/**
 * Stripe Customer Email Sync Test Suite
 *
 * Regression coverage for StripeBillingService.updateCustomerEmail(): when a
 * trial account (created with a placeholder email before payment) later sets
 * its real email, the linked Stripe customer record must be updated to match
 * — otherwise Stripe receipts/invoices/dashboard keep the placeholder email
 * forever, since Stripe never pushes its own email changes back to us.
 *
 * Pure unit test against the mock Stripe client (no live server, DB, or
 * Stripe keys required).
 *
 * Run with: node tests/stripe-customer-email-sync-test.js
 */

const { StripeBillingService, createMockStripe } = require('../services/StripeBillingService');

class StripeCustomerEmailSyncTestRunner {
  constructor() {
    this.testResults = { passed: 0, failed: 0, total: 0 };
  }

  log(message, type = 'info') {
    const prefix = { info: '📝', pass: '✅', fail: '❌', warn: '⚠️', section: '💳' }[type] || '📝';
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

  // Minimal fake userModel: just enough for updateCustomerEmail's getUserById lookup.
  makeUserModel(usersById) {
    return {
      async getUserById(id) {
        const user = usersById.get(id);
        if (!user) throw new Error('User not found');
        return user;
      }
    };
  }

  async testUpdatesStripeCustomerEmail() {
    this.log('Testing updateCustomerEmail syncs the Stripe customer record', 'section');

    const stripe = createMockStripe();
    const placeholderEmail = 'trial.abc123@sit-together.local';
    const customer = await stripe.customers.create({ email: placeholderEmail, metadata: {} });

    const usersById = new Map([
      ['user-1', { id: 'user-1', stripe_customer_id: customer.id }]
    ]);
    const service = new StripeBillingService(this.makeUserModel(usersById), {}, { stripeClient: stripe });

    const realEmail = 'real.person@example.com';
    await service.updateCustomerEmail('user-1', realEmail);

    const updated = await stripe.customers.retrieve(customer.id);
    this.assert(
      updated.email === realEmail,
      'Stripe customer email matches the account\'s real email after sync',
      `email: ${updated.email}`
    );
  }

  async testNoOpsWithoutStripeCustomerId() {
    this.log('Testing updateCustomerEmail no-ops for a user with no Stripe customer', 'section');

    const stripe = createMockStripe();
    const usersById = new Map([
      ['user-2', { id: 'user-2', stripe_customer_id: null }]
    ]);
    const service = new StripeBillingService(this.makeUserModel(usersById), {}, { stripeClient: stripe });

    let threw = false;
    try {
      await service.updateCustomerEmail('user-2', 'someone@example.com');
    } catch (err) {
      threw = true;
    }
    this.assert(!threw, 'Does not throw when the user has no stripe_customer_id yet');
  }

  async testPropagatesStripeErrorsToCaller() {
    this.log('Testing updateCustomerEmail surfaces a real Stripe failure to its caller', 'section');

    const stripe = createMockStripe();
    // Point at a customer id that was never created in the mock store.
    const usersById = new Map([
      ['user-3', { id: 'user-3', stripe_customer_id: 'cus_does_not_exist' }]
    ]);
    const service = new StripeBillingService(this.makeUserModel(usersById), {}, { stripeClient: stripe });

    let threw = false;
    try {
      await service.updateCustomerEmail('user-3', 'someone@example.com');
    } catch (err) {
      threw = true;
    }
    this.assert(threw, 'Propagates the error so the caller can decide how to handle it (route treats this as best-effort)');
  }

  printSummary() {
    this.log('📊 Stripe Customer Email Sync Test Results Summary', 'section');
    this.log(`Total Tests: ${this.testResults.total}`);
    this.log(`Passed: ${this.testResults.passed}`, 'pass');
    if (this.testResults.failed > 0) {
      this.log(`Failed: ${this.testResults.failed}`, 'fail');
    }
    const rate = this.testResults.total ? (this.testResults.passed / this.testResults.total * 100).toFixed(1) : '0.0';
    this.log(`Success Rate: ${rate}%`, this.testResults.failed === 0 ? 'pass' : 'warn');
  }

  async run() {
    await this.testUpdatesStripeCustomerEmail();
    await this.testNoOpsWithoutStripeCustomerId();
    await this.testPropagatesStripeErrorsToCaller();

    this.printSummary();
    return this.testResults.failed === 0;
  }
}

if (require.main === module) {
  const runner = new StripeCustomerEmailSyncTestRunner();
  runner.run()
    .then((success) => process.exit(success ? 0 : 1))
    .catch((err) => {
      console.error('Fatal error in test runner:', err);
      process.exit(1);
    });
}

module.exports = StripeCustomerEmailSyncTestRunner;
