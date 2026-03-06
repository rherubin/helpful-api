const express = require('express');
const { createAuthenticateToken } = require('../middleware/auth');
const { userUpdateLimiter } = require('../middleware/security');

// Helper function to filter sensitive fields from user objects
function filterUserData(user) {
  if (!user) return null;
  // Remove password_hash, is_premium (returned as computed `premium`), and premium
  const { password_hash, premium, is_premium, ...filteredUser } = user;
  return filteredUser;
}

function createUserRoutes(userModel, authService, pairingService, orgCodeModel) {
  const router = express.Router();
  const authenticateToken = createAuthenticateToken(authService);

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

      const createdUser = await userModel.createUser({ email, password });

      // Get the complete user object for token generation
      const user = await userModel.getUserById(createdUser.id);

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

      // Get user's pairings
      let pairings = [];
      try {
        const pairingsResult = await pairingService.getUserPairings(user.id);
        pairings = pairingsResult.pairings || [];
      } catch (pairingError) {
        // Log the error but don't fail user creation
        console.warn('Failed to fetch pairings for new user:', pairingError.message);
      }

      // Filter out sensitive fields for the response
      const filteredUser = filterUserData(user);

      // New users can't have premium pairings yet, so premium is always false
      // Explicitly set as boolean to ensure iOS/Swift compatibility
      const userWithPremium = {
        ...filteredUser,
        premium: false
      };

      const response = {
        message: 'Account created successfully',
        user: userWithPremium,
        access_token: tokenPayload.access_token,
        refresh_token: tokenPayload.refresh_token,
        expires_in: tokenPayload.expires_in,
        refresh_expires_in: tokenPayload.refresh_expires_in,
        pairings: pairings
      };

      // Include pairing code in response if it was successfully created
      if (pairingCode) {
        response.pairing_code = pairingCode;
      }

      res.status(201).json(response);
    } catch (error) {
      if (error.message === 'Email already exists') {
        return res.status(409).json({ error: error.message });
      } else if (error.message.includes('Password must') || error.message.includes('Password contains')) {
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

      // Check if user has premium access via pairings or direct org_code assignment
      const hasPremiumPairing = await pairingService.pairingModel.userHasPremiumPairing(id);

      const userWithPremium = {
        ...filterUserData(user),
        premium: hasPremiumPairing || !!user.is_premium
      };

      res.status(200).json(userWithPremium);
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
  router.put('/:id', userUpdateLimiter, authenticateToken, async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      
      // Users can only update their own profile
      if (id !== userId) {
        return res.status(403).json({ error: 'Not authorized to update this user' });
      }

      const { email, user_name, partner_name, children, org_code, org_name, org_city, org_state } = req.body;
      
      // Validate email format if provided
      if (email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          return res.status(400).json({ 
            error: 'Invalid email format' 
          });
        }
      }

      const updateData = { email, user_name, partner_name, children };

      // Validate org_code if provided and grant premium status on success
      if (org_code !== undefined) {
        if (!orgCodeModel) {
          return res.status(500).json({ error: 'Org code validation unavailable' });
        }

        let resolvedOrgCode;
        try {
          resolvedOrgCode = await orgCodeModel.getOrgCodeByCode(org_code);
        } catch (err) {
          return res.status(400).json({ error: 'Invalid org code' });
        }

        // Reject expired org codes
        if (resolvedOrgCode.expires_at && new Date(resolvedOrgCode.expires_at) <= new Date()) {
          return res.status(400).json({ error: 'Org code has expired' });
        }

        updateData.org_code_id = resolvedOrgCode.id;
        updateData.is_premium = true;
      } else if (org_name && org_city && org_state) {
        // No org_code provided but all 3 org details present — create a new org record
        if (!orgCodeModel) {
          return res.status(500).json({ error: 'Org code service unavailable' });
        }

        const generatedCode = `ORG-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
        const newOrgCode = await orgCodeModel.createOrgCode({
          org_code: generatedCode,
          organization: org_name,
          city: org_city,
          state: org_state
        });

        updateData.org_code_id = newOrgCode.id;
        updateData.is_premium = true;
      }

      const updatedUser = await userModel.updateUser(id, updateData);

      // Compute premium status (org_code assignment or premium pairing)
      const hasPremiumPairing = await pairingService.pairingModel.userHasPremiumPairing(id);

      // Fetch org details to include in response
      let orgDetails = { org_name: null, org_city: null, org_state: null };
      if (updatedUser.org_code_id && orgCodeModel) {
        try {
          const orgCode = await orgCodeModel.getOrgCodeById(updatedUser.org_code_id);
          orgDetails = {
            org_name: orgCode.organization || null,
            org_city: orgCode.city || null,
            org_state: orgCode.state || null
          };
        } catch (err) {
          // Non-fatal — org code may have been deleted; leave fields null
        }
      }

      const userWithPremium = {
        ...filterUserData(updatedUser),
        premium: hasPremiumPairing || !!updatedUser.is_premium,
        ...orgDetails
      };

      res.status(200).json({
        message: 'User updated successfully',
        user: userWithPremium
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
      res.json(deletedUsers.map(filterUserData));
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch deleted users' });
    }
  });

  return router;
}

module.exports = createUserRoutes; 