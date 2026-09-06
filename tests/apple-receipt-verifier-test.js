const crypto = require('crypto');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { AppleReceiptVerifier, AppleReceiptError } = require('../services/AppleReceiptVerifier');
const { SubscriptionService, SubscriptionError } = require('../services/SubscriptionService');

/**
 * AppleReceiptVerifier Unit Test Suite
 *
 * Builds a throwaway root -> intermediate -> leaf EC chain with openssl and
 * signs real JWS receipts with it, so these tests exercise the actual
 * chain-walking and ES256 signature path rather than a stubbed verifier.
 * Apple's own root is only pinned in production; here we pin the test root.
 *
 * Run with: node tests/apple-receipt-verifier-test.js
 * No server, database or Apple credentials required.
 */
class AppleReceiptVerifierTestRunner {
  constructor() {
    this.testResults = { passed: 0, failed: 0, total: 0 };
    this.tmpDir = null;
  }

  log(message, type = 'info') {
    const prefix = { info: '📝', pass: '✅', fail: '❌', warn: '⚠️', section: '🧪' }[type] || '📝';
    console.log(`${prefix} [${new Date().toISOString()}] ${message}`);
  }

  assert(condition, testName, details = '') {
    this.testResults.total++;
    if (condition) {
      this.testResults.passed++;
      this.log(`${testName} - PASSED ${details}`, 'pass');
    } else {
      this.testResults.failed++;
      this.log(`${testName} - FAILED ${details}`, 'fail');
    }
  }

  openssl(args) {
    execFileSync('openssl', args, { cwd: this.tmpDir, stdio: 'pipe' });
  }

  // root -> intermediate -> leaf, mirroring the shape Apple sends in x5c.
  buildChain() {
    this.tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apple-receipt-test-'));

    for (const name of ['root', 'intermediate', 'leaf']) {
      this.openssl(['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', `${name}.key`]);
    }

    this.openssl([
      'req', '-x509', '-new', '-key', 'root.key', '-sha256', '-days', '2',
      '-subj', '/CN=Test Root CA', '-out', 'root.pem'
    ]);

    this.openssl(['req', '-new', '-key', 'intermediate.key', '-subj', '/CN=Test Intermediate', '-out', 'intermediate.csr']);
    this.openssl([
      'x509', '-req', '-in', 'intermediate.csr', '-CA', 'root.pem', '-CAkey', 'root.key',
      '-CAcreateserial', '-days', '2', '-sha256', '-out', 'intermediate.pem'
    ]);

    this.openssl(['req', '-new', '-key', 'leaf.key', '-subj', '/CN=Test Leaf', '-out', 'leaf.csr']);
    this.openssl([
      'x509', '-req', '-in', 'leaf.csr', '-CA', 'intermediate.pem', '-CAkey', 'intermediate.key',
      '-CAcreateserial', '-days', '2', '-sha256', '-out', 'leaf.pem'
    ]);

    const read = (file) => fs.readFileSync(path.join(this.tmpDir, file), 'utf8');
    return {
      rootPem: read('root.pem'),
      leafKeyPem: read('leaf.key'),
      x5c: ['leaf.pem', 'intermediate.pem', 'root.pem'].map((file) => {
        const pem = read(file);
        return pem
          .replace(/-----(BEGIN|END) CERTIFICATE-----/g, '')
          .replace(/\s+/g, '');
      })
    };
  }

  base64Url(buffer) {
    return Buffer.from(buffer).toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  signJws(chain, claims, { alg = 'ES256', tamperPayload = false } = {}) {
    const header = this.base64Url(JSON.stringify({ alg, x5c: chain.x5c }));
    const payload = this.base64Url(JSON.stringify(claims));
    const signature = crypto.sign(
      'sha256',
      Buffer.from(`${header}.${payload}`, 'ascii'),
      { key: chain.leafKeyPem, dsaEncoding: 'ieee-p1363' }
    );

    const finalPayload = tamperPayload
      ? this.base64Url(JSON.stringify({ ...claims, expiresDate: claims.expiresDate + 31536000000 }))
      : payload;

    return `${header}.${finalPayload}.${this.base64Url(signature)}`;
  }

  validClaims(overrides = {}) {
    const now = Date.now();
    return {
      transactionId: 'txn_1001',
      originalTransactionId: 'txn_1000',
      productId: 'com.helpful.sittogether.monthly',
      bundleId: 'com.helpful.sittogether',
      environment: 'Sandbox',
      purchaseDate: now - 1000,
      expiresDate: now + 2592000000,
      ...overrides
    };
  }

  async testVerifierAcceptsGenuineReceipt(chain) {
    this.log('🧪 Verifier: genuine receipt', 'section');
    const verifier = new AppleReceiptVerifier({ rootCertificatePem: chain.rootPem });
    const claims = this.validClaims();

    try {
      const decoded = verifier.verify(this.signJws(chain, claims));
      this.assert(decoded.transactionId === 'txn_1001', 'Genuine receipt verifies and returns its claims');
      this.assert(decoded.expiresDate === claims.expiresDate, 'Decoded expiry matches the signed value');
    } catch (error) {
      this.assert(false, 'Genuine receipt verifies and returns its claims', error.message);
    }
  }

  async testVerifierRejectsTamperedPayload(chain) {
    this.log('🧪 Verifier: tampered payload', 'section');
    const verifier = new AppleReceiptVerifier({ rootCertificatePem: chain.rootPem });
    const jws = this.signJws(chain, this.validClaims(), { tamperPayload: true });

    try {
      verifier.verify(jws);
      this.assert(false, 'Payload edited after signing is rejected', 'verify() resolved');
    } catch (error) {
      this.assert(
        error instanceof AppleReceiptError && /signature does not match/i.test(error.message),
        'Payload edited after signing is rejected',
        error.message
      );
    }
  }

  async testVerifierRejectsForeignRoot(chain) {
    this.log('🧪 Verifier: chain from another CA', 'section');
    // A completely self-consistent chain — just not ours.
    const otherChain = this.buildChain();
    const verifier = new AppleReceiptVerifier({ rootCertificatePem: chain.rootPem });

    try {
      verifier.verify(this.signJws(otherChain, this.validClaims()));
      this.assert(false, 'Self-consistent chain from a different root is rejected', 'verify() resolved');
    } catch (error) {
      this.assert(
        error instanceof AppleReceiptError && /pinned Apple root/i.test(error.message),
        'Self-consistent chain from a different root is rejected',
        error.message
      );
    }
  }

  async testVerifierRejectsBadAlgorithm(chain) {
    this.log('🧪 Verifier: algorithm confusion', 'section');
    const verifier = new AppleReceiptVerifier({ rootCertificatePem: chain.rootPem });
    const header = this.base64Url(JSON.stringify({ alg: 'none', x5c: chain.x5c }));
    const payload = this.base64Url(JSON.stringify(this.validClaims()));

    try {
      verifier.verify(`${header}.${payload}.`);
      this.assert(false, 'alg:none is rejected', 'verify() resolved');
    } catch (error) {
      this.assert(
        error instanceof AppleReceiptError && /Unsupported JWS algorithm/i.test(error.message),
        'alg:none is rejected',
        error.message
      );
    }
  }

  async testVerifierRejectsMalformedInput(chain) {
    this.log('🧪 Verifier: malformed input', 'section');
    const verifier = new AppleReceiptVerifier({ rootCertificatePem: chain.rootPem });

    for (const [input, label] of [['', 'empty string'], ['a.b', 'two segments'], ['not-a-jws', 'no segments']]) {
      try {
        verifier.verify(input);
        this.assert(false, `Malformed receipt (${label}) is rejected`, 'verify() resolved');
      } catch (error) {
        this.assert(error instanceof AppleReceiptError, `Malformed receipt (${label}) is rejected`, error.message);
      }
    }
  }

  async testVerifierRejectsExpiredCertificate(chain) {
    this.log('🧪 Verifier: expired certificate', 'section');
    // Same chain, but evaluated a decade from now — every cert is out of date.
    const tenYears = Date.now() + 315360000000;
    const verifier = new AppleReceiptVerifier({
      rootCertificatePem: chain.rootPem,
      now: () => tenYears
    });

    try {
      verifier.verify(this.signJws(chain, this.validClaims()));
      this.assert(false, 'Chain with an out-of-window certificate is rejected', 'verify() resolved');
    } catch (error) {
      this.assert(
        error instanceof AppleReceiptError && /validity window/i.test(error.message),
        'Chain with an out-of-window certificate is rejected',
        error.message
      );
    }
  }

  // The regression that matters: PR #12's hole was trusting expiration_date.
  async testServiceIgnoresClientExpiration(chain) {
    this.log('🧪 Service: Apple claims override the client', 'section');
    const service = new SubscriptionService(null, null, null, null, null,
      new AppleReceiptVerifier({ rootCertificatePem: chain.rootPem }));

    const claims = this.validClaims();
    const jws = this.signJws(chain, claims);
    const forgedExpiry = Date.now() + 315360000000;

    const validated = service.verifyIosReceipt({
      product_id: claims.productId,
      transaction_id: claims.transactionId,
      original_transaction_id: claims.originalTransactionId,
      jws_receipt: jws,
      environment: 'Sandbox',
      purchase_date: claims.purchaseDate,
      expiration_date: forgedExpiry
    });

    this.assert(
      validated.expiration_date === claims.expiresDate,
      'A forged expiration_date is replaced by Apple\'s signed value'
    );
    this.assert(
      validated.expiration_date !== forgedExpiry,
      'The ten-year expiry the client asked for is not persisted'
    );
  }

  async testServiceRejectsIdentifierMismatch(chain) {
    this.log('🧪 Service: identifier mismatch', 'section');
    const service = new SubscriptionService(null, null, null, null, null,
      new AppleReceiptVerifier({ rootCertificatePem: chain.rootPem }));

    const claims = this.validClaims();
    try {
      service.verifyIosReceipt({
        product_id: claims.productId,
        transaction_id: 'someone-elses-transaction',
        original_transaction_id: claims.originalTransactionId,
        jws_receipt: this.signJws(chain, claims),
        environment: 'Sandbox',
        purchase_date: claims.purchaseDate,
        expiration_date: claims.expiresDate
      });
      this.assert(false, 'Receipt describing a different transaction is rejected', 'no error thrown');
    } catch (error) {
      this.assert(
        error instanceof SubscriptionError && error.statusCode === 400,
        'Receipt describing a different transaction is rejected',
        error.message
      );
    }
  }

  async testServiceRejectsForeignBundle(chain) {
    this.log('🧪 Service: bundle id mismatch', 'section');
    const previous = process.env.APPLE_BUNDLE_ID;
    process.env.APPLE_BUNDLE_ID = 'com.helpful.sittogether';

    try {
      const service = new SubscriptionService(null, null, null, null, null,
        new AppleReceiptVerifier({ rootCertificatePem: chain.rootPem }));
      const claims = this.validClaims({ bundleId: 'com.someone.else' });

      service.verifyIosReceipt({
        product_id: claims.productId,
        transaction_id: claims.transactionId,
        original_transaction_id: claims.originalTransactionId,
        jws_receipt: this.signJws(chain, claims),
        environment: 'Sandbox',
        purchase_date: claims.purchaseDate,
        expiration_date: claims.expiresDate
      });
      this.assert(false, 'Validly signed receipt for another app is rejected', 'no error thrown');
    } catch (error) {
      this.assert(
        error instanceof SubscriptionError && /different application/i.test(error.message),
        'Validly signed receipt for another app is rejected',
        error.message
      );
    } finally {
      if (previous === undefined) delete process.env.APPLE_BUNDLE_ID;
      else process.env.APPLE_BUNDLE_ID = previous;
    }
  }

  async testServiceRejectsNonSubscription(chain) {
    this.log('🧪 Service: receipt with no expiry', 'section');
    const service = new SubscriptionService(null, null, null, null, null,
      new AppleReceiptVerifier({ rootCertificatePem: chain.rootPem }));

    const claims = this.validClaims();
    delete claims.expiresDate;

    try {
      service.verifyIosReceipt({
        product_id: claims.productId,
        transaction_id: claims.transactionId,
        original_transaction_id: claims.originalTransactionId,
        jws_receipt: this.signJws(chain, claims),
        environment: 'Sandbox',
        purchase_date: claims.purchaseDate,
        expiration_date: Date.now() + 2592000000
      });
      this.assert(false, 'Receipt without a subscription expiry is rejected', 'no error thrown');
    } catch (error) {
      this.assert(
        error instanceof SubscriptionError && /no subscription expiration/i.test(error.message),
        'Receipt without a subscription expiry is rejected',
        error.message
      );
    }
  }

  // The pinned production certificate must actually be Apple's.
  async testPinnedRootIsAppleRoot() {
    this.log('🧪 Pinned root certificate', 'section');
    const { ROOT_CA_PATH } = require('../services/AppleReceiptVerifier');
    const certificate = new crypto.X509Certificate(fs.readFileSync(ROOT_CA_PATH, 'utf8'));

    this.assert(
      certificate.subject.includes('Apple Root CA - G3'),
      'Pinned certificate is Apple Root CA - G3',
      certificate.subject.replace(/\n/g, ' ')
    );
    this.assert(
      certificate.verify(certificate.publicKey),
      'Pinned root is self-signed'
    );
    this.assert(
      certificate.fingerprint256 === '63:34:3A:BF:B8:9A:6A:03:EB:B5:7E:9B:3F:5F:A7:BE:7C:4F:5C:75:6F:30:17:B3:A8:C4:88:C3:65:3E:91:79',
      'Pinned root SHA-256 fingerprint matches Apple\'s published value'
    );
  }

  // The mobile client types expirationDate as optional (Long? = null) while the
  // API used to require it. On the verified path Apple supplies the expiry.
  async testServiceAcceptsMissingClientExpiration(chain) {
    this.log('🧪 Service: client omits expiration_date', 'section');
    const service = new SubscriptionService(null, null, null, null, null,
      new AppleReceiptVerifier({ rootCertificatePem: chain.rootPem }));

    const claims = this.validClaims();
    const payload = {
      platform: 'ios',
      product_id: claims.productId,
      transaction_id: claims.transactionId,
      original_transaction_id: claims.originalTransactionId,
      jws_receipt: this.signJws(chain, claims),
      environment: 'Sandbox',
      purchase_date: claims.purchaseDate
      // expiration_date deliberately absent, as the Kotlin model allows
    };

    try {
      const validated = service.validateIosPayload(payload, { requireExpiration: false });
      this.assert(validated.expiration_date === null, 'Absent expiration_date is accepted on the verified path');
      const verified = service.verifyIosReceipt(validated);
      this.assert(
        verified.expiration_date === claims.expiresDate,
        'Expiry is filled in from Apple\'s signed claims'
      );
    } catch (error) {
      this.assert(false, 'Absent expiration_date is accepted on the verified path', error.message);
    }

    // The mock path still demands it, so existing behaviour is unchanged.
    try {
      service.validateIosPayload(payload, { requireExpiration: true });
      this.assert(false, 'Mock path still requires expiration_date', 'no error thrown');
    } catch (error) {
      this.assert(
        error instanceof SubscriptionError && /expiration_date is required/i.test(error.message),
        'Mock path still requires expiration_date',
        error.message
      );
    }
  }

  async testServiceRejectsXcodeEnvironment(chain) {
    this.log('🧪 Service: Xcode local StoreKit receipt', 'section');
    const service = new SubscriptionService(null, null, null, null, null,
      new AppleReceiptVerifier({ rootCertificatePem: chain.rootPem }));

    const claims = this.validClaims({ environment: 'Xcode' });
    try {
      service.verifyIosReceipt({
        product_id: claims.productId,
        transaction_id: claims.transactionId,
        original_transaction_id: claims.originalTransactionId,
        jws_receipt: this.signJws(chain, claims),
        environment: 'Sandbox',
        purchase_date: claims.purchaseDate,
        expiration_date: claims.expiresDate
      });
      this.assert(false, 'Xcode-environment receipt gets an actionable error', 'no error thrown');
    } catch (error) {
      this.assert(
        error instanceof SubscriptionError && /Xcode local StoreKit/i.test(error.message),
        'Xcode-environment receipt gets an actionable error',
        error.message
      );
    }
  }

  cleanup() {
    if (this.tmpDir) {
      fs.rmSync(this.tmpDir, { recursive: true, force: true });
      this.tmpDir = null;
    }
  }

  async run() {
    this.log('🍎 Starting Apple Receipt Verifier Unit Tests', 'section');
    const roots = [];

    try {
      const chain = this.buildChain();
      roots.push(this.tmpDir);

      await this.testVerifierAcceptsGenuineReceipt(chain);
      await this.testVerifierRejectsTamperedPayload(chain);
      await this.testVerifierRejectsForeignRoot(chain);
      roots.push(this.tmpDir);
      await this.testVerifierRejectsBadAlgorithm(chain);
      await this.testVerifierRejectsMalformedInput(chain);
      await this.testVerifierRejectsExpiredCertificate(chain);
      await this.testServiceIgnoresClientExpiration(chain);
      await this.testServiceRejectsIdentifierMismatch(chain);
      await this.testServiceRejectsForeignBundle(chain);
      await this.testServiceRejectsNonSubscription(chain);
      await this.testServiceAcceptsMissingClientExpiration(chain);
      await this.testServiceRejectsXcodeEnvironment(chain);
      await this.testPinnedRootIsAppleRoot();
    } catch (error) {
      this.log(`Unexpected failure: ${error.stack}`, 'fail');
      this.testResults.failed++;
      this.testResults.total++;
    } finally {
      for (const dir of new Set(roots.filter(Boolean))) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
      this.cleanup();
    }

    this.log(
      `Apple receipt verifier tests: ${this.testResults.passed}/${this.testResults.total} passed`,
      this.testResults.failed === 0 ? 'pass' : 'fail'
    );
    return this.testResults.failed === 0;
  }
}

module.exports = AppleReceiptVerifierTestRunner;

if (require.main === module) {
  const runner = new AppleReceiptVerifierTestRunner();
  runner.run().then((success) => process.exit(success ? 0 : 1));
}
