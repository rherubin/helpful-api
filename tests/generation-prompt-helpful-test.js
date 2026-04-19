/**
 * generation_prompt Column Integration Test (Helpful path)
 *
 * Product: **Helpful** — secular couples therapy. No org_code; user has only
 * user_name / partner_name / user_input. For the faith + org_code custom-prompt
 * path, see tests/generation-prompt-hopeful-test.js (Hopeful / org_code).
 *
 * Verifies end-to-end that the programs.generation_prompt column is populated
 * with the raw user prompt that was sent to the LLM, proving the
 * prompt-capture plumbing works through:
 *
 *   routes/programs.js → HelpfulPromptService.generateInitialProgram
 *     → attachPromptToResponse (non-enumerable __prompt)
 *     → programModel.updateTherapyResponse(generationPrompt)
 *
 * Uses the default (no org_code) path, which exercises HelpfulPromptService.
 * That path constructs a couples-therapy prompt interpolating user_name,
 * partner_name, and user_input — all of which we can assert appear verbatim
 * in the stored column.
 *
 * Storage format: the column holds the raw user message sent to OpenAI —
 * nothing else. The short static system role instruction is NOT stored,
 * because it's boilerplate that doesn't vary per program. If you copy the
 * column's contents into ChatGPT, you get back the same style of response.
 *
 * Usage:
 *   node tests/generation-prompt-helpful-test.js [--keep-data]
 *
 * IMPORTANT: Run the API server with TEST_MOCK_LLM=true to avoid real OpenAI
 * token usage. Example:
 *
 *   TEST_MOCK_LLM=true npm start   # in one terminal
 *   node tests/generation-prompt-helpful-test.js   # in another
 *
 * The mock path in BasePromptService._buildMockResponse returns a
 * deterministic 14-day program, so the full generation pipeline (including
 * the updateTherapyResponse call that writes generation_prompt) runs end-to-
 * end without contacting OpenAI.
 *
 * Options:
 *   --keep-data    Don't delete test data after the run (useful for manual DB inspection)
 */

require('dotenv').config();
const axios = require('axios');
const { getPool } = require('../config/database');

const API_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:9000';

const args = process.argv.slice(2);
const keepData = args.includes('--keep-data');

const testEmail = `generation-prompt-helpful-test_${Date.now()}_${Math.random().toString(36).substr(2, 5)}@example.com`;
const testPassword = 'SecurePass987!';
const TEST_USER_NAME = 'GenPromptAlice';
const TEST_PARTNER_NAME = 'GenPromptBob';
// Distinctive marker string we can grep for inside the stored prompt to
// prove the user's input was actually interpolated into what was sent.
const TEST_USER_INPUT = 'We keep getting stuck in the same argument about GENPROMPT_TEST_MARKER_42 and want to break the cycle.';

const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 30000;

let passed = 0;
let failed = 0;

function assert(condition, label, detail = '') {
  if (condition) {
    passed++;
    console.log(`✅ ${label}${detail ? ' — ' + detail : ''}`);
  } else {
    failed++;
    console.log(`❌ ${label}${detail ? ' — ' + detail : ''}`);
  }
}

async function checkServerAvailable() {
  try {
    const res = await axios.get(`${API_URL}/health`, { timeout: 3000 });
    return res.status === 200;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Poll the DB until generation_prompt OR generation_error is set (either
 * outcome proves the async generation pipeline has completed and our
 * prompt-capture code ran).
 */
async function pollForGenerationComplete(pool, programId) {
  const start = Date.now();
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    const [rows] = await pool.execute(
      'SELECT generation_prompt, generation_error, therapy_response FROM programs WHERE id = ?',
      [programId]
    );
    const row = rows[0];
    if (row && (row.generation_prompt !== null || row.generation_error !== null)) {
      return row;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  // Timeout — return the last read so the caller can still assert meaningfully
  const [finalRows] = await pool.execute(
    'SELECT generation_prompt, generation_error, therapy_response FROM programs WHERE id = ?',
    [programId]
  );
  return finalRows[0] || null;
}

async function main() {
  let userId = null;
  let programId = null;
  let pool = null;

  console.log('\n🧪 generation_prompt Integration Test (Helpful)\n');

  const serverUp = await checkServerAvailable();
  if (!serverUp) {
    console.log('⚠️  API server not reachable at', API_URL);
    console.log('   Start it with: TEST_MOCK_LLM=true npm start');
    console.log('   Then re-run:   node tests/generation-prompt-helpful-test.js\n');
    printSummary();
    process.exit(1);
  }

  try {
    pool = getPool();

    const createUserRes = await axios.post(`${API_URL}/api/users`, {
      email: testEmail,
      password: testPassword
    });
    assert(createUserRes.status === 201, 'Test user created', `email = ${testEmail}`);
    userId = createUserRes.data.user.id;
    const token = createUserRes.data.access_token;

    await axios.put(`${API_URL}/api/users/${userId}`, {
      user_name: TEST_USER_NAME,
      partner_name: TEST_PARTNER_NAME
    }, { headers: { Authorization: `Bearer ${token}` } });

    const createProgramRes = await axios.post(`${API_URL}/api/programs`, {
      user_input: TEST_USER_INPUT
    }, { headers: { Authorization: `Bearer ${token}` } });

    assert(
      createProgramRes.status === 201,
      'Program created (201)',
      `program_id = ${createProgramRes.data.program?.id}`
    );

    programId = createProgramRes.data.program?.id;

    // Informational: record the state immediately after creation. This is
    // NOT asserted on because under TEST_MOCK_LLM=true the mock response
    // resolves so quickly that the async write to generation_prompt often
    // completes before the client receives the HTTP 201, making any
    // "must be NULL yet" assertion racy. The meaningful assertion is
    // after polling, below.
    const [preRows] = await pool.execute(
      'SELECT generation_prompt FROM programs WHERE id = ?',
      [programId]
    );
    const initiallyPopulated = preRows[0]?.generation_prompt !== null;
    console.log(
      `📝 Post-create DB state: generation_prompt ${initiallyPopulated
        ? `already populated (${preRows[0].generation_prompt.length} chars) — async write beat the HTTP response`
        : 'still NULL — async write pending'}`
    );

    console.log(`\n⏳ Polling DB for async generation to complete (up to ${POLL_TIMEOUT_MS / 1000}s)...`);
    const finalRow = await pollForGenerationComplete(pool, programId);

    assert(
      !!finalRow,
      'Program row still exists after polling',
      finalRow ? 'row fetched' : 'row missing'
    );

    if (!finalRow) {
      throw new Error('Program row not found after polling — aborting further assertions');
    }

    const {
      generation_prompt: generationPrompt,
      generation_error: generationError,
      therapy_response: therapyResponse
    } = finalRow;

    // The core assertion: regardless of whether the LLM call succeeded or
    // failed, generation_prompt should be populated (per the design we
    // wired up in the service + route layer).
    assert(
      typeof generationPrompt === 'string' && generationPrompt.length > 0,
      'generation_prompt is populated in DB (non-null, non-empty string)',
      `length = ${generationPrompt ? generationPrompt.length : 0}, generation_error = ${generationError ? '"' + String(generationError).slice(0, 80) + '"' : 'null'}`
    );

    if (typeof generationPrompt !== 'string' || generationPrompt.length === 0) {
      console.log('\n⚠️  generation_prompt was not populated — remaining assertions will be skipped.');
      console.log('   Check that the server was started with TEST_MOCK_LLM=true OR that real OpenAI calls succeeded.');
    } else {
      // No wrapper markers — the stored string should be the raw user
      // prompt only. These two used to be the section delimiters;
      // confirming they're absent guards against regression.
      assert(
        !generationPrompt.includes('[SYSTEM]') && !generationPrompt.includes('[USER]'),
        'generation_prompt is stored raw (no [SYSTEM]/[USER] wrapper markers)',
        `has [SYSTEM]=${generationPrompt.includes('[SYSTEM]')}, has [USER]=${generationPrompt.includes('[USER]')}`
      );

      assert(
        generationPrompt.includes('GENPROMPT_TEST_MARKER_42'),
        'generation_prompt contains the user_input marker (proving user_input was interpolated)',
        `marker found = ${generationPrompt.includes('GENPROMPT_TEST_MARKER_42')}`
      );

      assert(
        generationPrompt.includes(TEST_USER_NAME),
        'generation_prompt contains the user_name (proving user_name was interpolated)',
        `"${TEST_USER_NAME}" found = ${generationPrompt.includes(TEST_USER_NAME)}`
      );

      assert(
        generationPrompt.includes(TEST_PARTNER_NAME),
        'generation_prompt contains the partner_name (proving partner_name was interpolated)',
        `"${TEST_PARTNER_NAME}" found = ${generationPrompt.includes(TEST_PARTNER_NAME)}`
      );

      // Distinctive phrase from the Helpful user prompt body (confirms the
      // route picked HelpfulPromptService for this no-org-code user and
      // stored its actual dynamic prompt, not some other service's).
      assert(
        generationPrompt.includes('top-tier couples therapist'),
        'generation_prompt contains HelpfulPromptService user-prompt signature',
        'expected no-org-code user to route to Helpful service'
      );

      // On mock success path, therapy_response will be populated and
      // generation_error cleared. On real-API failure, generation_error is
      // set. Either way generation_prompt should still be present — which we
      // just verified above.
      if (therapyResponse) {
        assert(
          generationError === null,
          'generation_error is NULL on successful generation',
          `generation_error = ${generationError}`
        );
      }
    }
  } catch (error) {
    console.error('❌ Test error:', error.response?.data?.error || error.message);
    failed++;
  } finally {
    if (keepData && userId) {
      console.log('\n📦 Keeping test data (--keep-data flag set)');
      console.log(`   User ID:    ${userId}`);
      console.log(`   User Email: ${testEmail}`);
      if (programId) console.log(`   Program ID: ${programId}`);
      console.log('\n   To inspect manually:');
      console.log(`   SELECT id, LENGTH(generation_prompt) AS prompt_len, SUBSTRING(generation_prompt, 1, 300) AS prompt_preview, generation_error FROM programs WHERE id = '${programId}';`);
    } else if (userId && pool) {
      try {
        console.log('\n🧹 Cleaning up test data...');
        if (programId) await pool.execute('DELETE FROM programs WHERE id = ?', [programId]);
        await pool.execute('DELETE FROM users WHERE id = ?', [userId]);
        console.log('✅ Test data cleaned up');
      } catch (err) {
        console.error('❌ Cleanup failed:', err.message);
      }
    }

    if (pool) await pool.end().catch(() => {});
  }

  printSummary();
  process.exit(failed > 0 ? 1 : 0);
}

function printSummary() {
  const total = passed + failed;
  console.log(`\n${'─'.repeat(40)}`);
  console.log(`Results: ${passed}/${total} passed${failed > 0 ? `, ${failed} failed` : ''}`);
  if (failed === 0) {
    console.log('🎉 All tests passed');
  } else {
    console.log('💥 Some tests failed');
  }
}

main();
