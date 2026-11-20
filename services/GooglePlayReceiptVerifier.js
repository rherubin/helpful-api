const crypto = require('crypto');
const axios = require('axios');

// Google Play has no offline-verifiable receipt like Apple's StoreKit 2 JWS:
// the only way to know a purchase_token is real is to ask the Google Play
// Developer API (Android Publisher) with a service account that has access to
// the app in Play Console. This verifier does exactly one read call,
// purchases.subscriptionsv2.get, and returns Google's view of the purchase.
//
// Auth is the standard service-account JWT bearer flow (RFC 7523): sign a
// short-lived RS256 JWT with the service account key, exchange it at the
// token endpoint for an access token, cache that token until shortly before
// it expires. Hand-rolled with node:crypto + axios (already a dependency)
// rather than pulling in googleapis/google-auth-library for a single call.
const ANDROID_PUBLISHER_SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const ANDROID_PUBLISHER_BASE_URL = 'https://androidpublisher.googleapis.com/androidpublisher/v3';
// Refresh a cached access token this long before Google says it expires.
const TOKEN_REFRESH_MARGIN_MS = 60 * 1000;
const DEFAULT_TIMEOUT_MS = 10 * 1000;

// `kind` tells the caller how to respond:
//   'invalid'     - Google says the token/purchase is not valid (client error, 4xx)
//   'unavailable' - we could not get an answer (auth, permissions, network, 5xx)
//   'config'      - credentials are missing or malformed
class GooglePlayReceiptError extends Error {
  constructor(message, { kind = 'unavailable', googleStatus = null, googleReason = null } = {}) {
    super(message);
    this.name = 'GooglePlayReceiptError';
    this.kind = kind;
    this.googleStatus = googleStatus;
    this.googleReason = googleReason;
  }
}

function base64UrlEncode(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

// Accepts the service account key file contents either as raw JSON or as
// base64-encoded JSON (easier to paste into some dashboards without
// newline/quote mangling). Returns null when nothing is configured.
function parseServiceAccount(raw) {
  if (raw === undefined || raw === null) {
    return null;
  }
  const trimmed = String(raw).trim();
  if (!trimmed) {
    return null;
  }

  let parsed;
  const candidates = trimmed.startsWith('{')
    ? [trimmed]
    : [Buffer.from(trimmed, 'base64').toString('utf8').trim(), trimmed];
  for (const candidate of candidates) {
    try {
      parsed = JSON.parse(candidate);
      break;
    } catch {
      // try the next form
    }
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new GooglePlayReceiptError(
      'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is not valid JSON (raw or base64-encoded)',
      { kind: 'config' }
    );
  }

  const clientEmail = parsed.client_email;
  // Dashboards sometimes store the key with literal "\n" sequences.
  const privateKey = typeof parsed.private_key === 'string'
    ? parsed.private_key.replace(/\\n/g, '\n')
    : null;
  if (!clientEmail || !privateKey) {
    throw new GooglePlayReceiptError(
      'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON must be a service account key with client_email and private_key',
      { kind: 'config' }
    );
  }
  try {
    crypto.createPrivateKey(privateKey);
  } catch {
    throw new GooglePlayReceiptError(
      'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON private_key is not a valid PEM private key',
      { kind: 'config' }
    );
  }

  return {
    clientEmail,
    privateKey,
    privateKeyId: parsed.private_key_id || null,
    tokenUri: parsed.token_uri || DEFAULT_TOKEN_URI
  };
}

function parseRfc3339(value) {
  if (typeof value !== 'string' || !value) {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

class GooglePlayReceiptVerifier {
  // Everything is injectable so tests can exercise the real JWT signing and
  // response handling with a fake HTTP client and no Google credentials.
  constructor({
    serviceAccount = undefined,
    httpClient = axios,
    now = () => Date.now(),
    timeoutMs = DEFAULT_TIMEOUT_MS
  } = {}) {
    this.serviceAccount = serviceAccount === undefined
      ? parseServiceAccount(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON)
      : (typeof serviceAccount === 'string' ? parseServiceAccount(serviceAccount) : serviceAccount);
    this.httpClient = httpClient;
    this.now = now;
    this.timeoutMs = timeoutMs;
    this.cachedToken = null; // { accessToken, expiresAt }
    this.inflightToken = null;
  }

  isConfigured() {
    return !!this.serviceAccount;
  }

  buildAssertion() {
    const issuedAt = Math.floor(this.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    if (this.serviceAccount.privateKeyId) {
      header.kid = this.serviceAccount.privateKeyId;
    }
    const claims = {
      iss: this.serviceAccount.clientEmail,
      scope: ANDROID_PUBLISHER_SCOPE,
      aud: this.serviceAccount.tokenUri,
      iat: issuedAt,
      exp: issuedAt + 3600
    };
    const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(claims))}`;
    const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), this.serviceAccount.privateKey);
    return `${signingInput}.${base64UrlEncode(signature)}`;
  }

  async getAccessToken() {
    if (!this.isConfigured()) {
      throw new GooglePlayReceiptError('Google Play service account is not configured', { kind: 'config' });
    }
    if (this.cachedToken && this.cachedToken.expiresAt - TOKEN_REFRESH_MARGIN_MS > this.now()) {
      return this.cachedToken.accessToken;
    }
    // Concurrent receipts share one token exchange.
    if (!this.inflightToken) {
      this.inflightToken = this.fetchAccessToken().finally(() => {
        this.inflightToken = null;
      });
    }
    return this.inflightToken;
  }

  async fetchAccessToken() {
    const body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: this.buildAssertion()
    }).toString();

    let response;
    try {
      response = await this.httpClient.post(this.serviceAccount.tokenUri, body, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: this.timeoutMs
      });
    } catch (error) {
      const status = error.response?.status || null;
      const detail = error.response?.data?.error_description || error.response?.data?.error || error.message;
      throw new GooglePlayReceiptError(
        `Could not obtain a Google access token for the Play service account${status ? ` (HTTP ${status})` : ''}: ${detail}`,
        { kind: 'unavailable', googleStatus: status }
      );
    }

    const accessToken = response?.data?.access_token;
    const expiresIn = Number(response?.data?.expires_in) || 3600;
    if (!accessToken) {
      throw new GooglePlayReceiptError('Google token endpoint returned no access_token', { kind: 'unavailable' });
    }
    this.cachedToken = { accessToken, expiresAt: this.now() + expiresIn * 1000 };
    return accessToken;
  }

  // Returns the raw SubscriptionPurchaseV2 resource. Callers must use this
  // instead of anything the client sent.
  async getSubscription(packageName, purchaseToken) {
    if (typeof packageName !== 'string' || !packageName) {
      throw new GooglePlayReceiptError('package_name is required', { kind: 'invalid' });
    }
    if (typeof purchaseToken !== 'string' || !purchaseToken) {
      throw new GooglePlayReceiptError('purchase_token is required', { kind: 'invalid' });
    }

    const url = `${ANDROID_PUBLISHER_BASE_URL}/applications/${encodeURIComponent(packageName)}`
      + `/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;

    // One retry with a fresh token if Google rejects the cached one.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const accessToken = await this.getAccessToken();
      try {
        const response = await this.httpClient.get(url, {
          headers: { Authorization: `Bearer ${accessToken}` },
          timeout: this.timeoutMs
        });
        return response.data;
      } catch (error) {
        const status = error.response?.status || null;
        if (status === 401 && attempt === 0) {
          this.cachedToken = null;
          continue;
        }
        throw this.mapApiError(error);
      }
    }
    // Unreachable, but keeps linters honest.
    throw new GooglePlayReceiptError('Google Play API authentication failed', { kind: 'unavailable' });
  }

  mapApiError(error) {
    const status = error.response?.status || null;
    const apiError = error.response?.data?.error || {};
    const reason = Array.isArray(apiError.errors) && apiError.errors[0]?.reason
      ? apiError.errors[0].reason
      : (apiError.status || null);
    const detail = apiError.message || error.message;

    if (status === 404 || status === 410 || status === 400) {
      const message = status === 404
        ? 'Google Play does not recognise this purchase token for this package'
        : status === 410
          ? 'Google Play says this purchase token is no longer valid'
          : `Google Play rejected the purchase token: ${detail}`;
      return new GooglePlayReceiptError(message, { kind: 'invalid', googleStatus: status, googleReason: reason });
    }
    if (status === 401 || status === 403) {
      return new GooglePlayReceiptError(
        `Google Play API refused the service account (HTTP ${status}${reason ? `, ${reason}` : ''}). `
        + 'Check that the Android Publisher API is enabled and the service account has access to this app in Play Console.',
        { kind: 'unavailable', googleStatus: status, googleReason: reason }
      );
    }
    return new GooglePlayReceiptError(
      `Google Play API request failed${status ? ` (HTTP ${status})` : ''}: ${detail}`,
      { kind: 'unavailable', googleStatus: status, googleReason: reason }
    );
  }
}

module.exports = {
  GooglePlayReceiptError,
  GooglePlayReceiptVerifier,
  parseServiceAccount,
  parseRfc3339,
  ANDROID_PUBLISHER_SCOPE,
  ANDROID_PUBLISHER_BASE_URL,
  DEFAULT_TOKEN_URI
};
