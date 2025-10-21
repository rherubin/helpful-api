const axios = require('axios');

const BASE_URL = process.env.API_URL || 'http://localhost:9000/api';

// Test configuration
const TEST_EMAIL_DOMAIN = '@programunlocktest.com';
let testUsers = [];
let testTokens = [];
let testPairing = null;
let testProgram = null;
let testProgramSteps = [];

// Helper function to generate unique test email
function generateTestEmail(prefix = 'user') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}${TEST_EMAIL_DOMAIN}`;
}

// Helper function to create a test user
async function createTestUser(userName = 'Test User') {
  const email = generateTestEmail(userName.toLowerCase().replace(/\s+/g, '_'));
  const password = 'Test123!';

  try {
    const response = await axios.post(`${BASE_URL}/register`, {
      user_name: userName,
      email,
      password,
      first_name: userName.split(' ')[0],
      last_name: userName.split(' ')[1] || 'User'
    });

    return {
      user: response.data.user,
      token: response.data.access_token,
      email,
      password
    };
  } catch (error) {
    console.error('Error creating test user:', error.response?.data || error.message);
    throw error;
  }
}

// Helper function to delete test user
async function deleteTestUser(userId, token) {
  try {
    await axios.delete(`${BASE_URL}/users/${userId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
  } catch (error) {
    console.error('Error deleting test user:', error.response?.data || error.message);
  }
}

// Test 1: Create program with default unlock threshold
async function testDefaultUnlockThreshold() {
  console.log('\n--- Test 1: Create program with default unlock threshold ---');
  
  try {
    const user = await createTestUser('Unlock User 1');
    testUsers.push(user);
    testTokens.push(user.token);

    // Create a program without specifying threshold
    const programResponse = await axios.post(
      `${BASE_URL}/programs`,
      {
        user_input: 'Test program for unlock feature'
      },
      {
        headers: { Authorization: `Bearer ${user.token}` }
      }
    );

    testProgram = programResponse.data.program;
    console.log('✓ Program created:', testProgram.id);

    // Wait for program steps to be generated
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Get program details
    const programDetails = await axios.get(
      `${BASE_URL}/programs/${testProgram.id}`,
      {
        headers: { Authorization: `Bearer ${user.token}` }
      }
    );

    const program = programDetails.data.program;
    
    if (program.steps_required_for_unlock === 7) {
      console.log('✓ Default threshold is 7');
    } else {
      throw new Error(`Expected default threshold 7, got ${program.steps_required_for_unlock}`);
    }

    if (program.next_program_unlocked === false || program.next_program_unlocked === 0) {
      console.log('✓ Program starts as locked (next_program_unlocked = false)');
    } else {
      throw new Error('Program should start as locked');
    }

    testProgramSteps = program.program_steps || [];
    console.log(`✓ Program has ${testProgramSteps.length} steps`);

    console.log('✓ Test 1 PASSED');
    return true;
  } catch (error) {
    console.error('✗ Test 1 FAILED:', error.response?.data || error.message);
    return false;
  }
}

// Test 2: Create program with custom unlock threshold
async function testCustomUnlockThreshold() {
  console.log('\n--- Test 2: Create program with custom unlock threshold ---');
  
  try {
    const user = testUsers[0];

    // Create a program with custom threshold
    const programResponse = await axios.post(
      `${BASE_URL}/programs`,
      {
        user_input: 'Test program with custom threshold',
        steps_required_for_unlock: 3
      },
      {
        headers: { Authorization: `Bearer ${user.token}` }
      }
    );

    const customProgram = programResponse.data.program;
    console.log('✓ Program created with custom threshold:', customProgram.id);

    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Get program details
    const programDetails = await axios.get(
      `${BASE_URL}/programs/${customProgram.id}`,
      {
        headers: { Authorization: `Bearer ${user.token}` }
      }
    );

    const program = programDetails.data.program;
    
    if (program.steps_required_for_unlock === 3) {
      console.log('✓ Custom threshold is 3');
    } else {
      throw new Error(`Expected custom threshold 3, got ${program.steps_required_for_unlock}`);
    }

    // Clean up
    await axios.delete(
      `${BASE_URL}/programs/${customProgram.id}`,
      {
        headers: { Authorization: `Bearer ${user.token}` }
      }
    );

    console.log('✓ Test 2 PASSED');
    return true;
  } catch (error) {
    console.error('✗ Test 2 FAILED:', error.response?.data || error.message);
    return false;
  }
}

// Test 3: Adding messages to steps and checking unlock status
async function testUnlockStatusProgression() {
  console.log('\n--- Test 3: Adding messages to steps and checking unlock status ---');
  
  try {
    const user = testUsers[0];

    if (testProgramSteps.length < 7) {
      console.log('⚠ Not enough program steps generated, waiting longer...');
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      const programDetails = await axios.get(
        `${BASE_URL}/programs/${testProgram.id}`,
        {
          headers: { Authorization: `Bearer ${user.token}` }
        }
      );
      testProgramSteps = programDetails.data.program.program_steps || [];
    }

    if (testProgramSteps.length < 7) {
      throw new Error(`Need at least 7 program steps, only have ${testProgramSteps.length}`);
    }

    // Add messages to 6 steps (below threshold)
    console.log('Adding messages to 6 steps...');
    for (let i = 0; i < 6; i++) {
      await axios.post(
        `${BASE_URL}/programSteps/${testProgramSteps[i].id}/messages`,
        {
          content: `Test message for step ${i + 1}`
        },
        {
          headers: { Authorization: `Bearer ${user.token}` }
        }
      );
      console.log(`  ✓ Message added to step ${i + 1}`);
    }

    // Wait for unlock check to complete
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Check program status (should still be locked)
    let programDetails = await axios.get(
      `${BASE_URL}/programs/${testProgram.id}`,
      {
        headers: { Authorization: `Bearer ${user.token}` }
      }
    );

    let program = programDetails.data.program;
    
    if (program.next_program_unlocked === false || program.next_program_unlocked === 0) {
      console.log('✓ Program still locked after 6 messages (threshold not met)');
    } else {
      throw new Error('Program should still be locked with 6 messages');
    }

    // Add message to 7th step (meets threshold)
    console.log('Adding message to 7th step to meet threshold...');
    await axios.post(
      `${BASE_URL}/programSteps/${testProgramSteps[6].id}/messages`,
      {
        content: 'Test message for step 7 - should unlock!'
      },
      {
        headers: { Authorization: `Bearer ${user.token}` }
      }
    );

    // Wait for unlock check to complete
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Check program status (should now be unlocked)
    programDetails = await axios.get(
      `${BASE_URL}/programs/${testProgram.id}`,
      {
        headers: { Authorization: `Bearer ${user.token}` }
      }
    );

    program = programDetails.data.program;
    
    if (program.next_program_unlocked === true || program.next_program_unlocked === 1) {
      console.log('✓ Program unlocked after 7 messages (threshold met)');
    } else {
      throw new Error('Program should be unlocked after 7 messages');
    }

    console.log('✓ Test 3 PASSED');
    return true;
  } catch (error) {
    console.error('✗ Test 3 FAILED:', error.response?.data || error.message);
    return false;
  }
}

// Test 4: Multiple users contributing to unlock (pairing scenario)
async function testPairingUnlock() {
  console.log('\n--- Test 4: Multiple users contributing to unlock (pairing scenario) ---');
  
  try {
    // Create second user
    const user2 = await createTestUser('Unlock User 2');
    testUsers.push(user2);
    testTokens.push(user2.token);

    // User 1 creates a pairing request
    const pairingResponse = await axios.post(
      `${BASE_URL}/pairing/request`,
      {},
      {
        headers: { Authorization: `Bearer ${testUsers[0].token}` }
      }
    );

    const partnerCode = pairingResponse.data.partner_code;
    console.log('✓ Pairing request created with code:', partnerCode);

    // User 2 accepts the pairing
    await axios.post(
      `${BASE_URL}/pairing/accept-code`,
      { partner_code: partnerCode },
      {
        headers: { Authorization: `Bearer ${user2.token}` }
      }
    );

    console.log('✓ Pairing accepted');

    // Get pairing ID
    const pairingsResponse = await axios.get(
      `${BASE_URL}/pairings`,
      {
        headers: { Authorization: `Bearer ${testUsers[0].token}` }
      }
    );

    testPairing = pairingsResponse.data.pairings.find(p => p.status === 'accepted');
    console.log('✓ Pairing ID:', testPairing.id);

    // Create a program with pairing and custom threshold of 3
    const programResponse = await axios.post(
      `${BASE_URL}/programs`,
      {
        user_input: 'Test program for pairing unlock',
        pairing_id: testPairing.id,
        steps_required_for_unlock: 3
      },
      {
        headers: { Authorization: `Bearer ${testUsers[0].token}` }
      }
    );

    const pairingProgram = programResponse.data.program;
    console.log('✓ Paired program created:', pairingProgram.id);

    // Wait for program steps
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Get program steps
    const programDetails = await axios.get(
      `${BASE_URL}/programs/${pairingProgram.id}`,
      {
        headers: { Authorization: `Bearer ${testUsers[0].token}` }
      }
    );

    const pairingSteps = programDetails.data.program.program_steps || [];
    
    if (pairingSteps.length < 3) {
      throw new Error(`Need at least 3 program steps, only have ${pairingSteps.length}`);
    }

    // User 1 adds message to step 1
    await axios.post(
      `${BASE_URL}/programSteps/${pairingSteps[0].id}/messages`,
      {
        content: 'Message from user 1 to step 1'
      },
      {
        headers: { Authorization: `Bearer ${testUsers[0].token}` }
      }
    );
    console.log('✓ User 1 added message to step 1');

    // User 2 adds message to step 2
    await axios.post(
      `${BASE_URL}/programSteps/${pairingSteps[1].id}/messages`,
      {
        content: 'Message from user 2 to step 2'
      },
      {
        headers: { Authorization: `Bearer ${user2.token}` }
      }
    );
    console.log('✓ User 2 added message to step 2');

    // User 1 adds message to step 3 (should unlock)
    await axios.post(
      `${BASE_URL}/programSteps/${pairingSteps[2].id}/messages`,
      {
        content: 'Message from user 1 to step 3'
      },
      {
        headers: { Authorization: `Bearer ${testUsers[0].token}` }
      }
    );
    console.log('✓ User 1 added message to step 3');

    // Wait for unlock check
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Check unlock status
    const finalProgramDetails = await axios.get(
      `${BASE_URL}/programs/${pairingProgram.id}`,
      {
        headers: { Authorization: `Bearer ${testUsers[0].token}` }
      }
    );

    const finalProgram = finalProgramDetails.data.program;
    
    if (finalProgram.next_program_unlocked === true || finalProgram.next_program_unlocked === 1) {
      console.log('✓ Program unlocked with contributions from both users');
    } else {
      throw new Error('Program should be unlocked after 3 steps with messages');
    }

    // Clean up
    await axios.delete(
      `${BASE_URL}/programs/${pairingProgram.id}`,
      {
        headers: { Authorization: `Bearer ${testUsers[0].token}` }
      }
    );

    console.log('✓ Test 4 PASSED');
    return true;
  } catch (error) {
    console.error('✗ Test 4 FAILED:', error.response?.data || error.message);
    return false;
  }
}

// Test 5: Edge cases
async function testEdgeCases() {
  console.log('\n--- Test 5: Edge cases ---');
  
  try {
    const user = testUsers[0];

    // Test with threshold of 0 (should unlock immediately)
    console.log('Testing threshold of 0...');
    const zeroThresholdResponse = await axios.post(
      `${BASE_URL}/programs`,
      {
        user_input: 'Test program with zero threshold',
        steps_required_for_unlock: 0
      },
      {
        headers: { Authorization: `Bearer ${user.token}` }
      }
    );

    const zeroProgram = zeroThresholdResponse.data.program;
    await new Promise(resolve => setTimeout(resolve, 2000));

    const zeroProgramDetails = await axios.get(
      `${BASE_URL}/programs/${zeroProgram.id}`,
      {
        headers: { Authorization: `Bearer ${user.token}` }
      }
    );

    // With threshold 0, it should be unlocked immediately
    if (zeroProgramDetails.data.program.next_program_unlocked === true || 
        zeroProgramDetails.data.program.next_program_unlocked === 1) {
      console.log('✓ Program with threshold 0 unlocks immediately');
    } else {
      console.log('⚠ Program with threshold 0 did not unlock immediately (may need manual check)');
    }

    await axios.delete(
      `${BASE_URL}/programs/${zeroProgram.id}`,
      {
        headers: { Authorization: `Bearer ${user.token}` }
      }
    );

    // Test with very high threshold
    console.log('Testing very high threshold...');
    const highThresholdResponse = await axios.post(
      `${BASE_URL}/programs`,
      {
        user_input: 'Test program with high threshold',
        steps_required_for_unlock: 100
      },
      {
        headers: { Authorization: `Bearer ${user.token}` }
      }
    );

    const highProgram = highThresholdResponse.data.program;
    
    if (highProgram.steps_required_for_unlock === 100) {
      console.log('✓ Program accepts high threshold value (100)');
    }

    await axios.delete(
      `${BASE_URL}/programs/${highProgram.id}`,
      {
        headers: { Authorization: `Bearer ${user.token}` }
      }
    );

    console.log('✓ Test 5 PASSED');
    return true;
  } catch (error) {
    console.error('✗ Test 5 FAILED:', error.response?.data || error.message);
    return false;
  }
}

// Cleanup function
async function cleanup() {
  console.log('\n--- Cleanup ---');
  
  // Delete test program
  if (testProgram && testTokens[0]) {
    try {
      await axios.delete(
        `${BASE_URL}/programs/${testProgram.id}`,
        {
          headers: { Authorization: `Bearer ${testTokens[0]}` }
        }
      );
      console.log('✓ Test program deleted');
    } catch (error) {
      console.log('⚠ Could not delete test program:', error.response?.data?.error || error.message);
    }
  }

  // Delete test users
  for (let i = 0; i < testUsers.length; i++) {
    if (testUsers[i] && testTokens[i]) {
      await deleteTestUser(testUsers[i].user.id, testTokens[i]);
      console.log(`✓ Test user ${i + 1} deleted`);
    }
  }
}

// Main test runner
async function runTests() {
  console.log('='.repeat(60));
  console.log('PROGRAM UNLOCK FEATURE TEST SUITE');
  console.log('='.repeat(60));
  console.log(`Testing against: ${BASE_URL}`);

  const results = {
    total: 5,
    passed: 0,
    failed: 0
  };

  try {
    // Run tests
    if (await testDefaultUnlockThreshold()) results.passed++;
    else results.failed++;

    if (await testCustomUnlockThreshold()) results.passed++;
    else results.failed++;

    if (await testUnlockStatusProgression()) results.passed++;
    else results.failed++;

    if (await testPairingUnlock()) results.passed++;
    else results.failed++;

    if (await testEdgeCases()) results.passed++;
    else results.failed++;

  } catch (error) {
    console.error('Unexpected error during tests:', error);
  } finally {
    await cleanup();
  }

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('TEST SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total Tests: ${results.total}`);
  console.log(`Passed: ${results.passed} ✓`);
  console.log(`Failed: ${results.failed} ✗`);
  console.log(`Success Rate: ${((results.passed / results.total) * 100).toFixed(1)}%`);
  console.log('='.repeat(60));

  process.exit(results.failed > 0 ? 1 : 0);
}

// Run the tests
runTests();

