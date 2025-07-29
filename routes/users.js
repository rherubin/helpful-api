const express = require('express');
const { authenticateToken } = require('../middleware/auth');

function createUserRoutes(userModel, authService) {
  const router = express.Router();

  // Create user
  router.post('/', async (req, res) => {
    try {
      const { email, first_name, last_name, password } = req.body;

      // Validation
      if (!email || !first_name || !last_name || !password) {
        return res.status(400).json({ 
          error: 'Email, first_name, last_name, and password are required' 
        });
      }

      // Email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ 
          error: 'Invalid email format' 
        });
      }

      const user = await userModel.createUser({ email, first_name, last_name, password });
      res.status(201).json(user);
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

  // Get all users
  router.get('/', async (req, res) => {
    try {
      const users = await userModel.getAllUsers();
      res.json(users);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch users' });
    }
  });

  // Get user by ID (public endpoint)
  router.get('/:id', async (req, res) => {
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

  // Update user
  router.put('/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const { first_name, last_name, email } = req.body;

      // Validation
      if (!first_name && !last_name && !email) {
        return res.status(400).json({ 
          error: 'At least one field (first_name, last_name, or email) is required' 
        });
      }

      // Email validation if provided
      if (email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          return res.status(400).json({ 
            error: 'Invalid email format' 
          });
        }
      }

      const updatedUser = await userModel.updateUser(id, { first_name, last_name, email });
      
      // Return user data (excluding password hash)
      const { password_hash, ...userData } = updatedUser;
      res.status(200).json({
        message: 'User updated successfully',
        user: userData
      });
    } catch (error) {
      if (error.message === 'User not found') {
        return res.status(404).json({ error: error.message });
      } else if (error.message === 'Email already exists') {
        return res.status(409).json({ error: error.message });
      } else {
        return res.status(500).json({ error: 'Failed to update user' });
      }
    }
  });

  return router;
}

module.exports = createUserRoutes; 