# Railway Token Expiration Update Guide

## Quick Fix for Token Expiration Issues

If you're experiencing "Token expired" errors too quickly, follow these steps:

## Option 1: Use New Default (Recommended)

The code now defaults to 24-hour access tokens. To use this:

1. **Remove the JWT_EXPIRES_IN variable from Railway** (if it exists):
   ```bash
   railway variables delete JWT_EXPIRES_IN
   ```

2. **Redeploy** (Railway will auto-deploy, or trigger manually):
   ```bash
   railway up
   ```

3. **Verify** by checking the logs after deployment:
   - Look for "JWT Configuration" log message
   - Should show `accessTokenExpiry: '24h'`

## Option 2: Set Custom Expiration

If you want a different expiration time:

1. **Set the variable on Railway:**
   ```bash
   # For 24 hours (recommended)
   railway variables set JWT_EXPIRES_IN=24h
   
   # For 12 hours
   railway variables set JWT_EXPIRES_IN=12h
   
   # For 48 hours
   railway variables set JWT_EXPIRES_IN=48h
   ```

2. **Railway will automatically redeploy**

3. **Verify** in the deployment logs

## Check Current Configuration

### Via Railway CLI:
```bash
# List all variables
railway variables

# Check specific variable
railway variables | grep JWT_EXPIRES_IN
```

### Via Railway Dashboard:
1. Go to your project
2. Click on your service
3. Go to "Variables" tab
4. Look for `JWT_EXPIRES_IN`

### Via Server Logs:
1. Deploy the updated code
2. Check logs for "JWT Configuration" message
3. Verify the `accessTokenExpiry` value

## Testing After Update

1. **Login to get a new token:**
   ```bash
   curl -X POST https://your-app.up.railway.app/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email":"your@email.com","password":"yourpassword"}'
   ```

2. **Check token info:**
   ```bash
   curl -X POST https://your-app.up.railway.app/auth/token-info \
     -H "Content-Type: application/json" \
     -d '{"access_token":"YOUR_TOKEN_HERE"}'
   ```

3. **Verify expiration time:**
   - Look at `time_until_expiry_minutes` in the response
   - Should be close to your configured expiration (e.g., ~1440 minutes for 24h)

## Troubleshooting

### Still Getting Quick Expiration?

1. **Clear old tokens:**
   - Logout and login again
   - Old tokens still have the old expiration

2. **Check for typos:**
   ```bash
   # Wrong (will use default 1h)
   railway variables set JWT_EXPIRES_IN=24

   # Correct
   railway variables set JWT_EXPIRES_IN=24h
   ```

3. **Verify deployment:**
   - Check that the latest code is deployed
   - Look for "JWT Configuration" in logs

### Token Info Shows Wrong Time?

- The token contains the expiration time from when it was issued
- Login again to get a new token with the updated expiration

## Recommended Settings

```bash
# Production (good balance of security and UX)
JWT_EXPIRES_IN=24h
JWT_REFRESH_EXPIRES_IN=14d

# Development (longer for convenience)
JWT_EXPIRES_IN=48h
JWT_REFRESH_EXPIRES_IN=30d
```

## Important Notes

⚠️ **Existing Tokens:**
- Tokens issued before the change will keep their original expiration
- Users need to login again to get tokens with the new expiration

✅ **Security:**
- 24-hour access tokens are safe when using refresh token rotation
- Refresh tokens are automatically extended on each API call
- Logout immediately revokes refresh tokens

📱 **Mobile Apps:**
- Consider 48h or longer for mobile apps
- Implement automatic token refresh before expiration
- Use the `/auth/token-info` endpoint to check expiration

## Next Steps

After updating:
1. ✅ Verify configuration in logs
2. ✅ Test with a new login
3. ✅ Monitor for "Token expired" errors
4. ✅ Update mobile/web clients to handle 24h tokens

## Support

If issues persist:
1. Check Railway logs for errors
2. Use `/auth/token-info` endpoint to debug
3. Verify server time is correct
4. Check for time sync issues between client and server

