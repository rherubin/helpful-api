# API Response Consistency Fix

## Issue
The authentication endpoints were returning inconsistent data types for `expires_in` and `refresh_expires_in` fields, breaking the API contract and causing potential client-side issues.

## Problem Details

### Inconsistent Return Types

**Before the fix:**

1. **`issueTokensForUser()` method** (used by registration):
   ```json
   {
     "expires_in": 86400,
     "refresh_expires_in": 1209600
   }
   ```
   ✅ Returns **numbers** (seconds)

2. **`login()` method**:
   ```json
   {
     "expires_in": "24h",
     "refresh_expires_in": "14d"
   }
   ```
   ❌ Returns **strings** (time format)

3. **`refreshToken()` method**:
   ```json
   {
     "expires_in": "24h",
     "refresh_expires_in": "14d"
   }
   ```
   ❌ Returns **strings** (time format)

### Impact

This inconsistency caused:
- **Client code breakage**: Clients expecting numeric values would fail when receiving strings
- **Type safety issues**: TypeScript/strongly-typed clients would have type mismatches
- **Parsing complexity**: Clients had to handle both number and string formats
- **API contract violation**: Same field returning different types is a breaking change
- **Test failures**: Tests expecting numeric values would fail for login/refresh endpoints

## Solution

All authentication endpoints now consistently return `expires_in` and `refresh_expires_in` as **numeric values in seconds**.

### Changes Made

#### 1. Fixed `login()` method
**File**: `services/AuthService.js` (lines 187-188)

```javascript
// Before
expires_in: this.JWT_EXPIRES_IN,              // Returns "24h"
refresh_expires_in: this.JWT_REFRESH_EXPIRES_IN  // Returns "14d"

// After
expires_in: this.parseExpirationToSeconds(this.JWT_EXPIRES_IN),              // Returns 86400
refresh_expires_in: this.parseExpirationToSeconds(this.JWT_REFRESH_EXPIRES_IN)  // Returns 1209600
```

#### 2. Fixed `refreshToken()` method
**File**: `services/AuthService.js` (lines 222-223)

```javascript
// Before
expires_in: this.JWT_EXPIRES_IN,              // Returns "24h"
refresh_expires_in: this.JWT_REFRESH_EXPIRES_IN  // Returns "14d"

// After
expires_in: this.parseExpirationToSeconds(this.JWT_EXPIRES_IN),              // Returns 86400
refresh_expires_in: this.parseExpirationToSeconds(this.JWT_REFRESH_EXPIRES_IN)  // Returns 1209600
```

#### 3. Updated test output
**File**: `tests/token-expiry-test.js`

Enhanced the test to display both seconds and human-readable format:
```javascript
log(`  Access token expires in: ${expires_in} seconds (${Math.floor(expires_in / 60)} minutes)`, 'yellow');
log(`  Refresh token expires in: ${refresh_expires_in} seconds (${Math.floor(refresh_expires_in / 60 / 60 / 24)} days)`, 'yellow');
```

## API Contract

### All Authentication Endpoints Now Return:

```typescript
{
  expires_in: number;        // Seconds until access token expires (e.g., 86400 for 24h)
  refresh_expires_in: number; // Seconds until refresh token expires (e.g., 1209600 for 14d)
}
```

### Affected Endpoints:

1. **POST /auth/login**
   ```json
   {
     "message": "Login successful",
     "data": {
       "user": { ... },
       "access_token": "...",
       "refresh_token": "...",
       "expires_in": 86400,
       "refresh_expires_in": 1209600
     }
   }
   ```

2. **POST /auth/refresh**
   ```json
   {
     "message": "Token refreshed successfully",
     "access_token": "...",
     "refresh_token": "...",
     "expires_in": 86400,
     "refresh_expires_in": 1209600
   }
   ```

3. **POST /auth/register** (via `issueTokensForUser`)
   ```json
   {
     "message": "User registered successfully",
     "data": {
       "user": { ... },
       "access_token": "...",
       "refresh_token": "...",
       "expires_in": 86400,
       "refresh_expires_in": 1209600
     }
   }
   ```

## Client Migration Guide

### If You Were Handling Both Types:

**Before:**
```javascript
// Client had to handle both string and number
let expiresInSeconds;
if (typeof response.expires_in === 'string') {
  expiresInSeconds = parseTimeString(response.expires_in); // Custom parser
} else {
  expiresInSeconds = response.expires_in;
}
```

**After:**
```javascript
// Now always a number
const expiresInSeconds = response.expires_in;
const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);
```

### If You Were Only Handling Strings:

**Before:**
```javascript
// This would work for login but fail for registration
const expiresIn = response.expires_in; // "24h"
// Had to parse the string format
```

**After:**
```javascript
// Now always a number (seconds)
const expiresIn = response.expires_in; // 86400
const expiresAt = new Date(Date.now() + expiresIn * 1000);
```

## Common Expiration Values

| Configuration | Seconds | Minutes | Hours | Days |
|--------------|---------|---------|-------|------|
| 5 minutes | 300 | 5 | 0.08 | 0.003 |
| 1 hour | 3,600 | 60 | 1 | 0.04 |
| 24 hours | 86,400 | 1,440 | 24 | 1 |
| 14 days | 1,209,600 | 20,160 | 336 | 14 |
| 30 days | 2,592,000 | 43,200 | 720 | 30 |

## Testing

### Verify the Fix

Run the token expiry test:
```bash
node tests/token-expiry-test.js
```

Expected output:
```
✓ Login successful
  Access token expires in: 86400 seconds (1440 minutes)
  Refresh token expires in: 1209600 seconds (14 days)
```

### Run User Creation Tests

```bash
node tests/user-creation-test.js
```

These tests already expected numeric values and should now pass for all endpoints.

## Benefits

1. **Consistent API**: All endpoints return the same data type
2. **Type Safety**: TypeScript/strongly-typed clients work correctly
3. **Simpler Client Code**: No need to handle multiple formats
4. **Standards Compliance**: OAuth 2.0 typically uses seconds for expiration
5. **Better Testing**: Tests can reliably assert on numeric values
6. **Easier Math**: Clients can directly calculate expiration timestamps

## Related Standards

This fix aligns with:
- **OAuth 2.0 RFC 6749**: Recommends `expires_in` as seconds (integer)
- **OpenID Connect**: Uses seconds for token expiration
- **Industry Best Practices**: Most APIs return expiration in seconds

## Files Modified

1. `services/AuthService.js` - Fixed `login()` and `refreshToken()` methods
2. `tests/token-expiry-test.js` - Enhanced test output
3. `API_CONSISTENCY_FIX.md` - This documentation

## Related Issues

- Token Expiry Fix: See `TOKEN_EXPIRY_FIX.md`
- Refresh Token Rotation: See `REFRESH_TOKEN_ROTATION.md`

---

**Date**: November 25, 2025
**Status**: ✅ Fixed and tested
**Breaking Change**: Yes (for clients expecting string format from login/refresh)
**Migration**: Update clients to expect numeric seconds instead of string format

