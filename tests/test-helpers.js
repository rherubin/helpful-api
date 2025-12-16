/**
 * Test Helpers
 * Shared utilities for all test files
 * Ensures consistent test data patterns across the test suite
 */

const { v4: uuidv4 } = require('uuid');

/**
 * Generate a test email address
 * ALL test emails MUST use @example.com domain for easy identification and cleanup
 * 
 * @param {string} prefix - Optional prefix for the email (default: 'test')
 * @returns {string} Email address in format: prefix_timestamp_random@example.com
 */
function generateTestEmail(prefix = 'test') {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substr(2, 5);
  return `${prefix}_${timestamp}_${random}@example.com`;
}

/**
 * Generate a test email with UUID
 * 
 * @param {string} prefix - Optional prefix for the email (default: 'test')
 * @returns {string} Email address in format: prefix-uuid@example.com
 */
function generateTestEmailWithUUID(prefix = 'test') {
  return `${prefix}-${uuidv4()}@example.com`;
}

/**
 * Generate a test email with custom format
 * Enforces @example.com domain
 * 
 * @param {string} localPart - The part before @
 * @returns {string} Email address: localPart@example.com
 */
function createTestEmail(localPart) {
  // Ensure no domain is included in localPart
  if (localPart.includes('@')) {
    throw new Error('Do not include @ or domain in localPart. Use only the username part.');
  }
  return `${localPart}@example.com`;
}

/**
 * Validate if an email is a test email
 * Test emails must end with @example.com
 * 
 * @param {string} email - Email to validate
 * @returns {boolean} True if valid test email
 */
function isValidTestEmail(email) {
  return typeof email === 'string' && email.endsWith('@example.com');
}

/**
 * Get test email patterns for database queries
 * Returns all patterns used to identify test data
 * 
 * @returns {string[]} Array of SQL LIKE patterns
 */
function getTestEmailPatterns() {
  return [
    'test%@example.com',
    '%test%@example.com',
    'john.doe.%@example.com',
    'jane.doe.%@example.com',
    'pairings.user%@example.com',
    'login-test-%@example.com',
    'loadtest-%@example.com'
  ];
}

/**
 * Generate test user data with secure defaults
 * 
 * @param {object} options - Options for user generation
 * @returns {object} User data object
 */
function generateTestUser(options = {}) {
  const {
    emailPrefix = 'test',
    password = 'SecurePass987!',
    userName = null,
    partnerName = null
  } = options;
  
  return {
    email: generateTestEmail(emailPrefix),
    password: password,
    ...(userName && { user_name: userName }),
    ...(partnerName && { partner_name: partnerName })
  };
}

/**
 * Test email domain constant
 * USE THIS instead of hardcoding '@example.com'
 */
const TEST_EMAIL_DOMAIN = '@example.com';

/**
 * Validate test email domain
 * Throws error if email doesn't use the correct test domain
 * 
 * @param {string} email - Email to validate
 * @throws {Error} If email doesn't use @example.com domain
 */
function validateTestEmailDomain(email) {
  if (!isValidTestEmail(email)) {
    throw new Error(
      `Invalid test email domain. ` +
      `All test emails MUST use ${TEST_EMAIL_DOMAIN} domain. ` +
      `Got: ${email}`
    );
  }
}

/**
 * Mock program response for testing without OpenAI
 * This mimics the structure returned by ChatGPTService.generateCouplesProgram()
 */
const MOCK_PROGRAM_RESPONSE = {
  program: {
    title: 'Mock 14-Day Couples Program',
    days: Array.from({ length: 14 }, (_, i) => ({
      day: i + 1,
      theme: `Day ${i + 1} Theme - Communication and Connection`,
      conversation_starter: `This is a mock conversation starter for day ${i + 1}. Discuss how you can improve your relationship today.`,
      science_behind_it: `Research shows that consistent communication strengthens relationships. This is mock content for day ${i + 1}.`
    }))
  }
};

/**
 * Mock ChatGPT Service for testing
 * Use this when running tests without requiring actual OpenAI API calls
 * 
 * @example
 * const mockService = new MockChatGPTService();
 * mockService.setMockResponse(['Custom response 1', 'Custom response 2']);
 * const response = await mockService.generateCouplesTherapyResponse(...);
 */
class MockChatGPTService {
  constructor() {
    this.configured = true;
    this.mockResponses = [];
    this.callLog = [];
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      rateLimitErrors: 0,
      averageResponseTime: 0,
      queueLength: 0,
      activeRequests: 0
    };
  }

  /**
   * Check if the service is configured
   */
  isConfigured() {
    return this.configured;
  }

  /**
   * Set whether the service appears configured
   */
  setConfigured(value) {
    this.configured = value;
  }

  /**
   * Set a custom mock response for the next call
   * @param {string|string[]} responses - Response(s) to return
   */
  setMockResponse(responses) {
    this.mockResponses = [Array.isArray(responses) ? responses : [responses]];
  }

  /**
   * Generate mock couples program
   * @param {string} userName - User's name
   * @param {string} partnerName - Partner's name
   * @param {string} userInput - User's input/goals
   * @returns {object} Mock program response
   */
  async generateCouplesProgram(userName, partnerName, userInput) {
    this.callLog.push({
      method: 'generateCouplesProgram',
      args: { userName, partnerName, userInput },
      timestamp: new Date().toISOString()
    });
    this.metrics.totalRequests++;
    this.metrics.successfulRequests++;

    // Simulate async delay
    await new Promise(resolve => setTimeout(resolve, 100));

    return JSON.stringify(MOCK_PROGRAM_RESPONSE);
  }

  /**
   * Generate mock next couples program
   * @param {string} userName - User's name
   * @param {string} partnerName - Partner's name
   * @param {string[]} previousStarters - Previous conversation starters
   * @param {string} userInput - User's input/goals
   * @returns {object} Mock program response
   */
  async generateNextCouplesProgram(userName, partnerName, previousStarters, userInput) {
    this.callLog.push({
      method: 'generateNextCouplesProgram',
      args: { userName, partnerName, previousStarters, userInput },
      timestamp: new Date().toISOString()
    });
    this.metrics.totalRequests++;
    this.metrics.successfulRequests++;

    // Simulate async delay
    await new Promise(resolve => setTimeout(resolve, 100));

    return JSON.stringify(MOCK_PROGRAM_RESPONSE);
  }

  /**
   * Generate mock couples therapy response
   * @param {string} user1Name - First user's name
   * @param {string} user2Name - Second user's name
   * @param {string[]} user1Messages - First user's messages
   * @param {string} user2FirstMessage - Second user's first message
   * @returns {string[]} Mock therapy responses
   */
  async generateCouplesTherapyResponse(user1Name, user2Name, user1Messages, user2FirstMessage) {
    this.callLog.push({
      method: 'generateCouplesTherapyResponse',
      args: { user1Name, user2Name, user1Messages, user2FirstMessage },
      timestamp: new Date().toISOString()
    });
    this.metrics.totalRequests++;
    this.metrics.successfulRequests++;

    // Simulate async delay
    await new Promise(resolve => setTimeout(resolve, 100));

    if (this.mockResponses.length > 0) {
      const response = this.mockResponses.shift();
      return Array.isArray(response) ? response : [response];
    }

    // Default mock therapy response
    return [
      `Thank you ${user1Name} and ${user2Name} for sharing your thoughts.`,
      `${user1Name}, I hear that you're expressing important feelings about your relationship.`,
      `${user2Name}, your response shows you're engaged and listening. That's a great foundation for growth.`
    ];
  }

  /**
   * Get service metrics
   * @returns {object} Service metrics
   */
  getMetrics() {
    return { ...this.metrics };
  }

  /**
   * Get the call log (useful for testing)
   * @returns {object[]} Array of logged calls
   */
  getCallLog() {
    return [...this.callLog];
  }

  /**
   * Clear the call log
   */
  clearCallLog() {
    this.callLog = [];
  }

  /**
   * Reset all state
   */
  reset() {
    this.configured = true;
    this.mockResponses = [];
    this.callLog = [];
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      rateLimitErrors: 0,
      averageResponseTime: 0,
      queueLength: 0,
      activeRequests: 0
    };
  }
}

module.exports = {
  // Email generation
  generateTestEmail,
  generateTestEmailWithUUID,
  createTestEmail,
  
  // Validation
  isValidTestEmail,
  validateTestEmailDomain,
  
  // User generation
  generateTestUser,
  
  // Constants and patterns
  TEST_EMAIL_DOMAIN,
  getTestEmailPatterns,
  
  // Mock services
  MockChatGPTService,
  MOCK_PROGRAM_RESPONSE
};

