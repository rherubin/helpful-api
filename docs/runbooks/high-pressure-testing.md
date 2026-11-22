# High-pressure and large API test runs

Use this when running multi-scenario, high-concurrency, or long-lived API validation against a local server. Pure unit tests and `npm test` against an already-running server do not need a restart if no server code changed.

## Restart and readiness

Stop whatever is bound to the test port, start with explicit env, and wait for health before sending load.

```bash
kill $(lsof -ti:9000) 2>/dev/null
TEST_MOCK_LLM=true PROGRAM_GENERATION_FOLLOWUP_DELAY_MS=5000 npm start
curl -s http://127.0.0.1:9000/health
# expect: OK
```

`TEST_MOCK_LLM=true` returns deterministic mock LLM responses so pressure runs do not spend OpenAI tokens. Omit it only when you are deliberately measuring live LLM latency or quality (for example `tests/openai-load-benchmark.js`).

Device-token and user-update rate limiters are bypassed when `TEST_MOCK_LLM=true` or `SKIP_RATE_LIMITS=true`. If some other limiter still fires, lower concurrency (8 → 6 → 4) rather than turning limits off ad hoc.

## Run configuration

Use an explicit concurrency number. For isolation, disable runner-level follow-up when you only want to validate backend follow-up:

```bash
# Backend-only follow-up
ENABLE_TIMEOUT_FOLLOWUP=false node tests/run-initial-prompt-batch.js 8

# End-to-end (runner + backend)
node tests/run-initial-prompt-batch.js 8
```

Production follow-up delay defaults to 60 seconds (`PROGRAM_GENERATION_FOLLOWUP_DELAY_MS`, default `60000`). Lower it for pressure runs (5000 in the example above) so failures surface sooner. Change one variable per run so results stay comparable.

## Report

Record pass/fail counts and generated program IDs. For timeouts or failures, include a SQL preview of `generation_error` and `therapy_response`, and check server logs for first-attempt failure, a scheduled follow-up, and follow-up success or the final persisted error.
