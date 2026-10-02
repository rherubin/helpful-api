const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Apple signs every StoreKit 2 transaction as a JWS whose header carries the
// full certificate chain (x5c: leaf -> intermediate -> Apple Root CA G3). The
// root is public and pinned here from
// https://www.apple.com/certificateauthority/AppleRootCA-G3.cer
// (SHA-256 63:34:3A:BF:B8:9A:6A:03:EB:B5:7E:9B:3F:5F:A7:BE:7C:4F:5C:75:6F:30:17:B3:A8:C4:88:C3:65:3E:91:79).
//
// Verifying that chain offline is what makes the transaction trustworthy — no
// App Store Connect credentials are involved. An In-App Purchase key is only
// needed to *call* the App Store Server API (status lookups, refunds), which
// this verifier deliberately does not do.
const ROOT_CA_PATH = path.join(__dirname, '..', 'certs', 'AppleRootCA-G3.pem');

// Apple's App Store Server library requires these extensions so a leaf issued
// for some other Apple product cannot mint a StoreKit 2 transaction JWS.
const APPLE_RECEIPT_SIGNING_OID = '1.2.840.113635.100.6.11.1';
const APPLE_WWDR_OID = '1.2.840.113635.100.6.2.1';

function encodeOid(oid) {
  const parts = oid.split('.').map(Number);
  const bytes = [40 * parts[0] + parts[1]];
  for (const part of parts.slice(2)) {
    const stack = [part & 0x7f];
    let value = Math.floor(part / 128);
    while (value > 0) {
      stack.unshift(value & 0x7f);
      value = Math.floor(value / 128);
    }
    for (let i = 0; i < stack.length - 1; i += 1) {
      stack[i] |= 0x80;
    }
    bytes.push(...stack);
  }
  return Buffer.from(bytes);
}

function certificateHasOid(certificate, oid) {
  return certificate.raw.includes(encodeOid(oid));
}

class AppleReceiptError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AppleReceiptError';
  }
}

function base64UrlDecode(segment) {
  if (typeof segment !== 'string' || segment.length === 0) {
    throw new AppleReceiptError('Malformed JWS: empty segment');
  }
  return Buffer.from(segment.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function parseJson(buffer, what) {
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch {
    throw new AppleReceiptError(`Malformed JWS: ${what} is not valid JSON`);
  }
}

function derToCertificate(derBase64) {
  const pem = [
    '-----BEGIN CERTIFICATE-----',
    ...(derBase64.match(/.{1,64}/g) || []),
    '-----END CERTIFICATE-----',
    ''
  ].join('\n');
  try {
    return new crypto.X509Certificate(pem);
  } catch {
    throw new AppleReceiptError('Malformed JWS: x5c entry is not a valid certificate');
  }
}

class AppleReceiptVerifier {
  // `rootCertificatePem` is injectable so tests can pin their own throwaway
  // root and exercise the real chain-verification path rather than a stub.
  constructor({ rootCertificatePem = null, now = () => Date.now() } = {}) {
    const pem = rootCertificatePem !== null
      ? rootCertificatePem
      : fs.readFileSync(ROOT_CA_PATH, 'utf8');
    this.rootCertificate = new crypto.X509Certificate(pem);
    this.now = now;
  }

  // Returns Apple's own signed claims. Everything the client sent alongside the
  // receipt is untrusted and must be reconciled against what this returns.
  verify(jwsReceipt) {
    if (typeof jwsReceipt !== 'string' || jwsReceipt.length === 0) {
      throw new AppleReceiptError('jws_receipt must be a non-empty string');
    }

    const parts = jwsReceipt.split('.');
    if (parts.length !== 3) {
      throw new AppleReceiptError('Malformed JWS: expected three dot-separated segments');
    }
    const [encodedHeader, encodedPayload, encodedSignature] = parts;

    const header = parseJson(base64UrlDecode(encodedHeader), 'header');
    if (header.alg !== 'ES256') {
      throw new AppleReceiptError(`Unsupported JWS algorithm: ${header.alg}`);
    }
    if (!Array.isArray(header.x5c) || header.x5c.length < 3) {
      throw new AppleReceiptError('JWS header is missing its x5c certificate chain');
    }

    const chain = header.x5c.map(derToCertificate);
    try {
      this.verifyChain(chain);
    } catch (error) {
      const xcodeMessage = this.xcodeReceiptErrorMessage(encodedPayload, error);
      throw xcodeMessage ? new AppleReceiptError(xcodeMessage) : error;
    }

    const leaf = chain[0];
    const signingInput = Buffer.from(`${encodedHeader}.${encodedPayload}`, 'ascii');
    const signature = base64UrlDecode(encodedSignature);

    // JWS ES256 signatures are the raw r||s pair, not the DER encoding Node
    // defaults to — without ieee-p1363 every genuine signature fails to verify.
    const signatureValid = crypto.verify(
      'sha256',
      signingInput,
      { key: leaf.publicKey, dsaEncoding: 'ieee-p1363' },
      signature
    );
    if (!signatureValid) {
      throw new AppleReceiptError('JWS signature does not match its signing certificate');
    }

    return parseJson(base64UrlDecode(encodedPayload), 'payload');
  }

  verifyChain(chain) {
    const now = new Date(this.now());

    for (const certificate of chain) {
      const notBefore = new Date(certificate.validFrom);
      const notAfter = new Date(certificate.validTo);
      if (now < notBefore || now > notAfter) {
        throw new AppleReceiptError(
          `Certificate in chain is outside its validity window (${certificate.subject})`
        );
      }
    }

    // Each certificate must be signed by the next one up.
    for (let i = 0; i < chain.length - 1; i += 1) {
      if (!chain[i].verify(chain[i + 1].publicKey)) {
        throw new AppleReceiptError('Certificate chain is not internally consistent');
      }
    }

    // The chain Apple sends ends at its own root. Pin it: compare the raw DER
    // of the last certificate against our copy, so a self-consistent chain from
    // some other CA cannot pass. `raw.equals` is a constant-length byte compare
    // over public data — the secret here is Apple's private key, not the cert.
    const chainRoot = chain[chain.length - 1];
    if (!chainRoot.raw.equals(this.rootCertificate.raw)) {
      throw new AppleReceiptError('Certificate chain does not terminate at the pinned Apple root');
    }

    // Guard against a chain that merely *includes* the root without the root
    // having actually signed the certificate below it.
    if (chain.length >= 2) {
      const intermediate = chain[chain.length - 2];
      if (!intermediate.verify(this.rootCertificate.publicKey)) {
        throw new AppleReceiptError('Intermediate certificate was not signed by the Apple root');
      }
    }

    const leaf = chain[0];
    const intermediate = chain[chain.length - 2];
    if (!certificateHasOid(leaf, APPLE_RECEIPT_SIGNING_OID)) {
      throw new AppleReceiptError('Leaf certificate is missing Apple receipt signing OID');
    }
    if (!certificateHasOid(intermediate, APPLE_WWDR_OID)) {
      throw new AppleReceiptError('Intermediate certificate is missing Apple WWDR OID');
    }
  }

  // Real Xcode StoreKit receipts never verify — they are signed by Xcode's own
  // root. Peek at the untrusted payload only to name that case instead of a
  // generic pin failure. The payload is not used for any authorization decision.
  xcodeReceiptErrorMessage(encodedPayload, chainError) {
    if (!/pinned Apple root/i.test(chainError.message)) {
      return null;
    }
    try {
      const payload = parseJson(base64UrlDecode(encodedPayload), 'payload');
      if (typeof payload.environment === 'string'
        && payload.environment.trim().toLowerCase() === 'xcode') {
        return 'Receipt came from Xcode local StoreKit testing, which Apple does not sign. '
          + 'Use an App Store sandbox purchase, or set TEST_MOCK_IAP=true for local testing only.';
      }
    } catch {
      return null;
    }
    return null;
  }
}

module.exports = {
  AppleReceiptError,
  AppleReceiptVerifier,
  ROOT_CA_PATH,
  APPLE_RECEIPT_SIGNING_OID,
  APPLE_WWDR_OID
};
