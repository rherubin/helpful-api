const axios = require('axios');

// Simple test for first message system message functionality
async function testFirstMessage() {
  const baseURL = 'http://127.0.0.1:9000';

  try {
    console.log('Testing first message system message functionality...');

    // First, try to get a health check
    const healthResponse = await axios.get(`${baseURL}/health`);
    console.log('✅ Server is running');

    // Test login to get auth token (you may need to adjust credentials)
    console.log('Attempting to login...');
    const loginResponse = await axios.post(`${baseURL}/api/login`, {
      email: 'test@example.com',
      password: 'testpassword'
    });

    if (loginResponse.data && loginResponse.data.access_token) {
      console.log('✅ Login successful');
      const token = loginResponse.data.access_token;

      // Try to get programs (this might fail if test data doesn't exist)
      const programsResponse = await axios.get(`${baseURL}/api/programs`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      console.log('Programs response:', programsResponse.data);
    } else {
      console.log('❌ Login failed or no token received');
    }

  } catch (error) {
    console.error('Test failed:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  }
}

testFirstMessage();
