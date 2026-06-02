# Prompt Sessions (Sit Sessions) — Design

**Status**: Early design / in discussion  
**Date**: 2026-05-28  
**Related**: Existing `pairings`, `programs`, `program_steps`, `PushNotificationService`

## Naming Decision

The internal resource is named **`prompt_sessions`** (table and API).

- **Table**: `prompt_sessions`
- **Prep table**: `prompt_session_preps`
- **Endpoints**: rooted at `/api/prompt-sessions` (kebab-case in URLs, `prompt_sessions` in the DB)
- **Inside the table**: still store `generation_prompt` (this preserves the technical truth that a dynamic AI prompt is built from the two preps).

The public product can still call the overall experience a **"Sit Session"** — the internal/DB name does not need to match the public label.

`prompt_sessions` is explicit about what the resource is (a session that produces a dynamically generated prompt from both partners' prep). The `pairing_id` foreign key is required on creation.

## Core Concept

A **Prompt Session** (publicly called a "Sit Session") is a structured, time-bounded couples experience that is more intentional and potentially more synchronous than the existing 14-day Programs.

High-level flow:
1. One partner initiates a Prompt Session for an accepted pairing.
2. Both partners independently complete **Prep** (six questions + optional focus area).
3. Once both preps are complete → system generates the dynamic prompt → produces the Bridge + Session content.
4. The couple moves through "The Bridge" (transition / synthesis of prep) → "The Session" (the guided experience itself).
5. The Prompt Session has a clear completion state.

Key differences from Programs:
- Prep is structured and required from *both* partners before content generation.
- The generation is heavily conditioned on the *specific answers* given in prep.
- Stronger sense of "we are doing this together right now" (even if done async).

## Data Model

### `prompt_sessions`

```sql
CREATE TABLE prompt_sessions (
  id VARCHAR(50) PRIMARY KEY,
  pairing_id VARCHAR(50) NOT NULL,
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
- `pairing_id` is **required** at creation time.
- We deliberately store `generation_prompt` (following the existing pattern in the `programs` table).
- `current_phase` gives the client a clear signal for what UI to show.

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
  "pairing_id": "pair_abc123"
  // optional future fields: "mode": "live" | "async"
}
```

**Validation** (must happen in the handler):
- `pairing_id` is required and valid.
- Caller is a member of the pairing.
- Pairing status must be `'accepted'`.
- (Policy decision) No other non-terminal prompt session exists for this pairing.

Response (201):
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

### Other likely endpoints

- `GET /api/pairings/:pairingId/prompt-sessions` — list for a pairing (convenience)
- `GET /api/prompt-sessions/:id`
- `POST /api/prompt-sessions/:id/prep` — submit or update my prep answers
- `GET /api/prompt-sessions/:id/prep` — my prep + partner completion status (and full answers once both done, per policy)
- `POST /api/prompt-sessions/:id/generate` (or automatic on second prep completion) — triggers the dynamic prompt construction + LLM call
- Phase advancement endpoints (or a single `PATCH /api/prompt-sessions/:id` with `current_phase`)

Push notifications will be important (e.g., "Your partner finished prep", "Your Sit Session is ready").

## Relationship to Existing Features

- **Pairings**: The anchor. Every prompt session belongs to exactly one accepted pairing.
- **Programs**: Sibling concept, not child. A couple can have many Programs and many Sit Sessions over time. No forced hierarchy.
- **PushNotificationService**: Reuse heavily for "partner completed prep", "session ready", etc.
- **LLM services** (`HopefulPromptService` / `HelpfulPromptService`): Will be called with a carefully constructed prompt built from both preps.

## Open Questions / Decisions Needed

1. **Exact six questions** — final wording and whether any are scales vs free text.
2. **Prep visibility policy** — when exactly does Partner A see Partner B's raw answers?
3. **Generation trigger** — automatic when the second prep is submitted, or explicit "Generate" button?
4. **One active session per pairing?** — should we prevent creating a second while one is still in `prep`/`bridge`/`in_session`?
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
