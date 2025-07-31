const express = require('express');
const { authenticateToken } = require('../middleware/auth');

function createPairingRoutes(pairingService) {
  const router = express.Router();

  // Request a pairing with another user
  router.post('/request', authenticateToken, async (req, res) => {
    try {
      const { pairing_code } = req.body;
      const requestingUserId = req.user.id;

      if (!pairing_code) {
        return res.status(400).json({ error: 'Pairing code is required' });
      }

      const result = await pairingService.requestPairing(requestingUserId, pairing_code);
      res.status(201).json(result);
    } catch (error) {
      if (error.message === 'User not found') {
        return res.status(404).json({ error: 'User with this pairing code not found' });
      } else if (error.message === 'Cannot pair with yourself') {
        return res.status(400).json({ error: error.message });
      } else if (error.message === 'Pairing already exists') {
        return res.status(409).json({ error: error.message });
      } else if (error.message.includes('reached your maximum number of pairings')) {
        return res.status(400).json({ error: error.message });
      } else if (error.message.includes('Target user has reached their maximum number of pairings')) {
        return res.status(400).json({ error: error.message });
      } else {
        return res.status(500).json({ error: 'Failed to request pairing' });
      }
    }
  });

  // Accept a pairing request
  router.post('/accept/:pairingId', authenticateToken, async (req, res) => {
    try {
      const { pairingId } = req.params;
      const userId = req.user.id;

      const result = await pairingService.acceptPairing(userId, pairingId);
      res.status(200).json(result);
    } catch (error) {
      if (error.message === 'Pairing not found') {
        return res.status(404).json({ error: error.message });
      } else if (error.message === 'You are not authorized to accept this pairing') {
        return res.status(403).json({ error: error.message });
      } else if (error.message === 'Pairing request has already been processed') {
        return res.status(400).json({ error: error.message });
      } else if (error.message.includes('reached your maximum number of pairings')) {
        return res.status(400).json({ error: error.message });
      } else {
        return res.status(500).json({ error: 'Failed to accept pairing' });
      }
    }
  });

  // Reject a pairing request
  router.post('/reject/:pairingId', authenticateToken, async (req, res) => {
    try {
      const { pairingId } = req.params;
      const userId = req.user.id;

      const result = await pairingService.rejectPairing(userId, pairingId);
      res.status(200).json(result);
    } catch (error) {
      if (error.message === 'Pairing not found') {
        return res.status(404).json({ error: error.message });
      } else if (error.message === 'You are not authorized to reject this pairing') {
        return res.status(403).json({ error: error.message });
      } else if (error.message === 'Pairing request has already been processed') {
        return res.status(400).json({ error: error.message });
      } else {
        return res.status(500).json({ error: 'Failed to reject pairing' });
      }
    }
  });

  // Get user's pairings
  router.get('/', authenticateToken, async (req, res) => {
    try {
      const userId = req.user.id;
      const result = await pairingService.getUserPairings(userId);
      res.status(200).json(result);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to fetch pairings' });
    }
  });

  // Get user's pending pairings
  router.get('/pending', authenticateToken, async (req, res) => {
    try {
      const userId = req.user.id;
      const result = await pairingService.getPendingPairings(userId);
      res.status(200).json(result);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to fetch pending pairings' });
    }
  });

  // Get user's accepted pairings
  router.get('/accepted', authenticateToken, async (req, res) => {
    try {
      const userId = req.user.id;
      const result = await pairingService.getAcceptedPairings(userId);
      res.status(200).json(result);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to fetch accepted pairings' });
    }
  });

  // Get user's pairing statistics
  router.get('/stats', authenticateToken, async (req, res) => {
    try {
      const userId = req.user.id;
      const result = await pairingService.getUserPairingStats(userId);
      res.status(200).json(result);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to fetch pairing statistics' });
    }
  });

  // Get pairing details
  router.get('/:pairingId', authenticateToken, async (req, res) => {
    try {
      const { pairingId } = req.params;
      const result = await pairingService.getPairingDetails(pairingId);
      res.status(200).json(result);
    } catch (error) {
      if (error.message === 'Pairing not found') {
        return res.status(404).json({ error: error.message });
      } else {
        return res.status(500).json({ error: 'Failed to fetch pairing details' });
      }
    }
  });

  // Soft delete a pairing
  router.delete('/:pairingId', authenticateToken, async (req, res) => {
    try {
      const { pairingId } = req.params;
      const userId = req.user.id;

      // First check if user is part of this pairing
      const pairing = await pairingService.getPairingDetails(pairingId);
      if (pairing.user1_id !== userId && pairing.user2_id !== userId) {
        return res.status(403).json({ error: 'You are not authorized to delete this pairing' });
      }

      // Get the pairing model from the service
      const pairingModel = pairingService.pairingModel;
      const result = await pairingModel.softDeletePairing(pairingId);
      res.status(200).json(result);
    } catch (error) {
      if (error.message === 'Pairing not found' || error.message === 'Pairing not found or already deleted') {
        return res.status(404).json({ error: 'Pairing not found' });
      } else {
        return res.status(500).json({ error: 'Failed to delete pairing' });
      }
    }
  });

  // Restore a soft deleted pairing (admin endpoint - could be restricted further)
  router.patch('/:pairingId/restore', authenticateToken, async (req, res) => {
    try {
      const { pairingId } = req.params;
      
      // Get the pairing model from the service
      const pairingModel = pairingService.pairingModel;
      const result = await pairingModel.restorePairing(pairingId);
      res.status(200).json(result);
    } catch (error) {
      if (error.message === 'Pairing not found or not deleted') {
        return res.status(404).json({ error: error.message });
      } else {
        return res.status(500).json({ error: 'Failed to restore pairing' });
      }
    }
  });

  // Get deleted pairings (admin endpoint)
  router.get('/deleted/all', authenticateToken, async (req, res) => {
    try {
      // Get the pairing model from the service
      const pairingModel = pairingService.pairingModel;
      const deletedPairings = await pairingModel.getDeletedPairings();
      res.json(deletedPairings);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch deleted pairings' });
    }
  });

  return router;
}

module.exports = createPairingRoutes; 