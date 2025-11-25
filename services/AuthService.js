const jwt = require('jsonwebtoken');

class AuthService {
  constructor(userModel, refreshTokenModel) {
    this.userModel = userModel;
    this.refreshTokenModel = refreshTokenModel;
    
    // JWT Configuration
    this.JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
    this.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'your-refresh-secret-key-change-in-production';
    this.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h'; // Access token - increased to 24 hours for better UX
    this.JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '14d'; // Long-lived refresh token
    
    // Log token configuration on startup (without exposing secrets)
    console.log('JWT Configuration:', {
      accessTokenExpiry: this.JWT_EXPIRES_IN,
      refreshTokenExpiry: this.JWT_REFRESH_EXPIRES_IN,
      accessTokenSeconds: this.parseExpirationToSeconds(this.JWT_EXPIRES_IN),
      refreshTokenSeconds: this.parseExpirationToSeconds(this.JWT_REFRESH_EXPIRES_IN)
    });
  }

  // Generate and persist tokens for a user, returning token payload plus user data
  async issueTokensForUser(user) {
    const accessToken = this.generateAccessToken(user);
    const refreshToken = this.generateRefreshToken(user.id);
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    await this.refreshTokenModel.createRefreshToken(user.id, refreshToken, expiresAt);
    const { password_hash, ...userData } = user;
    return {
      user: userData,
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: this.parseExpirationToSeconds(this.JWT_EXPIRES_IN),
      refresh_expires_in: this.parseExpirationToSeconds(this.JWT_REFRESH_EXPIRES_IN)
    };
  }

  // Parse expiration string to seconds
  parseExpirationToSeconds(expiration) {
    if (typeof expiration === 'number') return expiration;
    
    const match = expiration.match(/^(\d+)([smhd])$/);
    if (!match) return 3600; // Default to 1 hour
    
    const value = parseInt(match[1]);
    const unit = match[2];
    
    switch (unit) {
      case 's': return value;
      case 'm': return value * 60;
      case 'h': return value * 60 * 60;
      case 'd': return value * 60 * 60 * 24;
      default: return 3600;
    }
  }

  // Generate access token
  generateAccessToken(user) {
    return jwt.sign(
      { 
        id: user.id, 
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name
      }, 
      this.JWT_SECRET, 
      { expiresIn: this.JWT_EXPIRES_IN }
    );
  }

  // Generate refresh token
  generateRefreshToken(userId) {
    return jwt.sign(
      { id: userId },
      this.JWT_REFRESH_SECRET,
      { expiresIn: this.JWT_REFRESH_EXPIRES_IN }
    );
  }

  // Verify access token
  verifyAccessToken(token) {
    return new Promise((resolve, reject) => {
      jwt.verify(token, this.JWT_SECRET, (err, decoded) => {
        if (err) {
          reject(new Error('Invalid or expired token'));
        } else {
          resolve(decoded);
        }
      });
    });
  }

  // Verify refresh token
  verifyRefreshToken(token) {
    return new Promise((resolve, reject) => {
      jwt.verify(token, this.JWT_REFRESH_SECRET, (err, decoded) => {
        if (err) {
          reject(new Error('Invalid or expired refresh token'));
        } else {
          resolve(decoded);
        }
      });
    });
  }

  // Register user (convenience method)
  async register(email, password, first_name = null, last_name = null) {
    try {
      // Check if user already exists
      try {
        await this.userModel.getUserByEmail(email);
        // If we get here, user exists
        throw new Error('User with this email already exists');
      } catch (error) {
        // If error is "User not found", that's what we want - proceed with registration
        if (error.message !== 'User not found') {
          // If it's any other error, re-throw it
          throw error;
        }
      }

      // Create user
      const user = await this.userModel.createUser({ 
        email, 
        first_name, 
        last_name, 
        password 
      });

      // Issue tokens for the new user
      const tokens = await this.issueTokensForUser(user);

      return {
        message: 'User registered successfully',
        data: {
          user: {
            id: user.id,
            email: user.email,
            first_name: user.first_name,
            last_name: user.last_name
          },
          ...tokens
        }
      };
    } catch (error) {
      throw error;
    }
  }

  // Login user
  async login(email, password) {
    try {
      // Get user by email
      const user = await this.userModel.getUserByEmail(email);
      
      // Verify password
      const isPasswordValid = await this.userModel.verifyPassword(user, password);
      if (!isPasswordValid) {
        throw new Error('Invalid email or password');
      }

      // Generate tokens
      const accessToken = this.generateAccessToken(user);
      const refreshToken = this.generateRefreshToken(user.id);

      // Delete any existing refresh tokens for this user to avoid duplicates
      try {
        await this.refreshTokenModel.deleteRefreshTokensByUserId(user.id);
      } catch (error) {
        // Ignore if no tokens exist to delete
        console.log('No existing refresh tokens to delete for user:', user.id);
      }

      // Store refresh token in database
      const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14 days from now
      await this.refreshTokenModel.createRefreshToken(user.id, refreshToken, expiresAt);

      // Return user data (excluding password hash) and tokens
      const { password_hash, ...userData } = user;
      return {
        message: 'Login successful',
        data: {
          user: userData,
          access_token: accessToken,
          refresh_token: refreshToken,
          expires_in: this.JWT_EXPIRES_IN,
          refresh_expires_in: this.JWT_REFRESH_EXPIRES_IN
        }
      };
    } catch (error) {
      throw error;
    }
  }

  // Refresh access token and rotate refresh token
  async refreshToken(refreshToken) {
    try {
      // Verify refresh token
      const decoded = await this.verifyRefreshToken(refreshToken);
      
      // Check if refresh token exists in database
      await this.refreshTokenModel.getRefreshToken(refreshToken);
      
      // Get user data
      const user = await this.userModel.getUserById(decoded.id);
      
      // Generate new access token
      const newAccessToken = this.generateAccessToken(user);
      
      // Generate new refresh token with extended expiration (refresh token rotation)
      const newRefreshToken = this.generateRefreshToken(user.id);
      const expiresAt = new Date(Date.now() + this.parseExpirationToSeconds(this.JWT_REFRESH_EXPIRES_IN) * 1000);
      
      // Update the refresh token in database
      await this.refreshTokenModel.updateRefreshToken(refreshToken, newRefreshToken, expiresAt);
      
      return {
        message: 'Token refreshed successfully',
        access_token: newAccessToken,
        refresh_token: newRefreshToken,
        expires_in: this.JWT_EXPIRES_IN,
        refresh_expires_in: this.JWT_REFRESH_EXPIRES_IN
      };
    } catch (error) {
      console.error('Refresh token error:', error.message);
      throw error;
    }
  }

  // Logout user
  async logout(refreshToken) {
    try {
      await this.refreshTokenModel.deleteRefreshToken(refreshToken);
      return {
        message: 'Logged out successfully'
      };
    } catch (error) {
      throw error;
    }
  }

  // Reset refresh token expiration to 14 days for a user
  async resetRefreshTokenExpiration(userId) {
    try {
      await this.refreshTokenModel.resetRefreshTokenExpiration(userId);
      return {
        message: 'Refresh token expiration reset successfully'
      };
    } catch (error) {
      console.error('Error resetting refresh token expiration:', error.message);
      throw error;
    }
  }

  // Get user profile from token
  async getProfileFromToken(accessToken) {
    try {
      const decoded = await this.verifyAccessToken(accessToken);
      const user = await this.userModel.getUserById(decoded.id);

      // Return user data (excluding password hash)
      const { password_hash, ...userData } = user;
      return {
        message: 'Profile retrieved successfully',
        data: {
          user: userData
        }
      };
    } catch (error) {
      throw error;
    }
  }
}

module.exports = AuthService; 