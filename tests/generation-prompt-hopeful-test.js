/**
 * generation_prompt — Hopeful (org_code custom prompt) Integration Test
 *
 * Companion to tests/generation-prompt-helpful-test.js. Where that test exercises
 * the default (no-org-code) Helpful path, this test exercises the most
 * interesting debugging scenario: a user linked to an admin org_code that
 * has a custom initial_program_prompt template.
 *
 * Flow:
 *   1. Register a fresh admin user (unique email per run, no conflicts)
 *   2. Login as admin
 *   3. Create an org_code with a distinctive initial_program_prompt
 *      template that uses all four {{ }} placeholders so we can assert
 *      each one was interpolated verbatim
 *   4. Create a regular user, set user_name, link org_code
 *   5. POST /api/programs with distinctive user_input
 *   6. Poll DB for generation_prompt populated
 *   7. Assert the stored prompt:
 *        - is non-null, non-empty
 *        - has no [SYSTEM]/[USER] wrapper markers (regression guard)
 *        - contains our template's MARKER phrase
 *        - contains the interpolated user_name ({{userName}})
 *        - contains the interpolated user_input ({{User Input}})
 *        - contains the interpolated org name ({{Church Name}})
 *        - contains the interpolated "City, State" ({{City, State}})
 *        - contains the default Hopeful pastor framing AND the org's
 *          initial_program_prompt in the middle (custom augments default)
 *        - has no unreplaced {{ placeholders
 *
 * Usage:
 *   node tests/generation-prompt-hopeful-test.js [--keep-data|--keepData] [--org-code=SLUG] [--mock=false]
 *
 * Default / fast path — API with mock LLM (no tokens):
 *
 *   TEST_MOCK_LLM=true npm start
 *   node tests/generation-prompt-hopeful-test.js --org-code=antioch --keepData
 *
 * Real LLM — restart the API without TEST_MOCK_LLM; uses OpenAI and writes
 * therapy_response from the live model:
 *
 *   unset TEST_MOCK_LLM; PORT=9000 npm start
 *   node tests/generation-prompt-hopeful-test.js --org-code=antioch --mock=false --keepData
 *
 * Options:
 *   --keep-data, --keepData
 *                  Don't delete test data after the run (lets you inspect
 *                  generation_prompt, plus the admin/org_code/user it
 *                  created). Prints all IDs at the end.
 *   --org-code=SLUG, --org-code SLUG, --orgCode=SLUG
 *                  Use an existing org_codes row (e.g. antioch) instead of
 *                  creating a fresh admin + custom org. Skips admin bootstrap
 *                  and never deletes that org on cleanup.
 *   --mock=false, mock=false, --mock false
 *                  Require live LLM: GET /health/diagnostics must report
 *                  test_mock_llm=false. Longer DB poll; asserts therapy_response
 *                  is non-mock JSON with a 7-day program.
 */

require('dotenv').config();
const axios = require('axios');
const { getPool } = require('../config/database');

const API_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:9000';

function parseCliArgs(argv) {
  let keepData = false;
  let orgCodeOverride = null;
  /** When true, expect the API to call a real LLM (server must not set TEST_MOCK_LLM=true). */
  let useRealLlm = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--keep-data' || a === '--keepData') {
      keepData = true;
      continue;
    }
    if (a === '--mock=false' || a === 'mock=false') {
      useRealLlm = true;
      continue;
    }
    if (a.startsWith('--mock=')) {
      const v = a.slice('--mock='.length).trim().toLowerCase();
      if (v === 'false') useRealLlm = true;
      if (v === 'true') useRealLlm = false;
      continue;
    }
    if (a === '--mock') {
      const next = argv[i + 1];
      if (next === 'false') {
        useRealLlm = true;
        i++;
      } else if (next === 'true') {
        useRealLlm = false;
        i++;
      }
      continue;
    }
    if (a.startsWith('--org-code=')) {
      orgCodeOverride = a.slice('--org-code='.length).trim();
      continue;
    }
    if (a.startsWith('--orgCode=')) {
      orgCodeOverride = a.slice('--orgCode='.length).trim();
      continue;
    }
    if (a === '--org-code' || a === '--orgCode') {
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        orgCodeOverride = next.trim();
        i++;
      }
      continue;
    }
  }
  return { keepData, orgCodeOverride: orgCodeOverride || null, useRealLlm };
}

const args = process.argv.slice(2);
const { keepData, orgCodeOverride, useRealLlm } = parseCliArgs(args);

const runId = `${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

// Admin bootstrap — fresh every run so we don't depend on pre-seeded creds
const adminEmail = `gen-prompt-hopeful-admin_${runId}@example.com`;
// Must pass AdminUser.validatePassword — avoids "admin/login/user/password"
// common-words pattern, sequential digits, and 3+ repeated chars.
const adminPassword = 'Zpfg8K3qVt!';

// Regular test user
const testEmail = `gen-prompt-hopeful-test_${runId}@example.com`;
const testPassword = 'SecurePass987!';
const TEST_USER_NAME = 'SermonAlice';

// Org code (must be unique; uppercase)
const TEST_ORG_CODE = `HOPETEST${runId.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 10)}`;
const TEST_ORG_NAME = 'Grace Fellowship Test Church';
const TEST_ORG_CITY = 'Austin';
const TEST_ORG_STATE = 'TX';

// Distinctive marker we'll find verbatim in the stored generation_prompt
const TEMPLATE_MARKER = 'HOPEFUL_ORGCODE_MARKER_77';

// Distinctive marker in user_input to confirm {{User Input}} interpolation
const USER_INPUT_MARKER = 'HOPEFUL_USERINPUT_MARKER_88';
const TEST_USER_INPUT = `I want to deepen my faith and make sense of what our pastor shared ${USER_INPUT_MARKER} about forgiveness and active trust.`;

// Hopeful-style custom prompt using all four documented placeholders. The
// MARKER phrase lets us assert unambiguously that *this* template was used
// (not the built-in default). Kept intentionally short for readable DB
// inspection.
const CUSTOM_INITIAL_PROGRAM_PROMPT = `${TEMPLATE_MARKER}

You are a pastor at {{Church Name}} in {{City, State}} guiding a member named {{userName}} through a 7-day reflection journey.

Their stated goal:

"{{User Input}}"

Design a 7-day reflection rooted in the teachings of {{Church Name}}. Each day should include a reflection question, a unifying theme, and a Bible verse.

Respond only with a valid JSON object in exactly this structure:

{
  "program": {
    "title": "7-Day Reflection Program",
    "overview": "A single sentence describing the overall arc and goal of this program.",
    "days": [
      {
        "day": 1,
        "theme": "Theme name",
        "reflection": "The reflection text",
        "bible_verse": "The Bible verse"
      }
    ]
  }
}`;

const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS_MOCK = 30000;
const POLL_TIMEOUT_MS_REAL = 300000;

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

async function fetchHealthDiagnostics() {
  try {
    const res = await axios.get(`${API_URL}/health/diagnostics`, { timeout: 3000 });
    return res.data && typeof res.data === 'object' ? res.data : null;
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isProgramGenerationRowTerminal(row, requireTherapyResponse) {
  if (!row) return false;
  const err = row.generation_error;
  if (err != null && String(err).trim().length > 0) return true;
  if (requireTherapyResponse) {
    const tr = row.therapy_response;
    return typeof tr === 'string' && tr.trim().length > 0;
  }
  return row.generation_prompt != null || err != null;
}

async function pollForGenerationComplete(pool, programId, pollTimeoutMs, requireTherapyResponse = false) {
  const start = Date.now();
  while (Date.now() - start < pollTimeoutMs) {
    const [rows] = await pool.execute(
      'SELECT generation_prompt, generation_error, therapy_response FROM programs WHERE id = ?',
      [programId]
    );
    const row = rows[0];
    if (isProgramGenerationRowTerminal(row, requireTherapyResponse)) {
      return row;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  const [finalRows] = await pool.execute(
    'SELECT generation_prompt, generation_error, therapy_response FROM programs WHERE id = ?',
    [programId]
  );
  return finalRows[0] || null;
}

const MOCK_HOPEFUL_PROGRAM_TITLE = '7-Day Mock Reflection Program';

async function main() {
  let adminId = null;
  let orgCodeId = null;
  let userId = null;
  let programId = null;
  let pool = null;
  /** When set, test uses this DB row instead of creating admin + org */
  let existingOrgRow = null;

  console.log('\n🧪 generation_prompt — Hopeful (org_code custom prompt) Integration Test\n');
  if (orgCodeOverride) {
    console.log(`   Mode: existing org_code "${orgCodeOverride}" (no admin/org bootstrap)\n`);
  }
  if (useRealLlm) {
    console.log('   Mode: real LLM (--mock=false) — server must not set TEST_MOCK_LLM=true\n');
  }

  const pollTimeoutMs = useRealLlm ? POLL_TIMEOUT_MS_REAL : POLL_TIMEOUT_MS_MOCK;

  const serverUp = await checkServerAvailable();
  if (!serverUp) {
    console.log('⚠️  API server not reachable at', API_URL);
    if (useRealLlm) {
      console.log('   Start it without mock, e.g.: unset TEST_MOCK_LLM && PORT=9000 npm start');
    } else {
      console.log('   Start it with: TEST_MOCK_LLM=true npm start');
    }
    console.log('   Then re-run:   node tests/generation-prompt-hopeful-test.js\n');
    console.log('💥 Aborted: server not reachable.\n');
    process.exit(1);
  }

  if (useRealLlm) {
    const diag = await fetchHealthDiagnostics();
    if (!diag || typeof diag.test_mock_llm !== 'boolean') {
      console.log('⚠️  GET /health/diagnostics did not return test_mock_llm (update API or check URL).');
      console.log('   This flag is required to verify the server is not in TEST_MOCK_LLM mode.\n');
      console.log('💥 Aborted: cannot verify LLM mode.\n');
      process.exit(1);
    }
    if (diag.test_mock_llm === true) {
      console.log('⚠️  API reports test_mock_llm=true but --mock=false requires live LLM calls.');
      console.log('   Restart without TEST_MOCK_LLM, e.g.: unset TEST_MOCK_LLM && PORT=9000 npm start\n');
      console.log('💥 Aborted: server is still in TEST_MOCK_LLM mode.\n');
      process.exit(1);
    }
  }

  try {
    pool = getPool();

    if (orgCodeOverride) {
      const [existingRows] = await pool.execute(
        'SELECT id, org_code, organization, city, state, initial_program_prompt FROM org_codes WHERE org_code = ?',
        [orgCodeOverride]
      );
      existingOrgRow = existingRows[0] || null;
      assert(
        !!existingOrgRow,
        `org_codes row exists for org_code = ${orgCodeOverride}`,
        existingOrgRow ? `id = ${existingOrgRow.id}` : 'run scripts/seed-local-org-codes.js or create the org first'
      );
      if (!existingOrgRow) {
        throw new Error(`No org_codes row for org_code "${orgCodeOverride}"`);
      }
      orgCodeId = existingOrgRow.id;
    } else {
      // ── 1. Register admin ───────────────────────────────────────────────
      const registerRes = await axios.post(`${API_URL}/api/admin/auth/register`, {
        email: adminEmail,
        password: adminPassword
      });
      assert(
        registerRes.status === 201,
        'Admin user registered',
        `email = ${adminEmail}`
      );
      adminId = registerRes.data.user?.id || registerRes.data.admin?.id;

      // ── 2. Admin login ───────────────────────────────────────────────────
      const loginRes = await axios.post(`${API_URL}/api/admin/auth/login`, {
        email: adminEmail,
        password: adminPassword
      });
      assert(loginRes.status === 200, 'Admin login', `token received = ${!!loginRes.data.access_token}`);
      const adminToken = loginRes.data.access_token;

      // ── 3. Create org_code with custom initial_program_prompt ────────────
      const orgCodeRes = await axios.post(`${API_URL}/api/org-codes`, {
        org_code: TEST_ORG_CODE,
        organization: TEST_ORG_NAME,
        city: TEST_ORG_CITY,
        state: TEST_ORG_STATE,
        initial_program_prompt: CUSTOM_INITIAL_PROGRAM_PROMPT
      }, { headers: { Authorization: `Bearer ${adminToken}` } });
      assert(
        orgCodeRes.status === 201,
        'Org code created with custom initial_program_prompt',
        `code = ${TEST_ORG_CODE}, initial_program_prompt length = ${CUSTOM_INITIAL_PROGRAM_PROMPT.length}`
      );
      orgCodeId = orgCodeRes.data.org_code?.id;

      // Verify the prompt was persisted on the org_code row
      const [orgRows] = await pool.execute(
        'SELECT initial_program_prompt FROM org_codes WHERE id = ?',
        [orgCodeId]
      );
      assert(
        orgRows[0]?.initial_program_prompt === CUSTOM_INITIAL_PROGRAM_PROMPT,
        'Custom prompt is persisted on the org_code row',
        `stored length = ${orgRows[0]?.initial_program_prompt?.length || 0}`
      );
    }

    const orgCodeToLink = orgCodeOverride || TEST_ORG_CODE;

    // ── 4. Create regular user, set name, link org_code ──────────────────
    const createUserRes = await axios.post(`${API_URL}/api/users`, {
      email: testEmail,
      password: testPassword
    });
    assert(createUserRes.status === 201, 'Test user created', `email = ${testEmail}`);
    userId = createUserRes.data.user.id;
    const userToken = createUserRes.data.access_token;

    // Set user_name + partner_name (same pattern as other integration tests).
    // partner_name isn't used by the Hopeful flow but matches the shape the
    // rest of the suite uses.
    const setNameRes = await axios.put(`${API_URL}/api/users/${userId}`, {
      user_name: TEST_USER_NAME,
      partner_name: 'SermonBob'
    }, { headers: { Authorization: `Bearer ${userToken}` } });
    assert(setNameRes.status === 200, 'User name set', `user_name = ${TEST_USER_NAME}`);

    // Link the org_code in a second PUT (has its own validation/audit path).
    const linkOrgRes = await axios.put(`${API_URL}/api/users/${userId}`, {
      org_code: orgCodeToLink
    }, { headers: { Authorization: `Bearer ${userToken}` } });
    assert(linkOrgRes.status === 200, 'User linked to org_code', `org_code = ${orgCodeToLink}`);

    const userCheck = await axios.get(`${API_URL}/api/users/${userId}`, {
      headers: { Authorization: `Bearer ${userToken}` }
    });
    assert(
      userCheck.data.org_code_id === orgCodeId,
      'User is linked to the custom org_code',
      `user.org_code_id = ${userCheck.data.org_code_id}, expected = ${orgCodeId}`
    );

    // ── 5. Create program ────────────────────────────────────────────────
    const createProgramRes = await axios.post(`${API_URL}/api/programs`, {
      user_input: TEST_USER_INPUT
    }, { headers: { Authorization: `Bearer ${userToken}` } });
    assert(
      createProgramRes.status === 201,
      'Program created (201)',
      `program_id = ${createProgramRes.data.program?.id}`
    );
    programId = createProgramRes.data.program?.id;

    // ── 6. Poll for async generation ─────────────────────────────────────
    console.log(`\n⏳ Polling DB for async generation to complete (up to ${pollTimeoutMs / 1000}s)...`);
    const finalRow = await pollForGenerationComplete(pool, programId, pollTimeoutMs, useRealLlm);

    assert(!!finalRow, 'Program row still exists after polling');
    if (!finalRow) throw new Error('Program row not found after polling');

    const {
      generation_prompt: generationPrompt,
      generation_error: generationError,
      therapy_response: therapyResponse
    } = finalRow;

    if (useRealLlm && generationError) {
      throw new Error(
        `Real LLM program generation failed (programs.generation_error): ${String(generationError).slice(0, 400)}`
      );
    }

    // ── 7. Assertions on the stored generation_prompt ────────────────────
    assert(
      typeof generationPrompt === 'string' && generationPrompt.length > 0,
      'generation_prompt is populated in DB (non-null, non-empty string)',
      `length = ${generationPrompt ? generationPrompt.length : 0}, generation_error = ${generationError ? '"' + String(generationError).slice(0, 80) + '"' : 'null'}`
    );

    if (typeof generationPrompt !== 'string' || generationPrompt.length === 0) {
      console.log('\n⚠️  generation_prompt was not populated — remaining assertions skipped.');
      if (useRealLlm) {
        console.log('   For --mock=false: check OPENAI_API_KEY, model, and server logs; poll may need a longer timeout.');
      } else {
        console.log('   For the default path: start the server with TEST_MOCK_LLM=true.');
      }
    } else {
      assert(
        !generationPrompt.includes('[SYSTEM]') && !generationPrompt.includes('[USER]'),
        'generation_prompt is stored raw (no [SYSTEM]/[USER] wrapper markers)',
        `has [SYSTEM]=${generationPrompt.includes('[SYSTEM]')}, has [USER]=${generationPrompt.includes('[USER]')}`
      );

      if (existingOrgRow) {
        const tmpl = (existingOrgRow.initial_program_prompt || '').trim();
        if (tmpl.length > 0) {
          const proofLen = Math.min(160, tmpl.length);
          const proof = tmpl.slice(0, proofLen);
          assert(
            generationPrompt.includes(proof),
            'generation_prompt embeds org initial_program_prompt (prefix of stored template)',
            `proof_len = ${proofLen}, org_code = ${existingOrgRow.org_code}`
          );
          assert(
            generationPrompt.includes('grow closer to God and make progress toward their goal'),
            'generation_prompt includes default Hopeful pastor framing (org template is embedded in it)',
            'HopefulPromptService wraps initial_program_prompt inside the default user message'
          );
        } else {
          assert(
            generationPrompt.includes('grow closer to God and make progress toward their goal'),
            'generation_prompt contains default Hopeful signature (no custom initial_program_prompt on org)',
            'empty template falls back to built-in default prompt'
          );
        }

        if (tmpl.includes('{{userName}}')) {
          assert(
            generationPrompt.includes(TEST_USER_NAME),
            'generation_prompt contains user_name ({{userName}} in org template)',
            `"${TEST_USER_NAME}" found = ${generationPrompt.includes(TEST_USER_NAME)}`
          );
        }
        if (tmpl.includes('{{User Input}}')) {
          assert(
            generationPrompt.includes(USER_INPUT_MARKER),
            'generation_prompt contains user_input marker ({{User Input}} in org template)',
            `"${USER_INPUT_MARKER}" found = ${generationPrompt.includes(USER_INPUT_MARKER)}`
          );
        }
        if (tmpl.includes('{{Church Name}}') && existingOrgRow.organization) {
          assert(
            generationPrompt.includes(existingOrgRow.organization),
            'generation_prompt contains org organization ({{Church Name}} in org template)',
            `"${existingOrgRow.organization}" found = ${generationPrompt.includes(existingOrgRow.organization)}`
          );
        }
        if (tmpl.includes('{{City, State}}') && existingOrgRow.city && existingOrgRow.state) {
          const cs = `${existingOrgRow.city}, ${existingOrgRow.state}`;
          assert(
            generationPrompt.includes(cs),
            'generation_prompt contains "City, State" ({{City, State}} in org template)',
            `"${cs}" found = ${generationPrompt.includes(cs)}`
          );
        }
      } else {
        assert(
          generationPrompt.includes(TEMPLATE_MARKER),
          'generation_prompt contains the custom-template MARKER (proves org_code.initial_program_prompt was used)',
          `"${TEMPLATE_MARKER}" found = ${generationPrompt.includes(TEMPLATE_MARKER)}`
        );

        assert(
          generationPrompt.includes(TEST_USER_NAME),
          'generation_prompt contains user_name (proves {{userName}} was interpolated)',
          `"${TEST_USER_NAME}" found = ${generationPrompt.includes(TEST_USER_NAME)}`
        );

        assert(
          generationPrompt.includes(USER_INPUT_MARKER),
          'generation_prompt contains user_input marker (proves {{User Input}} was interpolated)',
          `"${USER_INPUT_MARKER}" found = ${generationPrompt.includes(USER_INPUT_MARKER)}`
        );

        assert(
          generationPrompt.includes(TEST_ORG_NAME),
          'generation_prompt contains org name (proves {{Church Name}} was interpolated)',
          `"${TEST_ORG_NAME}" found = ${generationPrompt.includes(TEST_ORG_NAME)}`
        );

        assert(
          generationPrompt.includes(`${TEST_ORG_CITY}, ${TEST_ORG_STATE}`),
          'generation_prompt contains "City, State" (proves {{City, State}} was interpolated)',
          `"${TEST_ORG_CITY}, ${TEST_ORG_STATE}" found = ${generationPrompt.includes(`${TEST_ORG_CITY}, ${TEST_ORG_STATE}`)}`
        );

        assert(
          generationPrompt.includes('grow closer to God and make progress toward their goal'),
          'generation_prompt includes default Hopeful framing (custom MARKER template is embedded in the default shell)',
          'HopefulPromptService inserts org initial_program_prompt between guidelines and JSON schema'
        );
      }

      // Regression guard: no unreplaced {{ }} placeholders. If this fails,
      // the interpolation pipeline broke for a placeholder that was in the
      // template but is no longer replaced by the service.
      const unreplaced = (generationPrompt.match(/\{\{[^}]+\}\}/g) || []);
      assert(
        unreplaced.length === 0,
        'generation_prompt has no unreplaced {{...}} placeholders',
        unreplaced.length === 0 ? 'clean' : `found: ${unreplaced.join(', ')}`
      );

      if (useRealLlm) {
        assert(
          typeof therapyResponse === 'string' && therapyResponse.length > 20,
          'therapy_response is populated (real LLM JSON body)',
          `length = ${therapyResponse ? therapyResponse.length : 0}`
        );
        let parsedTr = null;
        try {
          parsedTr = JSON.parse(therapyResponse);
        } catch {
          /* handled below */
        }
        assert(
          parsedTr && parsedTr.program && Array.isArray(parsedTr.program.days),
          'therapy_response parses as JSON with program.days',
          `top_keys = ${parsedTr ? Object.keys(parsedTr).join(',') : 'parse failed'}`
        );
        if (parsedTr && parsedTr.program && Array.isArray(parsedTr.program.days)) {
          assert(
            parsedTr.program.days.length === 7 || parsedTr.program.days.length === 14,
            'Hopeful therapy_response has 7 or 14 days (validator-compatible)',
            `days.length = ${parsedTr.program.days.length}`
          );
        }
        assert(
          !String(therapyResponse).includes(MOCK_HOPEFUL_PROGRAM_TITLE),
          'therapy_response is not the TEST_MOCK_LLM Hopeful stub title',
          'unexpected mock title in stored response'
        );
        assert(
          generationError === null,
          'generation_error is NULL on successful real-LLM generation',
          `generation_error = ${generationError}`
        );
      } else if (therapyResponse) {
        assert(
          generationError === null,
          'generation_error is NULL on successful generation',
          `generation_error = ${generationError}`
        );
      }
    }
  } catch (error) {
    const method = error.config?.method?.toUpperCase();
    const url = error.config?.url;
    console.error('❌ Test error:', error.response?.data?.error || error.message);
    if (method || url) {
      console.error(`   While calling: ${method || '??'} ${url || '??'}`);
    }
    if (error.response?.status) {
      console.error(`   Status: ${error.response.status}`);
    }
    if (error.response?.data) {
      console.error('   Response body:', JSON.stringify(error.response.data).slice(0, 500));
    }
    if (error.config?.data) {
      console.error('   Request body:', String(error.config.data).slice(0, 500));
    }
    failed++;
  } finally {
    if (keepData) {
      console.log('\n📦 Keeping test data (--keep-data / --keepData)');
      if (adminId) {
        console.log(`   Admin ID:    ${adminId}`);
        console.log(`   Admin Email: ${adminEmail}  (password: ${adminPassword})`);
      } else if (orgCodeOverride) {
        console.log('   Admin:       (skipped — existing org_code mode)');
      }
      console.log(`   Org Code ID: ${orgCodeId}`);
      console.log(`   Org Code:    ${orgCodeOverride || TEST_ORG_CODE}`);
      if (orgCodeOverride) {
        console.log('   Note:        org_codes row was not created by this test; it was left unchanged.');
      }
      console.log(`   User ID:     ${userId}`);
      console.log(`   User Email:  ${testEmail}`);
      if (programId) console.log(`   Program ID:  ${programId}`);
      console.log('\n   Handy queries:');
      if (programId) {
        console.log(`   SELECT id, LENGTH(generation_prompt) AS prompt_len, LENGTH(therapy_response) AS tr_len, generation_error FROM programs WHERE id = '${programId}';`);
        console.log(`   SELECT generation_prompt FROM programs WHERE id = '${programId}';`);
        console.log(`   SELECT therapy_response FROM programs WHERE id = '${programId}';`);
      }
      if (orgCodeId) {
        console.log(`   SELECT org_code, organization, city, state, LENGTH(initial_program_prompt) AS tmpl_len FROM org_codes WHERE id = '${orgCodeId}';`);
        console.log(`   SELECT initial_program_prompt FROM org_codes WHERE id = '${orgCodeId}';`);
      }
    } else if (pool) {
      try {
        console.log('\n🧹 Cleaning up test data...');
        if (programId) await pool.execute('DELETE FROM programs WHERE id = ?', [programId]);
        if (userId) await pool.execute('DELETE FROM users WHERE id = ?', [userId]);
        if (orgCodeId && !orgCodeOverride) {
          await pool.execute('DELETE FROM org_codes WHERE id = ?', [orgCodeId]);
        }
        if (adminId) await pool.execute('DELETE FROM admin_users WHERE id = ?', [adminId]);
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
