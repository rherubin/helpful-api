# Refresh Token Rotation Implementation

## Overview

This document describes the refresh token rotation feature implemented in the Helpful API for enhanced security.

## What is Refresh Token Rotation?

Refresh token rotation is a security best practice where:
1. Each time a refresh token is used, it is immediately invalidated
2. A new refresh token is issued with an extended expiration
3. The old token cannot be reused, preventing token theft attacks

## Implementation Details

### Changes Made

#### 1. RefreshToken Model (`models/RefreshToken.js`)

Added a new method to update refresh tokens in the database:

```javascript
async updateRefreshToken(oldToken, newToken, expiresAt) {
  // Updates the token and expiration in the database
  // Throws error if old token not found
}
```

#### 2. AuthService (`services/AuthService.js`)

Updated the `refreshToken()` method to:
- Generate a new access token (as before)
- Generate a new refresh token with extended expiration
- Update the database with the new refresh token
- Return both new tokens to the client

**Before:**
```javascript
return {
  message: 'Token refreshed successfully',
  access_token: newAccessToken,
  expires_in: this.JWT_EXPIRES_IN
};
```

**After:**
```javascript
return {
  message: 'Token refreshed successfully',
  access_token: newAccessToken,
  refresh_token: newRefreshToken,
  expires_in: this.JWT_EXPIRES_IN,
  refresh_expires_in: this.JWT_REFRESH_EXPIRES_IN
};
```

### Security Benefits

1. **Prevents Token Reuse**: Old tokens are immediately invalidated
2. **Sliding Expiration**: Active users stay logged in indefinitely
3. **Theft Detection**: Reused tokens indicate potential compromise
4. **Reduced Attack Window**: Tokens have limited lifetime

### API Changes

#### `/api/refresh` Endpoint

**Request:**
```json
POST /api/refresh
{
  "refresh_token": "old_refresh_token"
}
```

**Response:**
```json
{
  "message": "Token refreshed successfully",
  "access_token": "new_access_token",
  "refresh_token": "new_refresh_token",
  "expires_in": "1h",
  "refresh_expires_in": "7d"
}
```

**Important:** Clients must store the new `refresh_token` and use it for subsequent refresh requests.

## Client Implementation Guide

### JavaScript/TypeScript Example

```javascript
async function refreshAccessToken() {
  try {
    const response = await fetch('/api/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        refresh_token: localStorage.getItem('refresh_token')
      })
    });

    if (response.ok) {
      const data = await response.json();
      
      // IMPORTANT: Store the new tokens
      localStorage.setItem('access_token', data.access_token);
      localStorage.setItem('refresh_token', data.refresh_token);
      
      return data.access_token;
    } else {
      // Refresh failed - redirect to login
      window.location.href = '/login';
    }
  } catch (error) {
    console.error('Token refresh failed:', error);
    window.location.href = '/login';
  }
}

// Automatic refresh before expiration
setInterval(async () => {
  const tokenExpiry = localStorage.getItem('token_expiry');
  const now = Date.now();
  
  // Refresh 5 minutes before expiration
  if (tokenExpiry && now > tokenExpiry - 5 * 60 * 1000) {
    await refreshAccessToken();
  }
}, 60000); // Check every minute
```

### React Example with Axios Interceptor

```javascript
import axios from 'axios';

// Response interceptor to handle token refresh
axios.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // If 401 and haven't retried yet
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        const refreshToken = localStorage.getItem('refresh_token');
        const response = await axios.post('/api/refresh', {
          refresh_token: refreshToken
        });

        // Store new tokens
        localStorage.setItem('access_token', response.data.access_token);
        localStorage.setItem('refresh_token', response.data.refresh_token);

        // Retry original request with new token
        originalRequest.headers.Authorization = `Bearer ${response.data.access_token}`;
        return axios(originalRequest);
      } catch (refreshError) {
        // Refresh failed - redirect to login
        window.location.href = '/login';
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);
```

## Testing

### Test Suite

A comprehensive test suite has been created: `tests/refresh-token-rotation-test.js`

**Run the test:**
```bash
node tests/refresh-token-rotation-test.js
```

**Test Coverage:**
1. ✅ New access token is issued
2. ✅ New refresh token is issued
3. ✅ New tokens are different from old tokens
4. ✅ New token is stored in database
5. ✅ Token expiration is extended
6. ✅ Old refresh token is invalidated
7. ✅ New refresh token works for subsequent refreshes
8. ✅ New access token works for protected routes

### Integration with Existing Tests

The main authentication test suite (`tests/auth-test.js`) has been updated to test refresh token rotation:

- **Test 8**: Refresh Access Token with Token Rotation
- **Test 8b**: Old Refresh Token Should Be Invalidated After Rotation

**Run all auth tests:**
```bash
npm run test:auth
```

## Migration Guide

### For Existing Clients

If you have existing clients using the old `/api/refresh` endpoint:

1. **Update Response Handling**: The response now includes a `refresh_token` field
2. **Store New Token**: Always save the new `refresh_token` from the response
3. **Handle Errors**: Old tokens will now return 401 errors if reused

### Backward Compatibility

⚠️ **Breaking Change**: Clients must update to store the new refresh token. Old implementations that don't save the new token will fail after the first refresh.

## Troubleshooting

### Common Issues

**Problem:** Getting 401 errors after refresh
- **Cause:** Not storing the new refresh token
- **Solution:** Update client code to save `refresh_token` from response

**Problem:** Users getting logged out unexpectedly
- **Cause:** Refresh token expired due to inactivity
- **Solution:** Implement automatic refresh before expiration

**Problem:** Refresh token not found in database
- **Cause:** Token was already used or invalidated
- **Solution:** Redirect user to login page

## Security Considerations

1. **Store Tokens Securely**: Use httpOnly cookies or secure storage
2. **Use HTTPS**: Always use HTTPS in production
3. **Monitor Failed Refreshes**: Log and alert on suspicious patterns
4. **Implement Rate Limiting**: Prevent brute force attacks
5. **Token Expiration**: Balance security vs. user experience

## Database Schema

The `refresh_tokens` table structure remains unchanged:

```sql
CREATE TABLE refresh_tokens (
  id VARCHAR(50) PRIMARY KEY,
  user_id VARCHAR(50) NOT NULL,
  token VARCHAR(500) UNIQUE NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_id (user_id),
  INDEX idx_token (token),
  INDEX idx_expires_at (expires_at),
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
```

The `updateRefreshToken()` method updates the `token` and `expires_at` fields in place.

## Performance Impact

- **Minimal overhead**: Single database UPDATE query per refresh
- **No additional tables**: Uses existing `refresh_tokens` table
- **Efficient indexing**: Token lookup uses indexed column

## Future Enhancements

Potential improvements for consideration:

1. **Token Families**: Track token lineage to detect theft
2. **Device Tracking**: Associate tokens with specific devices
3. **Configurable Rotation**: Option to disable rotation for specific use cases
4. **Refresh Token Limits**: Maximum number of active tokens per user
5. **Audit Logging**: Track all token refresh events

## References

- [OAuth 2.0 Refresh Token Rotation](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-security-topics#section-4.13)
- [Auth0: Refresh Token Rotation](https://auth0.com/docs/secure/tokens/refresh-tokens/refresh-token-rotation)
- [OWASP: Token-Based Authentication](https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.html)

## Support

For questions or issues related to refresh token rotation:
1. Check the test suite for examples
2. Review the API documentation in README.md
3. Check server logs for error details

