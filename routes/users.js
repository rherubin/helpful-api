const express = require('express');
const { authenticateToken } = require('../middleware/auth');

function createUserRoutes(userModel, authService, pairingService) {
  const router = express.Router();

  // Create user
  router.post('/', async (req, res) => {
    try {
      const { email, password } = req.body;

      // Validation
      if (!email || !password) {
        return res.status(400).json({ 
          error: 'Email and password are required' 
        });
      }

      // Email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ 
          error: 'Invalid email format' 
        });
      }

      const user = await userModel.createUser({ email, password });
      
      // Automatically create a pairing request for the new user
      let pairingCode = null;
      try {
        const pairingResult = await pairingService.requestPairing(user.id);
        pairingCode = pairingResult.partner_code;
      } catch (pairingError) {
        // Log the pairing error but don't fail user creation
        console.warn('Failed to create automatic pairing request for new user:', pairingError.message);
      }
      
      // Issue tokens for the new user
      const tokenPayload = await authService.issueTokensForUser(user);
      // Set Authorization header for convenience
      res.set('Authorization', `Bearer ${tokenPayload.access_token}`);
      
      // Extract user data and exclude max_pairings and created_at
      const { max_pairings, created_at, ...filteredUser } = tokenPayload.user;
      
      const response = {
        message: 'Account created successfully',
        user: filteredUser,
        access_token: tokenPayload.access_token,
        refresh_token: tokenPayload.refresh_token,
        expires_in: tokenPayload.expires_in,
        refresh_expires_in: tokenPayload.refresh_expires_in
      };
      
      // Include pairing code in response if it was successfully created
      if (pairingCode) {
        response.pairing_code = pairingCode;
      }
      
      res.status(201).json(response);
    } catch (error) {
      if (error.message === 'Email already exists') {
        return res.status(409).json({ error: error.message });
      } else if (error.message.includes('Password must')) {
        return res.status(400).json({ error: error.message });
      } else {
        return res.status(500).json({ error: 'Failed to create user' });
      }
    }
  });

  // Get user by ID
  router.get('/:id', authenticateToken, async (req, res) => {
    try {
      const { id } = req.params;
      const user = await userModel.getUserById(id);
      res.status(200).json(user);
    } catch (error) {
      if (error.message === 'User not found') {
        return res.status(404).json({ error: error.message });
      } else {
        return res.status(500).json({ error: 'Failed to fetch user' });
      }
    }
  });


  // Soft delete user
  router.delete('/:id', authenticateToken, async (req, res) => {
    try {
      const { id } = req.params;
      
      // Get the pairing model from the userModel if available
      const pairingModel = req.app.locals.pairingModel;
      
      const result = await userModel.softDeleteUser(id, pairingModel);
      res.status(200).json(result);
    } catch (error) {
      if (error.message === 'User not found or already deleted') {
        return res.status(404).json({ error: error.message });
      } else {
        return res.status(500).json({ error: 'Failed to delete user' });
      }
    }
  });

  // Restore soft deleted user
  router.patch('/:id/restore', authenticateToken, async (req, res) => {
    try {
      const { id } = req.params;
      const result = await userModel.restoreUser(id);
      res.status(200).json(result);
    } catch (error) {
      if (error.message === 'User not found or not deleted') {
        return res.status(404).json({ error: error.message });
      } else {
        return res.status(500).json({ error: 'Failed to restore user' });
      }
    }
  });

  // Update user
  router.put('/:id', authenticateToken, async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      
      // Users can only update their own profile
      if (id !== userId) {
        return res.status(403).json({ error: 'Not authorized to update this user' });
      }

      const { email, user_name, partner_name, children } = req.body;
      
      // Validate email format if provided
      if (email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          return res.status(400).json({ 
            error: 'Invalid email format' 
          });
        }
      }

      const updatedUser = await userModel.updateUser(id, {
        email,
        user_name,
        partner_name,
        children
      });

      res.status(200).json({
        message: 'User updated successfully',
        user: updatedUser
      });
    } catch (error) {
      if (error.message === 'User not found') {
        return res.status(404).json({ error: error.message });
      } else if (error.message === 'Email already exists') {
        return res.status(409).json({ error: error.message });
      } else if (error.message.includes('Children must be')) {
        return res.status(400).json({ error: error.message });
      } else {
        console.error('Error updating user:', error.message);
        return res.status(500).json({ error: 'Failed to update user' });
      }
    }
  });

  // Get deleted users (admin endpoint)
  router.get('/deleted/all', authenticateToken, async (req, res) => {
    try {
      const deletedUsers = await userModel.getDeletedUsers();
      res.json(deletedUsers);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch deleted users' });
    }
  });

  return router;
}

module.exports = createUserRoutes; 