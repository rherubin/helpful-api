/**
 * Sit Session (prompt_sessions) Generate — generation_status Demo Script
 *
 * A manual, read-friendly walkthrough of the generation job state machine
 * (idle -> running -> succeeded|failed) described in README.md's
 * "Prompt sessions (Sit Sessions)" section and docs/prompt-sessions-design.md.
 * Prints `generation` (status/error/started_at/finished_at/ready) at every
 * step so you can see the exact shape clients should poll for.
 *
 * Not part of `npm test` — this is a demo/manual-verification tool, not a
 * pass/fail assertion suite (see tests/prompt-sessions-test.js for that).
 *
 * Usage:
 *   TEST_MOCK_LLM=true npm start        # in one terminal
 *   node tests/prompt-session-generate-demo.js   # in another
 */

require('dotenv').config();
const axios = require('axios');

const API_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:9000';
const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 30000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function checkServerAvailable() {
  try {
    const res = await axios.get(`${API_URL}/health`, { timeout: 3000 });
    return res.status === 200;
  } catch {
    return false;
  }
}

function authHeader(token) {
  return { headers: { Authorization: `Bearer ${token}` } };
}

function printSession(label, session) {
  const g = session?.generation || {};
  console.log(`\n📋 ${label}`);
  console.log(`   id:                      ${session?.id}`);
  console.log(`   status (lifecycle):      ${session?.status}`);
  console.log(`   generation.status:       ${g.status}`);
  console.log(`   generation.ready:        ${g.ready}`);
  console.log(`   generation.error:        ${g.error}`);
  console.log(`   generation.started_at:   ${g.started_at}`);
  console.log(`   generation.finished_at:  ${g.finished_at}`);
  console.log(`   bridge_content:          ${session?.bridge_content ? '(present)' : 'null'}`);
  console.log(`   session_content:         ${session?.session_content ? '(present)' : 'null'}`);
}

// Poll GET /:id until generation.status is terminal (succeeded|failed), or
// POLL_TIMEOUT_MS elapses — the exact pattern documented for clients waiting
// on auto-generate (fire-and-forget) to finish.
async function pollUntilTerminal(token, sessionId) {
  const start = Date.now();
  let session = null;
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    const res = await axios.get(`${API_URL}/api/prompt-sessions/${sessionId}`, authHeader(token));
    session = res.data.prompt_session;
    if (session.generation?.status === 'succeeded' || session.generation?.status === 'failed') {
      return session;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return session;
}

const PREP = {
  gratitude: 'hopeful and a bit tender',
  energy_level: 'somewhat full',
  boundary: 'somewhat close',
  intention: 'gentle and honest',
  curiosity: 'stay on reconnecting after a hard week',
  bringing_text: 'I want us to leave tonight feeling more on the same team.'
};

async function main() {
  console.log('\n🎬 Sit Session generate — generation_status state machine demo\n');
  console.log(`   API: ${API_URL}\n`);

  const serverUp = await checkServerAvailable();
  if (!serverUp) {
    console.log('⚠️  API server not reachable at', API_URL);
    console.log('   Start it with: TEST_MOCK_LLM=true npm start');
    console.log('   Then re-run:   node tests/prompt-session-generate-demo.js\n');
    process.exit(1);
  }

  const email = `sit-session-demo_${Date.now()}_${Math.random().toString(36).substr(2, 5)}@example.com`;
  const password = 'DemoPass987!';

  const createUserRes = await axios.post(`${API_URL}/api/users`, { email, password });
  const token = createUserRes.data.access_token;
  console.log(`👤 Created demo user: ${email}`);

  // ── Session 1: auto-generate (fire-and-forget after prep) ──────────────
  const createRes = await axios.post(`${API_URL}/api/prompt-sessions`, {}, authHeader(token));
  const sessionId = createRes.data.prompt_session.id;
  printSession('Session 1 — after create (expect generation.status = "idle")', createRes.data.prompt_session);

  try {
    await axios.post(`${API_URL}/api/prompt-sessions/${sessionId}/generate`, {}, authHeader(token));
  } catch (err) {
    console.log(`\n🚫 Generate before prep is ready → ${err.response?.status}: ${err.response?.data?.error}`);
  }

  const prepRes = await axios.post(`${API_URL}/api/prompt-sessions/${sessionId}/prep`, PREP, authHeader(token));
  console.log(`\n✅ Prep complete. both_preps_complete = ${prepRes.data.both_preps_complete}`);
  console.log('   Auto-generate fires in the background now — polling GET .../:id for the transition...');

  const settledSession = await pollUntilTerminal(token, sessionId);
  printSession(
    `Session 1 — after auto-generate settles (polled up to ${POLL_TIMEOUT_MS / 1000}s)`,
    settledSession
  );

  const idempotentRes = await axios.post(`${API_URL}/api/prompt-sessions/${sessionId}/generate`, {}, authHeader(token));
  console.log(`\n🔁 Explicit generate after auto-generate → ${idempotentRes.status}: "${idempotentRes.data.message}" (idempotent, no new LLM call)`);

  // ── Session 2: explicit synchronous generate + concurrency demo ────────
  await axios.patch(`${API_URL}/api/prompt-sessions/${sessionId}`, { status: 'complete' }, authHeader(token));

  const createRes2 = await axios.post(`${API_URL}/api/prompt-sessions`, {}, authHeader(token));
  const sessionId2 = createRes2.data.prompt_session.id;
  await axios.post(`${API_URL}/api/prompt-sessions/${sessionId2}/prep`, PREP, authHeader(token));

  console.log('\n▶️  Session 2: firing two concurrent POST .../generate calls right after prep completes...');
  console.log('   (one should win the compare-and-swap into "running"; the other gets 200 or 409 — never a second LLM call)');
  const [outcome1, outcome2] = await Promise.allSettled([
    axios.post(`${API_URL}/api/prompt-sessions/${sessionId2}/generate`, {}, authHeader(token)),
    axios.post(`${API_URL}/api/prompt-sessions/${sessionId2}/generate`, {}, authHeader(token))
  ]);
  const statuses = [outcome1, outcome2].map(r => (r.status === 'fulfilled' ? r.value.status : r.reason?.response?.status));
  console.log(`   Concurrent call statuses: ${statuses.join(', ')}`);

  const finalSession2 = await pollUntilTerminal(token, sessionId2);
  printSession('Session 2 — final state after concurrent generate calls settle', finalSession2);

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log('\n📊 Summary:');
  console.log(`   Session 1 (auto-generate):        generation.status = ${settledSession?.generation?.status}`);
  console.log(`   Session 2 (concurrent explicit):  generation.status = ${finalSession2?.generation?.status}`);
  console.log('\n✅ Demo complete.\n');
}

main().catch(err => {
  console.error('\n❌ Demo script failed:', err.response?.data?.error || err.message);
  process.exit(1);
});
