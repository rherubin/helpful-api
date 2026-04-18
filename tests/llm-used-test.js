/**
 * llm_used Column Test
 *
 * Verifies that newly created programs have the llm_used column populated
 * with the model name from HopefulPromptService (e.g. "gpt-5.4", "claude-sonnet-4-6", or "gemini-3.1-pro-preview").
 *
 * Usage:
 *   node tests/llm-used-test.js [--keep-data]
 *
 * Options:
 *   --keep-data    Don't delete test data after the run (useful for manual DB verification)
 */

require('dotenv').config();
const axios = require('axios');
const { getPool } = require('../config/database');
const PromptService = require('../services/HopefulPromptService');

const API_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:9000';

const args = process.argv.slice(2);
const keepData = args.includes('--keep-data');

const testEmail = `llm-used-test_${Date.now()}_${Math.random().toString(36).substr(2, 5)}@example.com`;
const testPassword = 'SecurePass987!';

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

async function main() {
  let userId = null;
  let programId = null;
  let pool = null;

  // ── Unit test: PromptService.model is set ────────────────────────────────
  console.log('\n🧪 Unit Tests\n');

  const service = new PromptService();
  assert(
    typeof service.model === 'string' && service.model.length > 0,
    'PromptService.model is a non-empty string',
    `model = "${service.model}"`
  );

  const expectedModels = ['gpt-5.4', 'claude-sonnet-4-6', 'gemini-3.1-pro-preview', 'gemini-2.5-flash', 'gemini-3-flash-preview'];
  const modelOverrideSet = process.env.OPENAI_MODEL || process.env.ANTHROPIC_MODEL || process.env.GEMINI_MODEL;
  const isKnownModel = expectedModels.includes(service.model) || !!modelOverrideSet;
  assert(
    isKnownModel,
    'PromptService.model is a recognised value (or overridden via OPENAI_MODEL / ANTHROPIC_MODEL / GEMINI_MODEL)',
    `model = "${service.model}"`
  );

  // ── Integration tests ─────────────────────────────────────────────────────
  console.log('\n🧪 Integration Tests\n');

  const serverUp = await checkServerAvailable();
  if (!serverUp) {
    console.log('⚠️  API server not reachable at', API_URL);
    console.log('   Start it with: npm start');
    console.log('   Then re-run:   node tests/llm-used-test.js\n');
    printSummary();
    process.exit(failed > 0 ? 1 : 0);
  }

  try {
    pool = getPool();

    // 1. Create test user
    const createUserRes = await axios.post(`${API_URL}/api/users`, {
      email: testEmail,
      password: testPassword
    });
    assert(createUserRes.status === 201, 'Test user created', `email = ${testEmail}`);
    userId = createUserRes.data.user.id;
    const token = createUserRes.data.access_token;

    // Set user_name (required for program generation)
    await axios.put(`${API_URL}/api/users/${userId}`, {
      user_name: 'TestUser',
      partner_name: 'TestPartner'
    }, { headers: { Authorization: `Bearer ${token}` } });

    // 2. Create a program
    const createProgramRes = await axios.post(`${API_URL}/api/programs`, {
      user_input: 'We want to improve communication and connection.'
    }, { headers: { Authorization: `Bearer ${token}` } });

    assert(
      createProgramRes.status === 201,
      'Program created (201)',
      `program_id = ${createProgramRes.data.program?.id}`
    );

    programId = createProgramRes.data.program?.id;

    // 3. Check llm_used in the API response
    const llmUsedInResponse = createProgramRes.data.program?.llm_used;
    assert(
      typeof llmUsedInResponse === 'string' && llmUsedInResponse.length > 0,
      'API response includes llm_used',
      `llm_used = "${llmUsedInResponse}"`
    );
    assert(
      llmUsedInResponse === service.model,
      'llm_used matches PromptService.model',
      `response "${llmUsedInResponse}" === service "${service.model}"`
    );

    // 4. Verify the value is persisted in the database
    if (pool && programId) {
      const [rows] = await pool.execute(
        'SELECT llm_used FROM programs WHERE id = ?',
        [programId]
      );
      const dbLlmUsed = rows[0]?.llm_used;
      assert(
        typeof dbLlmUsed === 'string' && dbLlmUsed.length > 0,
        'llm_used is persisted in the database',
        `DB value = "${dbLlmUsed}"`
      );
      assert(
        dbLlmUsed === service.model,
        'DB llm_used matches PromptService.model',
        `DB "${dbLlmUsed}" === service "${service.model}"`
      );
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
      console.log(`   SELECT id, llm_used, created_at FROM programs WHERE id = '${programId}';`);
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
