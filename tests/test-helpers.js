/**
 * Test Helpers
 * Shared utilities for all test files.
 *
 * All test emails MUST use @example.com so they can be easily identified
 * and cleaned up via tests/cleanup-test-data.js.
 */

const TEST_EMAIL_DOMAIN = '@example.com';

/**
 * Generate a unique test email.
 *
 * @param {string} prefix - Prefix for the email local part (default: 'test')
 * @returns {string} Email in the form `${prefix}_${timestamp}_${random}@example.com`
 */
function generateTestEmail(prefix = 'test') {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substr(2, 5);
  return `${prefix}_${timestamp}_${random}${TEST_EMAIL_DOMAIN}`;
}

/**
 * Throw if the provided email is not a valid @example.com test email.
 *
 * @param {string} email
 * @throws {Error} If email doesn't end with @example.com
 */
function validateTestEmailDomain(email) {
  const ok = typeof email === 'string' && email.endsWith(TEST_EMAIL_DOMAIN);
  if (!ok) {
    throw new Error(
      `Invalid test email domain. All test emails MUST use ${TEST_EMAIL_DOMAIN}. Got: ${email}`
    );
  }
}

module.exports = {
  generateTestEmail,
  validateTestEmailDomain,
  TEST_EMAIL_DOMAIN
};
