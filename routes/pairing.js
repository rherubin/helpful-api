const express = require('express');
const { createAuthenticateToken } = require('../middleware/auth');

function createPairingRoutes(pairingService, authService, pushNotificationService = null, userModel = null, pairingModel = null) {
  const router = express.Router();
  const authenticateToken = createAuthenticateToken(authService);

  // Request a pairing (generates partner code)
  router.post('/request', authenticateToken, async (req, res) => {
    try {
      const requestingUserId = req.user.id;

      const result = await pairingService.requestPairing(requestingUserId);
      res.status(201).json(result);
    } catch (error) {
      if (error.message.includes('reached your maximum number of pairings')) {
        return res.status(400).json({ error: error.message });
      } else if (error.message.includes('already have a pending pairing request')) {
        return res.status(409).json({ error: error.message });
      } else {
        return res.status(500).json({ error: 'Failed to request pairing' });
      }
    }
  });

  // Accept a pairing request
  router.post('/accept', authenticateToken, async (req, res) => {
    try {
      const { partner_code } = req.body;
      const userId = req.user.id;

      if (!partner_code) {
        return res.status(400).json({ error: 'Partner code is required' });
      }

      // Capture the requester's ID before the accept changes the pairing status.
      // Only needed for the fire-and-forget push notification below; if pairingModel
      // wasn't wired (shouldn't happen in production), the notification is skipped.
      let requesterId = null;
      if (pairingModel) {
        try {
          const pending = await pairingModel.getPendingPairingByPartnerCode(partner_code);
          if (pending) requesterId = pending.user1_id;
        } catch { /* non-fatal — push is best-effort */ }
      }

      await pairingService.acceptPairingByCode(userId, partner_code);
      res.status(200).end();

      // Notify the original requester that someone accepted their invite (fire-and-forget).
      if (requesterId && pushNotificationService) {
        const namePromise = userModel
          ? userModel.getUserById(userId).then(u => u?.user_name || 'Someone').catch(() => 'Someone')
          : Promise.resolve('Someone');
        namePromise
          .then(name => pushNotificationService.sendToUser(requesterId, {
            title: 'Pairing accepted!',
            body: `${name} accepted your pairing request.`,
            data: { kind: 'pairing_accepted' }
          }))
          .catch(err => console.warn('[push] pairing_accepted failed:', err.message));
      }
    } catch (error) {
      if (error.message === 'No pending pairing found for this partner code') {
        return res.status(404).json({ error: error.message });
      } else if (error.message === 'You cannot accept your own pairing request') {
        return res.status(400).json({ error: error.message });
      } else if (error.message === 'You are already paired with this user') {
        return res.status(409).json({ error: error.message });
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
      console.error('Error getting pairings:', error.message);
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

      // getPairingDetails returns { message, pairing } — authz uses the inner record.
      const details = await pairingService.getPairingDetails(pairingId);
      const pairing = details.pairing || details;
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

  // Restore a soft deleted pairing
  router.patch('/:pairingId/restore', authenticateToken, async (req, res) => {
    try {
      const { pairingId } = req.params;
      
      // Get the pairing model from the service
      const pairingModel = pairingService.pairingModel;
      const pairing = await pairingModel.getPairingByIdIncludingDeleted(pairingId);
      if (!pairing.deleted_at) {
        return res.status(404).json({ error: 'Pairing not found or not deleted' });
      }

      // Restoring an accepted pairing must not push either member over max_pairings
      // (e.g. after cascade soft-delete freed a slot and they rematched).
      if (pairing.status === 'accepted' && userModel) {
        for (const memberId of [pairing.user1_id, pairing.user2_id].filter(Boolean)) {
          let member;
          try {
            member = await userModel.getUserById(memberId);
          } catch (memberError) {
            if (memberError.message === 'User not found') {
              return res.status(400).json({
                error: 'Cannot restore pairing: a member account is deleted'
              });
            }
            throw memberError;
          }
          const acceptedCount = await pairingModel.countAcceptedPairings(memberId);
          if (acceptedCount >= member.max_pairings) {
            return res.status(400).json({
              error: 'Cannot restore pairing: a member has reached their maximum number of pairings'
            });
          }
        }
      }

      const result = await pairingModel.restorePairing(pairingId);
      res.status(200).json(result);
    } catch (error) {
      if (error.message === 'Pairing not found' || error.message === 'Pairing not found or not deleted') {
        return res.status(404).json({ error: error.message });
      } else {
        return res.status(500).json({ error: 'Failed to restore pairing' });
      }
    }
  });

  // Get deleted pairings (admin-only — regular user JWTs never carry type=admin)
  router.get('/deleted/all', authenticateToken, async (req, res) => {
    try {
      if (req.user?.type !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }
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