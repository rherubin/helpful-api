// PromptSession model — "Sit Sessions" (publicly), `prompt_sessions` internally.
//
// A prompt session is a structured, time-bounded experience. It may be:
//   - Solo (no pairing_id): single-device / unpaired web flow — one user fills prep.
//   - Paired (pairing_id set): both partners can prep; membership grants access
//     regardless of pairing status (accepted not required), so prep can start
//     before or without an accepted pair.
//
// When paired, once both preps are complete the dynamic LLM prompt is built and
// Bridge + Session content is generated (HelpfulPromptService.generateSitSessionContent).
// Solo sessions are ready after the creator's prep is complete.
// Persistence: saveGeneratedContent / updateGenerationError.
class PromptSession {
  constructor(db) {
    this.db = db; // MySQL pool
  }

  async query(sql, params = []) {
    const [results] = await this.db.execute(sql, params);
    return results;
  }

  async queryOne(sql, params = []) {
    const [results] = await this.db.execute(sql, params);
    return results[0] || null;
  }

  // Generate unique ID (matches the convention used across the codebase).
  generateUniqueId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  // Statuses where a session is still "in flight" (not terminal).
  static get ACTIVE_STATUSES() {
    return ['prep', 'bridge', 'in_session'];
  }

  static get ALL_STATUSES() {
    return ['prep', 'bridge', 'in_session', 'complete', 'abandoned'];
  }

  // Generation *job* state — orthogonal to the product `status` above.
  // idle: not started (or reset) · pending: queued (optional, currently unused
  // by any code path — transitions go idle -> running directly) · running: LLM
  // call in flight · succeeded: bridge_content + session_content persisted ·
  // failed: generation_error set, content still null.
  static get GENERATION_STATUSES() {
    return ['idle', 'pending', 'running', 'succeeded', 'failed'];
  }

  // The six required prep questions. Field names are placeholders pending final
  // product copy — see docs/prompt-sessions-design.md (open question #1).
  static get REQUIRED_PREP_FIELDS() {
    return ['bringing_text', 'energy_level', 'intention', 'curiosity', 'boundary', 'gratitude'];
  }

  // All prep columns the client may write (required six + optional focus).
  static get PREP_FIELDS() {
    return [...PromptSession.REQUIRED_PREP_FIELDS, 'optional_focus'];
  }

  async initDatabase() {
    const createPromptSessionsTable = `
      CREATE TABLE IF NOT EXISTS prompt_sessions (
        id VARCHAR(50) PRIMARY KEY,
        pairing_id VARCHAR(50) DEFAULT NULL,
        created_by_user_id VARCHAR(50) NOT NULL,

        status ENUM('prep','bridge','in_session','complete','abandoned') DEFAULT 'prep',
        current_phase VARCHAR(50) DEFAULT NULL,

        -- The dynamically built prompt sent to the LLM, derived from both
        -- partners' preps. Stored for audit/debug/replay; never exposed to clients.
        generation_prompt LONGTEXT DEFAULT NULL,
        generation_prompt_used_at DATETIME DEFAULT NULL,
        llm_used VARCHAR(100) DEFAULT NULL,

        bridge_content LONGTEXT DEFAULT NULL,
        session_content LONGTEXT DEFAULT NULL,

        generation_error TEXT DEFAULT NULL,
        -- First-class generation job state, kept separate from the product
        -- status column above so clients can distinguish "not started" from
        -- "generating" without inferring it from null content. See
        -- docs/prompt-sessions-design.md and README "Generation state".
        generation_status ENUM('idle','pending','running','succeeded','failed') DEFAULT 'idle',
        generation_started_at DATETIME DEFAULT NULL,
        generation_finished_at DATETIME DEFAULT NULL,
        seconds_to_generate DECIMAL(8,4) DEFAULT NULL,

        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

        INDEX idx_pairing_id (pairing_id),
        INDEX idx_created_by (created_by_user_id),
        INDEX idx_status (status),
        FOREIGN KEY (pairing_id) REFERENCES pairings (id) ON DELETE CASCADE,
        FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `;

    const createPrepsTable = `
      CREATE TABLE IF NOT EXISTS prompt_session_preps (
        id VARCHAR(50) PRIMARY KEY,
        prompt_session_id VARCHAR(50) NOT NULL,
        user_id VARCHAR(50) NOT NULL,

        bringing_text TEXT,
        energy_level TEXT,
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
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `;

    try {
      await this.query(createPromptSessionsTable);
      console.log('prompt_sessions table initialized successfully.');
      await this.query(createPrepsTable);
      console.log('prompt_session_preps table initialized successfully.');
      await this.ensurePairingIdNullable();
      await this.ensureGenerationStatusColumns();
    } catch (err) {
      console.error('Error creating prompt_sessions tables:', err.message);
      throw err;
    }
  }

  // Existing DBs created pairing_id as NOT NULL. Solo / single-device mode needs
  // nullable pairing_id so sessions can exist without a pairing.
  async ensurePairingIdNullable() {
    try {
      const colMeta = await this.queryOne(`
        SELECT IS_NULLABLE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'prompt_sessions'
          AND COLUMN_NAME = 'pairing_id'
      `);
      if (colMeta && colMeta.IS_NULLABLE === 'NO') {
        await this.query(`
          ALTER TABLE prompt_sessions
          MODIFY COLUMN pairing_id VARCHAR(50) DEFAULT NULL
        `);
        console.log('Migrated prompt_sessions: pairing_id is now nullable (solo mode).');
      }
    } catch (err) {
      console.warn('Migration warning (prompt_sessions.pairing_id nullable):', err.message);
    }
  }

  // Existing DBs created before generation-state tracking need these columns
  // added. Backfills a best-effort generation_status for pre-existing rows
  // based on whatever content/error state they already have, so old sessions
  // don't all show as "idle" once the column exists.
  async ensureGenerationStatusColumns() {
    try {
      const checkColumns = `
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'prompt_sessions'
          AND COLUMN_NAME IN ('generation_status', 'generation_started_at', 'generation_finished_at')
      `;
      const existingColumns = await this.query(checkColumns);
      const columnNames = existingColumns.map(col => col.COLUMN_NAME);
      let addedAnyColumn = false;

      if (!columnNames.includes('generation_status')) {
        await this.query(`
          ALTER TABLE prompt_sessions
          ADD COLUMN generation_status ENUM('idle','pending','running','succeeded','failed') DEFAULT 'idle'
          AFTER generation_error
        `);
        console.log('Added generation_status column to prompt_sessions table.');
        addedAnyColumn = true;
      }

      if (!columnNames.includes('generation_started_at')) {
        await this.query(`
          ALTER TABLE prompt_sessions
          ADD COLUMN generation_started_at DATETIME DEFAULT NULL
          AFTER generation_status
        `);
        console.log('Added generation_started_at column to prompt_sessions table.');
        addedAnyColumn = true;
      }

      if (!columnNames.includes('generation_finished_at')) {
        await this.query(`
          ALTER TABLE prompt_sessions
          ADD COLUMN generation_finished_at DATETIME DEFAULT NULL
          AFTER generation_started_at
        `);
        console.log('Added generation_finished_at column to prompt_sessions table.');
        addedAnyColumn = true;
      }

      if (addedAnyColumn) {
        // Backfill pre-existing rows so they reflect their already-known
        // outcome instead of the 'idle' column default.
        await this.query(`
          UPDATE prompt_sessions
          SET generation_status = 'succeeded', generation_finished_at = COALESCE(generation_finished_at, generation_prompt_used_at, updated_at)
          WHERE generation_status = 'idle' AND (bridge_content IS NOT NULL OR session_content IS NOT NULL)
        `);
        await this.query(`
          UPDATE prompt_sessions
          SET generation_status = 'failed', generation_finished_at = COALESCE(generation_finished_at, updated_at)
          WHERE generation_status = 'idle'
            AND generation_error IS NOT NULL
            AND bridge_content IS NULL
            AND session_content IS NULL
        `);
        console.log('Backfilled generation_status for existing prompt_sessions rows.');
      }
    } catch (err) {
      console.warn('Migration warning (prompt_sessions generation_status columns):', err.message);
    }
  }

  parseMaybeJson(value) {
    if (value === null || value === undefined) return null;
    try {
      return JSON.parse(value);
    } catch {
      return value; // Return as-is if not valid JSON
    }
  }

  // Shape a prompt_sessions row for client responses. Parses JSON content
  // fields and strips `generation_prompt` (which must never be exposed).
  //
  // Also attaches a non-persisted, computed `generation` object so clients
  // don't have to reinvent the idle/running/succeeded/failed rules from raw
  // columns. `generation.ready` is true only once generation_status is
  // 'succeeded' AND both bridge_content/session_content are present.
  serializeSession(row) {
    if (!row) return null;
    const { generation_prompt, ...rest } = row;
    const bridgeContent = this.parseMaybeJson(row.bridge_content);
    const sessionContent = this.parseMaybeJson(row.session_content);
    const generationStatus = row.generation_status || 'idle';
    return {
      ...rest,
      bridge_content: bridgeContent,
      session_content: sessionContent,
      generation: {
        status: generationStatus,
        error: row.generation_error || null,
        started_at: row.generation_started_at || null,
        finished_at: row.generation_finished_at || null,
        ready: generationStatus === 'succeeded' && !!bridgeContent && !!sessionContent
      }
    };
  }

  serializePrep(row) {
    if (!row) return null;
    return {
      id: row.id,
      prompt_session_id: row.prompt_session_id,
      user_id: row.user_id,
      bringing_text: row.bringing_text,
      energy_level: row.energy_level,
      intention: row.intention,
      curiosity: row.curiosity,
      boundary: row.boundary,
      gratitude: row.gratitude,
      optional_focus: row.optional_focus,
      completed: row.completed_at !== null && row.completed_at !== undefined,
      completed_at: row.completed_at,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  async createPromptSession({ pairingId = null, createdByUserId }) {
    const id = this.generateUniqueId();
    try {
      const insert = `
        INSERT INTO prompt_sessions (id, pairing_id, created_by_user_id, status, created_at, updated_at)
        VALUES (?, ?, ?, 'prep', NOW(), NOW())
      `;
      await this.query(insert, [id, pairingId || null, createdByUserId]);
      return this.getPromptSessionById(id);
    } catch (err) {
      console.error('Error creating prompt session:', err.message);
      throw new Error('Failed to create prompt session');
    }
  }

  async getPromptSessionById(id) {
    const row = await this.queryOne(`SELECT * FROM prompt_sessions WHERE id = ?`, [id]);
    if (!row) {
      throw new Error('Prompt session not found');
    }
    return this.serializeSession(row);
  }

  // Sessions visible to a user: solo sessions they created, plus any session
  // on a pairing they belong to (any status; soft-deleted pairings excluded).
  async getPromptSessionsForUser(userId) {
    const query = `
      SELECT DISTINCT ps.*
      FROM prompt_sessions ps
      LEFT JOIN pairings pair ON ps.pairing_id = pair.id AND pair.deleted_at IS NULL
      WHERE ps.created_by_user_id = ?
         OR (
           ps.pairing_id IS NOT NULL
           AND pair.id IS NOT NULL
           AND (pair.user1_id = ? OR pair.user2_id = ?)
         )
      ORDER BY ps.created_at DESC
    `;
    const rows = await this.query(query, [userId, userId, userId]);
    return rows.map(row => this.serializeSession(row));
  }

  async getPromptSessionsForPairing(pairingId) {
    const rows = await this.query(
      `SELECT * FROM prompt_sessions WHERE pairing_id = ? ORDER BY created_at DESC`,
      [pairingId]
    );
    return rows.map(row => this.serializeSession(row));
  }

  // The most recent non-terminal session for a pairing (for the
  // "one active session per pairing" policy), or null.
  async getActiveSessionForPairing(pairingId) {
    const row = await this.queryOne(
      `SELECT * FROM prompt_sessions
       WHERE pairing_id = ? AND status IN ('prep','bridge','in_session')
       ORDER BY created_at DESC
       LIMIT 1`,
      [pairingId]
    );
    return this.serializeSession(row);
  }

  // Most recent non-terminal solo session created by this user (no pairing).
  async getActiveSoloSessionForUser(userId) {
    const row = await this.queryOne(
      `SELECT * FROM prompt_sessions
       WHERE pairing_id IS NULL
         AND created_by_user_id = ?
         AND status IN ('prep','bridge','in_session')
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId]
    );
    return this.serializeSession(row);
  }

  // Creator always has access. If the session is paired, either pairing member
  // has access (pairing status need not be accepted; soft-deleted pairings do
  // not grant partner access, but the creator still can).
  async checkAccess(userId, promptSessionId) {
    const row = await this.queryOne(
      `SELECT COUNT(*) as count
       FROM prompt_sessions ps
       LEFT JOIN pairings pair
         ON ps.pairing_id = pair.id AND pair.deleted_at IS NULL
       WHERE ps.id = ?
         AND (
           ps.created_by_user_id = ?
           OR (
             ps.pairing_id IS NOT NULL
             AND pair.id IS NOT NULL
             AND (pair.user1_id = ? OR pair.user2_id = ?)
           )
         )`,
      [promptSessionId, userId, userId, userId]
    );
    return (row?.count || 0) > 0;
  }

  async getPrep(promptSessionId, userId) {
    const row = await this.queryOne(
      `SELECT * FROM prompt_session_preps WHERE prompt_session_id = ? AND user_id = ?`,
      [promptSessionId, userId]
    );
    return this.serializePrep(row);
  }

  async getPreps(promptSessionId) {
    const rows = await this.query(
      `SELECT * FROM prompt_session_preps WHERE prompt_session_id = ?`,
      [promptSessionId]
    );
    return rows.map(row => this.serializePrep(row));
  }

  // Insert or merge a user's prep answers. Only fields present in `answers`
  // overwrite existing values, so partial saves are supported. A prep is
  // considered complete once all six required fields are non-empty.
  async upsertPrep({ promptSessionId, userId, answers }) {
    const existing = await this.getPrep(promptSessionId, userId);

    const merged = {};
    for (const field of PromptSession.PREP_FIELDS) {
      if (answers && Object.prototype.hasOwnProperty.call(answers, field)) {
        merged[field] = answers[field];
      } else if (existing) {
        merged[field] = existing[field];
      } else {
        merged[field] = null;
      }
    }

    const isComplete = PromptSession.REQUIRED_PREP_FIELDS.every(field => {
      const v = merged[field];
      return v !== null && v !== undefined && String(v).trim() !== '';
    });

    // Preserve the original completion timestamp once set.
    const completedAt = isComplete
      ? (existing && existing.completed_at ? existing.completed_at : new Date())
      : null;

    const id = existing ? existing.id : this.generateUniqueId();

    const upsert = `
      INSERT INTO prompt_session_preps
        (id, prompt_session_id, user_id, bringing_text, energy_level, intention,
         curiosity, boundary, gratitude, optional_focus, completed_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        bringing_text = VALUES(bringing_text),
        energy_level = VALUES(energy_level),
        intention = VALUES(intention),
        curiosity = VALUES(curiosity),
        boundary = VALUES(boundary),
        gratitude = VALUES(gratitude),
        optional_focus = VALUES(optional_focus),
        completed_at = VALUES(completed_at),
        updated_at = NOW()
    `;

    await this.query(upsert, [
      id,
      promptSessionId,
      userId,
      merged.bringing_text,
      merged.energy_level,
      merged.intention,
      merged.curiosity,
      merged.boundary,
      merged.gratitude,
      merged.optional_focus,
      completedAt
    ]);

    return this.getPrep(promptSessionId, userId);
  }

  // True when prep requirements for this session are met:
  //   - Paired sessions: at least two completed preps
  //   - Solo sessions (no pairing_id): at least one completed prep
  async bothPrepsComplete(promptSessionId) {
    const session = await this.queryOne(
      `SELECT pairing_id FROM prompt_sessions WHERE id = ?`,
      [promptSessionId]
    );
    if (!session) return false;

    const required = session.pairing_id ? 2 : 1;
    const row = await this.queryOne(
      `SELECT COUNT(*) as count FROM prompt_session_preps
       WHERE prompt_session_id = ? AND completed_at IS NOT NULL`,
      [promptSessionId]
    );
    return (row?.count || 0) >= required;
  }

  async updateStatus(promptSessionId, status) {
    if (!PromptSession.ALL_STATUSES.includes(status)) {
      throw new Error(`Invalid status: ${status}`);
    }
    const result = await this.query(
      `UPDATE prompt_sessions SET status = ?, updated_at = NOW() WHERE id = ?`,
      [status, promptSessionId]
    );
    if (result.affectedRows === 0) {
      throw new Error('Prompt session not found');
    }
    return { message: 'Status updated successfully' };
  }

  async updatePhase(promptSessionId, currentPhase) {
    const result = await this.query(
      `UPDATE prompt_sessions SET current_phase = ?, updated_at = NOW() WHERE id = ?`,
      [currentPhase, promptSessionId]
    );
    if (result.affectedRows === 0) {
      throw new Error('Prompt session not found');
    }
    return { message: 'Phase updated successfully' };
  }

  // ---- Generation persistence ----

  // Compare-and-swap transition into 'running'. Only succeeds when the
  // session is not already running/succeeded and has no content yet, so two
  // concurrent callers (e.g. an explicit POST /generate racing the
  // auto-generate background trigger) cannot both start an LLM call for the
  // same session. Returns true if THIS call won the race.
  async beginGeneration(promptSessionId) {
    const result = await this.query(
      `UPDATE prompt_sessions
         SET generation_status = 'running',
             generation_started_at = NOW(),
             generation_finished_at = NULL,
             generation_error = NULL,
             updated_at = NOW()
       WHERE id = ?
         AND generation_status IN ('idle', 'pending', 'failed')
         AND bridge_content IS NULL
         AND session_content IS NULL`,
      [promptSessionId]
    );
    return result.affectedRows > 0;
  }

  // General-purpose generation_status transition helper (e.g. explicitly
  // marking 'pending' before a queued job starts). Callers doing the actual
  // idle/failed -> running transition that guards against double LLM spend
  // should use beginGeneration() instead, which is compare-and-swap.
  async updateGenerationStatus(promptSessionId, { status, startedAt, finishedAt, clearError = false } = {}) {
    if (!PromptSession.GENERATION_STATUSES.includes(status)) {
      throw new Error(`Invalid generation_status: ${status}`);
    }

    const sets = ['generation_status = ?', 'updated_at = NOW()'];
    const params = [status];

    if (startedAt !== undefined) {
      sets.push('generation_started_at = ?');
      params.push(startedAt);
    }
    if (finishedAt !== undefined) {
      sets.push('generation_finished_at = ?');
      params.push(finishedAt);
    }
    if (clearError) {
      sets.push('generation_error = NULL');
    }

    const result = await this.query(
      `UPDATE prompt_sessions SET ${sets.join(', ')} WHERE id = ?`,
      [...params, promptSessionId]
    );
    if (result.affectedRows === 0) {
      throw new Error('Prompt session not found');
    }
    return { message: 'Generation status updated successfully' };
  }

  // Persist generated Bridge + Session content along with the prompt that
  // produced it. `bridgeContent` / `sessionContent` may be objects (stored as
  // JSON) or strings. Marks generation_status 'succeeded' and stamps
  // generation_finished_at.
  async saveGeneratedContent(promptSessionId, {
    bridgeContent = null,
    sessionContent = null,
    generationPrompt = null,
    llmUsed = null,
    secondsToGenerate = null,
    status = 'bridge'
  }) {
    const toStorage = (v) => (v && typeof v === 'object' ? JSON.stringify(v) : v);
    const result = await this.query(
      `UPDATE prompt_sessions
         SET bridge_content = ?,
             session_content = ?,
             generation_prompt = ?,
             generation_prompt_used_at = NOW(),
             llm_used = ?,
             seconds_to_generate = ?,
             generation_error = NULL,
             generation_status = 'succeeded',
             generation_finished_at = NOW(),
             status = ?,
             updated_at = NOW()
       WHERE id = ?`,
      [toStorage(bridgeContent), toStorage(sessionContent), generationPrompt, llmUsed, secondsToGenerate, status, promptSessionId]
    );
    if (result.affectedRows === 0) {
      throw new Error('Prompt session not found');
    }
    return { message: 'Generated content saved successfully' };
  }

  // Record a generation failure. Only overwrites generation_prompt when a
  // non-null value is provided (mirrors the Program model behavior). Marks
  // generation_status 'failed' and stamps generation_finished_at so a
  // subsequent POST /generate can retry (idle/pending/failed -> running).
  async updateGenerationError(promptSessionId, errorMessage, generationPrompt = null) {
    const updateQuery = generationPrompt !== null
      ? `UPDATE prompt_sessions
           SET generation_error = ?, generation_prompt = ?,
               generation_status = 'failed', generation_finished_at = NOW(),
               updated_at = NOW()
         WHERE id = ?`
      : `UPDATE prompt_sessions
           SET generation_error = ?,
               generation_status = 'failed', generation_finished_at = NOW(),
               updated_at = NOW()
         WHERE id = ?`;
    const params = generationPrompt !== null
      ? [errorMessage, generationPrompt, promptSessionId]
      : [errorMessage, promptSessionId];

    const result = await this.query(updateQuery, params);
    if (result.affectedRows === 0) {
      throw new Error('Prompt session not found');
    }
    return { message: 'Generation error updated successfully' };
  }
}

module.exports = PromptSession;
