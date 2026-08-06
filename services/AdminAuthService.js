const jwt = require('jsonwebtoken');

class AdminAuthService {
  constructor(adminUserModel, refreshTokenModel) {
    this.adminUserModel = adminUserModel;
    this.refreshTokenModel = refreshTokenModel;
    this.jwtSecret = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
    this.jwtRefreshSecret = process.env.JWT_REFRESH_SECRET || 'your-refresh-secret-key-change-in-production';

    // JWT expiry times
    this.accessTokenExpiry = process.env.JWT_ACCESS_TOKEN_EXPIRES_IN_SECONDS || 86400; // 24 hours
    this.refreshTokenExpiry = process.env.JWT_REFRESH_TOKEN_EXPIRES_IN_SECONDS || 1209600; // 14 days
  }

  // Generate access token for admin user
  generateAccessToken(user) {
    return jwt.sign(
      {
        id: user.id,
        email: user.email,
        type: 'admin' // Mark as admin user
      },
      this.jwtSecret,
      { expiresIn: this.accessTokenExpiry }
    );
  }

  // Generate refresh token for admin user
  generateRefreshToken(user) {
    return jwt.sign(
      {
        id: user.id,
        email: user.email,
        type: 'admin'
      },
      this.jwtRefreshSecret,
      { expiresIn: this.refreshTokenExpiry }
    );
  }

  // Issue tokens for admin user
  async issueTokensForAdminUser(user) {
    const accessToken = this.generateAccessToken(user);
    const refreshToken = this.generateRefreshToken(user);

    // Store refresh token in database (for admin user)
    const expiresAt = new Date(Date.now() + (this.refreshTokenExpiry * 1000));
    await this.refreshTokenModel.createRefreshToken(user.id, refreshToken, expiresAt, 'admin');

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: 'Bearer',
      expires_in: this.accessTokenExpiry,
      user_type: 'admin'
    };
  }

  // Verify and refresh tokens for admin user
  async verifyAndRefreshTokens(accessToken, refreshToken) {
    try {
      // Verify refresh token
      const decodedRefresh = jwt.verify(refreshToken, this.jwtRefreshSecret);

      if (decodedRefresh.type !== 'admin') {
        throw new Error('Invalid token type');
      }

      // Confirm the presented refresh token is persisted for this admin.
      // Use the scan/verify helper (not getTokenByUserId) so a match is found
      // even if multiple admin refresh rows exist for the same user_id.
      await this.refreshTokenModel.getRefreshToken(refreshToken, decodedRefresh.id);

      const user = await this.adminUserModel.getAdminUserById(decodedRefresh.id);

      // Rotate: revoke existing admin refresh tokens BEFORE issuing replacements.
      // Previously this called the nonexistent deleteTokenByUserId() AFTER
      // issueTokensForAdminUser(), which always failed refresh and orphaned the
      // newly inserted token. Even with the correct method name, deleting after
      // issue would wipe the just-created token too.
      await this.refreshTokenModel.deleteRefreshTokensByUserId(decodedRefresh.id, 'admin');
      return await this.issueTokensForAdminUser(user);
    } catch (error) {
      throw new Error('Token refresh failed');
    }
  }

  // Login admin user
  async loginAdmin(email, password) {
    // Get admin user by email
    const user = await this.adminUserModel.getAdminUserByEmail(email);

    // Verify password
    const isValidPassword = await this.adminUserModel.verifyPassword(user, password);
    if (!isValidPassword) {
      throw new Error('Invalid email or password');
    }

    // Invalidate any prior admin refresh sessions (mirrors AuthService.login).
    // Without this, getTokenByUserId / multi-row state could leave stale tokens
    // and make subsequent refreshes nondeterministic.
    try {
      await this.refreshTokenModel.deleteRefreshTokensByUserId(user.id, 'admin');
    } catch (error) {
      console.log('No existing admin refresh tokens to delete for user:', user.id);
    }

    // Issue tokens
    const tokens = await this.issueTokensForAdminUser(user);

    return {
      message: 'Admin login successful',
      ...tokens
    };
  }

  // Register new admin user
  async registerAdmin(email, password) {
    // Create admin user
    const user = await this.adminUserModel.createAdminUser({ email, password });

    // Issue tokens for the new admin user
    const tokens = await this.issueTokensForAdminUser(user);

    return {
      message: 'Admin account created successfully',
      user: {
        id: user.id,
        email: user.email
      },
      ...tokens
    };
  }

  // Logout admin user (invalidate refresh token)
  async logoutAdmin(userId) {
    await this.refreshTokenModel.deleteRefreshTokensByUserId(userId, 'admin');
    return { message: 'Admin logout successful' };
  }

  // Get admin user profile
  async getAdminProfile(userId) {
    const user = await this.adminUserModel.getAdminUserById(userId);

    // Remove sensitive fields
    const { password_hash, ...profile } = user;

    return {
      id: profile.id,
      email: profile.email,
      user_name: profile.user_name,
      partner_name: profile.partner_name,
      children: profile.children,
      max_pairings: profile.max_pairings,
      created_at: profile.created_at,
      updated_at: profile.updated_at,
      user_type: 'admin'
    };
  }

  // Update admin user profile
  async updateAdminProfile(userId, updateData) {
    const updatedUser = await this.adminUserModel.updateAdminUser(userId, updateData);
    return this.getAdminProfile(userId);
  }
}

module.exports = AdminAuthService;