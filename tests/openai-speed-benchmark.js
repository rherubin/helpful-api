require('dotenv').config();
const ChatGPTService = require('../services/ChatGPTService');

const ITERATIONS = 3;

const TEST_INPUTS = [
  {
    userName: 'Sarah',
    partnerName: 'Michael',
    userInput: 'We want to improve our communication and feel more connected in our daily lives together.'
  },
  {
    userName: 'Emma',
    partnerName: 'James',
    userInput: 'We struggle with balancing work and quality time together and want to be more intentional about our relationship.'
  },
  {
    userName: 'Olivia',
    partnerName: 'Daniel',
    userInput: 'We recently had a difficult season and want to rebuild trust and emotional intimacy in our marriage.'
  }
];

async function runBenchmark() {
  const service = new ChatGPTService();

  if (!service.isConfigured()) {
    console.error('OPENAI_API_KEY not configured');
    process.exit(1);
  }

  // Read the model from the service by inspecting a dummy fetch
  let detectedModel = 'unknown';
  const originalFetch = global.fetch;
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    detectedModel = body.model;
    global.fetch = originalFetch;
    return originalFetch(_url, options);
  };

  console.log(`\n========================================`);
  console.log(`  OpenAI Model Speed Benchmark`);
  console.log(`  Iterations: ${ITERATIONS}`);
  console.log(`========================================\n`);

  const durations = [];
  let modelConfirmed = false;

  for (let i = 0; i < ITERATIONS; i++) {
    const input = TEST_INPUTS[i % TEST_INPUTS.length];
    console.log(`Run ${i + 1}/${ITERATIONS}: "${input.userName} & ${input.partnerName}"`);

    const start = Date.now();
    try {
      const result = await service.generateCouplesProgram(
        input.userName,
        input.partnerName,
        input.userInput
      );
      const elapsed = Date.now() - start;
      durations.push(elapsed);

      const days = result?.program?.days?.length || '?';

      if (!modelConfirmed) {
        console.log(`  Model: ${detectedModel}`);
        modelConfirmed = true;
      }
      console.log(`  Result: ${days}-day program in ${elapsed}ms`);
    } catch (err) {
      const elapsed = Date.now() - start;
      console.log(`  FAILED after ${elapsed}ms: ${err.message}`);
    }
  }

  if (durations.length === 0) {
    console.log('\nNo successful runs — cannot compute stats.');
    process.exit(1);
  }

  const sorted = [...durations].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const avg = durations.reduce((s, d) => s + d, 0) / durations.length;
  const median = sorted[Math.floor(sorted.length / 2)];

  console.log(`\n----------------------------------------`);
  console.log(`  Results for model: ${detectedModel}`);
  console.log(`----------------------------------------`);
  console.log(`  Successful runs : ${durations.length}/${ITERATIONS}`);
  console.log(`  Min             : ${min}ms`);
  console.log(`  Max             : ${max}ms`);
  console.log(`  Average         : ${avg.toFixed(0)}ms`);
  console.log(`  Median          : ${median}ms`);
  console.log(`  All durations   : ${durations.map(d => d + 'ms').join(', ')}`);
  console.log(`----------------------------------------\n`);

  return { model: detectedModel, durations, min, max, avg, median };
}

runBenchmark().then(() => process.exit(0)).catch(err => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
