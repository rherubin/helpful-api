const express = require('express');
const { authenticateToken } = require('../middleware/auth');

function createAuthRoutes(authService) {
  const router = express.Router();

  // Login endpoint
  router.post('/login', async (req, res) => {
    try {
      const { email, password } = req.body;

      // Validation
      if (!email || !password) {
        return res.status(400).json({ 
          error: 'Email and password are required' 
        });
      }

      const result = await authService.login(email, password);
      res.status(200).json(result);
    } catch (error) {
      if (error.message === 'User not found' || error.message === 'Invalid email or password') {
        return res.status(401).json({ error: 'Invalid email or password' });
      } else {
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

  // Get authenticated user profile
  router.get('/profile', authenticateToken, async (req, res) => {
    try {
      const authHeader = req.headers['authorization'];
      const token = authHeader && authHeader.split(' ')[1];
      
      const result = await authService.getProfileFromToken(token);
      res.status(200).json(result);
    } catch (error) {
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