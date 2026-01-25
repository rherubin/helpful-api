const axios = require('axios');
const { generateTestEmail } = require('./test-helpers');

/**
 * Subscription Endpoint Test Suite
 * Tests the POST /api/subscription endpoint for iOS and Android purchase receipts
 * 
 * Run with: node tests/subscription-test.js
 * Run with keep-data: node tests/subscription-test.js --__keep-data
 * 
 * The --__keep-data flag prevents cleanup of test data, allowing SQL verification:
 *   SELECT id, email, created_at FROM users
 *     WHERE email LIKE 'subscription_ios%@example.com'
 *        OR email LIKE 'subscription_android%@example.com';
 *   SELECT s.*, u.email FROM ios_subscriptions s JOIN users u ON s.user_id = u.id
 *     WHERE u.email LIKE 'subscription_ios%@example.com';
 *   SELECT s.*, u.email FROM android_subscriptions s JOIN users u ON s.user_id = u.id
 *     WHERE u.email LIKE 'subscription_android%@example.com';
 *   SELECT p.*, u1.email as user1_email, u2.email as user2_email FROM pairings p
 *     LEFT JOIN users u1 ON p.user1_id = u1.id
 *     LEFT JOIN users u2 ON p.user2_id = u2.id
 *     WHERE (u1.email LIKE 'subscription_ios%@example.com' OR u2.email LIKE 'subscription_ios%@example.com')
 *        AND p.premium = 1;
 */

class SubscriptionTestRunner {
  constructor(options = {}) {
    this.baseURL = options.baseURL || 'http://127.0.0.1:9000';
    this.timeout = options.timeout || 15000;
    this.keepData = process.argv.includes('--__keep-data');
    this.testResults = {
      passed: 0,
      failed: 0,
      total: 0
    };
    this.testData = {
      users: [],
      subscriptions: []
    };
  }

  log(message, type = 'info') {
    const timestamp = new Date().toISOString();
    const prefix = {
      info: '📝',
      pass: '✅',
      fail: '❌',
      warn: '⚠️',
      section: '🧪',
      data: '💾'
    }[type] || '📝';
    
    console.log(`${prefix} [${timestamp}] ${message}`);
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

  // Create a test user and return user data with token
  async createTestUser(prefix = 'subscription_test') {
    const timestamp = Date.now();
    const userData = {
      email: generateTestEmail(`${prefix}_${timestamp}`),
      password: 'SecurePass987!'
    };

    try {
      const response = await axios.post(`${this.baseURL}/api/users`, userData, {
        timeout: this.timeout
      });

      const user = {
        ...response.data.user,
        email: userData.email,
        token: response.data.access_token,
        refreshToken: response.data.refresh_token
      };

      this.testData.users.push(user);
      return user;
    } catch (error) {
      this.log(`Failed to create test user: ${error.response?.data?.error || error.message}`, 'fail');
      return null;
    }
  }

  // Create two users and pair them
  async createPairedUsers(prefix = 'subscription_test') {
    const user1 = await this.createTestUser(`${prefix}_user1`);
    const user2 = await this.createTestUser(`${prefix}_user2`);

    if (!user1 || !user2) {
      return null;
    }

    try {
      // User1 creates pairing request
      const pairingResponse = await axios.post(`${this.baseURL}/api/pairing/request`, {}, {
        headers: { Authorization: `Bearer ${user1.token}` },
        timeout: this.timeout
      });

      const partnerCode = pairingResponse.data.partner_code;

      // User2 accepts the pairing
      await axios.post(`${this.baseURL}/api/pairing/accept`, {
        partner_code: partnerCode
      }, {
        headers: { Authorization: `Bearer ${user2.token}` },
        timeout: this.timeout
      });

      // Wait for pairing to be processed
      await new Promise(resolve => setTimeout(resolve, 500));

      return { user1, user2, partnerCode };
    } catch (error) {
      this.log(`Failed to create paired users: ${error.response?.data?.error || error.message}`, 'fail');
      return null;
    }
  }

  // Test iOS subscription creation
  async testIosSubscriptionCreation() {
    this.log('Testing iOS Subscription Creation', 'section');

    const user = await this.createTestUser('subscription_ios');
    if (!user) {
      this.assert(false, 'Create user for iOS test', 'Failed to create test user');
      return;
    }

    // Create iOS subscription with future expiration (active)
    const futureExpiration = Date.now() + (365 * 24 * 60 * 60 * 1000); // 1 year from now
    const iosSubscription = {
      platform: 'ios',
      product_id: 'com.helpful.yearly.29.99',
      transaction_id: `test_txn_${Date.now()}`,
      original_transaction_id: `test_orig_txn_${Date.now()}`,
      jws_receipt: 'eyJhbGciOiJSUzI1NiIsIng1YyI6WyJNSUlCU...test_receipt',
      environment: 'Production',
      purchase_date: Date.now() - 1000,
      expiration_date: futureExpiration
    };

    try {
      const response = await axios.post(`${this.baseURL}/api/subscription`, iosSubscription, {
        headers: { Authorization: `Bearer ${user.token}` },
        timeout: this.timeout
      });

      this.assert(
        response.status === 201,
        'iOS subscription returns 201 for new subscription',
        `Status: ${response.status}`
      );

      this.assert(
        response.data.message === 'Subscription receipt created successfully',
        'iOS subscription returns correct message',
        `Message: ${response.data.message}`
      );

      this.assert(
        response.data.subscription.platform === 'ios',
        'iOS subscription returns correct platform',
        `Platform: ${response.data.subscription.platform}`
      );

      this.assert(
        response.data.subscription.is_active === true,
        'iOS subscription with future expiration is active',
        `Is active: ${response.data.subscription.is_active}`
      );

      this.assert(
        response.data.premium_status.active === true,
        'Premium status is active for valid subscription',
        `Premium active: ${response.data.premium_status.active}`
      );

      this.assert(
        response.data.premium_status.pairings_updated === 0,
        'No pairings updated to premium for single user',
        `Pairings updated: ${response.data.premium_status.pairings_updated}`
      );

      // Store for later tests
      this.testData.subscriptions.push({
        type: 'ios',
        data: iosSubscription,
        userId: user.id
      });

    } catch (error) {
      this.assert(false, 'iOS subscription creation', `Error: ${error.response?.data?.error || error.message}`);
    }
  }

  // Test Android subscription creation
  async testAndroidSubscriptionCreation() {
    this.log('Testing Android Subscription Creation', 'section');

    const user = await this.createTestUser('subscription_android');
    if (!user) {
      this.assert(false, 'Create user for Android test', 'Failed to create test user');
      return;
    }

    // Create Android subscription with future expiration (active)
    const futureExpiration = Date.now() + (365 * 24 * 60 * 60 * 1000); // 1 year from now
    const androidSubscription = {
      platform: 'android',
      product_id: 'com.helpful.yearly.29.99',
      purchase_token: `test_token_${Date.now()}_abcdefghijklmnop`,
      order_id: `GPA.${Date.now()}-1234-5678-90123`,
      package_name: 'com.helpful.app',
      purchase_date: Date.now() - 1000,
      expiration_date: futureExpiration
    };

    try {
      const response = await axios.post(`${this.baseURL}/api/subscription`, androidSubscription, {
        headers: { Authorization: `Bearer ${user.token}` },
        timeout: this.timeout
      });

      this.assert(
        response.status === 201,
        'Android subscription returns 201 for new subscription',
        `Status: ${response.status}`
      );

      this.assert(
        response.data.message === 'Subscription receipt created successfully',
        'Android subscription returns correct message',
        `Message: ${response.data.message}`
      );

      this.assert(
        response.data.subscription.platform === 'android',
        'Android subscription returns correct platform',
        `Platform: ${response.data.subscription.platform}`
      );

      this.assert(
        response.data.subscription.is_active === true,
        'Android subscription with future expiration is active',
        `Is active: ${response.data.subscription.is_active}`
      );

      // Store for later tests
      this.testData.subscriptions.push({
        type: 'android',
        data: androidSubscription,
        userId: user.id
      });

    } catch (error) {
      this.assert(false, 'Android subscription creation', `Error: ${error.response?.data?.error || error.message}`);
    }
  }

  // Test subscription update (same transaction_id/order_id sent again)
  async testSubscriptionUpdate() {
    this.log('Testing Subscription Update (Re-sending same transaction)', 'section');

    const iosUser = await this.createTestUser('subscription_ios_update');
    const androidUser = await this.createTestUser('subscription_android_update');
    if (!iosUser || !androidUser) {
      this.assert(false, 'Create users for update test', 'Failed to create test users');
      return;
    }

    const transactionId = `test_txn_update_${Date.now()}`;
    const orderId = `GPA.update_${Date.now()}-1234-5678`;

    // First iOS subscription
    const iosSubscription = {
      platform: 'ios',
      product_id: 'com.helpful.yearly.29.99',
      transaction_id: transactionId,
      original_transaction_id: transactionId,
      jws_receipt: 'test_receipt_v1',
      environment: 'Production',
      purchase_date: Date.now() - 1000,
      expiration_date: Date.now() + (30 * 24 * 60 * 60 * 1000) // 30 days
    };

    try {
      // Create initial iOS subscription
      const createResponse = await axios.post(`${this.baseURL}/api/subscription`, iosSubscription, {
        headers: { Authorization: `Bearer ${iosUser.token}` },
        timeout: this.timeout
      });

      this.assert(
        createResponse.status === 201,
        'Initial iOS subscription created',
        `Status: ${createResponse.status}`
      );

      // Update the same subscription (same transaction_id, new expiration)
      const updatedSubscription = {
        ...iosSubscription,
        jws_receipt: 'test_receipt_v2',
        expiration_date: Date.now() + (365 * 24 * 60 * 60 * 1000) // Extended to 1 year
      };

      const updateResponse = await axios.post(`${this.baseURL}/api/subscription`, updatedSubscription, {
        headers: { Authorization: `Bearer ${iosUser.token}` },
        timeout: this.timeout
      });

      this.assert(
        updateResponse.status === 200,
        'iOS subscription update returns 200',
        `Status: ${updateResponse.status}`
      );

      this.assert(
        updateResponse.data.message === 'Subscription receipt updated successfully',
        'Update returns correct message',
        `Message: ${updateResponse.data.message}`
      );

      // Test Android update
      const androidSubscription = {
        platform: 'android',
        product_id: 'com.helpful.yearly.29.99',
        purchase_token: `test_token_update_${Date.now()}`,
        order_id: orderId,
        package_name: 'com.helpful.app',
        purchase_date: Date.now() - 1000,
        expiration_date: Date.now() + (30 * 24 * 60 * 60 * 1000)
      };

      await axios.post(`${this.baseURL}/api/subscription`, androidSubscription, {
        headers: { Authorization: `Bearer ${androidUser.token}` },
        timeout: this.timeout
      });

      const updatedAndroid = {
        ...androidSubscription,
        expiration_date: Date.now() + (365 * 24 * 60 * 60 * 1000)
      };

      const androidUpdateResponse = await axios.post(`${this.baseURL}/api/subscription`, updatedAndroid, {
        headers: { Authorization: `Bearer ${androidUser.token}` },
        timeout: this.timeout
      });

      this.assert(
        androidUpdateResponse.status === 200,
        'Android subscription update returns 200',
        `Status: ${androidUpdateResponse.status}`
      );

    } catch (error) {
      this.assert(false, 'Subscription update', `Error: ${error.response?.data?.error || error.message}`);
    }
  }

  // Test rejecting receipt ownership conflicts
  async testReceiptOwnershipConflicts() {
    this.log('Testing Receipt Ownership Conflicts', 'section');

    const iosUser1 = await this.createTestUser('subscription_ios_owner1');
    const iosUser2 = await this.createTestUser('subscription_ios_owner2');
    const androidUser1 = await this.createTestUser('subscription_android_owner1');
    const androidUser2 = await this.createTestUser('subscription_android_owner2');

    if (!iosUser1 || !iosUser2 || !androidUser1 || !androidUser2) {
      this.assert(false, 'Create users for ownership test', 'Failed to create test users');
      return;
    }

    const transactionId = `test_txn_owner_${Date.now()}`;
    const orderId = `GPA.owner_${Date.now()}-1234-5678`;
    const originalTransactionId = `test_orig_owner_${Date.now()}`;
    const purchaseToken = `test_token_owner_${Date.now()}`;

    try {
      // User1 creates iOS receipt
      await axios.post(`${this.baseURL}/api/subscription`, {
        platform: 'ios',
        product_id: 'com.helpful.yearly.29.99',
        transaction_id: transactionId,
        original_transaction_id: transactionId,
        jws_receipt: 'test_receipt_owner',
        environment: 'Production',
        purchase_date: Date.now() - 1000,
        expiration_date: Date.now() + (30 * 24 * 60 * 60 * 1000)
      }, {
        headers: { Authorization: `Bearer ${iosUser1.token}` },
        timeout: this.timeout
      });

      // User2 tries to reuse the same transaction_id
      try {
        await axios.post(`${this.baseURL}/api/subscription`, {
          platform: 'ios',
          product_id: 'com.helpful.yearly.29.99',
          transaction_id: transactionId,
          original_transaction_id: transactionId,
          jws_receipt: 'test_receipt_owner_conflict',
          environment: 'Production',
          purchase_date: Date.now() - 1000,
          expiration_date: Date.now() + (30 * 24 * 60 * 60 * 1000)
        }, {
          headers: { Authorization: `Bearer ${iosUser2.token}` },
          timeout: this.timeout
        });
        this.assert(false, 'iOS ownership conflict should fail', 'Request succeeded unexpectedly');
      } catch (error) {
        this.assert(
          error.response?.status === 409,
          'iOS ownership conflict returns 409',
          `Status: ${error.response?.status}`
        );
      }

      // User1 creates iOS receipt with original_transaction_id
      await axios.post(`${this.baseURL}/api/subscription`, {
        platform: 'ios',
        product_id: 'com.helpful.yearly.29.99',
        transaction_id: `${transactionId}_orig`,
        original_transaction_id: originalTransactionId,
        jws_receipt: 'test_receipt_owner_orig',
        environment: 'Production',
        purchase_date: Date.now() - 1000,
        expiration_date: Date.now() + (30 * 24 * 60 * 60 * 1000)
      }, {
        headers: { Authorization: `Bearer ${iosUser1.token}` },
        timeout: this.timeout
      });

      // User2 tries to reuse the same original_transaction_id
      try {
        await axios.post(`${this.baseURL}/api/subscription`, {
          platform: 'ios',
          product_id: 'com.helpful.yearly.29.99',
          transaction_id: `${transactionId}_orig_conflict`,
          original_transaction_id: originalTransactionId,
          jws_receipt: 'test_receipt_owner_orig_conflict',
          environment: 'Production',
          purchase_date: Date.now() - 1000,
          expiration_date: Date.now() + (30 * 24 * 60 * 60 * 1000)
        }, {
          headers: { Authorization: `Bearer ${iosUser2.token}` },
          timeout: this.timeout
        });
        this.assert(false, 'iOS original_transaction_id conflict should fail', 'Request succeeded unexpectedly');
      } catch (error) {
        this.assert(
          error.response?.status === 409,
          'iOS original_transaction_id conflict returns 409',
          `Status: ${error.response?.status}`
        );
      }

      // User1 creates Android receipt
      await axios.post(`${this.baseURL}/api/subscription`, {
        platform: 'android',
        product_id: 'com.helpful.yearly.29.99',
        purchase_token: `test_token_owner_${Date.now()}`,
        order_id: orderId,
        package_name: 'com.helpful.app',
        purchase_date: Date.now() - 1000,
        expiration_date: Date.now() + (30 * 24 * 60 * 60 * 1000)
      }, {
        headers: { Authorization: `Bearer ${androidUser1.token}` },
        timeout: this.timeout
      });

      // User2 tries to reuse the same order_id
      try {
        await axios.post(`${this.baseURL}/api/subscription`, {
          platform: 'android',
          product_id: 'com.helpful.yearly.29.99',
          purchase_token: `test_token_owner_conflict_${Date.now()}`,
          order_id: orderId,
          package_name: 'com.helpful.app',
          purchase_date: Date.now() - 1000,
          expiration_date: Date.now() + (30 * 24 * 60 * 60 * 1000)
        }, {
          headers: { Authorization: `Bearer ${androidUser2.token}` },
          timeout: this.timeout
        });
        this.assert(false, 'Android ownership conflict should fail', 'Request succeeded unexpectedly');
      } catch (error) {
        this.assert(
          error.response?.status === 409,
          'Android ownership conflict returns 409',
          `Status: ${error.response?.status}`
        );
      }

      // User1 creates Android receipt with purchase_token
      await axios.post(`${this.baseURL}/api/subscription`, {
        platform: 'android',
        product_id: 'com.helpful.yearly.29.99',
        purchase_token: purchaseToken,
        order_id: `GPA.owner_token_${Date.now()}-1234-5678`,
        package_name: 'com.helpful.app',
        purchase_date: Date.now() - 1000,
        expiration_date: Date.now() + (30 * 24 * 60 * 60 * 1000)
      }, {
        headers: { Authorization: `Bearer ${androidUser1.token}` },
        timeout: this.timeout
      });

      // User2 tries to reuse the same purchase_token
      try {
        await axios.post(`${this.baseURL}/api/subscription`, {
          platform: 'android',
          product_id: 'com.helpful.yearly.29.99',
          purchase_token: purchaseToken,
          order_id: `GPA.owner_token_conflict_${Date.now()}-1234-5678`,
          package_name: 'com.helpful.app',
          purchase_date: Date.now() - 1000,
          expiration_date: Date.now() + (30 * 24 * 60 * 60 * 1000)
        }, {
          headers: { Authorization: `Bearer ${androidUser2.token}` },
          timeout: this.timeout
        });
        this.assert(false, 'Android purchase_token conflict should fail', 'Request succeeded unexpectedly');
      } catch (error) {
        this.assert(
          error.response?.status === 409,
          'Android purchase_token conflict returns 409',
          `Status: ${error.response?.status}`
        );
      }
    } catch (error) {
      this.assert(false, 'Receipt ownership conflicts', `Error: ${error.response?.data?.error || error.message}`);
    }
  }

  // Test expired subscription does not grant premium
  async testExpiredSubscription() {
    this.log('Testing Expired Subscription', 'section');

    const user = await this.createTestUser('subscription_ios_expired');
    if (!user) {
      this.assert(false, 'Create user for expired test', 'Failed to create test user');
      return;
    }

    // Create subscription with past expiration (expired)
    const pastExpiration = Date.now() - (24 * 60 * 60 * 1000); // 1 day ago
    const expiredSubscription = {
      platform: 'ios',
      product_id: 'com.helpful.yearly.29.99',
      transaction_id: `test_txn_expired_${Date.now()}`,
      original_transaction_id: `test_orig_txn_expired_${Date.now()}`,
      jws_receipt: 'test_receipt_expired',
      environment: 'Production',
      purchase_date: Date.now() - (366 * 24 * 60 * 60 * 1000), // Over a year ago
      expiration_date: pastExpiration
    };

    try {
      const response = await axios.post(`${this.baseURL}/api/subscription`, expiredSubscription, {
        headers: { Authorization: `Bearer ${user.token}` },
        timeout: this.timeout
      });

      this.assert(
        response.status === 201,
        'Expired subscription still creates receipt',
        `Status: ${response.status}`
      );

      this.assert(
        response.data.subscription.is_active === false,
        'Expired subscription is not active',
        `Is active: ${response.data.subscription.is_active}`
      );

      this.assert(
        response.data.premium_status.active === false,
        'Expired subscription does not grant premium',
        `Premium active: ${response.data.premium_status.active}`
      );

      this.assert(
        response.data.premium_status.pairings_updated === 0,
        'No pairings updated to premium for expired subscription',
        `Pairings updated: ${response.data.premium_status.pairings_updated}`
      );

    } catch (error) {
      this.assert(false, 'Expired subscription', `Error: ${error.response?.data?.error || error.message}`);
    }
  }

  // Test premium is set for both partners in a pairing
  async testPremiumForBothPartners() {
    this.log('Testing Premium Status for Both Partners', 'section');

    const paired = await this.createPairedUsers('subscription_ios');
    if (!paired) {
      this.assert(false, 'Create paired users', 'Failed to create paired users');
      return;
    }

    const { user1, user2 } = paired;

    // User1 purchases a subscription
    const futureExpiration = Date.now() + (365 * 24 * 60 * 60 * 1000);
    const subscription = {
      platform: 'ios',
      product_id: 'com.helpful.yearly.29.99',
      transaction_id: `test_txn_paired_${Date.now()}`,
      original_transaction_id: `test_orig_txn_paired_${Date.now()}`,
      jws_receipt: 'test_receipt_paired',
      environment: 'Production',
      purchase_date: Date.now() - 1000,
      expiration_date: futureExpiration
    };

    try {
      const subscriptionResponse = await axios.post(`${this.baseURL}/api/subscription`, subscription, {
        headers: { Authorization: `Bearer ${user1.token}` },
        timeout: this.timeout
      });

      this.assert(
        subscriptionResponse.data.premium_status.pairings_updated === 1,
        'Pairing updated to premium',
        `Pairings updated: ${subscriptionResponse.data.premium_status.pairings_updated}`
      );

      // Verify user1's premium status via subscription endpoint
      const user1StatusResponse = await axios.get(`${this.baseURL}/api/subscription`, {
        headers: { Authorization: `Bearer ${user1.token}` },
        timeout: this.timeout
      });

      this.assert(
        user1StatusResponse.data.premium === true,
        'User1 (purchaser) has premium status',
        `Premium: ${user1StatusResponse.data.premium}`
      );

      // Verify user2's premium status via subscription endpoint
      const user2StatusResponse = await axios.get(`${this.baseURL}/api/subscription`, {
        headers: { Authorization: `Bearer ${user2.token}` },
        timeout: this.timeout
      });

      this.assert(
        user2StatusResponse.data.premium === true,
        'User2 (partner) has premium status',
        `Premium: ${user2StatusResponse.data.premium}`
      );

    } catch (error) {
      this.assert(false, 'Premium for both partners', `Error: ${error.response?.data?.error || error.message}`);
    }
  }

  // Test premium reconciliation after expiration update
  async testPremiumReconciliation() {
    this.log('Testing Premium Reconciliation', 'section');

    const paired = await this.createPairedUsers('subscription_ios_reconcile');
    if (!paired) {
      this.assert(false, 'Create paired users for reconciliation', 'Failed to create paired users');
      return;
    }

    const { user1, user2 } = paired;
    const transactionId = `test_txn_reconcile_${Date.now()}`;
    const originalTransactionId = `test_orig_reconcile_${Date.now()}`;

    const activeSubscription = {
      platform: 'ios',
      product_id: 'com.helpful.yearly.29.99',
      transaction_id: transactionId,
      original_transaction_id: originalTransactionId,
      jws_receipt: 'test_receipt_reconcile',
      environment: 'Production',
      purchase_date: Date.now() - 1000,
      expiration_date: Date.now() + (30 * 24 * 60 * 60 * 1000)
    };

    try {
      await axios.post(`${this.baseURL}/api/subscription`, activeSubscription, {
        headers: { Authorization: `Bearer ${user1.token}` },
        timeout: this.timeout
      });

      const user1StatusResponse = await axios.get(`${this.baseURL}/api/subscription`, {
        headers: { Authorization: `Bearer ${user1.token}` },
        timeout: this.timeout
      });

      const user2StatusResponse = await axios.get(`${this.baseURL}/api/subscription`, {
        headers: { Authorization: `Bearer ${user2.token}` },
        timeout: this.timeout
      });

      this.assert(
        user1StatusResponse.data.premium === true,
        'User1 has premium before reconciliation',
        `Premium: ${user1StatusResponse.data.premium}`
      );

      this.assert(
        user2StatusResponse.data.premium === true,
        'User2 has premium before reconciliation',
        `Premium: ${user2StatusResponse.data.premium}`
      );

      const expiredUpdate = {
        ...activeSubscription,
        purchase_date: Date.now() - (10 * 24 * 60 * 60 * 1000),
        expiration_date: Date.now() - (5 * 24 * 60 * 60 * 1000)
      };

      await axios.post(`${this.baseURL}/api/subscription`, expiredUpdate, {
        headers: { Authorization: `Bearer ${user1.token}` },
        timeout: this.timeout
      });

      const user1AfterResponse = await axios.get(`${this.baseURL}/api/subscription`, {
        headers: { Authorization: `Bearer ${user1.token}` },
        timeout: this.timeout
      });

      const user2AfterResponse = await axios.get(`${this.baseURL}/api/subscription`, {
        headers: { Authorization: `Bearer ${user2.token}` },
        timeout: this.timeout
      });

      this.assert(
        user1AfterResponse.data.premium === false,
        'User1 premium cleared after expiration',
        `Premium: ${user1AfterResponse.data.premium}`
      );

      this.assert(
        user2AfterResponse.data.premium === false,
        'User2 premium cleared after expiration',
        `Premium: ${user2AfterResponse.data.premium}`
      );

    } catch (error) {
      this.assert(false, 'Premium reconciliation', `Error: ${error.response?.data?.error || error.message}`);
    }
  }

  // Test validation errors
  async testValidationErrors() {
    this.log('Testing Validation Errors', 'section');

    const iosUser = await this.createTestUser('subscription_ios_validation');
    const androidUser = await this.createTestUser('subscription_android_validation');
    if (!iosUser || !androidUser) {
      this.assert(false, 'Create user for validation test', 'Failed to create test user');
      return;
    }

    const iosHeaders = { Authorization: `Bearer ${iosUser.token}` };
    const androidHeaders = { Authorization: `Bearer ${androidUser.token}` };

    // Test missing platform
    try {
      await axios.post(`${this.baseURL}/api/subscription`, {
        product_id: 'com.helpful.yearly.29.99'
      }, { headers: iosHeaders, timeout: this.timeout });
      this.assert(false, 'Missing platform should fail', 'Request succeeded unexpectedly');
    } catch (error) {
      this.assert(
        error.response?.status === 400,
        'Missing platform returns 400',
        `Status: ${error.response?.status}`
      );
      this.assert(
        error.response?.data?.error === 'Platform is required',
        'Missing platform error message',
        `Error: ${error.response?.data?.error}`
      );
    }

    // Test invalid platform
    try {
      await axios.post(`${this.baseURL}/api/subscription`, {
        platform: 'windows'
      }, { headers: iosHeaders, timeout: this.timeout });
      this.assert(false, 'Invalid platform should fail', 'Request succeeded unexpectedly');
    } catch (error) {
      this.assert(
        error.response?.status === 400,
        'Invalid platform returns 400',
        `Status: ${error.response?.status}`
      );
    }

    // Test iOS missing transaction_id
    try {
      await axios.post(`${this.baseURL}/api/subscription`, {
        platform: 'ios',
        product_id: 'com.helpful.yearly.29.99',
        original_transaction_id: 'test',
        jws_receipt: 'test',
        environment: 'Production',
        purchase_date: Date.now(),
        expiration_date: Date.now() + 1000
      }, { headers: iosHeaders, timeout: this.timeout });
      this.assert(false, 'iOS missing transaction_id should fail', 'Request succeeded unexpectedly');
    } catch (error) {
      this.assert(
        error.response?.status === 400 && error.response?.data?.error?.includes('transaction_id'),
        'iOS missing transaction_id returns proper error',
        `Error: ${error.response?.data?.error}`
      );
    }

    // Test Android missing order_id
    try {
      await axios.post(`${this.baseURL}/api/subscription`, {
        platform: 'android',
        product_id: 'com.helpful.yearly.29.99',
        purchase_token: 'test_token',
        package_name: 'com.helpful.app',
        purchase_date: Date.now(),
        expiration_date: Date.now() + 1000
      }, { headers: androidHeaders, timeout: this.timeout });
      this.assert(false, 'Android missing order_id should fail', 'Request succeeded unexpectedly');
    } catch (error) {
      this.assert(
        error.response?.status === 400 && error.response?.data?.error?.includes('order_id'),
        'Android missing order_id returns proper error',
        `Error: ${error.response?.data?.error}`
      );
    }

    // Test invalid purchase_date type
    try {
      await axios.post(`${this.baseURL}/api/subscription`, {
        platform: 'ios',
        product_id: 'com.helpful.yearly.29.99',
        transaction_id: 'test_txn',
        original_transaction_id: 'test_orig',
        jws_receipt: 'test_receipt',
        environment: 'Production',
        purchase_date: 'not-a-number',
        expiration_date: Date.now() + 1000
      }, { headers: iosHeaders, timeout: this.timeout });
      this.assert(false, 'Invalid purchase_date should fail', 'Request succeeded unexpectedly');
    } catch (error) {
      this.assert(
        error.response?.status === 400,
        'Invalid purchase_date returns 400',
        `Status: ${error.response?.status}`
      );
    }
  }

  // Test authentication requirements
  async testAuthenticationRequirements() {
    this.log('Testing Authentication Requirements', 'section');

    // Test without token
    try {
      await axios.post(`${this.baseURL}/api/subscription`, {
        platform: 'ios',
        product_id: 'test'
      }, { timeout: this.timeout });
      this.assert(false, 'Request without token should fail', 'Request succeeded unexpectedly');
    } catch (error) {
      this.assert(
        error.response?.status === 401,
        'Request without token returns 401',
        `Status: ${error.response?.status}`
      );
    }

    // Test with invalid token
    try {
      await axios.post(`${this.baseURL}/api/subscription`, {
        platform: 'ios',
        product_id: 'test'
      }, {
        headers: { Authorization: 'Bearer invalid-token' },
        timeout: this.timeout
      });
      this.assert(false, 'Request with invalid token should fail', 'Request succeeded unexpectedly');
    } catch (error) {
      this.assert(
        error.response?.status === 401,
        'Request with invalid token returns 401',
        `Status: ${error.response?.status}`
      );
    }

    // Test GET subscription status without token
    try {
      await axios.get(`${this.baseURL}/api/subscription`, { timeout: this.timeout });
      this.assert(false, 'GET without token should fail', 'Request succeeded unexpectedly');
    } catch (error) {
      this.assert(
        error.response?.status === 401,
        'GET without token returns 401',
        `Status: ${error.response?.status}`
      );
    }
  }

  // Test GET subscription status endpoint
  async testGetSubscriptionStatus() {
    this.log('Testing GET Subscription Status', 'section');

    const user = await this.createTestUser('subscription_ios_status');
    if (!user) {
      this.assert(false, 'Create user for status test', 'Failed to create test user');
      return;
    }

    try {
      // Check status before any subscriptions
      const initialResponse = await axios.get(`${this.baseURL}/api/subscription`, {
        headers: { Authorization: `Bearer ${user.token}` },
        timeout: this.timeout
      });

      this.assert(
        initialResponse.status === 200,
        'GET subscription status returns 200',
        `Status: ${initialResponse.status}`
      );

      this.assert(
        initialResponse.data.premium === false,
        'Initial premium status is false',
        `Premium: ${initialResponse.data.premium}`
      );

      this.assert(
        initialResponse.data.active_subscriptions === 0,
        'Initial active subscriptions is 0',
        `Active: ${initialResponse.data.active_subscriptions}`
      );

      // Create an active subscription
      const futureExpiration = Date.now() + (365 * 24 * 60 * 60 * 1000);
      await axios.post(`${this.baseURL}/api/subscription`, {
        platform: 'ios',
        product_id: 'com.helpful.yearly.29.99',
        transaction_id: `test_txn_status_${Date.now()}`,
        original_transaction_id: `test_orig_status_${Date.now()}`,
        jws_receipt: 'test_receipt_status',
        environment: 'Production',
        purchase_date: Date.now() - 1000,
        expiration_date: futureExpiration
      }, {
        headers: { Authorization: `Bearer ${user.token}` },
        timeout: this.timeout
      });

      // Check status after subscription
      const afterResponse = await axios.get(`${this.baseURL}/api/subscription`, {
        headers: { Authorization: `Bearer ${user.token}` },
        timeout: this.timeout
      });

      this.assert(
        afterResponse.data.premium === false,
        'Premium status remains false for single user (no pairings)',
        `Premium: ${afterResponse.data.premium}`
      );

      this.assert(
        afterResponse.data.active_subscriptions === 1,
        'Active subscriptions is 1',
        `Active: ${afterResponse.data.active_subscriptions}`
      );

      this.assert(
        afterResponse.data.latest_expiration === futureExpiration,
        'Latest expiration matches',
        `Expiration: ${afterResponse.data.latest_expiration}`
      );

      this.assert(
        Array.isArray(afterResponse.data.subscriptions) && afterResponse.data.subscriptions.length === 1,
        'Subscriptions array has one entry',
        `Count: ${afterResponse.data.subscriptions?.length}`
      );

    } catch (error) {
      this.assert(false, 'GET subscription status', `Error: ${error.response?.data?.error || error.message}`);
    }
  }

  // Test GET receipts endpoint
  async testGetReceiptsEndpoint() {
    this.log('Testing GET Receipts Endpoint', 'section');

    const user = await this.createTestUser('subscription_ios_receipts');
    if (!user) {
      this.assert(false, 'Create user for receipts test', 'Failed to create test user');
      return;
    }

    const subscription = {
      platform: 'ios',
      product_id: 'com.helpful.yearly.29.99',
      transaction_id: `test_txn_receipts_${Date.now()}`,
      original_transaction_id: `test_orig_receipts_${Date.now()}`,
      jws_receipt: 'test_receipt_receipts',
      environment: 'Production',
      purchase_date: Date.now() - 1000,
      expiration_date: Date.now() + (30 * 24 * 60 * 60 * 1000)
    };

    try {
      await axios.post(`${this.baseURL}/api/subscription`, subscription, {
        headers: { Authorization: `Bearer ${user.token}` },
        timeout: this.timeout
      });

      const response = await axios.get(`${this.baseURL}/api/subscription/receipts`, {
        headers: { Authorization: `Bearer ${user.token}` },
        timeout: this.timeout
      });

      this.assert(
        response.status === 200,
        'GET receipts returns 200',
        `Status: ${response.status}`
      );

      this.assert(
        response.data.data.ios_receipts.length === 1,
        'GET receipts returns iOS receipt',
        `Count: ${response.data.data.ios_receipts.length}`
      );

      this.assert(
        response.data.data.android_receipts.length === 0,
        'GET receipts returns no Android receipts',
        `Count: ${response.data.data.android_receipts.length}`
      );
    } catch (error) {
      this.assert(false, 'GET receipts endpoint', `Error: ${error.response?.data?.error || error.message}`);
    }
  }

  // Run all tests
  async runAllTests() {
    this.log('🧪 Starting Subscription Endpoint Test Suite', 'section');
    
    if (this.keepData) {
      this.log('🔒 KEEP DATA MODE: Test data will NOT be cleaned up', 'data');
      this.log('   You can verify data with SQL queries after tests complete', 'data');
    }

    try {
      console.log('');
      await this.testAuthenticationRequirements();
      console.log('');
      
      await new Promise(resolve => setTimeout(resolve, 500));
      
      await this.testValidationErrors();
      console.log('');
      
      await new Promise(resolve => setTimeout(resolve, 500));
      
      await this.testIosSubscriptionCreation();
      console.log('');
      
      await new Promise(resolve => setTimeout(resolve, 500));
      
      await this.testAndroidSubscriptionCreation();
      console.log('');
      
      await new Promise(resolve => setTimeout(resolve, 500));
      
      await this.testSubscriptionUpdate();
      console.log('');

      await new Promise(resolve => setTimeout(resolve, 500));
      
      await this.testReceiptOwnershipConflicts();
      console.log('');
      
      await new Promise(resolve => setTimeout(resolve, 500));
      
      await this.testExpiredSubscription();
      console.log('');
      
      await new Promise(resolve => setTimeout(resolve, 500));
      
      await this.testPremiumForBothPartners();
      console.log('');
      
      await new Promise(resolve => setTimeout(resolve, 500));
      
      await this.testPremiumReconciliation();
      console.log('');
      
      await new Promise(resolve => setTimeout(resolve, 500));
      
      await this.testGetSubscriptionStatus();
      console.log('');

      await new Promise(resolve => setTimeout(resolve, 500));
      
      await this.testGetReceiptsEndpoint();
      console.log('');

      this.printSummary();
      
      if (this.keepData) {
        this.printTestDataInfo();
      }
      
      return this.testResults.failed === 0;
      
    } catch (error) {
      this.log(`Test suite failed with error: ${error.message}`, 'fail');
      return false;
    }
  }

  printSummary() {
    this.log('📊 Subscription Endpoint Test Results Summary', 'section');
    this.log(`Total Tests: ${this.testResults.total}`);
    this.log(`Passed: ${this.testResults.passed}`, this.testResults.passed === this.testResults.total ? 'pass' : 'info');
    this.log(`Failed: ${this.testResults.failed}`, this.testResults.failed === 0 ? 'pass' : 'fail');
    
    const successRate = this.testResults.total > 0 
      ? ((this.testResults.passed / this.testResults.total) * 100).toFixed(1)
      : '0';
    
    this.log(`Success Rate: ${successRate}%`, successRate === '100.0' ? 'pass' : 'warn');
    
    if (this.testResults.failed === 0) {
      this.log('🎉 All subscription endpoint tests passed!', 'pass');
    } else {
      this.log('⚠️ Some subscription endpoint tests failed. Review the failures above.', 'fail');
    }
  }

  printTestDataInfo() {
    this.log('', 'section');
    this.log('💾 TEST DATA PRESERVED - SQL Queries for Verification:', 'data');
    this.log('', 'info');
    this.log('-- View test users:', 'info');
    this.log("SELECT p.*, u1.email as user1_email, u2.email as user2_email FROM pairings p LEFT JOIN users u1 ON p.user1_id = u1.id LEFT JOIN users u2 ON p.user2_id = u2.id WHERE (u1.email LIKE 'subscription_ios%@example.com' OR u2.email LIKE 'subscription_ios%@example.com' OR u1.email LIKE 'subscription_android%@example.com' OR u2.email LIKE 'subscription_android%@example.com') AND p.premium = 1;", 'info');
    this.log('', 'info');
    this.log('-- View iOS subscriptions:', 'info');
    this.log('SELECT s.*, u.email FROM ios_subscriptions s JOIN users u ON s.user_id = u.id WHERE u.email LIKE \'subscription_ios%@example.com\';', 'info');
    this.log('', 'info');
    this.log('-- View Android subscriptions:', 'info');
    this.log('SELECT s.*, u.email FROM android_subscriptions s JOIN users u ON s.user_id = u.id WHERE u.email LIKE \'subscription_android%@example.com\';', 'info');
    this.log('', 'info');
    this.log('-- View pairings:', 'info');
    this.log("SELECT p.*, u1.email as user1_email, u2.email as user2_email FROM pairings p LEFT JOIN users u1 ON p.user1_id = u1.id LEFT JOIN users u2 ON p.user2_id = u2.id WHERE u1.email LIKE 'subscription_ios%@example.com' OR u2.email LIKE 'subscription_ios%@example.com';", 'info');
    this.log('', 'info');
    
    if (this.testData.users.length > 0) {
      this.log('Test User IDs created:', 'data');
      this.testData.users.forEach(user => {
        this.log(`  - ${user.id} (${user.email})`, 'info');
      });
    }
  }
}

// Run tests if called directly
if (require.main === module) {
  const testRunner = new SubscriptionTestRunner();
  testRunner.runAllTests().then(success => {
    process.exit(success ? 0 : 1);
  }).catch(error => {
    console.error('Subscription test runner failed:', error);
    process.exit(1);
  });
}

module.exports = SubscriptionTestRunner;
