/**
 * Batch test: run 10 generateInitialProgram calls and keep all data.
 *
 * Creates a dedicated user for each run so naming + org state are isolated.
 * Polls each program for step generation and prints a final summary with
 * program IDs so you can run the SQL below to inspect therapy_response.
 *
 * Run with:
 *   node tests/run-initial-prompt-batch.js
 *
 * SQL to inspect results afterward:
 *   SELECT id, user_input, generation_error,
 *          LEFT(therapy_response, 200) AS therapy_response_preview
 *   FROM programs
 *   WHERE id IN ('<id1>','<id2>',...);
 */

require('dotenv').config();
const axios = require('axios');
const { generateTestEmail } = require('./test-helpers');

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:9000';
const POLL_TIMEOUT_MS = 90000;
const POLL_INTERVAL_MS = 3000;
const REQUEST_TIMEOUT = 15000;
const DEFAULT_CONCURRENCY = Number(process.env.BATCH_CONCURRENCY || 3);
const FOLLOWUP_POLL_TIMEOUT_MS = Number(process.env.FOLLOWUP_POLL_TIMEOUT_MS || 60000);
const ENABLE_TIMEOUT_FOLLOWUP = process.env.ENABLE_TIMEOUT_FOLLOWUP !== 'false';

const RUNS = [
  {
    label: 'No org — prayer life',
    userName: 'Morgan',
    orgSetup: null,
    userInput: 'I want to deepen my prayer life and feel closer to God each day.'
  },
  {
    label: 'No org — serve others',
    userName: 'Riley',
    orgSetup: null,
    userInput: 'I want to find meaningful ways to serve my community and live out my faith.'
  },
  {
    label: 'Custom org (all fields) — peace',
    userName: 'Cameron',
    orgSetup: { org_name: 'Lakewood Community Church', org_city: 'Houston', org_state: 'TX' },
    userInput: 'I am struggling with anxiety and want to find peace through my faith.'
  },
  {
    label: 'Custom org (all fields) — marriage',
    userName: 'Alex',
    orgSetup: { org_name: 'Grace Chapel', org_city: 'Nashville', org_state: 'TN' },
    userInput: 'I want to grow in patience and become a more present and loving spouse.'
  },
  {
    label: 'Custom org (all fields) — purpose',
    userName: 'Jordan',
    orgSetup: { org_name: 'Hillside Fellowship', org_city: 'Denver', org_state: 'CO' },
    userInput: 'I feel lost in my career and want to discern God\'s purpose for my life.'
  },
  {
    label: 'Custom org (name only) — gratitude',
    userName: 'Casey',
    orgSetup: { org_name: 'Cornerstone Church' },
    userInput: 'I want to cultivate a spirit of gratitude and stop focusing on what I lack.'
  },
  {
    label: 'Custom org (name only) — forgiveness',
    userName: 'Taylor',
    orgSetup: { org_name: 'New Life Church' },
    userInput: 'I need help forgiving someone who hurt me deeply and releasing that bitterness.'
  },
  {
    label: 'No org — parenting',
    userName: 'Avery',
    orgSetup: null,
    userInput: 'I want to be a more patient and faith-centered parent to my young children.'
  },
  {
    label: 'Custom org (all fields) — grief',
    userName: 'Quinn',
    orgSetup: { org_name: 'Hope Community Church', org_city: 'Atlanta', org_state: 'GA' },
    userInput: 'I am grieving the loss of a parent and want to find hope and healing through scripture.'
  },
  {
    label: 'No org — short input',
    userName: 'Drew',
    orgSetup: null,
    userInput: 'I want to read the Bible consistently and build a daily quiet time habit.'
  }
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function createUser(label) {
  const res = await axios.post(`${BASE_URL}/api/users`, {
    email: generateTestEmail('batchprompt'),
    password: 'TestPass987!'
  }, { timeout: REQUEST_TIMEOUT });
  return { id: res.data.user.id, token: res.data.access_token };
}

async function setUserName(user, userName) {
  // Always set partner_name too. Post-refactor, users without an org_code
  // route to HelpfulPromptService (couples flow) which requires partner_name;
  // users with an org_code route to HopefulPromptService which ignores it.
  // Setting both makes the batch work for every routing case.
  await axios.put(`${BASE_URL}/api/users/${user.id}`, {
    user_name: userName,
    partner_name: 'Alex'
  }, {
    headers: { Authorization: `Bearer ${user.token}` },
    timeout: REQUEST_TIMEOUT
  });
}

async function setOrgFields(user, orgSetup) {
  if (!orgSetup) return;
  await axios.put(`${BASE_URL}/api/users/${user.id}`, orgSetup, {
    headers: { Authorization: `Bearer ${user.token}` },
    timeout: REQUEST_TIMEOUT
  });
}

async function createProgram(user, userInput) {
  const res = await axios.post(`${BASE_URL}/api/programs`, {
    user_input: userInput
  }, {
    headers: { Authorization: `Bearer ${user.token}` },
    timeout: REQUEST_TIMEOUT
  });
  return res.data.program.id;
}

async function pollForSteps(programId, token, timeoutMs = POLL_TIMEOUT_MS) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await axios.get(`${BASE_URL}/api/programs/${programId}`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: REQUEST_TIMEOUT
      });
      const steps = res.data.program?.program_steps ?? [];
      if (steps.length > 0) return { status: 'steps_generated', count: steps.length };

      // Check if a generation error was saved
      const generationError = res.data.program?.generation_error;
      if (generationError) return { status: 'generation_error', error: generationError };
    } catch { /* keep polling */ }
    await sleep(POLL_INTERVAL_MS);
  }
  return { status: 'timeout' };
}

async function triggerTherapyResponseFollowUp(programId, token) {
  try {
    const res = await axios.post(
      `${BASE_URL}/api/programs/${programId}/therapy_response`,
      {},
      {
        headers: { Authorization: `Bearer ${token}` },
        timeout: REQUEST_TIMEOUT
      }
    );
    return { ok: true, statusCode: res.status };
  } catch (err) {
    const statusCode = err.response?.status || null;
    const message = err.response?.data?.error || err.message;

    // 409 means steps already exist (or are being created). Treat as non-fatal.
    if (statusCode === 409) {
      return { ok: true, statusCode, message };
    }
    return { ok: false, statusCode, message };
  }
}

function formatRunHeader(index, total, run) {
  const num = String(index + 1).padStart(2, ' ');
  return `\n[${num}/${total}] ${run.label}`;
}

async function executeRun(run, index, total) {
  console.log(formatRunHeader(index, total, run));
  console.log(`       user_name : ${run.userName}`);
  console.log(`       org_setup : ${run.orgSetup ? JSON.stringify(run.orgSetup) : 'none'}`);
  console.log(`       user_input: ${run.userInput}`);

  const result = { label: run.label, programId: null, status: null, detail: null };

  try {
    const user = await createUser(run.label);
    await setUserName(user, run.userName);
    await setOrgFields(user, run.orgSetup);

    const programId = await createProgram(user, run.userInput);
    result.programId = programId;
    console.log(`       program_id: ${programId} — polling for steps...`);

    const poll = await pollForSteps(programId, user.token);
    result.status = poll.status;
    result.detail = poll.count ?? poll.error ?? null;

    if (poll.status === 'steps_generated') {
      console.log(`       ✅ ${poll.count} steps generated`);
    } else if (poll.status === 'generation_error') {
      console.log(`       ❌ generation_error: ${poll.error}`);
    } else {
      console.log(`       ⚠️  timed out after ${Math.round(POLL_TIMEOUT_MS / 1000)}s`);

      if (ENABLE_TIMEOUT_FOLLOWUP) {
        // Follow-up phase 1: extra poll window for delayed async completion.
        console.log(`       🔁 follow-up poll window: +${Math.round(FOLLOWUP_POLL_TIMEOUT_MS / 1000)}s`);
        const followUpPoll = await pollForSteps(programId, user.token, FOLLOWUP_POLL_TIMEOUT_MS);

        if (followUpPoll.status === 'steps_generated') {
          result.status = followUpPoll.status;
          result.detail = followUpPoll.count;
          console.log(`       ✅ recovered in follow-up poll (${followUpPoll.count} steps)`);
          return result;
        }
        if (followUpPoll.status === 'generation_error') {
          result.status = followUpPoll.status;
          result.detail = followUpPoll.error;
          console.log(`       ❌ follow-up detected generation_error: ${followUpPoll.error}`);
          return result;
        }

        // Follow-up phase 2: trigger manual therapy response generation once.
        console.log('       🔁 triggering manual therapy_response follow-up...');
        const trigger = await triggerTherapyResponseFollowUp(programId, user.token);
        if (!trigger.ok) {
          result.status = 'followup_trigger_failed';
          result.detail = `follow-up trigger failed (${trigger.statusCode || 'no-status'}): ${trigger.message}`;
          console.log(`       ❌ ${result.detail}`);
          return result;
        }

        // Follow-up phase 3: final poll after manual trigger.
        const finalPoll = await pollForSteps(programId, user.token, FOLLOWUP_POLL_TIMEOUT_MS);
        if (finalPoll.status === 'steps_generated') {
          result.status = finalPoll.status;
          result.detail = finalPoll.count;
          console.log(`       ✅ recovered after follow-up trigger (${finalPoll.count} steps)`);
        } else if (finalPoll.status === 'generation_error') {
          result.status = finalPoll.status;
          result.detail = finalPoll.error;
          console.log(`       ❌ follow-up generation_error: ${finalPoll.error}`);
        } else {
          result.status = 'timeout_after_followup';
          result.detail = 'timed out even after follow-up poll + trigger';
          console.log('       ⚠️  still timed out after follow-up poll + trigger');
        }
      }
    }
  } catch (err) {
    result.status = 'exception';
    result.detail = err.response?.data?.error || err.message;
    console.log(`       ❌ exception: ${result.detail}`);
  }

  return result;
}

async function runInParallelGroups(runs, concurrency) {
  const results = new Array(runs.length);
  let cursor = 0;

  async function worker(workerId) {
    while (true) {
      const idx = cursor;
      cursor += 1;
      if (idx >= runs.length) return;

      const run = runs[idx];
      console.log(`\n👷 Worker ${workerId} starting run ${idx + 1}/${runs.length}`);
      results[idx] = await executeRun(run, idx, runs.length);
    }
  }

  const workers = [];
  for (let i = 0; i < concurrency; i++) {
    workers.push(worker(i + 1));
  }
  await Promise.all(workers);
  return results;
}

async function runBatch() {
  const requestedConcurrency = Number(process.argv[2] || DEFAULT_CONCURRENCY);
  const concurrency = Number.isFinite(requestedConcurrency) && requestedConcurrency > 0
    ? Math.min(requestedConcurrency, RUNS.length)
    : Math.min(DEFAULT_CONCURRENCY, RUNS.length);

  // Optional BATCH_COUNT env override: run only the first N scenarios instead
  // of all 10. Useful for quick smoke/validation runs.
  const requestedCount = Number(process.env.BATCH_COUNT);
  const count = Number.isFinite(requestedCount) && requestedCount > 0
    ? Math.min(requestedCount, RUNS.length)
    : RUNS.length;
  const selectedRuns = RUNS.slice(0, count);
  const effectiveConcurrency = Math.min(concurrency, selectedRuns.length);

  console.log('='.repeat(70));
  console.log(`🧪 BATCH: generateInitialProgram — ${selectedRuns.length} runs, data kept`);
  console.log(`🔗 ${BASE_URL}`);
  console.log(`⚡ Parallel workers: ${effectiveConcurrency}`);
  console.log(`🔁 Timeout follow-up: ${ENABLE_TIMEOUT_FOLLOWUP ? 'enabled' : 'disabled'} (${Math.round(FOLLOWUP_POLL_TIMEOUT_MS / 1000)}s windows)`);
  console.log('='.repeat(70));

  const results = await runInParallelGroups(selectedRuns, effectiveConcurrency);

  // ─── Summary ──────────────────────────────────────────────────────────────
  const passed = results.filter(r => r.status === 'steps_generated').length;
  const failed = results.filter(r => r.status !== 'steps_generated').length;

  console.log('\n' + '='.repeat(70));
  console.log('📊 RESULTS');
  console.log('='.repeat(70));
  console.log(`Passed (steps generated): ${passed}/${selectedRuns.length}`);
  console.log(`Failed / no steps:        ${failed}/${selectedRuns.length}`);

  console.log('\n📋 Program IDs (for DB inspection):');
  for (const r of results) {
    const icon = r.status === 'steps_generated' ? '✅' : r.status === 'generation_error' ? '❌' : '⚠️ ';
    const detail = r.status === 'generation_error' ? ` — ${r.detail}` : r.status === 'timeout' ? ' — timed out' : r.status === 'exception' ? ` — ${r.detail}` : ` — ${r.detail} steps`;
    console.log(`  ${icon} ${r.programId ?? 'N/A'} | ${r.label}${detail}`);
  }

  const failedIds = results.filter(r => r.programId && r.status !== 'steps_generated').map(r => r.programId);
  if (failedIds.length > 0) {
    console.log('\n❌ FAILED PROGRAM IDS (grep these in the server log for root cause):');
    for (const id of failedIds) console.log(`    ${id}`);
  }

  const ids = results.filter(r => r.programId).map(r => `'${r.programId}'`).join(', ');
  console.log('\n🗄️  SQL to inspect therapy_response and errors:');
  console.log(`  SELECT id, LEFT(user_input, 60) AS user_input,`);
  console.log(`         generation_error,`);
  console.log(`         LEFT(therapy_response, 300) AS therapy_response_preview`);
  console.log(`  FROM programs`);
  console.log(`  WHERE id IN (${ids});`);
  console.log('='.repeat(70));
}

runBatch().catch(err => {
  console.error('Batch runner error:', err.message);
  process.exit(1);
});
