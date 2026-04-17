/**
 * Test Helpers
 * Shared utilities for all test files.
 *
 * All test emails MUST use @example.com so they can be easily identified
 * and cleaned up via tests/cleanup-test-data.js.
 */

const axios = require('axios');

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

/**
 * Return a Promise that resolves after `ms` milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Poll GET /api/programs/:programId until `program_steps` appears (or timeout).
 *
 * Used by programs/program-steps/messages/therapy-trigger suites to wait
 * for async OpenAI-driven step generation before asserting behavior.
 *
 * When `mockOpenAI` is true the call returns immediately with
 * `{ found: false, skipped: true, steps: [] }`, mirroring
 * `TEST_MOCK_OPENAI=true` behavior without doing any HTTP work.
 *
 * @param {object} opts
 * @param {string} opts.baseURL         API base URL (no trailing slash).
 * @param {string} opts.programId       Program ID to poll.
 * @param {string} opts.token           Bearer token.
 * @param {number} [opts.requestTimeout=30000]  Per-request HTTP timeout (ms).
 * @param {number} [opts.maxWait=15000] Total polling budget (ms).
 * @param {number} [opts.pollInterval=1000] Delay between polls (ms).
 * @param {boolean} [opts.mockOpenAI=false]   Short-circuit when true.
 * @param {Function} [opts.log]         Optional logger `(message, type)`.
 * @returns {Promise<{found:boolean, skipped:boolean, steps:Array}>}
 */
async function pollForProgramSteps(opts) {
  const {
    baseURL,
    programId,
    token,
    requestTimeout = 30000,
    maxWait = 15000,
    pollInterval = 1000,
    mockOpenAI = false,
    log
  } = opts;

  if (mockOpenAI) {
    if (typeof log === 'function') {
      log('TEST_MOCK_OPENAI=true, skipping step generation wait', 'info');
    }
    return { found: false, skipped: true, steps: [] };
  }

  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      const response = await axios.get(`${baseURL}/api/programs/${programId}`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: requestTimeout
      });

      if (response.data.program?.program_steps?.length > 0) {
        return {
          found: true,
          skipped: false,
          steps: response.data.program.program_steps
        };
      }
    } catch (_error) {
      // Continue polling — transient errors are expected during generation.
    }
    await sleep(pollInterval);
  }
  return { found: false, skipped: false, steps: [] };
}

module.exports = {
  generateTestEmail,
  validateTestEmailDomain,
  TEST_EMAIL_DOMAIN,
  sleep,
  pollForProgramSteps
};
