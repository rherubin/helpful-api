const assert = require('assert');
const Database = require('better-sqlite3');
const express = require('express');
const request = require('supertest');
const { v4: uuidv4 } = require('uuid');

// Import models and services
const User = require('../models/User');
const RefreshToken = require('../models/RefreshToken');
const AuthService = require('../services/AuthService');

// Create a simplified auth router for testing (without complex middleware)
function createSimpleAuthRoutes(authService) {
  const router = express.Router();
  
  // Register endpoint
  router.post('/register', async (req, res) => {
    try {
      const { email, password, first_name, last_name } = req.body;
      
      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
      }
      
      const result = await authService.register(email, password, first_name, last_name);
      res.status(201).json(result);
    } catch (error) {
      if (error.message.includes('already exists')) {
        return res.status(409).json({ error: error.message });
      }
      return res.status(500).json({ error: 'Failed to register user' });
    }
  });
  
  // Login endpoint
  router.post('/login', async (req, res) => {
    try {
      const { email, password } = req.body;
      
      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
      }
      
      const result = await authService.login(email, password);
      res.status(200).json(result);
    } catch (error) {
      if (error.message.includes('Invalid credentials') || 
          error.message.includes('User not found') || 
          error.message.includes('Invalid email or password')) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      return res.status(500).json({ error: 'Failed to login' });
    }
  });
  
  // Refresh token endpoint
  router.post('/refresh', async (req, res) => {
    try {
      const { refresh_token } = req.body;
      
      if (!refresh_token) {
        return res.status(400).json({ error: 'Refresh token is required' });
      }
      
      const result = await authService.refreshToken(refresh_token);
      res.status(200).json(result);
    } catch (error) {
      if (error.message.includes('Invalid or expired refresh token') || 
          error.message.includes('Refresh token not found or expired')) {
        return res.status(403).json({ error: error.message });
      } else {
        return res.status(500).json({ error: 'Failed to refresh token' });
      }
    }
  });
  
  // Logout endpoint
  router.post('/logout', async (req, res) => {
    try {
      const { refresh_token } = req.body;
      
      if (!refresh_token) {
        return res.status(400).json({ error: 'Refresh token is required' });
      }
      
      const result = await authService.logout(refresh_token);
      res.status(200).json(result);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to logout' });
    }
  });
  
  // Profile endpoint (with simple token verification)
  router.get('/profile', async (req, res) => {
    try {
      const authHeader = req.headers['authorization'];
      const token = authHeader && authHeader.split(' ')[1];
      
      if (!token) {
        return res.status(401).json({ error: 'Access token required' });
      }
      
      const result = await authService.getProfileFromToken(token);
      res.status(200).json(result);
    } catch (error) {
      if (error.message === 'User not found') {
        return res.status(404).json({ error: error.message });
      } else if (error.message.includes('Invalid') || error.message.includes('expired')) {
        return res.status(403).json({ error: 'Invalid or expired token' });
      } else {
        return res.status(500).json({ error: 'Failed to fetch user profile' });
      }
    }
  });
  
  return router;
}

class AuthTest {
  constructor() {
    this.testResults = [];
    this.db = null;
    this.models = {};
    this.services = {};
    this.app = null;
  }

  log(message, type = 'info') {
    const timestamp = new Date().toISOString();
    const prefix = type === 'error' ? '❌' : type === 'success' ? '✅' : type === 'section' ? '📋' : 'ℹ️';
    console.log(`${prefix} [${timestamp}] ${message}`);
  }

  async setup() {
    try {
      this.log('Setting up in-memory database and services...', 'section');
      
      // Create in-memory database
      this.db = new Database(':memory:');
      
      // Enable foreign key constraints
      this.db.pragma('foreign_keys = ON');
      
      // Initialize models
      this.models.user = new User(this.db);
      this.models.refreshToken = new RefreshToken(this.db);
      
      // Initialize database tables
      await this.models.user.initDatabase();
      await this.models.refreshToken.initDatabase();
      
      // Initialize services
      this.services.auth = new AuthService(this.models.user, this.models.refreshToken);
      
      // Create Express app with simplified auth routes
      this.app = express();
      this.app.use(express.json());
      this.app.use('/api', createSimpleAuthRoutes(this.services.auth));
      
      this.log('Setup completed successfully', 'success');
      return true;
    } catch (error) {
      this.log(`Setup failed: ${error.message}`, 'error');
      return false;
    }
  }

  async cleanup() {
    if (this.db) {
      this.db.close();
    }
  }

  async testUserRegistration() {
    this.log('Testing user registration...', 'section');
    
    try {
      const userData = {
        email: `test-${uuidv4()}@example.com`,
        password: 'MyVerySecureP@ssw0rd2024!',
        first_name: 'Test',
        last_name: 'User'
      };

      const response = await request(this.app)
        .post('/api/register')
        .send(userData)
        .expect(201);

      assert(response.body.message === 'User registered successfully', 'Registration message incorrect');
      assert(response.body.data.access_token, 'Access token not provided');
      assert(response.body.data.refresh_token, 'Refresh token not provided');
      assert(response.body.data.user.email === userData.email, 'User email mismatch');
      assert(!response.body.data.user.password, 'Password should not be returned');

      this.log('✓ User registration successful', 'success');
      return { success: true, userData, tokens: response.body.data };
    } catch (error) {
      this.log(`✗ User registration failed: ${error.message}`, 'error');
      return { success: false, error: error.message };
    }
  }

  async testUserLogin() {
    this.log('Testing user login...', 'section');
    
    try {
      // First register a user
      const userData = {
        email: `login-test-${uuidv4()}@example.com`,
        password: 'MyVerySecureP@ssw0rd2024!',
        first_name: 'Login',
        last_name: 'Test'
      };

      await request(this.app)
        .post('/api/register')
        .send(userData)
        .expect(201);

      // Now test login
      const loginResponse = await request(this.app)
        .post('/api/login')
        .send({
          email: userData.email,
          password: userData.password
        })
        .expect(200);

      assert(loginResponse.body.message === 'Login successful', 'Login message incorrect');
      assert(loginResponse.body.data.access_token, 'Access token not provided');
      assert(loginResponse.body.data.refresh_token, 'Refresh token not provided');
      assert(loginResponse.body.data.user.email === userData.email, 'User email mismatch');
      assert(!loginResponse.body.data.user.password, 'Password should not be returned');

      this.log('✓ User login successful', 'success');
      return { success: true, userData, tokens: loginResponse.body.data };
    } catch (error) {
      this.log(`✗ User login failed: ${error.message}`, 'error');
      return { success: false, error: error.message };
    }
  }

  async testInvalidLogin() {
    this.log('Testing invalid login scenarios...', 'section');
    
    try {
      // Test with non-existent user
      await request(this.app)
        .post('/api/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'wrongpassword'
        })
        .expect(401);

      // Register a user first
      const userData = {
        email: `invalid-test-${uuidv4()}@example.com`,
          password: 'MyVerySecureP@ssw0rd2024!'
      };

      await request(this.app)
        .post('/api/register')
        .send(userData)
        .expect(201);

      // Test with wrong password
      await request(this.app)
        .post('/api/login')
        .send({
          email: userData.email,
          password: 'wrongpassword'
        })
        .expect(401);

      // Test with missing fields
      await request(this.app)
        .post('/api/login')
        .send({
          email: userData.email
        })
        .expect(400);

      await request(this.app)
        .post('/api/login')
        .send({
          password: userData.password
        })
        .expect(400);

      this.log('✓ Invalid login scenarios handled correctly', 'success');
      return { success: true };
    } catch (error) {
      this.log(`✗ Invalid login test failed: ${error.message}`, 'error');
      return { success: false, error: error.message };
    }
  }

  async testTokenRefresh() {
    this.log('Testing token refresh...', 'section');
    
    try {
      // First register and login a user
      const userData = {
        email: `refresh-test-${uuidv4()}@example.com`,
          password: 'MyVerySecureP@ssw0rd2024!'
      };

      const registerResponse = await request(this.app)
        .post('/api/register')
        .send(userData)
        .expect(201);

      const refreshToken = registerResponse.body.data.refresh_token;
      const originalAccessToken = registerResponse.body.data.access_token;

      // Wait a moment to ensure new token has different timestamp
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Test refresh token
      const refreshResponse = await request(this.app)
        .post('/api/refresh')
        .send({ refresh_token: refreshToken })
        .expect(200);

      assert(refreshResponse.body.message === 'Token refreshed successfully', 'Refresh message incorrect');
      assert(refreshResponse.body.access_token, 'New access token not provided');
      assert(refreshResponse.body.expires_in === '1h', 'Token expiry incorrect');
      assert(refreshResponse.body.access_token !== originalAccessToken, 'New token should be different');

      this.log('✓ Token refresh successful', 'success');
      return { success: true, refreshToken, newAccessToken: refreshResponse.body.access_token };
    } catch (error) {
      this.log(`✗ Token refresh failed: ${error.message}`, 'error');
      return { success: false, error: error.message };
    }
  }

  async testInvalidTokenRefresh() {
    this.log('Testing invalid token refresh scenarios...', 'section');
    
    try {
      // Test with invalid token
      await request(this.app)
        .post('/api/refresh')
        .send({ refresh_token: 'invalid.token.here' })
        .expect(403);

      // Test with missing token
      await request(this.app)
        .post('/api/refresh')
        .send({})
        .expect(400);

      // Test with expired token (simulate by creating one with past expiry)
      const expiredToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6InRlc3QiLCJpYXQiOjE2MDAwMDAwMDAsImV4cCI6MTYwMDAwMDAwMX0.invalid';
      await request(this.app)
        .post('/api/refresh')
        .send({ refresh_token: expiredToken })
        .expect(403);

      this.log('✓ Invalid token refresh scenarios handled correctly', 'success');
      return { success: true };
    } catch (error) {
      this.log(`✗ Invalid token refresh test failed: ${error.message}`, 'error');
      return { success: false, error: error.message };
    }
  }

  async testLogout() {
    this.log('Testing user logout...', 'section');
    
    try {
      // Register a user and get tokens
      const userData = {
        email: `logout-test-${uuidv4()}@example.com`,
          password: 'MyVerySecureP@ssw0rd2024!'
      };

      const registerResponse = await request(this.app)
        .post('/api/register')
        .send(userData)
        .expect(201);

      const refreshToken = registerResponse.body.data.refresh_token;

      // Test logout
      const logoutResponse = await request(this.app)
        .post('/api/logout')
        .send({ refresh_token: refreshToken })
        .expect(200);

      assert(logoutResponse.body.message === 'Logged out successfully', 'Logout message incorrect');

      // Try to use the refresh token after logout (should fail)
      await request(this.app)
        .post('/api/refresh')
        .send({ refresh_token: refreshToken })
        .expect(403);

      this.log('✓ User logout successful', 'success');
      return { success: true };
    } catch (error) {
      this.log(`✗ User logout failed: ${error.message}`, 'error');
      return { success: false, error: error.message };
    }
  }

  async testUserProfile() {
    this.log('Testing user profile endpoint...', 'section');
    
    try {
      // Register a user and get tokens
      const userData = {
        email: `profile-test-${uuidv4()}@example.com`,
        password: 'MyVerySecureP@ssw0rd2024!',
        first_name: 'Profile',
        last_name: 'Test'
      };

      const registerResponse = await request(this.app)
        .post('/api/register')
        .send(userData)
        .expect(201);

      const accessToken = registerResponse.body.data.access_token;

      // Test profile endpoint with valid token
      const profileResponse = await request(this.app)
        .get('/api/profile')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      assert(profileResponse.body.data.user.email === userData.email, 'Profile email mismatch');
      assert(profileResponse.body.data.user.first_name === userData.first_name, 'Profile first name mismatch');
      assert(!profileResponse.body.data.user.password, 'Password should not be returned in profile');

      // Test profile endpoint without token
      await request(this.app)
        .get('/api/profile')
        .expect(401);

      // Test profile endpoint with invalid token
      await request(this.app)
        .get('/api/profile')
        .set('Authorization', 'Bearer invalid.token.here')
        .expect(403);

      this.log('✓ User profile endpoint working correctly', 'success');
      return { success: true };
    } catch (error) {
      this.log(`✗ User profile test failed: ${error.message}`, 'error');
      return { success: false, error: error.message };
    }
  }

  async testTokenExpiry() {
    this.log('Testing token expiry behavior...', 'section');
    
    try {
      // This test would require mocking JWT to create expired tokens
      // For now, we'll test the basic validation logic
      
      const userData = {
        email: `expiry-test-${uuidv4()}@example.com`,
          password: 'MyVerySecureP@ssw0rd2024!'
      };

      const registerResponse = await request(this.app)
        .post('/api/register')
        .send(userData)
        .expect(201);

      const accessToken = registerResponse.body.data.access_token;
      
      // Verify token structure (should be a valid JWT)
      const tokenParts = accessToken.split('.');
      assert(tokenParts.length === 3, 'Access token should have 3 parts');
      
      // Decode and check token content
      const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
      assert(payload.id, 'Token should contain user ID');
      assert(payload.email === userData.email, 'Token should contain user email');
      assert(payload.exp, 'Token should have expiration');
      assert(payload.iat, 'Token should have issued at');

      this.log('✓ Token structure and content validation passed', 'success');
      return { success: true };
    } catch (error) {
      this.log(`✗ Token expiry test failed: ${error.message}`, 'error');
      return { success: false, error: error.message };
    }
  }

  async runAllTests() {
    this.log('🚀 Starting Authentication Test Suite', 'section');
    
    const setupSuccess = await this.setup();
    if (!setupSuccess) {
      this.log('Setup failed, aborting tests', 'error');
      return false;
    }

    const tests = [
      { name: 'User Registration', method: 'testUserRegistration' },
      { name: 'User Login', method: 'testUserLogin' },
      { name: 'Invalid Login', method: 'testInvalidLogin' },
      { name: 'Token Refresh', method: 'testTokenRefresh' },
      { name: 'Invalid Token Refresh', method: 'testInvalidTokenRefresh' },
      { name: 'User Logout', method: 'testLogout' },
      { name: 'User Profile', method: 'testUserProfile' },
      { name: 'Token Expiry', method: 'testTokenExpiry' }
    ];

    let passedTests = 0;
    let totalTests = tests.length;

    for (const test of tests) {
      try {
        this.log(`Running ${test.name}...`);
        const result = await this[test.method]();
        
        if (result.success) {
          passedTests++;
          this.testResults.push({ name: test.name, status: 'passed' });
        } else {
          this.testResults.push({ name: test.name, status: 'failed', error: result.error });
        }
      } catch (error) {
        this.log(`Test ${test.name} threw an error: ${error.message}`, 'error');
        this.testResults.push({ name: test.name, status: 'error', error: error.message });
      }
    }

    await this.cleanup();
    this.printSummary(passedTests, totalTests);
    return passedTests === totalTests;
  }

  printSummary(passed, total) {
    this.log('📊 Authentication Test Results Summary', 'section');
    
    this.testResults.forEach(result => {
      const status = result.status === 'passed' ? '✅' : '❌';
      const errorMsg = result.error ? ` (${result.error})` : '';
      this.log(`${status} ${result.name}${errorMsg}`);
    });

    const successRate = ((passed / total) * 100).toFixed(1);
    this.log(`\n🎯 Results: ${passed}/${total} tests passed (${successRate}%)`, 
             passed === total ? 'success' : 'error');
    
    if (passed === total) {
      this.log('🎉 All authentication tests passed!', 'success');
    } else {
      this.log(`❌ ${total - passed} test(s) failed`, 'error');
    }
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  const authTest = new AuthTest();
  authTest.runAllTests()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('Test suite failed:', error);
      process.exit(1);
    });
}

module.exports = AuthTest;
