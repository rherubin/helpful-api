#!/usr/bin/env node

/**
 * Test Data Cleanup Script
 * Removes test data from MySQL database
 * Run with: node tests/cleanup-test-data.js
 */

require('dotenv').config();
const { getPool } = require('../config/database');

async function cleanupTestData() {
  let connection;
  
  try {
    const pool = getPool();
    connection = await pool.getConnection();
    console.log('✅ Connected to MySQL database\n');
    
    // Get counts before cleanup
    console.log('📊 Test Data Analysis:');
    console.log('=====================\n');
    
    const [testUsers] = await connection.query(`
      SELECT COUNT(*) as count FROM users 
      WHERE email LIKE 'test%@example.com'
         OR email LIKE 'john.doe.%@example.com'
         OR email LIKE 'jane.doe.%@example.com'
         OR email LIKE 'loadtest-%@example.com'
         OR email LIKE 'pairings.user%@example.com'
         OR email LIKE 'login-test-%@example.com'
         OR email LIKE 'programs-test-%@example.com'
         OR email LIKE 'steps-test-%@example.com'
         OR email LIKE 'messages-test-%@example.com'
         OR email LIKE 'therapy-trigger-%@example.com'
         OR email LIKE 'debug-test-%@example.com'
    `);
    
    const [testPairings] = await connection.query(`
      SELECT COUNT(*) as count FROM pairings 
      WHERE user1_id IN (
        SELECT id FROM users 
        WHERE email LIKE 'test%@example.com' 
           OR email LIKE 'john.doe.%@example.com'
           OR email LIKE 'jane.doe.%@example.com'
           OR email LIKE 'loadtest-%@example.com'
           OR email LIKE 'pairings.user%@example.com'
           OR email LIKE 'login-test-%@example.com'
      )
    `);
    
    const [testPrograms] = await connection.query(`
      SELECT COUNT(*) as count FROM programs 
      WHERE user_id IN (
        SELECT id FROM users 
        WHERE email LIKE 'test%@example.com' 
           OR email LIKE 'john.doe.%@example.com'
           OR email LIKE 'jane.doe.%@example.com'
           OR email LIKE 'loadtest-%@example.com'
           OR email LIKE 'pairings.user%@example.com'
           OR email LIKE 'login-test-%@example.com'
      )
    `);
    
    const [testTokens] = await connection.query(`
      SELECT COUNT(*) as count FROM refresh_tokens 
      WHERE user_id IN (
        SELECT id FROM users 
        WHERE email LIKE 'test%@example.com' 
           OR email LIKE 'john.doe.%@example.com'
           OR email LIKE 'jane.doe.%@example.com'
           OR email LIKE 'loadtest-%@example.com'
           OR email LIKE 'pairings.user%@example.com'
           OR email LIKE 'login-test-%@example.com'
      )
    `);
    
    console.log(`Test Users Found: ${testUsers[0].count}`);
    console.log(`Test Pairings Found: ${testPairings[0].count}`);
    console.log(`Test Programs Found: ${testPrograms[0].count}`);
    console.log(`Test Tokens Found: ${testTokens[0].count}\n`);
    
    if (testUsers[0].count === 0) {
      console.log('✨ No test data found! Database is clean.');
      return;
    }
    
    // Confirm cleanup
    console.log('⚠️  This will delete ALL test data from the database.');
    console.log('   Test users have emails matching patterns like:');
    console.log('   - test_*@example.com');
    console.log('   - john.doe.*@example.com');
    console.log('   - loadtest-*@example.com\n');
    
    // Start transaction
    await connection.beginTransaction();
    
    try {
      console.log('🗑️  Cleaning up test data...\n');
      
      // Step 1: Delete messages from test conversations
      console.log('1️⃣  Deleting test messages...');
      const [messages] = await connection.query(`
        DELETE m FROM messages m
        INNER JOIN program_steps ps ON m.step_id = ps.id
        INNER JOIN programs p ON ps.program_id = p.id
        WHERE p.user_id IN (
          SELECT id FROM users 
          WHERE email LIKE 'test%@example.com' 
             OR email LIKE 'john.doe.%@example.com'
             OR email LIKE 'jane.doe.%@example.com'
             OR email LIKE 'loadtest-%@example.com'
             OR email LIKE 'pairings.user%@example.com'
             OR email LIKE 'login-test-%@example.com'
        )
      `);
      console.log(`   ✅ Deleted ${messages.affectedRows || 0} test messages\n`);
      
      // Step 2: Delete program steps
      console.log('2️⃣  Deleting program steps...');
      const [steps] = await connection.query(`
        DELETE ps FROM program_steps ps
        INNER JOIN programs p ON ps.program_id = p.id
        WHERE p.user_id IN (
          SELECT id FROM users 
          WHERE email LIKE 'test%@example.com' 
             OR email LIKE 'john.doe.%@example.com'
             OR email LIKE 'jane.doe.%@example.com'
             OR email LIKE 'loadtest-%@example.com'
             OR email LIKE 'pairings.user%@example.com'
             OR email LIKE 'login-test-%@example.com'
        )
      `);
      console.log(`   ✅ Deleted ${steps.affectedRows || 0} program steps\n`);
      
      // Step 3: Delete programs
      console.log('3️⃣  Deleting test programs...');
      const [programs] = await connection.query(`
        DELETE FROM programs 
        WHERE user_id IN (
          SELECT id FROM users 
          WHERE email LIKE 'test%@example.com' 
             OR email LIKE 'john.doe.%@example.com'
             OR email LIKE 'jane.doe.%@example.com'
             OR email LIKE 'loadtest-%@example.com'
             OR email LIKE 'pairings.user%@example.com'
             OR email LIKE 'login-test-%@example.com'
        )
      `);
      console.log(`   ✅ Deleted ${programs.affectedRows} programs\n`);
      
      // Step 4: Delete pairings
      console.log('4️⃣  Deleting test pairings...');
      const [pairings] = await connection.query(`
        DELETE FROM pairings 
        WHERE user1_id IN (
          SELECT id FROM users 
          WHERE email LIKE 'test%@example.com' 
             OR email LIKE 'john.doe.%@example.com'
             OR email LIKE 'jane.doe.%@example.com'
             OR email LIKE 'loadtest-%@example.com'
             OR email LIKE 'pairings.user%@example.com'
             OR email LIKE 'login-test-%@example.com'
        )
        OR user2_id IN (
          SELECT id FROM users 
          WHERE email LIKE 'test%@example.com' 
             OR email LIKE 'john.doe.%@example.com'
             OR email LIKE 'jane.doe.%@example.com'
             OR email LIKE 'loadtest-%@example.com'
             OR email LIKE 'pairings.user%@example.com'
             OR email LIKE 'login-test-%@example.com'
        )
      `);
      console.log(`   ✅ Deleted ${pairings.affectedRows} pairings\n`);
      
      // Step 5: Delete refresh tokens
      console.log('5️⃣  Deleting test refresh tokens...');
      const [tokens] = await connection.query(`
        DELETE FROM refresh_tokens 
        WHERE user_id IN (
          SELECT id FROM users 
          WHERE email LIKE 'test%@example.com' 
             OR email LIKE 'john.doe.%@example.com'
             OR email LIKE 'jane.doe.%@example.com'
             OR email LIKE 'loadtest-%@example.com'
             OR email LIKE 'pairings.user%@example.com'
             OR email LIKE 'login-test-%@example.com'
        )
      `);
      console.log(`   ✅ Deleted ${tokens.affectedRows} tokens\n`);
      
      // Step 6: Delete test users (ONLY @example.com test accounts)
      console.log('6️⃣  Deleting test users...');
      const [users] = await connection.query(`
        DELETE FROM users 
        WHERE email LIKE 'test%@example.com' 
           OR email LIKE 'john.doe.%@example.com'
           OR email LIKE 'jane.doe.%@example.com'
           OR email LIKE 'loadtest-%@example.com'
           OR email LIKE 'pairings.user%@example.com'
           OR email LIKE 'login-test-%@example.com'
      `);
      console.log(`   ✅ Deleted ${users.affectedRows} users\n`);
      
      // Commit transaction
      await connection.commit();
      
      console.log('================================');
      console.log('✅ Cleanup Complete!');
      console.log('================================');
      console.log(`Total Removed:`);
      console.log(`  - Users: ${users.affectedRows}`);
      console.log(`  - Pairings: ${pairings.affectedRows}`);
      console.log(`  - Programs: ${programs.affectedRows}`);
      console.log(`  - Program Steps: ${steps.affectedRows || 0}`);
      console.log(`  - Messages: ${messages.affectedRows || 0}`);
      console.log(`  - Tokens: ${tokens.affectedRows}`);
      console.log('================================\n');
      console.log('✨ Database is now clean!');
      
    } catch (error) {
      await connection.rollback();
      throw error;
    }
    
  } catch (error) {
    console.error('❌ Error during cleanup:', error.message);
    console.error('\n💡 Make sure:');
    console.error('   - MySQL is running');
    console.error('   - Database credentials are correct in .env');
    process.exit(1);
  } finally {
    if (connection) {
      connection.release();
    }
  }
}

// Main execution
console.log('🧹 Test Data Cleanup Script');
console.log('===========================\n');

cleanupTestData()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });

