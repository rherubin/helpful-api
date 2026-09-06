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
    if (!Array.isArray(header.x5c) || header.x5c.length < 2) {
      throw new AppleReceiptError('JWS header is missing its x5c certificate chain');
    }

    const chain = header.x5c.map(derToCertificate);
    this.verifyChain(chain);

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
  }
}

module.exports = {
  AppleReceiptError,
  AppleReceiptVerifier,
  ROOT_CA_PATH
};
