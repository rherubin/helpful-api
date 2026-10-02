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
    this.createdDirs = [];
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

  async withEnv(overrides, fn) {
    const previous = {};
    for (const key of Object.keys(overrides)) {
      previous[key] = process.env[key];
      const value = overrides[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    try {
      return await fn();
    } finally {
      for (const key of Object.keys(overrides)) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
    }
  }

  iapService(chain) {
    return new SubscriptionService(
      null, null, null, null, null,
      new AppleReceiptVerifier({ rootCertificatePem: chain.rootPem })
    );
  }

  // root -> intermediate -> leaf, mirroring the shape Apple sends in x5c.
  buildChain({ appleOids = true } = {}) {
    this.tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apple-receipt-test-'));
    this.createdDirs.push(this.tmpDir);

    for (const name of ['root', 'intermediate', 'leaf']) {
      this.openssl(['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', `${name}.key`]);
    }

    this.openssl([
      'req', '-x509', '-new', '-key', 'root.key', '-sha256', '-days', '2',
      '-subj', '/CN=Test Root CA', '-out', 'root.pem'
    ]);

    this.openssl(['req', '-new', '-key', 'intermediate.key', '-subj', '/CN=Test Intermediate', '-out', 'intermediate.csr']);
    if (appleOids) {
      fs.writeFileSync(
        path.join(this.tmpDir, 'intermediate.ext'),
        'basicConstraints=CA:TRUE\n1.2.840.113635.100.6.2.1=ASN1:NULL\n'
      );
    }
    this.openssl([
      'x509', '-req', '-in', 'intermediate.csr', '-CA', 'root.pem', '-CAkey', 'root.key',
      '-CAcreateserial', '-days', '2', '-sha256', '-out', 'intermediate.pem',
      ...(appleOids ? ['-extfile', 'intermediate.ext'] : [])
    ]);

    this.openssl(['req', '-new', '-key', 'leaf.key', '-subj', '/CN=Test Leaf', '-out', 'leaf.csr']);
    if (appleOids) {
      fs.writeFileSync(
        path.join(this.tmpDir, 'leaf.ext'),
        '1.2.840.113635.100.6.11.1=ASN1:NULL\n'
      );
    }
    this.openssl([
      'x509', '-req', '-in', 'leaf.csr', '-CA', 'intermediate.pem', '-CAkey', 'intermediate.key',
      '-CAcreateserial', '-days', '2', '-sha256', '-out', 'leaf.pem',
      ...(appleOids ? ['-extfile', 'leaf.ext'] : [])
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

  async testVerifierRejectsMissingAppleOids() {
    this.log('🧪 Verifier: missing Apple certificate OIDs', 'section');
    const bareChain = this.buildChain({ appleOids: false });
    const verifier = new AppleReceiptVerifier({ rootCertificatePem: bareChain.rootPem });

    try {
      verifier.verify(this.signJws(bareChain, this.validClaims()));
      this.assert(false, 'Chain missing Apple receipt OIDs is rejected', 'verify() resolved');
    } catch (error) {
      this.assert(
        error instanceof AppleReceiptError && /OID/i.test(error.message),
        'Chain missing Apple receipt OIDs is rejected',
        error.message
      );
    }
  }

  async testVerifierNamesXcodeReceipt() {
    this.log('🧪 Verifier: Xcode local StoreKit chain', 'section');
    const appleLike = this.buildChain();
    const xcodeChain = this.buildChain();
    const verifier = new AppleReceiptVerifier({ rootCertificatePem: appleLike.rootPem });

    try {
      verifier.verify(this.signJws(xcodeChain, this.validClaims({ environment: 'Xcode' })));
      this.assert(false, 'Xcode-signed receipt names the local StoreKit cause', 'verify() resolved');
    } catch (error) {
      this.assert(
        error instanceof AppleReceiptError && /Xcode local StoreKit/i.test(error.message),
        'Xcode-signed receipt names the local StoreKit cause',
        error.message
      );
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
    const service = this.iapService(chain);

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
    const service = this.iapService(chain);

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
    await this.withEnv({
      APPLE_BUNDLE_ID: 'com.helpful.sittogether',
      APPLE_IAP_ENVIRONMENT: 'Sandbox'
    }, () => {
      const service = new SubscriptionService(null, null, null, null, null,
        new AppleReceiptVerifier({ rootCertificatePem: chain.rootPem }));
      const claims = this.validClaims({ bundleId: 'com.someone.else' });

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
        this.assert(false, 'Validly signed receipt for another app is rejected', 'no error thrown');
      } catch (error) {
        this.assert(
          error instanceof SubscriptionError && /different application/i.test(error.message),
          'Validly signed receipt for another app is rejected',
          error.message
        );
      }
    });
  }

  async testServiceRequiresBundleId(chain) {
    this.log('🧪 Service: missing APPLE_BUNDLE_ID', 'section');
    await this.withEnv({
      APPLE_BUNDLE_ID: undefined,
      APPLE_IAP_ENVIRONMENT: 'Sandbox'
    }, () => {
      const service = new SubscriptionService(null, null, null, null, null,
        new AppleReceiptVerifier({ rootCertificatePem: chain.rootPem }));
      const claims = this.validClaims();

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
        this.assert(false, 'Missing APPLE_BUNDLE_ID fail-closes verification', 'no error thrown');
      } catch (error) {
        this.assert(
          error instanceof SubscriptionError && error.statusCode === 503
            && /APPLE_BUNDLE_ID is required/i.test(error.message),
          'Missing APPLE_BUNDLE_ID fail-closes verification',
          error.message
        );
      }
    });
  }

  verifySandboxReceipt(chain, claimOverrides = {}) {
    const service = this.iapService(chain);
    const claims = this.validClaims({ environment: 'Sandbox', ...claimOverrides });
    return service.verifyIosReceipt({
      product_id: claims.productId,
      transaction_id: claims.transactionId,
      original_transaction_id: claims.originalTransactionId,
      jws_receipt: this.signJws(chain, claims),
      environment: 'Sandbox',
      purchase_date: claims.purchaseDate,
      expiration_date: claims.expiresDate
    });
  }

  // App Review purchases with sandbox accounts against the production build,
  // so a production server must accept Sandbox receipts unless told otherwise.
  async testServiceAcceptsSandboxInProductionByDefault(chain) {
    this.log('🧪 Service: sandbox receipt on a production server (default)', 'section');
    await this.withEnv({
      APPLE_BUNDLE_ID: 'com.helpful.sittogether',
      APPLE_IAP_ENVIRONMENT: undefined,
      NODE_ENV: 'production',
      RAILWAY_ENVIRONMENT_NAME: 'production'
    }, () => {
      try {
        const result = this.verifySandboxReceipt(chain);
        this.assert(
          result.environment === 'Sandbox',
          'Sandbox receipts are accepted in production by default (App Review)',
          `environment=${result.environment}`
        );
      } catch (error) {
        this.assert(false, 'Sandbox receipts are accepted in production by default (App Review)', error.message);
      }
    });
  }

  async testServiceRejectsSandboxWhenNarrowedToProduction(chain) {
    this.log('🧪 Service: sandbox receipt when narrowed to Production', 'section');
    await this.withEnv({
      APPLE_BUNDLE_ID: 'com.helpful.sittogether',
      APPLE_IAP_ENVIRONMENT: 'Production'
    }, () => {
      try {
        this.verifySandboxReceipt(chain);
        this.assert(false, 'Sandbox receipts are rejected when APPLE_IAP_ENVIRONMENT=Production', 'no error thrown');
      } catch (error) {
        this.assert(
          error instanceof SubscriptionError && /not accepted by this server/i.test(error.message),
          'Sandbox receipts are rejected when APPLE_IAP_ENVIRONMENT=Production',
          error.message
        );
      }
    });
  }

  async testServiceAcceptsAnyListedBundle(chain) {
    this.log('🧪 Service: multiple APPLE_BUNDLE_IDs', 'section');
    await this.withEnv({
      APPLE_BUNDLE_ID: 'com.helpful.dev, com.helpful.sittogether',
      APPLE_IAP_ENVIRONMENT: undefined
    }, () => {
      try {
        this.verifySandboxReceipt(chain);
        this.assert(true, 'Receipt for any listed bundle id is accepted');
      } catch (error) {
        this.assert(false, 'Receipt for any listed bundle id is accepted', error.message);
      }
      try {
        this.verifySandboxReceipt(chain, { bundleId: 'com.someone.else' });
        this.assert(false, 'Receipt for an unlisted bundle id is rejected', 'no error thrown');
      } catch (error) {
        this.assert(
          error instanceof SubscriptionError && /different application/i.test(error.message),
          'Receipt for an unlisted bundle id is rejected',
          error.message
        );
      }
    });
  }

  async testServiceRejectsRevokedReceipt(chain) {
    this.log('🧪 Service: revoked receipt', 'section');
    const service = this.iapService(chain);
    const claims = this.validClaims({ revocationDate: Date.now() });

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
      this.assert(false, 'Revoked Apple receipt is rejected', 'no error thrown');
    } catch (error) {
      this.assert(
        error instanceof SubscriptionError && /revoked/i.test(error.message),
        'Revoked Apple receipt is rejected',
        error.message
      );
    }
  }

  async testServiceRejectsNonSubscription(chain) {
    this.log('🧪 Service: receipt with no expiry', 'section');
    const service = this.iapService(chain);

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
    const service = this.iapService(chain);

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
    const xcodeChain = this.buildChain();
    const service = this.iapService(chain);

    const claims = this.validClaims({ environment: 'Xcode' });
    try {
      service.verifyIosReceipt({
        product_id: claims.productId,
        transaction_id: claims.transactionId,
        original_transaction_id: claims.originalTransactionId,
        jws_receipt: this.signJws(xcodeChain, claims),
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
    for (const dir of new Set(this.createdDirs.filter(Boolean))) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    this.createdDirs = [];
    this.tmpDir = null;
  }

  async run() {
    this.log('🍎 Starting Apple Receipt Verifier Unit Tests', 'section');

    return this.withEnv({
      APPLE_BUNDLE_ID: process.env.APPLE_BUNDLE_ID || 'com.helpful.sittogether',
      APPLE_IAP_ENVIRONMENT: process.env.APPLE_IAP_ENVIRONMENT || 'Sandbox'
    }, async () => {
      try {
        const chain = this.buildChain();

        await this.testVerifierAcceptsGenuineReceipt(chain);
        await this.testVerifierRejectsTamperedPayload(chain);
        await this.testVerifierRejectsForeignRoot(chain);
        await this.testVerifierRejectsMissingAppleOids();
        await this.testVerifierNamesXcodeReceipt();
        await this.testVerifierRejectsBadAlgorithm(chain);
        await this.testVerifierRejectsMalformedInput(chain);
        await this.testVerifierRejectsExpiredCertificate(chain);
        await this.testServiceIgnoresClientExpiration(chain);
        await this.testServiceRejectsIdentifierMismatch(chain);
        await this.testServiceRejectsForeignBundle(chain);
        await this.testServiceRequiresBundleId(chain);
        await this.testServiceAcceptsSandboxInProductionByDefault(chain);
        await this.testServiceRejectsSandboxWhenNarrowedToProduction(chain);
        await this.testServiceAcceptsAnyListedBundle(chain);
        await this.testServiceRejectsRevokedReceipt(chain);
        await this.testServiceRejectsNonSubscription(chain);
        await this.testServiceAcceptsMissingClientExpiration(chain);
        await this.testServiceRejectsXcodeEnvironment(chain);
        await this.testPinnedRootIsAppleRoot();
      } catch (error) {
        this.log(`Unexpected failure: ${error.stack}`, 'fail');
        this.testResults.failed++;
        this.testResults.total++;
      } finally {
        this.cleanup();
      }

      this.log(
        `Apple receipt verifier tests: ${this.testResults.passed}/${this.testResults.total} passed`,
        this.testResults.failed === 0 ? 'pass' : 'fail'
      );
      return this.testResults.failed === 0;
    });
  }
}

module.exports = AppleReceiptVerifierTestRunner;

if (require.main === module) {
  const runner = new AppleReceiptVerifierTestRunner();
  runner.run().then((success) => process.exit(success ? 0 : 1));
}
