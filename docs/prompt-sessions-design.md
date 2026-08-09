# Prompt Sessions (Sit Sessions) — Design

**Status**: Early design / in discussion  
**Date**: 2026-05-28  
**Related**: Existing `pairings`, `programs`, `program_steps`, `PushNotificationService`

## Naming Decision (Locked)

**Final decision:** We are keeping the internal resource as **`prompt_sessions`** (and `prompt_session_preps` for the prep/check-in step).

- **Table**: `prompt_sessions`
- **Prep table**: `prompt_session_preps`
- **Endpoints**: rooted at `/api/prompt-sessions`
- **Key column**: `generation_prompt` (LONGTEXT) on the main table — this is the dynamically constructed prompt from both users' prep answers.

**Rationale (owner's call):** The feature's special sauce is the AI prompt that gets built from the two preps to make each experience unique for The Bridge and The Session. Naming it after "prompt" makes that mechanic explicit and intentional.

**Tradeoffs explicitly accepted:**
- "prompt" is heavily used elsewhere in the codebase (generation_prompt, prompt services, org prompts, etc.).
- Future developers will need context that this is the "Sit Together" dyadic experience, not general prompt tooling.
- We explored many lighter/brand-free alternatives (`pauses`, `moments`, `breaths`, `practices`, `rituals`, etc.) and the various "xxx_sessions" variants. After discussion, `prompt_sessions` was chosen anyway.

**Status:** No further naming work is required. This name is locked for implementation unless explicitly reopened.

Public-facing language can remain "Sit Session" / "Sit Together". Internal code and schema use `prompt_sessions`.

`pairing_id` is **optional** on `POST /api/prompt-sessions` (solo / single-device web mode). When omitted, the session is owned by the creator only. When provided, the caller must be a pairing member; pairing status need **not** be `accepted`.

## Core Concept

A **Prompt Session** (publicly called a "Sit Session") is a structured, time-bounded experience. It supports:

- **Solo / single-device**: no pairing required — one user creates a session and fills prep (web unpaired flow).
- **Paired**: optional `pairing_id` links the session to a couple so both members can prep and later generate shared content.

High-level flow (paired):
1. One partner initiates a Prompt Session (with or without an accepted pairing).
2. Both partners independently complete **Prep** (six questions + optional focus area).
3. Once both preps are complete → system generates the dynamic prompt → produces the Bridge + Session content.
4. The couple moves through "The Bridge" (transition / synthesis of prep) → "The Session" (the guided experience itself).
5. The Prompt Session has a clear completion state.

Solo flow: create without `pairing_id` → complete own prep → prep is considered ready (one completed prep).

Key differences from Programs:
- Prep is structured; for paired sessions both partners complete prep before content generation.
- The generation is heavily conditioned on the *specific answers* given in prep.
- Stronger sense of "we are doing this together right now" when paired (even if done async).

## Data Model

### `prompt_sessions`

```sql
CREATE TABLE prompt_sessions (
  id VARCHAR(50) PRIMARY KEY,
  pairing_id VARCHAR(50) DEFAULT NULL,   -- optional: null = solo / single-device
  created_by_user_id VARCHAR(50) NOT NULL,

  status ENUM('prep','bridge','in_session','complete','abandoned') DEFAULT 'prep',
  current_phase VARCHAR(50) DEFAULT NULL,           -- e.g. 'bridge', 'core_prompt_2', 'synthesis'

  -- The magic: the dynamically built prompt(s) that were sent to the LLM
  -- based on both partners' answers in prompt_session_preps. Stored for audit, debugging, and replay.
  generation_prompt LONGTEXT DEFAULT NULL,
  generation_prompt_used_at DATETIME DEFAULT NULL,
  llm_used VARCHAR(100) DEFAULT NULL,

  -- Optional: store the raw generated output for the Bridge and the main experience
  bridge_content LONGTEXT DEFAULT NULL,
  session_content LONGTEXT DEFAULT NULL,

  generation_error TEXT DEFAULT NULL,
  seconds_to_generate DECIMAL(8,4) DEFAULT NULL,

  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_pairing_id (pairing_id),
  INDEX idx_created_by (created_by_user_id),
  INDEX idx_status (status),
  FOREIGN KEY (pairing_id) REFERENCES pairings (id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

**Notes**:
- `pairing_id` is **optional** (null for solo / single-device). When set, membership grants access; `accepted` status is not required for create or prep.
- We deliberately store `generation_prompt` (following the existing pattern in the `programs` table).
- `current_phase` gives the client a clear signal for what UI to show.

### `generation_status` — first-class generation job state

`status` (`prep`/`bridge`/…) is the **product** lifecycle and does not tell clients whether an LLM call is currently running. `generation_status` is a second, orthogonal state machine dedicated to that:

```
idle -> running -> succeeded
              \--> failed -> running -> succeeded | failed   (retry)
```

- `generation_started_at` / `generation_finished_at` are stamped on each `running` transition and each terminal outcome, respectively.
- The `idle`/`failed` → `running` transition is a compare-and-swap `UPDATE ... WHERE generation_status IN ('idle','pending','failed') AND bridge_content IS NULL AND session_content IS NULL` (`PromptSession.beginGeneration`), so an explicit `POST .../generate` racing the auto-generate background trigger can never both reach the LLM — the loser gets a `GENERATION_RUNNING` error, surfaced as **409** by the route.
- `succeeded` never restarts: once content exists, `POST .../generate` is a pure read (idempotent).
- `failed` is retryable: a subsequent `POST .../generate` clears `generation_error` and re-enters `running`.
- **`running` must never be terminal.** Because only `idle`/`pending`/`failed` are claimable, a row that reaches `running` and never leaves would 409 forever with no API path back — so the lock is designed to always be releasable:
  - Everything after the compare-and-swap in `runGeneration()` lives inside the try/catch that calls `updateGenerationError`, so no throw can escape while holding the lock.
  - `resetStaleRunningGenerations()` runs at startup and sweeps `running` rows to `failed`. Any row still `running` at boot belongs to a dead process.
  - The CAS also accepts a `running` row whose `generation_started_at` is older than `PROMPT_SESSION_GENERATION_LEASE_MS` (default 10 min), covering a process that is alive but wedged. The default is deliberately generous: stealing the lock from a worker that is still going would double the LLM spend the CAS exists to prevent.
  - Because a lease can hand a session to a second worker, `updateGenerationError()` refuses to write to a session that already has content — otherwise a slow first worker's late failure could flip a session the second worker just finished.
  - The route deliberately does **not** pre-check `generation_status === 'running'` before calling `runGeneration()`; only the CAS knows whether a lease is still live, and a pre-check would shadow reclaim and make abandoned sessions permanently un-retryable.
- Both 409s from the generate route carry a machine-readable `code` (`GENERATION_RUNNING` vs `PREP_NOT_READY`) because they call for opposite client behaviour: poll, versus collect more prep.
- `serializeSession()` never exposes raw `generation_status`/`generation_started_at`/`generation_finished_at` derivation logic to clients directly — it also attaches a computed, non-persisted `generation` object (`{ status, error, started_at, finished_at, ready }`) so app/web don't reinvent the "is this actually ready" rule from `bridge_content`/`session_content` null-checks.
- Full client-facing contract (state table, polling guidance, status codes): see the [README "Generation state"](../README.md#generation-state-generation_status) section — that is the canonical, single source of truth; this note is implementation background only.

### `prompt_session_preps`

One row per partner per prompt session. This is the "six questions + optional focus".

```sql
CREATE TABLE prompt_session_preps (
  id VARCHAR(50) PRIMARY KEY,
  prompt_session_id VARCHAR(50) NOT NULL,
  user_id VARCHAR(50) NOT NULL,

  -- The six structured questions (names are illustrative — adjust to final copy)
  bringing_text TEXT,
  energy_level TEXT,                    -- or INT if it's a 1-5 scale
  intention TEXT,
  curiosity TEXT,
  boundary TEXT,
  gratitude TEXT,

  optional_focus TEXT NULL,

  completed_at DATETIME DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY unique_prompt_session_user (prompt_session_id, user_id),
  INDEX idx_prompt_session_id (prompt_session_id),
  INDEX idx_user_id (user_id),
  FOREIGN KEY (prompt_session_id) REFERENCES prompt_sessions (id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

**Privacy / visibility rules** (to be confirmed with product):
- While a prep is incomplete for a user → only that user can see their own answers.
- Once **both** partners have submitted prep → the system can reveal the partner's prep (or a synthesized view) during The Bridge.
- The generated `generation_prompt` is never exposed to clients.

## API Surface (Current Thinking)

### Creation (root endpoint, as preferred)

```http
POST /api/prompt-sessions
Authorization: Bearer <token>

{
  // optional — omit for solo / single-device
  "pairing_id": "pair_abc123"
  // optional future fields: "mode": "live" | "async"
}
```

**Validation** (must happen in the handler):
- `pairing_id` is optional. If omitted → solo session owned by the caller.
- If `pairing_id` is provided: it must exist and the caller must be a member. Status need **not** be `'accepted'`.
- Policy: only one non-terminal session per pairing; only one non-terminal solo session per user.

Response (201) — paired:
```json
{
  "message": "Prompt session created",
  "prompt_session": {
    "id": "ps_xyz789",
    "pairing_id": "pair_abc123",
    "status": "prep",
    "current_phase": null,
    "created_at": "..."
  }
}
```

Response (201) — solo (`pairing_id` omitted): same shape with `"pairing_id": null`.

**Prep readiness (`both_preps_complete`):**
- Solo (`pairing_id` null): true when **one** completed prep exists.
- Paired: true when **two** completed preps exist.

### Implemented endpoints

- `GET /api/prompt-sessions` — list for the caller (optional `?pairing_id=`)
- `GET /api/prompt-sessions/:id`
- `POST /api/prompt-sessions/:id/prep` — submit or update my prep answers
- `GET /api/prompt-sessions/:id/prep` — my prep + partner completion status (full partner answers once both done); solo returns `partner_prep: null`
- `POST /api/prompt-sessions/:id/generate` — builds prep-based prompt via `HelpfulPromptService.generateSitSessionContent`, persists `bridge_content` / `session_content` (**409** if prep not ready · **503** if LLM not configured · idempotent if already generated)
- `PATCH /api/prompt-sessions/:id` — `status` and/or `current_phase`

Push notifications will be important (e.g., "Your partner finished prep", "Your Sit Session is ready").

## Relationship to Existing Features

- **Pairings**: Optional anchor. Paired sessions link to a pairing (any membership status for access); solo sessions have no pairing.
- **Programs**: Sibling concept, not child. Users/couples can have many Programs and many Sit Sessions over time. No forced hierarchy.
- **PushNotificationService**: Reuse heavily for "partner completed prep", "session ready", etc.
- **LLM services** (`HopefulPromptService` / `HelpfulPromptService`): Will be called with a carefully constructed prompt built from both preps.

## Open Questions / Decisions Needed

1. **Exact six questions** — final wording and whether any are scales vs free text.
2. **Prep visibility policy** — when exactly does Partner A see Partner B's raw answers?
3. **Generation trigger** — automatic when the second prep is submitted, or explicit "Generate" button?
4. **One active session per pairing?** — **Yes (implemented):** one active per pairing; one active solo per user.
5. **Real-time needs** — do we need presence ("partner is currently filling prep") or is the existing push + polling model sufficient?
6. **Archival / history** — how long do we keep completed Sit Sessions and their generated prompts?

---

This document should evolve as we implement the model, routes, and the actual prompt construction logic.

## Related Code Locations (as of now)

- `models/Pairing.js`
- `models/Program.js` (see `generation_prompt`, access checks that consider pairing members)
- `routes/programs.js` (creation pattern with optional/required `pairing_id`)
- `services/PushNotificationService.js`
- `routes/pairing.js`, `routes/programSteps.js` (examples of fire-and-forget push on relationship events)
