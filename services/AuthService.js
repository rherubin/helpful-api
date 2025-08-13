const jwt = require('jsonwebtoken');

class AuthService {
  constructor(userModel, refreshTokenModel) {
    this.userModel = userModel;
    this.refreshTokenModel = refreshTokenModel;
    
    // JWT Configuration
    this.JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
    this.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'your-refresh-secret-key-change-in-production';
    this.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h'; // Short-lived access token
    this.JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d'; // Long-lived refresh token
  }

  // Generate and persist tokens for a user, returning token payload plus user data
  async issueTokensForUser(user) {
    const accessToken = this.generateAccessToken(user);
    const refreshToken = this.generateRefreshToken(user.id);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await this.refreshTokenModel.createRefreshToken(user.id, refreshToken, expiresAt);
    const { password_hash, ...userData } = user;
    return {
      user: userData,
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: this.JWT_EXPIRES_IN,
      refresh_expires_in: this.JWT_REFRESH_EXPIRES_IN
    };
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

      // Store refresh token in database
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days from now
      await this.refreshTokenModel.createRefreshToken(user.id, refreshToken, expiresAt);

      // Return user data (excluding password hash) and tokens
      const { password_hash, ...userData } = user;
      return {
        message: 'Login successful',
        user: userData,
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: this.JWT_EXPIRES_IN,
        refresh_expires_in: this.JWT_REFRESH_EXPIRES_IN
      };
    } catch (error) {
      throw error;
    }
  }

  // Refresh access token
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
      
      return {
        message: 'Token refreshed successfully',
        access_token: newAccessToken,
        expires_in: this.JWT_EXPIRES_IN
      };
    } catch (error) {
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

  // Get user profile from token
  async getProfileFromToken(accessToken) {
    try {
      const decoded = await this.verifyAccessToken(accessToken);
      const user = await this.userModel.getUserById(decoded.id);
      
      // Return user data (excluding password hash)
      const { password_hash, ...userData } = user;
      return {
        message: 'Profile retrieved successfully',
        user: userData
      };
    } catch (error) {
      throw error;
    }
  }
}

module.exports = AuthService; 