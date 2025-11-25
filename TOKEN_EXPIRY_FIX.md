# Token Expiry Configuration Fix

## Problem
Users were experiencing "Token expired" errors after just a few minutes of inactivity, which is far too aggressive and creates a poor user experience.

## Root Cause
The access token expiration was set to 1 hour by default, but could be overridden by the `JWT_EXPIRES_IN` environment variable. If this was set to a very short duration (e.g., `5m` or `10m`), tokens would expire very quickly.

## Solution

### 1. Increased Default Access Token Expiration
Changed the default access token expiration from `1h` to `24h` for better user experience:

```javascript
// Before
this.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';

// After
this.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';
```

**Why 24 hours?**
- Provides a full day of uninterrupted usage
- Reduces the frequency of token refresh operations
- Still maintains reasonable security (refresh tokens are still 14 days)
- Aligns with industry best practices for mobile/web apps

### 2. Added Token Configuration Logging
The service now logs token configuration on startup to help debug issues:

```javascript
console.log('JWT Configuration:', {
  accessTokenExpiry: this.JWT_EXPIRES_IN,
  refreshTokenExpiry: this.JWT_REFRESH_EXPIRES_IN,
  accessTokenSeconds: this.parseExpirationToSeconds(this.JWT_EXPIRES_IN),
  refreshTokenSeconds: this.parseExpirationToSeconds(this.JWT_REFRESH_EXPIRES_IN)
});
```

### 3. Enhanced Error Logging
Added detailed logging when tokens expire to help diagnose timing issues:

```javascript
console.log('Token expired:', {
  expiredAt: err.expiredAt,
  now: new Date(),
  timeSinceExpiry: Date.now() - new Date(err.expiredAt).getTime()
});
```

### 4. New Token Info Endpoint
Added a new endpoint `POST /auth/token-info` that allows checking token information without validation:

**Request:**
```json
{
  "access_token": "your-jwt-token"
}
```

**Response:**
```json
{
  "issued_at": "2024-01-15T10:00:00.000Z",
  "expires_at": "2024-01-16T10:00:00.000Z",
  "current_time": "2024-01-15T12:30:00.000Z",
  "token_age_seconds": 9000,
  "token_age_minutes": 150,
  "time_until_expiry_seconds": 77400,
  "time_until_expiry_minutes": 1290,
  "is_expired": false,
  "user_id": 123,
  "user_email": "user@example.com"
}
```

This endpoint is useful for:
- Debugging token expiration issues
- Checking if a token is about to expire
- Implementing proactive token refresh in clients

## Configuration

### Environment Variables

To customize token expiration, set these environment variables:

```bash
# Access token expiration (default: 24h)
JWT_EXPIRES_IN=24h

# Refresh token expiration (default: 14d)
JWT_REFRESH_EXPIRES_IN=14d
```

### Supported Time Formats

- `s` - seconds (e.g., `3600s`)
- `m` - minutes (e.g., `60m`)
- `h` - hours (e.g., `24h`)
- `d` - days (e.g., `14d`)

### Recommended Settings

**For Production:**
```bash
JWT_EXPIRES_IN=24h        # 24 hours for good UX
JWT_REFRESH_EXPIRES_IN=14d # 14 days for security
```

**For Development:**
```bash
JWT_EXPIRES_IN=24h        # Same as production
JWT_REFRESH_EXPIRES_IN=30d # Longer for convenience
```

**For Testing Token Expiry:**
```bash
JWT_EXPIRES_IN=5m         # 5 minutes for quick testing
JWT_REFRESH_EXPIRES_IN=1h # 1 hour for testing refresh flow
```

## Security Considerations

### Why 24 Hours is Safe

1. **Refresh Token Rotation**: The system uses refresh token rotation, which provides security even with longer access token lifetimes
2. **Automatic Refresh**: The middleware automatically extends refresh token expiration on each API call
3. **Revocation**: Refresh tokens can be revoked immediately via logout
4. **Database-Backed**: Refresh tokens are stored in the database and can be invalidated

### Best Practices

1. **Use HTTPS**: Always use HTTPS in production to prevent token interception
2. **Store Securely**: Store tokens securely on the client (e.g., secure httpOnly cookies or secure storage)
3. **Implement Logout**: Always provide a logout mechanism that revokes refresh tokens
4. **Monitor Usage**: Monitor for suspicious token usage patterns
5. **Rotate Secrets**: Periodically rotate JWT secrets (requires all users to re-login)

## Testing

### Test Token Expiration Configuration

Run the token expiry test:

```bash
node tests/token-expiry-test.js
```

This will:
1. Login and get an access token
2. Check the token information
3. Verify the token works
4. Display token expiration details
5. Warn if expiration is too short

### Manual Testing

1. **Check Current Configuration:**
   - Start the server and look for the "JWT Configuration" log message
   - Verify the expiration times are correct

2. **Test Token Info Endpoint:**
   ```bash
   # Login first
   curl -X POST http://localhost:9000/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email":"test@example.com","password":"password123"}'
   
   # Check token info (replace TOKEN with actual token)
   curl -X POST http://localhost:9000/auth/token-info \
     -H "Content-Type: application/json" \
     -d '{"access_token":"TOKEN"}'
   ```

3. **Test Token Expiration:**
   - Set `JWT_EXPIRES_IN=1m` for testing
   - Login and get a token
   - Wait 2 minutes
   - Try to use the token - should get "Token expired" error
   - Use refresh token to get a new access token

## Troubleshooting

### Tokens Still Expiring Too Quickly

1. **Check Environment Variables:**
   ```bash
   # On Railway
   railway variables
   
   # Or check your .env file
   cat .env | grep JWT_EXPIRES_IN
   ```

2. **Check Server Logs:**
   - Look for "JWT Configuration" log on startup
   - Verify the `accessTokenSeconds` value

3. **Check Token Info:**
   - Use the `/auth/token-info` endpoint to see actual expiration
   - Compare with expected expiration

### Time Sync Issues

If tokens expire immediately or at unexpected times:

1. **Check Server Time:**
   ```bash
   date
   ```

2. **Check Client Time:**
   - Ensure client and server clocks are synchronized
   - Consider using NTP for time synchronization

3. **Check Timezone:**
   - JWT uses UTC timestamps
   - Ensure server is using correct timezone

## Migration Guide

### For Existing Deployments

1. **Update Environment Variable (Optional):**
   ```bash
   # On Railway
   railway variables set JWT_EXPIRES_IN=24h
   ```
   
   If you don't set this, the new default of 24h will be used automatically.

2. **Deploy Changes:**
   - Push changes to your repository
   - Railway will automatically redeploy

3. **Verify:**
   - Check server logs for "JWT Configuration" message
   - Run token expiry test
   - Monitor for "Token expired" errors

### For Existing Users

- **No action required** - existing tokens will continue to work until they expire
- New tokens issued after deployment will use the new expiration time
- Users may need to login again after their current token expires

## Related Files

- `services/AuthService.js` - Token generation and configuration
- `middleware/auth.js` - Token verification and error handling
- `routes/auth.js` - Authentication endpoints including token-info
- `tests/token-expiry-test.js` - Token expiration testing script

## References

- [JWT Best Practices](https://tools.ietf.org/html/rfc8725)
- [OAuth 2.0 Token Expiration](https://www.oauth.com/oauth2-servers/access-tokens/access-token-lifetime/)
- [OWASP JWT Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.html)

