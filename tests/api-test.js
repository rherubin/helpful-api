const axios = require('axios');
const jwt = require('jsonwebtoken');

/**
 * Comprehensive API functionality test suite
 * Tests all endpoints and core functionality
 * Run with: node tests/api-test.js
 */

class APITestRunner {
  constructor(options = {}) {
    this.baseURL = options.baseURL || 'http://localhost:9000';
    this.timeout = options.timeout || 15000;
    this.JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
    this.testResults = {
      passed: 0,
      failed: 0,
      total: 0
    };
    this.testData = {};
  }

  log(message, type = 'info') {
    const timestamp = new Date().toISOString();
    const prefix = {
      info: '📝',
      pass: '✅',
      fail: '❌',
      warn: '⚠️',
      section: '🧪'
    }[type] || '📝';
    
    console.log(`${prefix} [${timestamp}] ${message}`);
  }

  assert(condition, testName, details = '') {
    this.testResults.total++;
    if (condition) {
      this.testResults.passed++;
      this.log(`${testName} - PASSED ${details}`, 'pass');
    } else {
      this.testResults.failed++;
      this.log(`${testName} - FAILED ${details}`, 'fail');
    }
  }

  // Generate JWT token
  generateToken(userId = 'test-user-id', email = 'test@example.com') {
    return jwt.sign({ id: userId, email }, this.JWT_SECRET, { expiresIn: '24h' });
  }

  // Test server health
  async testHealthEndpoint() {
    this.log('Testing Health Endpoint', 'section');
    
    try {
      const response = await axios.get(`${this.baseURL}/health`, { timeout: 5000 });
      
      this.assert(
        response.status === 200,
        'Health endpoint returns 200',
        `Status: ${response.status}`
      );
      
      this.assert(
        response.data.status === 'OK',
        'Health endpoint returns OK status',
        `Status: ${response.data.status}`
      );
      
      this.assert(
        !!response.data.timestamp,
        'Health endpoint includes timestamp',
        `Timestamp: ${response.data.timestamp}`
      );
      
    } catch (error) {
      this.assert(false, 'Health endpoint accessible', `Error: ${error.message}`);
    }
  }

  // Test authentication endpoints (comprehensive from original test-api.js)
  async testAuthEndpoints() {
    this.log('Testing Authentication Endpoints', 'section');
    
    // Test user creation with comprehensive validation
    const timestamp = Date.now();
    const testUser = {
      email: `john.doe.${timestamp}@example.com`,
      first_name: 'John',
      last_name: 'Doe',
      password: 'Test1!@#'
    };
    
    try {
      const createResponse = await axios.post(`${this.baseURL}/api/users`, testUser, {
        timeout: this.timeout
      });
      
      this.assert(
        createResponse.status === 201,
        'User creation returns 201',
        `Status: ${createResponse.status}`
      );
      
      this.assert(
        !!createResponse.data.access_token,
        'User creation returns access token',
        'Token received'
      );
      
      this.assert(
        createResponse.data.user.email === testUser.email,
        'User creation returns correct email',
        `Email: ${createResponse.data.user.email}`
      );
      
      // Store user data for later tests
      this.testData.user = createResponse.data.user;
      this.testData.token = createResponse.data.access_token;
      this.testData.refreshToken = createResponse.data.refresh_token;
      
    } catch (error) {
      this.assert(false, 'User creation', `Error: ${error.response?.data?.error || error.message}`);
      
      // Fallback to generated token if user creation fails
      this.testData.token = this.generateToken();
      this.testData.user = { id: 'test-user-id', email: 'test@example.com' };
    }

    // Small delay to ensure user is fully created in database
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Test login with correct credentials
    try {
      const loginResponse = await axios.post(`${this.baseURL}/api/login`, {
        email: testUser.email,
        password: testUser.password
      }, { timeout: this.timeout });
      
      this.assert(
        loginResponse.status === 200,
        'Login with correct credentials returns 200',
        `Status: ${loginResponse.status}`
      );
      
      this.assert(
        !!loginResponse.data.data?.access_token,
        'Login returns access token',
        'Token received'
      );

      // Update stored tokens with login response
      this.testData.token = loginResponse.data.data?.access_token || this.testData.token;
      this.testData.refreshToken = loginResponse.data.data?.refresh_token || this.testData.refreshToken;
      
    } catch (error) {
      this.assert(false, 'Login with correct credentials', `Error: ${error.response?.data?.error || error.message}`);
    }

    // Test duplicate email validation
    try {
      await axios.post(`${this.baseURL}/api/users`, {
        email: testUser.email,
        password: 'Test1!@#',
        first_name: 'Test',
        last_name: 'User'
      }, { timeout: this.timeout });
      
      this.assert(false, 'Duplicate email should fail', 'Request succeeded unexpectedly');
      
    } catch (error) {
      this.assert(
        error.response?.status === 409,
        'Duplicate email returns 409',
        `Status: ${error.response?.status}`
      );
    }

    // Test invalid email format
    try {
      await axios.post(`${this.baseURL}/api/users`, {
        email: 'invalid-email',
        first_name: 'Test',
        last_name: 'User',
        password: 'Test1!@#'
      }, { timeout: this.timeout });
      
      this.assert(false, 'Invalid email format should fail', 'Request succeeded unexpectedly');
      
    } catch (error) {
      this.assert(
        error.response?.status === 400,
        'Invalid email format returns 400',
        `Status: ${error.response?.status}`
      );
    }

    // Test login with incorrect password
    try {
      await axios.post(`${this.baseURL}/api/login`, {
        email: testUser.email,
        password: 'Wrong1!@#'
      }, { timeout: this.timeout });
      
      this.assert(false, 'Login with wrong password should fail', 'Request succeeded unexpectedly');
      
    } catch (error) {
      this.assert(
        error.response?.status === 401,
        'Login with wrong password returns 401',
        `Status: ${error.response?.status}`
      );
    }
    
    // Test login with non-existent email
    try {
      await axios.post(`${this.baseURL}/api/login`, {
        email: 'nonexistent@example.com',
        password: 'Test1!@#'
      }, { timeout: this.timeout });
      
      this.assert(false, 'Login with non-existent email should fail', 'Request succeeded unexpectedly');
      
    } catch (error) {
      this.assert(
        error.response?.status === 401,
        'Login with non-existent email returns 401',
        `Status: ${error.response?.status}`
      );
    }

    // Test password validation (weak password)
    try {
      await axios.post(`${this.baseURL}/api/users`, {
        email: 'test@example.com',
        first_name: 'Test',
        last_name: 'User',
        password: 'weak'
      }, { timeout: this.timeout });
      
      this.assert(false, 'Weak password should fail', 'Request succeeded unexpectedly');
      
    } catch (error) {
      this.assert(
        error.response?.status === 400,
        'Weak password returns 400',
        `Status: ${error.response?.status}`
      );
    }
  }

  // Test user management endpoints (from original test-api.js)
  async testUserManagement() {
    this.log('Testing User Management', 'section');
    
    const token = this.testData.token;
    const userId = this.testData.user?.id;
    
    if (!userId) {
      this.log('Skipping user management tests - no user ID available', 'warn');
      return;
    }

    // Test getting specific user
    try {
      const userResponse = await axios.get(`${this.baseURL}/api/users/${userId}`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: this.timeout
      });
      
      this.assert(
        userResponse.status === 200,
        'Get user by ID returns 200',
        `Status: ${userResponse.status}`
      );
      
      this.assert(
        userResponse.data.id === userId,
        'Get user by ID returns correct user',
        `ID: ${userResponse.data.id}`
      );
      
    } catch (error) {
      this.assert(false, 'Get user by ID', `Error: ${error.response?.data?.error || error.message}`);
    }

    // Test update user
    try {
      const updateResponse = await axios.put(`${this.baseURL}/api/users/${userId}`, {
        first_name: 'Johnny',
        last_name: 'Smith'
      }, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: this.timeout
      });
      
      this.assert(
        updateResponse.status === 200,
        'Update user returns 200',
        `Status: ${updateResponse.status}`
      );
      
      this.assert(
        updateResponse.data.user.first_name === 'Johnny',
        'Update user changes first name',
        `Name: ${updateResponse.data.user.first_name}`
      );
      
    } catch (error) {
      this.assert(false, 'Update user', `Error: ${error.response?.data?.error || error.message}`);
    }

    // Test update user with email
    try {
      const updateEmailResponse = await axios.put(`${this.baseURL}/api/users/${userId}`, {
        email: 'johnny.smith@example.com'
      }, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: this.timeout
      });
      
      this.assert(
        updateEmailResponse.status === 200,
        'Update user email returns 200',
        `Status: ${updateEmailResponse.status}`
      );
      
    } catch (error) {
      this.assert(false, 'Update user email', `Error: ${error.response?.data?.error || error.message}`);
    }

    // Test user profile endpoint (combines user info and pairings)
    try {
      const profileResponse = await axios.get(`${this.baseURL}/api/users/profile`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: this.timeout
      });
      
      this.assert(
        profileResponse.status === 200,
        'User profile endpoint returns 200',
        `Status: ${profileResponse.status}`
      );
      
      this.assert(
        !!profileResponse.data.profile,
        'User profile endpoint returns profile object',
        'Profile object present'
      );
      
      this.assert(
        profileResponse.data.profile.id === userId,
        'User profile endpoint returns correct user ID',
        `ID: ${profileResponse.data.profile.id}`
      );
      
      this.assert(
        Array.isArray(profileResponse.data.profile.pairings),
        'User profile endpoint includes pairings array',
        `Pairings type: ${typeof profileResponse.data.profile.pairings}`
      );
      
    } catch (error) {
      this.assert(false, 'User profile endpoint', `Error: ${error.response?.data?.error || error.message}`);
    }

    // Test update non-existent user
    try {
      await axios.put(`${this.baseURL}/api/users/nonexistent`, {
        first_name: 'Test'
      }, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: this.timeout
      });
      
      this.assert(false, 'Update non-existent user should fail', 'Request succeeded unexpectedly');
      
    } catch (error) {
      this.assert(
        error.response?.status === 404,
        'Update non-existent user returns 404',
        `Status: ${error.response?.status}`
      );
    }
  }

  // Test token management (from original test-api.js)
  async testTokenManagement() {
    this.log('Testing Token Management', 'section');
    
    const token = this.testData.token;
    const refreshToken = this.testData.refreshToken;

    // Test authenticated profile endpoint
    try {
      const profileResponse = await axios.get(`${this.baseURL}/api/profile`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: this.timeout
      });
      
      this.assert(
        profileResponse.status === 200,
        'Profile endpoint returns 200',
        `Status: ${profileResponse.status}`
      );
      
      this.assert(
        !!profileResponse.data.user,
        'Profile endpoint returns user data',
        'User data present'
      );
      
    } catch (error) {
      this.assert(false, 'Profile endpoint', `Error: ${error.response?.data?.error || error.message}`);
    }

    // Test profile endpoint without token
    try {
      await axios.get(`${this.baseURL}/api/profile`, { timeout: this.timeout });
      this.assert(false, 'Profile without token should fail', 'Request succeeded unexpectedly');
      
    } catch (error) {
      this.assert(
        error.response?.status === 401,
        'Profile without token returns 401',
        `Status: ${error.response?.status}`
      );
    }

    // Test profile endpoint with invalid token
    try {
      await axios.get(`${this.baseURL}/api/profile`, {
        headers: { Authorization: 'Bearer invalid-token' },
        timeout: this.timeout
      });
      this.assert(false, 'Profile with invalid token should fail', 'Request succeeded unexpectedly');
      
    } catch (error) {
      this.assert(
        error.response?.status === 403,
        'Profile with invalid token returns 403',
        `Status: ${error.response?.status}`
      );
    }

    // Test refresh token endpoint
    if (refreshToken) {
      try {
        const refreshResponse = await axios.post(`${this.baseURL}/api/refresh`, {
          refresh_token: refreshToken
        }, { timeout: this.timeout });
        
        this.assert(
          refreshResponse.status === 200,
          'Refresh token returns 200',
          `Status: ${refreshResponse.status}`
        );
        
        this.assert(
          !!refreshResponse.data.access_token,
          'Refresh token returns new access token',
          'New token received'
        );
        
        // Update stored token
        this.testData.token = refreshResponse.data.access_token;
        
      } catch (error) {
        this.assert(false, 'Refresh token', `Error: ${error.response?.data?.error || error.message}`);
      }

      // Test refresh token with invalid token
      try {
        await axios.post(`${this.baseURL}/api/refresh`, {
          refresh_token: 'invalid-refresh-token'
        }, { timeout: this.timeout });
        
        this.assert(false, 'Refresh with invalid token should fail', 'Request succeeded unexpectedly');
        
      } catch (error) {
        this.assert(
          error.response?.status === 403,
          'Refresh with invalid token returns 403',
          `Status: ${error.response?.status}`
        );
      }

      // Test logout endpoint (but don't actually logout to preserve tokens for other tests)
      // We'll test this with a separate refresh token
      try {
        // Create a separate refresh token for logout testing
        const separateLoginResponse = await axios.post(`${this.baseURL}/api/login`, {
          email: this.testData.user.email || 'test@example.com',
          password: 'Test1!@#'
        }, { timeout: this.timeout });
        
        const separateRefreshToken = separateLoginResponse.data.refresh_token;
        
        const logoutResponse = await axios.post(`${this.baseURL}/api/logout`, {
          refresh_token: separateRefreshToken
        }, { timeout: this.timeout });
        
        this.assert(
          logoutResponse.status === 200,
          'Logout returns 200',
          `Status: ${logoutResponse.status}`
        );
        
        // Test refresh token after logout
        try {
          await axios.post(`${this.baseURL}/api/refresh`, {
            refresh_token: separateRefreshToken
          }, { timeout: this.timeout });
          
          this.assert(false, 'Refresh after logout should fail', 'Request succeeded unexpectedly');
          
        } catch (logoutError) {
          this.assert(
            logoutError.response?.status === 403,
            'Refresh after logout returns 403',
            `Status: ${logoutError.response?.status}`
          );
        }
        
      } catch (error) {
        this.assert(false, 'Logout test setup', `Error: ${error.response?.data?.error || error.message}`);
      }
    }
  }

  // Test pairing functionality (from original test-api.js)
  async testPairingFunctionality() {
    this.log('Testing Pairing Functionality', 'section');
    
    const token = this.testData.token;

    // Create a second user for pairing tests
    const timestamp = Date.now();
    const secondUserData = {
      email: `jane.doe.${timestamp}@example.com`,
      first_name: 'Jane',
      last_name: 'Doe',
      password: 'Test2!@#',
      max_pairings: 2
    };
    
    try {
      const secondUserResponse = await axios.post(`${this.baseURL}/api/users`, secondUserData, {
        timeout: this.timeout
      });
      
      this.assert(
        secondUserResponse.status === 201,
        'Second user creation returns 201',
        `Status: ${secondUserResponse.status}`
      );
      
      // Login as second user
      const secondUserLoginResponse = await axios.post(`${this.baseURL}/api/login`, {
        email: secondUserData.email,
        password: secondUserData.password
      }, { timeout: this.timeout });
      
      const secondUserToken = secondUserLoginResponse.data.access_token;
      this.testData.secondUserToken = secondUserToken;
      
      this.assert(
        !!secondUserToken,
        'Second user login successful',
        'Token received'
      );
      
    } catch (error) {
      this.assert(false, 'Second user setup', `Error: ${error.response?.data?.error || error.message}`);
      return; // Skip pairing tests if second user setup fails
    }

    // Request pairing (generates partner code)
    try {
      const pairingResponse = await axios.post(`${this.baseURL}/api/pairing/request`, {}, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: this.timeout
      });
      
      this.assert(
        pairingResponse.status === 201,
        'Pairing request returns 201',
        `Status: ${pairingResponse.status}`
      );
      
      this.assert(
        !!pairingResponse.data.partner_code,
        'Pairing request returns partner code',
        `Code: ${pairingResponse.data.partner_code}`
      );
      
      this.testData.partnerCode = pairingResponse.data.partner_code;
      
    } catch (error) {
      this.assert(false, 'Pairing request', `Error: ${error.response?.data?.error || error.message}`);
      return;
    }

    // Accept pairing request using partner code
    try {
      const acceptPairingResponse = await axios.post(`${this.baseURL}/api/pairing/accept`, {
        partner_code: this.testData.partnerCode
      }, {
        headers: { Authorization: `Bearer ${this.testData.secondUserToken}` },
        timeout: this.timeout
      });
      
      this.assert(
        acceptPairingResponse.status === 200,
        'Accept pairing returns 200',
        `Status: ${acceptPairingResponse.status}`
      );
      
      // Accept pairing now returns empty response, pairing ID will be retrieved from accepted pairings endpoint
      
    } catch (error) {
      this.assert(false, 'Accept pairing', `Error: ${error.response?.data?.error || error.message}`);
      return;
    }

    // Get accepted pairings
    try {
      const acceptedPairingsResponse = await axios.get(`${this.baseURL}/api/pairing/accepted`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: this.timeout
      });
      
      this.assert(
        acceptedPairingsResponse.status === 200,
        'Get accepted pairings returns 200',
        `Status: ${acceptedPairingsResponse.status}`
      );
      
      this.assert(
        Array.isArray(acceptedPairingsResponse.data.pairings),
        'Accepted pairings returns array',
        `Type: ${typeof acceptedPairingsResponse.data.pairings}`
      );
      
      // Extract pairing ID from accepted pairings for later use
      if (acceptedPairingsResponse.data.pairings.length > 0) {
        this.testData.pairingId = acceptedPairingsResponse.data.pairings[0].id;
      }
      
    } catch (error) {
      this.assert(false, 'Get accepted pairings', `Error: ${error.response?.data?.error || error.message}`);
    }

    // Test new GET /api/pairings endpoint
    try {
      const allPairingsResponse = await axios.get(`${this.baseURL}/api/pairings`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: this.timeout
      });
      
      this.assert(
        allPairingsResponse.status === 200,
        'Get all pairings returns 200',
        `Status: ${allPairingsResponse.status}`
      );
      
    } catch (error) {
      this.assert(false, 'Get all pairings', `Error: ${error.response?.data?.error || error.message}`);
    }

    // Get pairing statistics
    try {
      const pairingStatsResponse = await axios.get(`${this.baseURL}/api/pairing/stats`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: this.timeout
      });
      
      this.assert(
        pairingStatsResponse.status === 200,
        'Get pairing stats returns 200',
        `Status: ${pairingStatsResponse.status}`
      );
      
    } catch (error) {
      this.assert(false, 'Get pairing stats', `Error: ${error.response?.data?.error || error.message}`);
    }
  }

  // Test program endpoints (enhanced from original)
  async testProgramEndpoints() {
    this.log('Testing Program Endpoints', 'section');
    
    const token = this.testData.token;
    const secondUserToken = this.testData.secondUserToken;
    const pairingId = this.testData.pairingId;
    
    // Test program creation with pairing (from original test-api.js)
    const testProgram = {
      user_name: "Steve",
      partner_name: "Becca", 
      children: 3,
      user_input: "I feel less and less connected with my wife. I want a plan that will help us have what we used to.",
      pairing_id: pairingId
    };
    
    try {
      const createResponse = await axios.post(`${this.baseURL}/api/programs`, testProgram, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: this.timeout
      });
      
      this.assert(
        createResponse.status === 201,
        'Program creation returns 201',
        `Status: ${createResponse.status}`
      );
      
      this.assert(
        !!createResponse.data.program.id,
        'Program creation returns program ID',
        `ID: ${createResponse.data.program.id}`
      );
      
      this.assert(
        createResponse.data.program.user_name === testProgram.user_name,
        'Program creation returns correct user_name',
        `Name: ${createResponse.data.program.user_name}`
      );
      
      // Store program for later tests
      this.testData.program = createResponse.data.program;
      const programId = createResponse.data.program.id;
      
      this.log('Program created successfully. ChatGPT therapy response will be generated in the background.', 'info');
      
    } catch (error) {
      this.assert(false, 'Program creation', `Error: ${error.response?.data?.error || error.message}`);
    }
    
    // Test getting user's programs
    try {
      const getResponse = await axios.get(`${this.baseURL}/api/programs`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: this.timeout
      });
      
      this.assert(
        getResponse.status === 200,
        'Get user programs returns 200',
        `Status: ${getResponse.status}`
      );
      
      this.assert(
        Array.isArray(getResponse.data.programs),
        'Get user programs returns array',
        `Type: ${typeof getResponse.data.programs}`
      );
      
      this.assert(
        getResponse.data.programs.length > 0,
        'Get user programs returns at least one program',
        `Count: ${getResponse.data.programs.length}`
      );
      
    } catch (error) {
      this.assert(false, 'Get user programs', `Error: ${error.response?.data?.error || error.message}`);
    }

    const programId = this.testData.program?.id;
    if (programId) {
      // Test get program by ID (as creator)
      try {
        const programResponse = await axios.get(`${this.baseURL}/api/programs/${programId}`, {
          headers: { Authorization: `Bearer ${token}` },
          timeout: this.timeout
        });
        
        this.assert(
          programResponse.status === 200,
          'Get program by ID (creator) returns 200',
          `Status: ${programResponse.status}`
        );
        
        this.assert(
          programResponse.data.program.id === programId,
          'Get program by ID returns correct program',
          `ID: ${programResponse.data.program.id}`
        );
        
      } catch (error) {
        this.assert(false, 'Get program by ID (creator)', `Error: ${error.response?.data?.error || error.message}`);
      }

      // Test get program by ID (as paired user)
      if (secondUserToken) {
        try {
          const pairedProgramResponse = await axios.get(`${this.baseURL}/api/programs/${programId}`, {
            headers: { Authorization: `Bearer ${secondUserToken}` },
            timeout: this.timeout
          });
          
          this.assert(
            pairedProgramResponse.status === 200,
            'Get program by ID (paired user) returns 200',
            `Status: ${pairedProgramResponse.status}`
          );
          
        } catch (error) {
          this.assert(false, 'Get program by ID (paired user)', `Error: ${error.response?.data?.error || error.message}`);
        }
      }

      // Store programId for conversation tests before deletion
      this.testData.programIdForConversations = programId;

      // Test delete program (only owner can delete)
      try {
        const deleteProgramResponse = await axios.delete(`${this.baseURL}/api/programs/${programId}`, {
          headers: { Authorization: `Bearer ${token}` },
          timeout: this.timeout
        });
        
        this.assert(
          deleteProgramResponse.status === 200,
          'Delete program returns 200',
          `Status: ${deleteProgramResponse.status}`
        );
        
      } catch (error) {
        this.assert(false, 'Delete program', `Error: ${error.response?.data?.error || error.message}`);
      }
    }

    // Create a new program for conversation testing (since we deleted the first one)
    if (pairingId) {
      try {
        const conversationTestProgram = {
          user_name: "Alice",
          partner_name: "Bob", 
          children: 2,
          user_input: "We want to improve our communication and build stronger intimacy.",
          pairing_id: pairingId
        };

        const createConversationProgramResponse = await axios.post(`${this.baseURL}/api/programs`, conversationTestProgram, {
          headers: { Authorization: `Bearer ${token}` },
          timeout: this.timeout
        });
        
        this.assert(
          createConversationProgramResponse.status === 201,
          'Conversation test program creation returns 201',
          `Status: ${createConversationProgramResponse.status}`
        );
        
        // Store this program for conversation tests
        this.testData.conversationTestProgram = createConversationProgramResponse.data.program;
        
      } catch (error) {
        this.assert(false, 'Conversation test program creation', `Error: ${error.response?.data?.error || error.message}`);
      }
    }
    
    // Test program creation with invalid data
    try {
      await axios.post(`${this.baseURL}/api/programs`, {
        user_name: 'Test'
        // Missing required fields
      }, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: this.timeout
      });
      
      this.assert(false, 'Program creation with invalid data should fail', 'Request succeeded unexpectedly');
      
    } catch (error) {
      this.assert(
        error.response?.status === 400,
        'Program creation with invalid data returns 400',
        `Status: ${error.response?.status}`
      );
    }
  }

  // Test conversation endpoints
  async testConversationEndpoints() {
    this.log('Testing Conversation Endpoints', 'section');
    
    const token = this.testData.token;
    const program = this.testData.conversationTestProgram;
    
    if (!program) {
      this.log('Skipping conversation tests - no program available', 'warn');
      return;
    }
    
    const programId = program.id;
    
    // Wait a bit for program processing
    this.log('Waiting 5 seconds for program processing...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Test getting program conversations
    try {
      const getResponse = await axios.get(`${this.baseURL}/api/programs/${programId}/conversations`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: this.timeout
      });
      
      this.assert(
        getResponse.status === 200,
        'Get program conversations returns 200',
        `Status: ${getResponse.status}`
      );
      
      this.assert(
        !!getResponse.data.days,
        'Get program conversations returns days object',
        'Days object present'
      );
      
      // Store conversation ID for message tests
      const firstDay = Object.values(getResponse.data.days)[0];
      if (firstDay?.conversation_id) {
        this.testData.conversationId = firstDay.conversation_id;
      }
      
    } catch (error) {
      this.assert(false, 'Get program conversations', `Error: ${error.response?.data?.error || error.message}`);
    }
    
    // Test getting specific day conversations
    try {
      const dayResponse = await axios.get(`${this.baseURL}/api/programs/${programId}/conversations/day/1`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: this.timeout
      });
      
      this.assert(
        dayResponse.status === 200,
        'Get day 1 conversations returns 200',
        `Status: ${dayResponse.status}`
      );
      
      this.assert(
        dayResponse.data.day === 1,
        'Get day 1 conversations returns correct day',
        `Day: ${dayResponse.data.day}`
      );
      
    } catch (error) {
      this.assert(false, 'Get day 1 conversations', `Error: ${error.response?.data?.error || error.message}`);
    }
  }

  // Test message endpoints
  async testMessageEndpoints() {
    this.log('Testing Message Endpoints', 'section');
    
    const token = this.testData.token;
    const conversationId = this.testData.conversationId;
    
    if (!conversationId) {
      this.log('Skipping message tests - no conversation available', 'warn');
      return;
    }
    
    // Test adding a message to conversation
    const testMessage = {
      content: 'This is a test message for our conversation. We completed the exercise and found it very helpful!',
      metadata: {
        completed_exercise: true,
        satisfaction_rating: 5,
        duration_minutes: 30
      }
    };
    
    try {
      const addResponse = await axios.post(`${this.baseURL}/api/conversations/${conversationId}/messages`, testMessage, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: this.timeout
      });
      
      this.assert(
        addResponse.status === 201,
        'Add message returns 201',
        `Status: ${addResponse.status}`
      );
      
      this.assert(
        !!addResponse.data.data.id,
        'Add message returns message ID',
        `ID: ${addResponse.data.data.id}`
      );
      
      this.assert(
        addResponse.data.data.content === testMessage.content,
        'Add message returns correct content',
        'Content matches'
      );
      
      // Store message ID for update test
      this.testData.messageId = addResponse.data.data.id;
      
    } catch (error) {
      this.assert(false, 'Add message to conversation', `Error: ${error.response?.data?.error || error.message}`);
    }
    
    // Test getting conversation messages
    try {
      const getResponse = await axios.get(`${this.baseURL}/api/conversations/${conversationId}/messages`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: this.timeout
      });
      
      this.assert(
        getResponse.status === 200,
        'Get conversation messages returns 200',
        `Status: ${getResponse.status}`
      );
      
      this.assert(
        Array.isArray(getResponse.data.messages),
        'Get conversation messages returns array',
        `Type: ${typeof getResponse.data.messages}`
      );
      
      this.assert(
        getResponse.data.messages.length > 0,
        'Get conversation messages returns at least one message',
        `Count: ${getResponse.data.messages.length}`
      );
      
    } catch (error) {
      this.assert(false, 'Get conversation messages', `Error: ${error.response?.data?.error || error.message}`);
    }
    
    // Test updating a message
    if (this.testData.messageId) {
      try {
        const updateResponse = await axios.put(`${this.baseURL}/api/conversations/${conversationId}/messages/${this.testData.messageId}`, {
          content: 'This is an updated test message with additional details about our experience.',
          metadata: {
            completed_exercise: true,
            satisfaction_rating: 5,
            duration_minutes: 30,
            edited: true
          }
        }, {
          headers: { Authorization: `Bearer ${token}` },
          timeout: this.timeout
        });
        
        this.assert(
          updateResponse.status === 200,
          'Update message returns 200',
          `Status: ${updateResponse.status}`
        );
        
      } catch (error) {
        this.assert(false, 'Update message', `Error: ${error.response?.data?.error || error.message}`);
      }
    }
  }

  // Test metrics endpoint
  async testMetricsEndpoint() {
    this.log('Testing Metrics Endpoint', 'section');
    
    const token = this.testData.token;
    
    try {
      const metricsResponse = await axios.get(`${this.baseURL}/api/programs/metrics`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: this.timeout
      });
      
      this.assert(
        metricsResponse.status === 200,
        'Metrics endpoint returns 200',
        `Status: ${metricsResponse.status}`
      );
      
      this.assert(
        !!metricsResponse.data.metrics,
        'Metrics endpoint returns metrics object',
        'Metrics object present'
      );
      
      const metrics = metricsResponse.data.metrics;
      const expectedKeys = ['totalRequests', 'successfulRequests', 'failedRequests', 'successRate'];
      
      expectedKeys.forEach(key => {
        this.assert(
          metrics.hasOwnProperty(key),
          `Metrics contains ${key}`,
          `Value: ${metrics[key]}`
        );
      });
      
    } catch (error) {
      this.assert(false, 'Get OpenAI metrics', `Error: ${error.response?.data?.error || error.message}`);
    }
  }

  // Test authentication and authorization
  async testAuthorizationSecurity() {
    this.log('Testing Authorization Security', 'section');
    
    // Test accessing protected endpoint without token
    try {
      await axios.get(`${this.baseURL}/api/programs`, { timeout: this.timeout });
      this.assert(false, 'Protected endpoint without token should fail', 'Request succeeded unexpectedly');
      
    } catch (error) {
      this.assert(
        error.response?.status === 401,
        'Protected endpoint without token returns 401',
        `Status: ${error.response?.status}`
      );
    }
    
    // Test accessing protected endpoint with invalid token
    try {
      await axios.get(`${this.baseURL}/api/programs`, {
        headers: { Authorization: 'Bearer invalid-token' },
        timeout: this.timeout
      });
      this.assert(false, 'Protected endpoint with invalid token should fail', 'Request succeeded unexpectedly');
      
    } catch (error) {
      this.assert(
        error.response?.status === 403,
        'Protected endpoint with invalid token returns 403',
        `Status: ${error.response?.status}`
      );
    }
    
    // Test rate limiting (if enabled)
    this.log('Testing rate limiting...');
    const rapidRequests = Array.from({ length: 10 }, () => 
      axios.get(`${this.baseURL}/health`, { timeout: 1000 }).catch(e => e.response)
    );
    
    const responses = await Promise.all(rapidRequests);
    const rateLimited = responses.some(r => r?.status === 429);
    
    if (rateLimited) {
      this.assert(true, 'Rate limiting active', 'Some requests were rate limited');
    } else {
      this.log('Rate limiting not triggered with current load', 'warn');
    }
  }

  // Run comprehensive test suite
  async runFullTestSuite() {
    this.log('🧪 Starting Comprehensive API Test Suite', 'section');
    
    try {
      await this.testHealthEndpoint();
      console.log('');
      
      await this.testAuthEndpoints();
      console.log('');
      
      await this.testUserManagement();
      console.log('');
      
      await this.testTokenManagement();
      console.log('');
      
      await this.testPairingFunctionality();
      console.log('');
      
      await this.testProgramEndpoints();
      console.log('');
      
      await this.testConversationEndpoints();
      console.log('');
      
      await this.testMessageEndpoints();
      console.log('');
      
      await this.testMetricsEndpoint();
      console.log('');
      
      await this.testAuthorizationSecurity();
      console.log('');
      
      this.printSummary();
      
      return this.testResults.failed === 0;
      
    } catch (error) {
      this.log(`Test suite failed with error: ${error.message}`, 'fail');
      return false;
    }
  }

  printSummary() {
    this.log('📊 API Test Results Summary', 'section');
    this.log(`Total Tests: ${this.testResults.total}`);
    this.log(`Passed: ${this.testResults.passed}`, this.testResults.passed === this.testResults.total ? 'pass' : 'info');
    this.log(`Failed: ${this.testResults.failed}`, this.testResults.failed === 0 ? 'pass' : 'fail');
    
    const successRate = this.testResults.total > 0 
      ? ((this.testResults.passed / this.testResults.total) * 100).toFixed(1)
      : '0';
    
    this.log(`Success Rate: ${successRate}%`, successRate === '100.0' ? 'pass' : 'warn');
    
    if (this.testResults.failed === 0) {
      this.log('🎉 All API tests passed! The API is functioning correctly.', 'pass');
    } else {
      this.log('⚠️ Some API tests failed. Review the failures above.', 'fail');
    }
  }
}

// Run tests if called directly
if (require.main === module) {
  const testRunner = new APITestRunner();
  testRunner.runFullTestSuite().then(success => {
    process.exit(success ? 0 : 1);
  }).catch(error => {
    console.error('API test runner failed:', error);
    process.exit(1);
  });
}

module.exports = APITestRunner;
