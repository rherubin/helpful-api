#!/usr/bin/env node
'use strict';

/**
 * Instrument the API server and the test runner with c8, then write reports
 * to ./coverage. Does not replace `npm test`.
 *
 * Usage:
 *   PORT=9010 node scripts/run-coverage.js
 *   node scripts/run-coverage.js --url=http://127.0.0.1:9010
 */

const { spawn, execSync } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const root = path.resolve(__dirname, '..');
const c8Bin = path.join(root, 'node_modules', '.bin', 'c8');
const port = process.env.PORT || '9010';
const host = process.env.HOST || '127.0.0.1';
const baseUrl = process.env.TEST_BASE_URL || `http://${host}:${port}`;
const tmpDir = path.join(root, '.c8-tmp');
const reportsDir = path.join(root, 'coverage');

const envBase = {
  ...process.env,
  PORT: String(port),
  HOST: host,
  JWT_SECRET: process.env.JWT_SECRET || 'ci-test-jwt-secret',
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || 'ci-test-refresh-secret',
  MYSQL_HOST: process.env.MYSQL_HOST || '127.0.0.1',
  MYSQL_PORT: process.env.MYSQL_PORT || '3306',
  MYSQL_USER: process.env.MYSQL_USER || 'root',
  MYSQL_PASSWORD: process.env.MYSQL_PASSWORD || 'helpful_ci_root',
  MYSQL_DATABASE: process.env.MYSQL_DATABASE || 'helpful_db',
  TEST_MOCK_LLM: process.env.TEST_MOCK_LLM || 'true',
  TEST_MOCK_PUSH: process.env.TEST_MOCK_PUSH || 'true',
  TEST_MOCK_IAP: process.env.TEST_MOCK_IAP || 'true',
  TEST_MOCK_STRIPE: process.env.TEST_MOCK_STRIPE || 'true',
  TEST_BASE_URL: baseUrl
};

const extraArgs = process.argv.slice(2);

function c8Args(forReport) {
  const include = [
    '--include=server.js',
    '--include=routes/**',
    '--include=services/**',
    '--include=middleware/**',
    '--include=models/**',
    '--include=config/**'
  ];
  const common = [
    `--temp-directory=${tmpDir}`,
    '--all',
    '--exclude=tests/**',
    '--exclude=scripts/**',
    '--exclude=node_modules/**',
    ...include
  ];
  if (forReport) {
    return [
      ...common,
      '--reporter=text',
      '--reporter=text-summary',
      '--reporter=json-summary',
      '--reporter=json',
      '--reporter=html',
      `--reports-dir=${reportsDir}`
    ];
  }
  return [...common, '--clean=false', '--report=false'];
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: root,
      env: { ...envBase, ...(opts.env || {}) },
      stdio: opts.stdio || 'inherit'
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) return reject(new Error(`${cmd} killed by ${signal}`));
      resolve(code ?? 1);
    });
    if (opts.onSpawn) opts.onSpawn(child);
  });
}

function pidsOnPort(p) {
  try {
    const out = execSync(`fuser ${p}/tcp`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return out.trim().split(/\s+/).map(Number).filter(Boolean);
  } catch (err) {
    const text = `${err.stdout || ''} ${err.stderr || ''}`;
    return text.trim().split(/\s+/).map(Number).filter(Boolean);
  }
}

function waitForHealth(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get(`${baseUrl}/health`, (res) => {
        res.resume();
        if (res.statusCode === 200) return resolve();
        retry();
      });
      req.on('error', retry);
      req.setTimeout(1000, () => {
        req.destroy();
        retry();
      });
    };
    const retry = () => {
      if (Date.now() > deadline) {
        return reject(new Error(`Server did not become healthy at ${baseUrl}/health`));
      }
      setTimeout(tryOnce, 250);
    };
    tryOnce();
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function stopInstrumentedServer(serverProc) {
  // SIGINT the actual `node server.js` process so the graceful shutdown
  // handler runs and c8 can flush coverage. Killing the c8 wrapper alone
  // leaves the server running and drops the server-side report.
  const pids = pidsOnPort(port);
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGINT');
    } catch (_) {
      /* already gone */
    }
  }
  if (serverProc && !serverProc.killed) {
    try {
      serverProc.kill('SIGINT');
    } catch (_) {
      /* already gone */
    }
  }

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const still = pidsOnPort(port);
    const wrapperAlive = serverProc && serverProc.exitCode == null && !serverProc.killed;
    if (still.length === 0 && !wrapperAlive) return;
    await sleep(200);
  }

  for (const pid of pidsOnPort(port)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch (_) {
      /* already gone */
    }
  }
  if (serverProc && !serverProc.killed) {
    try {
      serverProc.kill('SIGKILL');
    } catch (_) {
      /* already gone */
    }
  }
}

async function main() {
  if (!fs.existsSync(c8Bin)) {
    console.error('c8 is not installed. Run: npm install --save-dev c8');
    process.exit(1);
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  let serverProc;
  const serverCodePromise = run(c8Bin, c8Args(false).concat(['node', 'server.js']), {
    onSpawn: (child) => {
      serverProc = child;
    }
  });

  try {
    await waitForHealth();
    console.log(`\n[coverage] Server is healthy at ${baseUrl}\n`);

    const testCode = await run(
      c8Bin,
      c8Args(false).concat(['node', 'tests/run-all-tests.js', `--url=${baseUrl}`, ...extraArgs])
    );

    await stopInstrumentedServer(serverProc);
    await Promise.race([
      serverCodePromise.catch(() => 0),
      sleep(2000)
    ]);

    console.log('\n[coverage] Writing reports to ./coverage\n');
    const reportCode = await run(c8Bin, ['report', ...c8Args(true)]);

    if (testCode !== 0) {
      console.error(`[coverage] Test suite exited ${testCode}`);
      process.exit(testCode);
    }
    process.exit(reportCode);
  } catch (err) {
    await stopInstrumentedServer(serverProc);
    console.error(err);
    process.exit(1);
  }
}

main();
