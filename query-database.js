#!/usr/bin/env node

// Database query script for helpful API
const Database = require('better-sqlite3');
const User = require('./models/User');
const Pairing = require('./models/Pairing');
const Program = require('./models/Program');
const RefreshToken = require('./models/RefreshToken');

// Database setup
const DATABASE_PATH = process.env.DATABASE_PATH || './helpful-db.sqlite';

async function queryDatabase() {
  let db;
  
  try {
    // Connect to database
    db = new Database(DATABASE_PATH);
    console.log('✅ Connected to SQLite database\n');
    
    // Initialize models
    const userModel = new User(db);
    const pairingModel = new Pairing(db);
    const programModel = new Program(db);
    const refreshTokenModel = new RefreshToken(db);
    
    // Query 1: Get all active users
    console.log('📊 ACTIVE USERS:');
    console.log('================');
    const users = await userModel.allAsync('SELECT id, email, first_name, last_name, created_at FROM users WHERE deleted_at IS NULL ORDER BY created_at DESC');
    users.forEach(user => {
      console.log(`- ${user.first_name} ${user.last_name} (${user.email}) - Created: ${user.created_at}`);
    });
    console.log(`Total: ${users.length} users\n`);
    
    // Query 2: Get all pairings
    console.log('🤝 PAIRINGS:');
    console.log('============');
    const pairings = await pairingModel.allAsync(`
      SELECT p.*, 
             u1.email as user1_email, u1.first_name as user1_first_name,
             u2.email as user2_email, u2.first_name as user2_first_name
      FROM pairings p 
      JOIN users u1 ON p.user1_id = u1.id 
      LEFT JOIN users u2 ON p.user2_id = u2.id 
      WHERE p.deleted_at IS NULL 
      ORDER BY p.created_at DESC
    `);
    
    pairings.forEach(pairing => {
      const user2Info = pairing.user2_email ? `${pairing.user2_first_name} (${pairing.user2_email})` : 'Pending';
      console.log(`- ${pairing.status.toUpperCase()}: ${pairing.user1_first_name} (${pairing.user1_email}) ↔ ${user2Info}`);
      if (pairing.partner_code) {
        console.log(`  Partner Code: ${pairing.partner_code}`);
      }
    });
    console.log(`Total: ${pairings.length} pairings\n`);
    
    // Query 3: Get all programs
    console.log('💬 THERAPY PROGRAMS:');
    console.log('====================');
    const programs = await programModel.allAsync(`
      SELECT p.id, p.user_name, p.partner_name, p.children, p.user_input, 
             p.therapy_response, p.created_at, u.email as creator_email
      FROM programs p 
      JOIN users u ON p.user_id = u.id 
      WHERE p.deleted_at IS NULL 
      ORDER BY p.created_at DESC
    `);
    
    programs.forEach(program => {
      console.log(`- Program by ${program.user_name} & ${program.partner_name} (${program.children} children)`);
      console.log(`  Creator: ${program.creator_email}`);
      console.log(`  Input: "${program.user_input.substring(0, 100)}${program.user_input.length > 100 ? '...' : ''}"`);
      console.log(`  Has AI Response: ${program.therapy_response ? 'Yes' : 'No'}`);
      console.log(`  Created: ${program.created_at}\n`);
    });
    console.log(`Total: ${programs.length} programs\n`);
    
    // Query 4: Get refresh tokens (active)
    console.log('🔑 ACTIVE REFRESH TOKENS:');
    console.log('=========================');
    const tokens = await refreshTokenModel.allAsync(`
      SELECT rt.id, rt.user_id, rt.expires_at, rt.created_at, u.email 
      FROM refresh_tokens rt 
      JOIN users u ON rt.user_id = u.id 
      WHERE rt.expires_at > datetime('now') 
      ORDER BY rt.created_at DESC
    `);
    
    tokens.forEach(token => {
      console.log(`- User: ${token.email}, Expires: ${token.expires_at}, Created: ${token.created_at}`);
    });
    console.log(`Total: ${tokens.length} active tokens\n`);
    
    // Query 5: Database statistics
    console.log('📈 DATABASE STATISTICS:');
    console.log('=======================');
    const stats = await userModel.getAsync(`
      SELECT 
        (SELECT COUNT(*) FROM users WHERE deleted_at IS NULL) as active_users,
        (SELECT COUNT(*) FROM users WHERE deleted_at IS NOT NULL) as deleted_users,
        (SELECT COUNT(*) FROM pairings WHERE status = 'accepted' AND deleted_at IS NULL) as accepted_pairings,
        (SELECT COUNT(*) FROM pairings WHERE status = 'pending' AND deleted_at IS NULL) as pending_pairings,
        (SELECT COUNT(*) FROM programs WHERE deleted_at IS NULL) as active_programs,
        (SELECT COUNT(*) FROM refresh_tokens WHERE expires_at > datetime('now')) as active_tokens
    `);
    
    console.log(`Active Users: ${stats.active_users}`);
    console.log(`Deleted Users: ${stats.deleted_users}`);
    console.log(`Accepted Pairings: ${stats.accepted_pairings}`);
    console.log(`Pending Pairings: ${stats.pending_pairings}`);
    console.log(`Active Programs: ${stats.active_programs}`);
    console.log(`Active Refresh Tokens: ${stats.active_tokens}`);
    
  } catch (error) {
    console.error('❌ Error querying database:', error.message);
  } finally {
    if (db) {
      db.close();
      console.log('\n✅ Database connection closed');
    }
  }
}

// Run the queries
queryDatabase();

