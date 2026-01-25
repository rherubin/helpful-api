class PairingService {
  constructor(userModel, pairingModel) {
    this.userModel = userModel;
    this.pairingModel = pairingModel;
  }

  // Request a pairing (new flow - creates partner code)
  async requestPairing(requestingUserId) {
    try {
      // Get the requesting user
      const requestingUser = await this.userModel.getUserById(requestingUserId);
      
      // Check if requesting user has reached their max pairings
      const requestingUserPairings = await this.pairingModel.countAcceptedPairings(requestingUserId);
      if (requestingUserPairings >= requestingUser.max_pairings) {
        throw new Error('You have reached your maximum number of pairings');
      }

      // Check if user already has a pending partner code request
      const existingPendingRequest = await this.pairingModel.getUserPairings(requestingUserId);
      const hasPendingPartnerCode = existingPendingRequest.some(p => 
        p.status === 'pending' && p.partner_code && !p.user2_id
      );
      
      if (hasPendingPartnerCode) {
        const pendingRequest = existingPendingRequest.find(p =>
          p.status === 'pending' && p.partner_code && !p.user2_id
        );

        if (pendingRequest) {
          return {
            message: 'Existing partner code retrieved successfully.',
            partner_code: pendingRequest.partner_code,
            pairing_id: pendingRequest.id,
            requester: {
              id: requestingUser.id,
              user_name: requestingUser.user_name,
              email: requestingUser.email
            },
            expires_note: 'This partner code is valid until someone uses it or you cancel the request.'
          };
        }
      }


      
      // Create the pairing request with partner code
      const pairing = await this.pairingModel.createPairingWithPartnerCode(requestingUserId);
      
      return {
        message: 'Partner code generated successfully. Share this code with someone to pair with you.',
        partner_code: pairing.partner_code,
        pairing_id: pairing.id,
        requester: {
          id: requestingUser.id,
          user_name: requestingUser.user_name,
          email: requestingUser.email
        },
        expires_note: 'This partner code is valid until someone uses it or you cancel the request.'
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

  // Accept a pairing request by partner code
  async acceptPairingByCode(userId, partnerCode) {
    try {
      // Find the pending pairing with the given partner code
      const pairing = await this.pairingModel.getPendingPairingByPartnerCode(partnerCode);
      
      if (!pairing) {
        throw new Error('No pending pairing found for this partner code');
      }

      // Check if user is trying to accept their own pairing request
      if (pairing.user1_id === userId) {
        throw new Error('You cannot accept your own pairing request');
      }

      // Get the accepting user
      const acceptingUser = await this.userModel.getUserById(userId);
      
      // Check if accepting user has reached their max pairings
      const acceptingUserPairings = await this.pairingModel.countAcceptedPairings(userId);
      if (acceptingUserPairings >= acceptingUser.max_pairings) {
        throw new Error('You have reached your maximum number of pairings');
      }

      // Check if they're already paired
      const existingPairing = await this.pairingModel.checkExistingPairing(pairing.user1_id, userId);
      if (existingPairing && existingPairing.id !== pairing.id) {
        throw new Error('You are already paired with this user');
      }

      // Accept the pairing by partner code
      await this.pairingModel.acceptPairingByPartnerCode(partnerCode, userId);
      
      return {
        message: 'Pairing accepted successfully',
        pairing: {
          id: pairing.id,
          partner_code: partnerCode,
          requester: {
            id: pairing.user1_id,
            user_name: pairing.user1_user_name,
            email: pairing.user1_email
          }
        }
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

  // Get user's pairings (both accepted and pending)
  async getUserPairings(userId) {
    try {
      // Get accepted pairings
      const rawAcceptedPairings = await this.pairingModel.getAcceptedPairings(userId);

      // Get pending pairings
      const rawPendingPairings = await this.pairingModel.getPendingPairings(userId);

      // Combine arrays
      const allPairings = rawAcceptedPairings.concat(rawPendingPairings);

      // Sort by created_at descending (most recent first)
      allPairings.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      // Transform pairings to include partner information
      const transformedPairings = allPairings.map(pairing => {
        // Determine which user is the partner (not the current user)
        const isUser1 = pairing.user1_id === userId;
        const partnerId = isUser1 ? pairing.user2_id : pairing.user1_id;
        const partnerUserName = isUser1 ? pairing.user2_user_name : pairing.user1_user_name;
        const partnerEmail = isUser1 ? pairing.user2_email : pairing.user1_email;

        // For partner code requests where user2 is null, there's no partner yet
        const partner = partnerId ? {
          id: partnerId,
          user_name: partnerUserName,
          email: partnerEmail
        } : null;

        // Return pairing with partner information (null if no partner yet)
        return {
          id: pairing.id,
          status: pairing.status,
          partner_code: pairing.partner_code,
          premium: pairing.premium,
          created_at: pairing.created_at,
          updated_at: pairing.updated_at,
          partner: partner
        };
      });

      return {
        message: 'User pairings retrieved successfully',
        pairings: transformedPairings
      };
    } catch (error) {
      throw error;
    }
  }

  // Get user's pending pairings
  async getPendingPairings(userId) {
    try {
      const rawPairings = await this.pairingModel.getPendingPairings(userId);
      
      // Transform pairings to only include partner information (not current user)
      const pairings = rawPairings.map(pairing => {
        // Determine which user is the partner (not the current user)
        const isUser1 = pairing.user1_id === userId;
        const partnerId = isUser1 ? pairing.user2_id : pairing.user1_id;
        const partnerUserName = isUser1 ? pairing.user2_user_name : pairing.user1_user_name;
        const partnerEmail = isUser1 ? pairing.user2_email : pairing.user1_email;

        // For partner code requests where user2 is null, there's no partner yet
        const partner = partnerId ? {
          id: partnerId,
          user_name: partnerUserName,
          email: partnerEmail
        } : null;

        // Return pairing with partner information (null if no partner yet)
        return {
          id: pairing.id,
          status: pairing.status,
          partner_code: pairing.partner_code,
          premium: pairing.premium,
          created_at: pairing.created_at,
          updated_at: pairing.updated_at,
          partner: partner
        };
      });
      
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
      const rawPairings = await this.pairingModel.getAcceptedPairings(userId);
      
      // Transform pairings to only include partner information (not current user)
      const pairings = rawPairings.map(pairing => {
        // Determine which user is the partner (not the current user)
        const isUser1 = pairing.user1_id === userId;
        const partnerId = isUser1 ? pairing.user2_id : pairing.user1_id;
        const partnerUserName = isUser1 ? pairing.user2_user_name : pairing.user1_user_name;
        const partnerEmail = isUser1 ? pairing.user2_email : pairing.user1_email;
        
        // Return pairing with only partner information
        return {
          id: pairing.id,
          status: pairing.status,
          partner_code: pairing.partner_code,
          premium: pairing.premium,
          created_at: pairing.created_at,
          updated_at: pairing.updated_at,
          partner: {
            id: partnerId,
            user_name: partnerUserName,
            email: partnerEmail
          }
        };
      });
      
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