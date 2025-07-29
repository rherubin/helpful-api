class PairingService {
  constructor(userModel, pairingModel) {
    this.userModel = userModel;
    this.pairingModel = pairingModel;
  }

  // Request a pairing with another user
  async requestPairing(requestingUserId, targetPairingCode) {
    try {
      // Get the requesting user
      const requestingUser = await this.userModel.getUserById(requestingUserId);
      
      // Get the target user by pairing code
      const targetUser = await this.userModel.getUserByPairingCode(targetPairingCode);
      
      // Check if users are trying to pair with themselves
      if (requestingUserId === targetUser.id) {
        throw new Error('Cannot pair with yourself');
      }

      // Check if pairing already exists
      const existingPairing = await this.pairingModel.checkExistingPairing(requestingUserId, targetUser.id);
      if (existingPairing) {
        throw new Error('Pairing already exists');
      }

      // Check if requesting user has reached their max pairings
      const requestingUserPairings = await this.pairingModel.countAcceptedPairings(requestingUserId);
      if (requestingUserPairings >= requestingUser.max_pairings) {
        throw new Error('You have reached your maximum number of pairings');
      }

      // Check if target user has reached their max pairings
      const targetUserPairings = await this.pairingModel.countAcceptedPairings(targetUser.id);
      if (targetUserPairings >= targetUser.max_pairings) {
        throw new Error('Target user has reached their maximum number of pairings');
      }

      // Create the pairing request
      const pairing = await this.pairingModel.createPairing(requestingUserId, targetUser.id);
      
      return {
        message: 'Pairing request sent successfully',
        pairing: pairing,
        target_user: {
          id: targetUser.id,
          first_name: targetUser.first_name,
          last_name: targetUser.last_name,
          email: targetUser.email
        }
      };
    } catch (error) {
      throw error;
    }
  }

  // Accept a pairing request
  async acceptPairing(userId, pairingId) {
    try {
      // Get the pairing
      const pairing = await this.pairingModel.getPairingById(pairingId);
      
      // Check if the user is part of this pairing
      if (pairing.user1_id !== userId && pairing.user2_id !== userId) {
        throw new Error('You are not authorized to accept this pairing');
      }

      // Check if the pairing is already processed
      if (pairing.status !== 'pending') {
        throw new Error('Pairing request has already been processed');
      }

      // Get the accepting user
      const acceptingUser = await this.userModel.getUserById(userId);
      
      // Check if accepting user has reached their max pairings
      const acceptingUserPairings = await this.pairingModel.countAcceptedPairings(userId);
      if (acceptingUserPairings >= acceptingUser.max_pairings) {
        throw new Error('You have reached your maximum number of pairings');
      }

      // Accept the pairing
      await this.pairingModel.acceptPairing(pairingId);
      
      return {
        message: 'Pairing accepted successfully',
        pairing_id: pairingId
      };
    } catch (error) {
      throw error;
    }
  }

  // Reject a pairing request
  async rejectPairing(userId, pairingId) {
    try {
      // Get the pairing
      const pairing = await this.pairingModel.getPairingById(pairingId);
      
      // Check if the user is part of this pairing
      if (pairing.user1_id !== userId && pairing.user2_id !== userId) {
        throw new Error('You are not authorized to reject this pairing');
      }

      // Check if the pairing is already processed
      if (pairing.status !== 'pending') {
        throw new Error('Pairing request has already been processed');
      }

      // Reject the pairing
      await this.pairingModel.rejectPairing(pairingId);
      
      return {
        message: 'Pairing rejected successfully',
        pairing_id: pairingId
      };
    } catch (error) {
      throw error;
    }
  }

  // Get user's pairings
  async getUserPairings(userId) {
    try {
      const pairings = await this.pairingModel.getUserPairings(userId);
      
      return {
        message: 'User pairings retrieved successfully',
        pairings: pairings
      };
    } catch (error) {
      throw error;
    }
  }

  // Get user's pending pairings
  async getPendingPairings(userId) {
    try {
      const pairings = await this.pairingModel.getPendingPairings(userId);
      
      return {
        message: 'Pending pairings retrieved successfully',
        pairings: pairings
      };
    } catch (error) {
      throw error;
    }
  }

  // Get user's accepted pairings
  async getAcceptedPairings(userId) {
    try {
      const pairings = await this.pairingModel.getAcceptedPairings(userId);
      
      return {
        message: 'Accepted pairings retrieved successfully',
        pairings: pairings
      };
    } catch (error) {
      throw error;
    }
  }

  // Get pairing details
  async getPairingDetails(pairingId) {
    try {
      const pairing = await this.pairingModel.getPairingById(pairingId);
      
      return {
        message: 'Pairing details retrieved successfully',
        pairing: pairing
      };
    } catch (error) {
      throw error;
    }
  }

  // Get user's pairing statistics
  async getUserPairingStats(userId) {
    try {
      const user = await this.userModel.getUserById(userId);
      const acceptedCount = await this.pairingModel.countAcceptedPairings(userId);
      const pendingPairings = await this.pairingModel.getPendingPairings(userId);
      
      return {
        message: 'User pairing statistics retrieved successfully',
        stats: {
          max_pairings: user.max_pairings,
          current_pairings: acceptedCount,
          available_slots: user.max_pairings - acceptedCount,
          pending_requests: pendingPairings.length
        }
      };
    } catch (error) {
      throw error;
    }
  }
}

module.exports = PairingService; 