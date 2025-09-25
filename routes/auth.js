const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { 
  loginLimiter, 
  isAccountLocked, 
  recordFailedAttempt, 
  clearFailedAttempts,
  getAccountLockInfo,
  securityLogger 
} = require('../middleware/security');

function createAuthRoutes(authService, userModel, pairingService) {
  const router = express.Router();

  // Apply security logging to all auth routes
  router.use(securityLogger);

  // Login endpoint with security measures
  router.post('/login', loginLimiter, async (req, res) => {
    try {
      const { email, password } = req.body;

      // Validation
      if (!email || !password) {
        return res.status(400).json({ 
          error: 'Email and password are required' 
        });
      }

      // Check if account is locked
      if (isAccountLocked(email)) {
        const lockInfo = getAccountLockInfo(email);
        return res.status(423).json({ 
          error: 'Account temporarily locked due to too many failed attempts',
          lockInfo: {
            remainingTime: Math.ceil(lockInfo.remainingTime / 1000 / 60), // minutes
            attemptCount: lockInfo.attemptCount
          }
        });
      }

      const result = await authService.login(email, password);
      
      // Clear failed attempts on successful login
      clearFailedAttempts(email);
      
      res.status(200).json(result);
    } catch (error) {
      if (error.message === 'User not found' || error.message === 'Invalid email or password') {
        // Record failed attempt and check for account lockout
        const { email } = req.body;
        if (email) {
          const isLocked = recordFailedAttempt(email);
          if (isLocked) {
            const lockInfo = getAccountLockInfo(email);
            return res.status(423).json({ 
              error: 'Account locked due to too many failed attempts',
              lockInfo: {
                remainingTime: Math.ceil(lockInfo.remainingTime / 1000 / 60), // minutes
                attemptCount: lockInfo.attemptCount
              }
            });
          }
        }
        return res.status(401).json({ error: 'Invalid email or password' });
      } else {
        console.error('Login error:', error);
        return res.status(500).json({ error: 'Failed to authenticate user' });
      }
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

  // Get user profile with pairings
  router.get('/profile', authenticateToken, async (req, res) => {
    try {
      const userId = req.user.id;
      const user = await userModel.getUserById(userId);
      
      // Get user's pairings (both accepted and pending)
      const pairingsResult = await pairingService.getUserPairings(userId);

      // Extract all pairing codes from the user's pairings
      const pairingCodes = pairingsResult.pairings.map(pairing => pairing.partner_code).filter(code => code);

      const profile = {
        ...user,
        pairings: pairingsResult.pairings,
        pairing_codes: pairingCodes
      };
      
      res.status(200).json({
        message: 'User profile retrieved successfully',
        profile: profile
      });
    } catch (error) {
      console.error('Profile endpoint error:', error.message);
      if (error.message === 'User not found') {
        return res.status(404).json({ error: error.message });
      } else {
        return res.status(500).json({ error: 'Failed to fetch user profile' });
      }
    }
  });

  return router;
}

module.exports = createAuthRoutes; 