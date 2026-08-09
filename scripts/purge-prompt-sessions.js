#!/usr/bin/env node

/**
 * Purge all Sit Sessions (prompt_sessions + cascade preps).
 *
 * Use while the feature is still in development to drop legacy / invalid
 * generation payloads. Deletes EVERY row in prompt_sessions; preps go with
 * ON DELETE CASCADE.
 *
 * Safety:
 *   - Dry-run by default (prints counts + target DB only)
 *   - Pass --confirm to actually delete
 *
 * Usage:
 *   node scripts/purge-prompt-sessions.js              # dry-run
 *   node scripts/purge-prompt-sessions.js --confirm    # delete all
 *
 * Point at another env with MYSQL_URL or MYSQL_* env vars, e.g.:
 *   MYSQL_URL='mysql://…' node scripts/purge-prompt-sessions.js --confirm
 */

require('dotenv').config();
const { getPool } = require('../config/database');

function targetLabel() {
  if (process.env.MYSQL_URL) {
    try {
      const url = new URL(process.env.MYSQL_URL);
      return `${url.hostname}:${url.port || 3306}/${url.pathname.replace(/^\//, '')} (MYSQL_URL)`;
    } catch {
      return '(MYSQL_URL present but unparseable)';
    }
  }
  const host = process.env.MYSQL_HOST || 'localhost';
  const port = process.env.MYSQL_PORT || 3306;
  const db = process.env.MYSQL_DATABASE || 'helpful_db';
  return `${host}:${port}/${db}`;
}

async function main() {
  const confirm = process.argv.includes('--confirm');
  const pool = getPool();
  let connection;

  try {
    connection = await pool.getConnection();
    console.log(`Target DB: ${targetLabel()}`);
    console.log(`Mode: ${confirm ? 'CONFIRM (will delete)' : 'dry-run (no deletes)'}\n`);

    const [[sessionCounts]] = await connection.query(`
      SELECT
        COUNT(*) AS total,
        SUM(bridge_content IS NOT NULL OR session_content IS NOT NULL) AS with_generated_content,
        SUM(status IN ('prep','bridge','in_session')) AS active,
        SUM(status IN ('complete','abandoned')) AS terminal
      FROM prompt_sessions
    `);

    const [[prepCounts]] = await connection.query(`
      SELECT COUNT(*) AS total FROM prompt_session_preps
    `);

    console.log('Current rows:');
    console.log(`  prompt_sessions:       ${sessionCounts.total}`);
    console.log(`    with generated content: ${sessionCounts.with_generated_content || 0}`);
    console.log(`    active (prep/bridge/in_session): ${sessionCounts.active || 0}`);
    console.log(`    terminal (complete/abandoned):   ${sessionCounts.terminal || 0}`);
    console.log(`  prompt_session_preps:  ${prepCounts.total}`);

    if (!confirm) {
      console.log('\nDry-run only. Re-run with --confirm to delete all prompt_sessions (preps cascade).');
      return;
    }

    if (Number(sessionCounts.total) === 0 && Number(prepCounts.total) === 0) {
      console.log('\nNothing to delete.');
      return;
    }

    // Delete sessions first; preps cascade via FK. Also clear any orphan preps.
    await connection.beginTransaction();
    try {
      const [sessionResult] = await connection.query('DELETE FROM prompt_sessions');
      const [prepResult] = await connection.query('DELETE FROM prompt_session_preps');
      await connection.commit();

      console.log('\nDeleted:');
      console.log(`  prompt_sessions:      ${sessionResult.affectedRows}`);
      console.log(`  prompt_session_preps: ${prepResult.affectedRows} (cascade + any orphans)`);
      console.log('Done.');
    } catch (err) {
      await connection.rollback();
      throw err;
    }
  } finally {
    if (connection) connection.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Purge failed:', err.message);
  process.exit(1);
});
