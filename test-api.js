const axios = require('axios');

const BASE_URL = 'http://localhost:3000';

async function testAPI() {
  try {
    console.log('🧪 Testing User API...\n');

    // Test health endpoint
    console.log('1. Testing health endpoint...');
    const healthResponse = await axios.get(`${BASE_URL}/health`);
    console.log('✅ Health check passed:', healthResponse.data);

    // Test creating a user
    console.log('\n2. Testing user creation...');
    const userData = {
      email: 'john.doe@example.com',
      first_name: 'John',
      last_name: 'Doe',
      password: 'Test1!@#'
    };
    
    const createResponse = await axios.post(`${BASE_URL}/api/users`, userData);
    console.log('✅ User created successfully:', createResponse.data);
    
    const userId = createResponse.data.id;

    // Test getting all users
    console.log('\n3. Testing get all users...');
    const allUsersResponse = await axios.get(`${BASE_URL}/api/users`);
    console.log('✅ Retrieved all users:', allUsersResponse.data);

    // Test getting specific user
    console.log('\n4. Testing get user by ID...');
    const userResponse = await axios.get(`${BASE_URL}/api/users/${userId}`);
    console.log('✅ Retrieved user by ID:', userResponse.data);

    // Test duplicate email error
    console.log('\n5. Testing duplicate email validation...');
    try {
      await axios.post(`${BASE_URL}/api/users`, userData);
    } catch (error) {
      if (error.response && error.response.status === 409) {
        console.log('✅ Duplicate email validation working:', error.response.data);
      } else {
        throw error;
      }
    }

    // Test invalid email
    console.log('\n6. Testing invalid email validation...');
    try {
      await axios.post(`${BASE_URL}/api/users`, {
        email: 'invalid-email',
        first_name: 'Test',
        last_name: 'User',
        password: 'Test1!@#'
      });
    } catch (error) {
      if (error.response && error.response.status === 400) {
        console.log('✅ Invalid email validation working:', error.response.data);
      } else {
        throw error;
      }
    }

    // Test login with correct credentials
    console.log('\n7. Testing login with correct credentials...');
    const loginResponse = await axios.post(`${BASE_URL}/api/login`, {
      email: 'john.doe@example.com',
      password: 'Test1!@#'
    });
    console.log('✅ Login successful:', loginResponse.data);
    
    // Store tokens for authenticated requests
    const accessToken = loginResponse.data.access_token;
    const refreshToken = loginResponse.data.refresh_token;

    // Test login with incorrect password
    console.log('\n8. Testing login with incorrect password...');
    try {
      await axios.post(`${BASE_URL}/api/login`, {
        email: 'john.doe@example.com',
        password: 'Wrong1!@#'
      });
    } catch (error) {
      if (error.response && error.response.status === 401) {
        console.log('✅ Invalid password validation working:', error.response.data);
      } else {
        throw error;
      }
    }

    // Test login with non-existent email
    console.log('\n9. Testing login with non-existent email...');
    try {
      await axios.post(`${BASE_URL}/api/login`, {
        email: 'nonexistent@example.com',
        password: 'Test1!@#'
      });
    } catch (error) {
      if (error.response && error.response.status === 401) {
        console.log('✅ Non-existent email validation working:', error.response.data);
      } else {
        throw error;
      }
    }

    // Test password validation
    console.log('\n10. Testing password validation...');
    try {
      await axios.post(`${BASE_URL}/api/users`, {
        email: 'test@example.com',
        first_name: 'Test',
        last_name: 'User',
        password: 'weak'
      });
    } catch (error) {
      if (error.response && error.response.status === 400) {
        console.log('✅ Password validation working:', error.response.data);
      } else {
        throw error;
      }
    }

    // Test update user
    console.log('\n11. Testing user update...');
    const updateResponse = await axios.put(`${BASE_URL}/api/users/${userId}`, {
      first_name: 'Johnny',
      last_name: 'Smith'
    });
    console.log('✅ User updated successfully:', updateResponse.data);

    // Test update user with email
    console.log('\n12. Testing user update with email...');
    const updateEmailResponse = await axios.put(`${BASE_URL}/api/users/${userId}`, {
      email: 'johnny.smith@example.com'
    });
    console.log('✅ User email updated successfully:', updateEmailResponse.data);

    // Test update non-existent user
    console.log('\n13. Testing update non-existent user...');
    try {
      await axios.put(`${BASE_URL}/api/users/nonexistent`, {
        first_name: 'Test'
      });
    } catch (error) {
      if (error.response && error.response.status === 404) {
        console.log('✅ Update non-existent user validation working:', error.response.data);
      } else {
        throw error;
      }
    }

    // Test authenticated profile endpoint
    console.log('\n14. Testing authenticated profile endpoint...');
    const profileResponse = await axios.get(`${BASE_URL}/api/profile`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    console.log('✅ Profile retrieved successfully:', profileResponse.data);

    // Test profile endpoint without token
    console.log('\n15. Testing profile endpoint without token...');
    try {
      await axios.get(`${BASE_URL}/api/profile`);
    } catch (error) {
      if (error.response && error.response.status === 401) {
        console.log('✅ Profile endpoint authentication working:', error.response.data);
      } else {
        throw error;
      }
    }

    // Test profile endpoint with invalid token
    console.log('\n16. Testing profile endpoint with invalid token...');
    try {
      await axios.get(`${BASE_URL}/api/profile`, {
        headers: {
          'Authorization': 'Bearer invalid-token'
        }
      });
    } catch (error) {
      if (error.response && error.response.status === 403) {
        console.log('✅ Invalid token validation working:', error.response.data);
      } else {
        throw error;
      }
    }

    // Test refresh token endpoint
    console.log('\n17. Testing refresh token endpoint...');
    const refreshResponse = await axios.post(`${BASE_URL}/api/refresh`, {
      refresh_token: refreshToken
    });
    console.log('✅ Token refreshed successfully:', refreshResponse.data);

    // Test refresh token with invalid token
    console.log('\n18. Testing refresh token with invalid token...');
    try {
      await axios.post(`${BASE_URL}/api/refresh`, {
        refresh_token: 'invalid-refresh-token'
      });
    } catch (error) {
      if (error.response && error.response.status === 403) {
        console.log('✅ Invalid refresh token validation working:', error.response.data);
      } else {
        throw error;
      }
    }

    // Test logout endpoint
    console.log('\n19. Testing logout endpoint...');
    const logoutResponse = await axios.post(`${BASE_URL}/api/logout`, {
      refresh_token: refreshToken
    });
    console.log('✅ Logout successful:', logoutResponse.data);

    // Test refresh token after logout
    console.log('\n20. Testing refresh token after logout...');
    try {
      await axios.post(`${BASE_URL}/api/refresh`, {
        refresh_token: refreshToken
      });
    } catch (error) {
      if (error.response && error.response.status === 403) {
        console.log('✅ Refresh token revoked after logout:', error.response.data);
      } else {
        throw error;
      }
    }

    // Test pairing functionality
    console.log('\n21. Testing pairing functionality...');
    
    // Create a second user for pairing tests
    const secondUserData = {
      email: 'jane.doe@example.com',
      first_name: 'Jane',
      last_name: 'Doe',
      password: 'Test2!@#',
      max_pairings: 2
    };
    
    const secondUserResponse = await axios.post(`${BASE_URL}/api/users`, secondUserData);
    console.log('✅ Second user created:', secondUserResponse.data);
    
    // Login as second user
    const secondUserLoginResponse = await axios.post(`${BASE_URL}/api/login`, {
      email: 'jane.doe@example.com',
      password: 'Test2!@#'
    });
    const secondUserToken = secondUserLoginResponse.data.access_token;
    
    // Request pairing (generates partner code)
    const pairingResponse = await axios.post(`${BASE_URL}/api/pairing/request`, {}, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    console.log('✅ Partner code generated:', pairingResponse.data);
    const partnerCode = pairingResponse.data.partner_code;
    
    // Accept pairing request using partner code
    const acceptPairingResponse = await axios.post(`${BASE_URL}/api/pairing/accept`, {
      partner_code: partnerCode
    }, {
      headers: {
        'Authorization': `Bearer ${secondUserToken}`
      }
    });
    console.log('✅ Pairing accepted:', acceptPairingResponse.data);
    
    // Get accepted pairings
    const acceptedPairingsResponse = await axios.get(`${BASE_URL}/api/pairing/accepted`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    console.log('✅ Accepted pairings retrieved:', acceptedPairingsResponse.data);
    
    // Get pairing statistics
    const pairingStatsResponse = await axios.get(`${BASE_URL}/api/pairing/stats`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    console.log('✅ Pairing statistics retrieved:', pairingStatsResponse.data);

    console.log('\n🎉 All tests passed! API is working correctly.');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
    }
  }
}

// Check if axios is available
try {
  require('axios');
  testAPI();
} catch (error) {
  console.log('📝 To run tests, install axios: npm install axios');
  console.log('Then run: node test-api.js');
} 