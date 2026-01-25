#!/usr/bin/env node

/**
 * MySQL Database Query Script
 * 
 * Queries the MySQL database and displays statistics
 * Run with: node query-mysql-database.js
 */

require('dotenv').config();
const { getPool } = require('./config/database');

async function queryDatabase() {
  let connection;
  
  try {
    const pool = getPool();
    connection = await pool.getConnection();
    console.log('✅ Connected to MySQL database\n');
    
    // Query 1: Get all active users
    console.log('📊 ACTIVE USERS:');
    console.log('================');
    const [users] = await connection.query(
      'SELECT id, email, user_name, partner_name, created_at FROM users WHERE deleted_at IS NULL ORDER BY created_at DESC'
    );
    users.forEach(user => {
      console.log(`- ${user.user_name || 'N/A'} (${user.email}) - Created: ${user.created_at}`);
    });
    console.log(`Total: ${users.length} users\n`);
    
    // Query 2: Get all pairings
    console.log('🤝 PAIRINGS:');
    console.log('============');
    const [pairings] = await connection.query(`
      SELECT p.*, 
             u1.email as user1_email, u1.user_name as user1_name,
             u2.email as user2_email, u2.user_name as user2_name
      FROM pairings p 
      JOIN users u1 ON p.user1_id = u1.id 
      LEFT JOIN users u2 ON p.user2_id = u2.id 
      WHERE p.deleted_at IS NULL 
      ORDER BY p.created_at DESC
    `);
    
    pairings.forEach(pairing => {
      const user2Info = pairing.user2_email ? `${pairing.user2_name || pairing.user2_email}` : 'Pending';
      console.log(`- ${pairing.status.toUpperCase()}: ${pairing.user1_name || pairing.user1_email} ↔ ${user2Info}`);
      if (pairing.partner_code) {
        console.log(`  Partner Code: ${pairing.partner_code}`);
      }
    });
    console.log(`Total: ${pairings.length} pairings\n`);
    
    // Query 3: Get all programs
    console.log('💬 THERAPY PROGRAMS:');
    console.log('====================');
    const [programs] = await connection.query(`
      SELECT p.id, p.user_input, p.created_at, u.email as creator_email, u.user_name,
             (SELECT COUNT(*) FROM program_steps ps WHERE ps.program_id = p.id) as step_count
      FROM programs p 
      JOIN users u ON p.user_id = u.id 
      WHERE p.deleted_at IS NULL 
      ORDER BY p.created_at DESC
      LIMIT 10
    `);
    
    programs.forEach(program => {
      console.log(`- Program by ${program.user_name || program.creator_email}`);
      console.log(`  Input: "${program.user_input.substring(0, 100)}${program.user_input.length > 100 ? '...' : ''}"`);
      console.log(`  Steps: ${program.step_count}`);
      console.log(`  Created: ${program.created_at}\n`);
    });
    console.log(`Total shown: ${programs.length} programs (showing latest 10)\n`);
    
    // Query 4: Get refresh tokens (active)
    console.log('🔑 ACTIVE REFRESH TOKENS:');
    console.log('=========================');
    const [tokens] = await connection.query(`
      SELECT rt.id, rt.user_id, rt.expires_at, rt.created_at, u.email 
      FROM refresh_tokens rt 
      JOIN users u ON rt.user_id = u.id 
      WHERE rt.expires_at > NOW() 
      ORDER BY rt.created_at DESC
      LIMIT 10
    `);
    
    tokens.forEach(token => {
      console.log(`- User: ${token.email}, Expires: ${token.expires_at}, Created: ${token.created_at}`);
    });
    console.log(`Total shown: ${tokens.length} active tokens (showing latest 10)\n`);
    
    // Query 5: Database statistics
    console.log('📈 DATABASE STATISTICS:');
    console.log('=======================');
    const [stats] = await connection.query(`
      SELECT 
        (SELECT COUNT(*) FROM users WHERE deleted_at IS NULL) as active_users,
        (SELECT COUNT(*) FROM users WHERE deleted_at IS NOT NULL) as deleted_users,
        (SELECT COUNT(*) FROM pairings WHERE status = 'accepted' AND deleted_at IS NULL) as accepted_pairings,
        (SELECT COUNT(*) FROM pairings WHERE status = 'pending' AND deleted_at IS NULL) as pending_pairings,
        (SELECT COUNT(*) FROM programs WHERE deleted_at IS NULL) as active_programs,
        (SELECT COUNT(*) FROM program_steps) as total_program_steps,
        (SELECT COUNT(*) FROM messages) as total_messages,
        (SELECT COUNT(*) FROM refresh_tokens WHERE expires_at > NOW()) as active_tokens
    `);
    
    const stat = stats[0];
    console.log(`Active Users: ${stat.active_users}`);
    console.log(`Deleted Users: ${stat.deleted_users}`);
    console.log(`Accepted Pairings: ${stat.accepted_pairings}`);
    console.log(`Pending Pairings: ${stat.pending_pairings}`);
    console.log(`Active Programs: ${stat.active_programs}`);
    console.log(`Program Steps: ${stat.total_program_steps}`);
    console.log(`Messages: ${stat.total_messages}`);
    console.log(`Active Refresh Tokens: ${stat.active_tokens}`);
    
    // Query 6: Recent activity
    console.log('\n📅 RECENT ACTIVITY (Last 7 Days):');
    console.log('==================================');
    const [activity] = await connection.query(`
      SELECT 
        (SELECT COUNT(*) FROM users WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)) as new_users,
        (SELECT COUNT(*) FROM pairings WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)) as new_pairings,
        (SELECT COUNT(*) FROM programs WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)) as new_programs,
        (SELECT COUNT(*) FROM messages WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)) as new_messages
    `);
    
    const act = activity[0];
    console.log(`New Users: ${act.new_users}`);
    console.log(`New Pairings: ${act.new_pairings}`);
    console.log(`New Programs: ${act.new_programs}`);
    console.log(`New Messages: ${act.new_messages}`);
    
  } catch (error) {
    console.error('❌ Error querying database:', error.message);
    console.error('💡 Make sure:');
    console.error('   - MySQL is running (locally or Railway)');
    console.error('   - MYSQL_* environment variables are set in .env');
    console.error('   - Or MYSQL_URL is set for Railway');
  } finally {
    if (connection) {
      connection.release();
      console.log('\n✅ Database connection closed');
    }
  }
}

// Run the queries
queryDatabase()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });

