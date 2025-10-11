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
    password = 'TestPassword123!@#',
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
  getTestEmailPatterns
};

