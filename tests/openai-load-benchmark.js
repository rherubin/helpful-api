require('dotenv').config();
const ChatGPTService = require('../services/ChatGPTService');

const CONCURRENCY_LEVELS = [1, 2, 4];

const TEST_INPUTS = [
  { userName: 'Sarah', partnerName: 'Michael', userInput: 'We want to improve our communication and feel more connected in our daily lives together.' },
  { userName: 'Emma', partnerName: 'James', userInput: 'We struggle with balancing work and quality time together and want to be more intentional about our relationship.' },
  { userName: 'Olivia', partnerName: 'Daniel', userInput: 'We recently had a difficult season and want to rebuild trust and emotional intimacy in our marriage.' },
  { userName: 'Grace', partnerName: 'Nathan', userInput: 'We want to grow spiritually as a couple and learn to pray together more consistently.' },
];

async function runSingle(service, input, index) {
  const start = Date.now();
  try {
    const result = await service.generateCouplesProgram(input.userName, input.partnerName, input.userInput);
    const elapsed = Date.now() - start;
    const days = result?.program?.days?.length || '?';
    const tokens = null; // can't easily get from the queued path
    return { success: true, elapsed, days, index };
  } catch (err) {
    const elapsed = Date.now() - start;
    return { success: false, elapsed, error: err.message, index };
  }
}

function stats(durations) {
  if (durations.length === 0) return null;
  const sorted = [...durations].sort((a, b) => a - b);
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: Math.round(durations.reduce((s, d) => s + d, 0) / durations.length),
    median: sorted[Math.floor(sorted.length / 2)],
    p95: sorted[Math.floor(sorted.length * 0.95)] || sorted[sorted.length - 1],
  };
}

async function runLevel(service, concurrency, detectedModel) {
  console.log(`\n--- Concurrency: ${concurrency} ---`);

  const promises = Array.from({ length: concurrency }, (_, i) => {
    const input = TEST_INPUTS[i % TEST_INPUTS.length];
    return runSingle(service, input, i + 1);
  });

  const wallStart = Date.now();
  const results = await Promise.all(promises);
  const wallTime = Date.now() - wallStart;

  const successes = results.filter(r => r.success);
  const failures = results.filter(r => !r.success);

  successes.forEach(r => console.log(`  [${r.index}] OK  ${r.days}-day program in ${r.elapsed}ms`));
  failures.forEach(r => console.log(`  [${r.index}] FAIL after ${r.elapsed}ms: ${r.error}`));

  const s = stats(successes.map(r => r.elapsed));

  console.log(`  Wall time  : ${wallTime}ms`);
  console.log(`  Success    : ${successes.length}/${concurrency}`);
  if (s) {
    console.log(`  Min        : ${s.min}ms`);
    console.log(`  Max        : ${s.max}ms`);
    console.log(`  Avg        : ${s.avg}ms`);
    console.log(`  Median     : ${s.median}ms`);
  }

  return { concurrency, wallTime, successes: successes.length, failures: failures.length, stats: s, allResults: results };
}

async function main() {
  const service = new ChatGPTService();
  if (!service.isConfigured()) {
    console.error('OPENAI_API_KEY not configured');
    process.exit(1);
  }

  // Detect model
  let detectedModel = 'unknown';
  const originalFetch = global.fetch;
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    detectedModel = body.model;
    global.fetch = originalFetch;
    return originalFetch(_url, options);
  };

  console.log(`\n================================================`);
  console.log(`  generateInitialProgram Load Benchmark`);
  console.log(`  Concurrency levels: ${CONCURRENCY_LEVELS.join(', ')}`);
  console.log(`================================================`);

  const allLevelResults = [];

  for (const level of CONCURRENCY_LEVELS) {
    const result = await runLevel(service, level, detectedModel);
    allLevelResults.push(result);
    if (level !== CONCURRENCY_LEVELS[CONCURRENCY_LEVELS.length - 1]) {
      console.log(`\n  Cooling down 3s...`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  console.log(`\n================================================`);
  console.log(`  Summary — model: ${detectedModel}`);
  console.log(`================================================`);
  console.log(`  Concurrency | Success | Wall Time | Avg     | Median  | Min     | Max`);
  for (const r of allLevelResults) {
    const s = r.stats;
    const row = s
      ? `  ${String(r.concurrency).padEnd(11)} | ${r.successes}/${r.concurrency}     | ${String(r.wallTime + 'ms').padEnd(9)} | ${String(s.avg + 'ms').padEnd(7)} | ${String(s.median + 'ms').padEnd(7)} | ${String(s.min + 'ms').padEnd(7)} | ${s.max}ms`
      : `  ${String(r.concurrency).padEnd(11)} | ${r.successes}/${r.concurrency}     | ${String(r.wallTime + 'ms').padEnd(9)} | -       | -       | -       | -`;
    console.log(row);
  }
  console.log(`================================================\n`);
}

main().then(() => process.exit(0)).catch(err => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
