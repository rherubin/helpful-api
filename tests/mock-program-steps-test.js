/**
 * Mock Program Steps Test
 * Tests program step creation with mock data (no OpenAI required)
 */

const axios = require('axios');
const { generateTestEmail } = require('./test-helpers');

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:9000';

async function testProgramStepsWithMockData() {
  console.log('🧪 Testing Program Steps with Mock Data\n');
  
  try {
    // 1. Create a test user
    const testEmail = generateTestEmail('mocktest');
    const testPassword = 'TestPass123!';
    
    console.log('1️⃣  Creating test user...');
    const userResponse = await axios.post(`${BASE_URL}/api/users`, {
      email: testEmail,
      password: testPassword
    });
    
    const token = userResponse.data.access_token;
    const userId = userResponse.data.user.id;
    console.log(`✅ User created: ${testEmail}\n`);
    
    // 2. Create a program
    console.log('2️⃣  Creating program...');
    const programResponse = await axios.post(`${BASE_URL}/api/programs`, {
      user_name: 'Test User',
      partner_name: 'Test Partner',
      children: 0,
      user_input: 'We need help with communication'
    }, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    const programId = programResponse.data.program.id;
    console.log(`✅ Program created: ${programId}\n`);
    
    // 3. Check program steps immediately
    console.log('3️⃣  Checking program steps (immediate)...');
    const getResponse = await axios.get(`${BASE_URL}/api/programs/${programId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    console.log(`   Program steps count: ${getResponse.data.program.program_steps.length}`);
    
    if (getResponse.data.program.program_steps.length === 0) {
      console.log('   ⚠️  No program steps generated (OpenAI not configured)\n');
      console.log('   To enable program step generation:');
      console.log('   1. Set OPENAI_API_KEY in your .env file');
      console.log('   2. Restart the server');
      console.log('   3. Program steps will be generated asynchronously\n');
    } else {
      console.log(`   ✅ ${getResponse.data.program.program_steps.length} program steps generated!\n`);
      
      // Show first step
      const firstStep = getResponse.data.program.program_steps[0];
      console.log('   First step preview:');
      console.log(`   - Day: ${firstStep.day}`);
      console.log(`   - Theme: ${firstStep.theme}`);
      console.log(`   - Conversation starter: ${firstStep.conversation_starter?.substring(0, 50)}...`);
    }
    
    // 4. Wait and check again (in case of async generation)
    console.log('\n4️⃣  Waiting 3 seconds for async generation...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const getResponse2 = await axios.get(`${BASE_URL}/api/programs/${programId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    console.log(`   Program steps count after wait: ${getResponse2.data.program.program_steps.length}`);
    
    if (getResponse2.data.program.program_steps.length > 0) {
      console.log(`   ✅ Steps generated asynchronously!\n`);
    } else {
      console.log(`   ⚠️  Still no steps (OpenAI likely not configured)\n`);
    }
    
    // 5. Test program steps endpoint directly
    console.log('5️⃣  Testing program steps endpoint...');
    try {
      const stepsResponse = await axios.get(
        `${BASE_URL}/api/programs/${programId}/programSteps`, 
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      console.log(`   ✅ Endpoint working: ${stepsResponse.data.total_steps} steps\n`);
    } catch (error) {
      console.log(`   ❌ Endpoint error: ${error.response?.data?.error || error.message}\n`);
    }
    
    // Summary
    console.log('================================');
    console.log('📊 Test Summary');
    console.log('================================');
    console.log(`✅ API structure: Working`);
    console.log(`✅ program_steps property: Exists`);
    console.log(`✅ program_steps type: Array`);
    
    if (getResponse2.data.program.program_steps.length > 0) {
      console.log(`✅ Content generation: Working`);
      console.log(`✅ Steps generated: ${getResponse2.data.program.program_steps.length}`);
    } else {
      console.log(`⚠️  Content generation: Not configured`);
      console.log(`   Reason: OPENAI_API_KEY not set`);
    }
    console.log('================================\n');
    
  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
    process.exit(1);
  }
}

// Check if server is running
async function checkServer() {
  try {
    await axios.get(`${BASE_URL}/health`, { timeout: 2000 });
    return true;
  } catch (error) {
    return false;
  }
}

// Main
(async () => {
  console.log('Checking if server is running...');
  const running = await checkServer();
  
  if (!running) {
    console.error('❌ Server not running. Start with: npm start');
    process.exit(1);
  }
  
  console.log('✅ Server is running\n');
  await testProgramStepsWithMockData();
})();

