#!/usr/bin/env node

/**
 * Sit Session generate demo (debug the real HTTP JSON).
 *
 * 1. Creates two users + accepted pairing
 * 2. Creates a paired prompt-session
 * 3. Submits full /prep for each partner
 * 4. POST /generate and pretty-prints the full API JSON
 *
 * Prerequisites:
 *   - API running (e.g. TEST_MOCK_LLM=true TEST_MOCK_PUSH=true npm start)
 *   - OPENAI_API_KEY set for live GPT, or TEST_MOCK_LLM=true for mock JSON
 *
 * Usage:
 *   node tests/prompt-session-generate-demo.js
 *   npm run test:prompt-session-generate-demo
 *   TEST_BASE_URL=http://127.0.0.1:9000 node tests/prompt-session-generate-demo.js
 */

const axios = require('axios');

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:9000';
const TIMEOUT = Number(process.env.TEST_TIMEOUT_MS) || 60000;
const PASSWORD = 'Test1!@#';

function log(step, detail = '') {
  const suffix = detail ? ` — ${detail}` : '';
  console.log(`\n▶ ${step}${suffix}`);
}

function auth(token) {
  return {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    timeout: TIMEOUT
  };
}

function pretty(obj) {
  return JSON.stringify(obj, null, 2);
}

async function createUser(label, userName) {
  const email = `ps-gen-demo.${label}.${Date.now()}.${Math.random().toString(36).slice(2, 7)}@example.com`;
  const res = await axios.post(
    `${BASE_URL}/api/users`,
    {
      email,
      password: PASSWORD,
      first_name: label,
      last_name: 'Demo',
      user_name: userName
    },
    { timeout: TIMEOUT }
  );
  // Profile user_name may need PUT if create ignores it
  const user = res.data.user;
  const token = res.data.access_token;
  if (userName && user?.id) {
    try {
      await axios.put(
        `${BASE_URL}/api/users/${user.id}`,
        { user_name: userName },
        auth(token)
      );
    } catch {
      // non-fatal; generate falls back to email local-part
    }
  }
  return {
    id: user.id,
    email,
    user_name: userName,
    token
  };
}

async function ensureServerUp() {
  try {
    const res = await axios.get(`${BASE_URL}/health`, { timeout: 5000 });
    if (res.status !== 200) {
      throw new Error(`Health returned ${res.status}`);
    }
  } catch (err) {
    console.error(`\n❌ API not reachable at ${BASE_URL}`);
    console.error('   Start it first, e.g.:');
    console.error('     TEST_MOCK_LLM=true TEST_MOCK_PUSH=true npm start');
    console.error(`   (${err.message})`);
    process.exit(1);
  }
}

async function main() {
  console.log('='.repeat(72));
  console.log('Sit Session generate demo');
  console.log(`Base URL: ${BASE_URL}`);
  console.log('='.repeat(72));

  await ensureServerUp();
  log('Health OK');

  try {
    // ── 1) Two users + pairing ───────────────────────────────────────────
    log('Create two users');
    const alex = await createUser('alex', 'Alex');
    const jordan = await createUser('jordan', 'Jordan');
    console.log(`  Alex:   ${alex.id}  ${alex.email}`);
    console.log(`  Jordan: ${jordan.id}  ${jordan.email}`);

    log('Create accepted pairing');
    const requestRes = await axios.post(`${BASE_URL}/api/pairing/request`, {}, auth(alex.token));
    const partnerCode = requestRes.data.partner_code;
    if (!partnerCode) throw new Error('No partner_code from pairing request');
    await axios.post(
      `${BASE_URL}/api/pairing/accept`,
      { partner_code: partnerCode },
      auth(jordan.token)
    );
    // Pairing id may be on accept or list
    let pairingId = requestRes.data.pairing_id || requestRes.data.pairing?.id;
    if (!pairingId) {
      const listRes = await axios.get(`${BASE_URL}/api/pairings`, auth(alex.token));
      const accepted = (listRes.data.pairings || []).find(p => p.status === 'accepted');
      pairingId = accepted?.id;
    }
    if (!pairingId) throw new Error('Could not resolve pairing_id');
    console.log(`  pairing_id: ${pairingId}`);

    // ── 2) Create prompt-session ─────────────────────────────────────────
    log('POST /api/prompt-sessions (paired)');
    const createRes = await axios.post(
      `${BASE_URL}/api/prompt-sessions`,
      { pairing_id: pairingId },
      auth(alex.token)
    );
    const sessionId = createRes.data.prompt_session?.id;
    if (!sessionId) throw new Error('No prompt_session.id on create');
    console.log(`  session_id: ${sessionId}`);
    console.log(`  create response status: ${createRes.status}`);

    // ── 3) Prep for both partners (distinct answers for debugging) ───────
    const prepAlex = {
      gratitude: 'hopeful and a bit tender',
      energy_level: 'somewhat full',
      boundary: 'somewhat close',
      intention: 'gentle and honest',
      curiosity: 'stay on reconnecting after a hard week',
      bringing_text: 'I want us to leave tonight feeling more on the same team.',
      optional_focus: 'evening check-ins'
    };
    const prepJordan = {
      gratitude: 'tired but open',
      energy_level: 'empty',
      boundary: 'distant',
      intention: 'honest and direct',
      curiosity: 'talk about how we handle conflict',
      bringing_text: 'I need more patience from both of us without shutting down.'
    };

    log('POST /prep for Alex (partner A / creator)');
    const prepARes = await axios.post(
      `${BASE_URL}/api/prompt-sessions/${sessionId}/prep`,
      prepAlex,
      auth(alex.token)
    );
    console.log(`  completed: ${prepARes.data.prep?.completed}, both_preps_complete: ${prepARes.data.both_preps_complete}`);

    log('POST /prep for Jordan (partner B)');
    const prepBRes = await axios.post(
      `${BASE_URL}/api/prompt-sessions/${sessionId}/prep`,
      prepJordan,
      auth(jordan.token)
    );
    console.log(`  completed: ${prepBRes.data.prep?.completed}, both_preps_complete: ${prepBRes.data.both_preps_complete}`);
    if (!prepBRes.data.both_preps_complete) {
      throw new Error('Expected both_preps_complete true after second prep');
    }

    // Small settle if auto-generate is racing (explicit generate is still idempotent)
    await new Promise(r => setTimeout(r, 400));

    // ── 4) Generate + dump JSON ──────────────────────────────────────────
    log('POST /api/prompt-sessions/:id/generate');
    const genRes = await axios.post(
      `${BASE_URL}/api/prompt-sessions/${sessionId}/generate`,
      {},
      auth(alex.token)
    );

    console.log(`\n  HTTP ${genRes.status}`);
    console.log(`  message: ${genRes.data.message}`);
    console.log('\n' + '='.repeat(72));
    console.log('FULL GENERATE RESPONSE JSON');
    console.log('='.repeat(72));
    console.log(pretty(genRes.data));

    const session = genRes.data.prompt_session || {};
    console.log('\n' + '='.repeat(72));
    console.log('NORMALIZED GPT OUTPUT (bridge_content + session_content only)');
    console.log('='.repeat(72));
    console.log(pretty({
      bridge_content: session.bridge_content,
      session_content: session.session_content
    }));

    // Sanity summary for quick scan
    console.log('\n' + '='.repeat(72));
    console.log('QUICK SUMMARY');
    console.log('='.repeat(72));
    console.log(`  session_id:            ${session.id}`);
    console.log(`  status:                ${session.status}`);
    console.log(`  llm_used:              ${session.llm_used}`);
    console.log(`  seconds_to_generate:   ${session.seconds_to_generate}`);
    console.log(`  generation_error:      ${session.generation_error}`);
    console.log(`  bridge.summary:        ${(session.bridge_content?.summary || '').slice(0, 80)}…`);
    console.log(`  bridge.shared_themes:  ${JSON.stringify(session.bridge_content?.shared_themes)}`);
    console.log(`  session.title:         ${session.session_content?.title}`);
    console.log(`  session.phases:        ${(session.session_content?.phases || []).map(p => p.id).join(', ')}`);
    console.log(`  generation_prompt:     ${('generation_prompt' in session) ? 'EXPOSED (bug)' : 'not exposed (correct)'}`);
    console.log('\nNote: generation_prompt (text sent to the model) is never returned by the API.');
    console.log('      The JSON above is the validated/normalized model output saved for clients.');
    console.log('\nDone. Demo users use @example.com (safe for npm run test:cleanup).');
    console.log(`Re-fetch: GET ${BASE_URL}/api/prompt-sessions/${sessionId}`);
  } catch (err) {
    const status = err.response?.status;
    const body = err.response?.data;
    console.error('\n❌ Demo failed');
    if (status) console.error(`  HTTP ${status}`);
    if (body) console.error('  body:', pretty(body));
    else console.error('  error:', err.message);
    process.exit(1);
  }
}

main();
