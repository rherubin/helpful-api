const jwt = require('jsonwebtoken');

// JWT Configuration
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// JWT Middleware to verify token and reset refresh token expiration
function createAuthenticateToken(authService) {
  return async function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="API"');
      return res.status(401).json({ error: 'Access token required' });
    }

    jwt.verify(token, JWT_SECRET, async (err, user) => {
      if (err) {
        // Check if it's specifically a token expiry error
        if (err.name === 'TokenExpiredError') {
          res.setHeader('WWW-Authenticate', 'Bearer realm="API", error="invalid_token", error_description="The access token expired"');
          return res.status(401).json({ error: 'Token expired' });
        }
        // For other JWT errors (invalid signature, malformed, etc.)
        res.setHeader('WWW-Authenticate', 'Bearer realm="API", error="invalid_token", error_description="The access token is invalid"');
        return res.status(401).json({ error: 'Invalid token' });
      }

      req.user = user;

      // Reset refresh token expiration to 14 days asynchronously (non-blocking)
      if (authService && user && user.id) {
        try {
          // Fire and forget - don't wait for completion to avoid blocking API calls
          authService.resetRefreshTokenExpiration(user.id).catch(error => {
            // Log error but don't fail the request
            console.error('Failed to reset refresh token expiration:', error.message);
          });
        } catch (error) {
          // Log error but continue with the request
          console.error('Error triggering refresh token expiration reset:', error.message);
        }
      }

      next();
    });
  };
}

// Backward compatibility - create a basic version without auth service
const authenticateToken = createAuthenticateToken(null);

module.exports = {
  createAuthenticateToken,
  authenticateToken
}; 