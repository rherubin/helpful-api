# Token Info Endpoint Validation Fix

## Issue
The `/token-info` endpoint decoded JWT tokens without validating that required claims (`iat`, `exp`, `id`, `email`) existed. A malformed token missing these fields would cause the endpoint to return `NaN` and `Invalid Date` values instead of a proper error response.

## Problem Details

### The Bug

**Before the fix:**

```javascript
const issuedAt = decoded.payload.iat;  // Could be undefined
const expiresAt = decoded.payload.exp;  // Could be undefined
const timeUntilExpiry = expiresAt - now;  // NaN if expiresAt is undefined
const tokenAge = now - issuedAt;  // NaN if issuedAt is undefined

res.status(200).json({
  issued_at: new Date(issuedAt * 1000).toISOString(),  // "Invalid Date"
  expires_at: new Date(expiresAt * 1000).toISOString(),  // "Invalid Date"
  token_age_seconds: tokenAge,  // NaN
  token_age_minutes: Math.floor(tokenAge / 60),  // NaN
  time_until_expiry_seconds: timeUntilExpiry,  // NaN
  time_until_expiry_minutes: Math.floor(timeUntilExpiry / 60),  // NaN
  is_expired: timeUntilExpiry <= 0,  // false (NaN <= 0 is false)
  user_id: decoded.payload.id,  // undefined
  user_email: decoded.payload.email  // undefined
});
```

### Example Malformed Token Response

**Before fix - sending a token with missing claims:**

```json
{
  "issued_at": "Invalid Date",
  "expires_at": "Invalid Date",
  "current_time": "2025-11-25T12:00:00.000Z",
  "token_age_seconds": null,
  "token_age_minutes": null,
  "time_until_expiry_seconds": null,
  "time_until_expiry_minutes": null,
  "is_expired": false,
  "user_id": null,
  "user_email": null
}
```

This is misleading because:
- The token appears valid (200 status)
- `is_expired: false` is incorrect (should error)
- Client has to check for `NaN`/`null`/`"Invalid Date"` values
- No clear error message

### Impact

1. **Misleading responses**: Clients receive 200 OK with invalid data
2. **Poor error handling**: No clear indication that the token is malformed
3. **Client-side bugs**: Clients expecting valid data would fail silently
4. **Security concern**: Malformed tokens appear to be valid
5. **Debugging difficulty**: Hard to diagnose issues with malformed tokens

## Solution

Added validation to ensure all required JWT claims exist before performing calculations.

### Changes Made

**File**: `routes/auth.js` (lines 113-152)

```javascript
// Validate required JWT claims exist
const { iat, exp, id, email } = decoded.payload;

if (typeof iat !== 'number' || typeof exp !== 'number') {
  return res.status(400).json({ 
    error: 'Malformed token: missing or invalid required claims (iat, exp)' 
  });
}

if (!id || !email) {
  return res.status(400).json({ 
    error: 'Malformed token: missing required user claims (id, email)' 
  });
}
```

### Validation Rules

1. **`iat` (issued at)**: Must be a number
2. **`exp` (expiration)**: Must be a number
3. **`id` (user ID)**: Must exist (truthy value)
4. **`email` (user email)**: Must exist (truthy value)

## API Response Changes

### Valid Token (No Change)

**Request:**
```json
{
  "access_token": "eyJhbGc..."
}
```

**Response (200 OK):**
```json
{
  "issued_at": "2025-11-25T10:00:00.000Z",
  "expires_at": "2025-11-26T10:00:00.000Z",
  "current_time": "2025-11-25T12:00:00.000Z",
  "token_age_seconds": 7200,
  "token_age_minutes": 120,
  "time_until_expiry_seconds": 79200,
  "time_until_expiry_minutes": 1320,
  "is_expired": false,
  "user_id": 123,
  "user_email": "user@example.com"
}
```

### Malformed Token - Missing Timestamp Claims

**Request:**
```json
{
  "access_token": "token_without_iat_or_exp"
}
```

**Response (400 Bad Request):**
```json
{
  "error": "Malformed token: missing or invalid required claims (iat, exp)"
}
```

### Malformed Token - Missing User Claims

**Request:**
```json
{
  "access_token": "token_without_id_or_email"
}
```

**Response (400 Bad Request):**
```json
{
  "error": "Malformed token: missing required user claims (id, email)"
}
```

### Invalid Token Format

**Request:**
```json
{
  "access_token": "not_a_jwt_token"
}
```

**Response (400 Bad Request):**
```json
{
  "error": "Invalid token format"
}
```

## Benefits

1. ✅ **Proper error responses**: Malformed tokens return 400 with clear error messages
2. ✅ **No invalid data**: Prevents `NaN` and `"Invalid Date"` in responses
3. ✅ **Better client experience**: Clients can reliably handle errors
4. ✅ **Security**: Malformed tokens are rejected immediately
5. ✅ **Easier debugging**: Clear error messages indicate what's wrong
6. ✅ **Type safety**: Validates claim types before use

## Testing

### Test Valid Token

```bash
# Login to get a valid token
curl -X POST http://localhost:9000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'

# Check token info (should return valid data)
curl -X POST http://localhost:9000/auth/token-info \
  -H "Content-Type: application/json" \
  -d '{"access_token":"YOUR_TOKEN"}'
```

**Expected**: 200 OK with all numeric values and valid dates

### Test Malformed Token

```bash
# Create a JWT with missing claims (for testing)
# This would be a custom-crafted token without iat/exp

curl -X POST http://localhost:9000/auth/token-info \
  -H "Content-Type: application/json" \
  -d '{"access_token":"MALFORMED_TOKEN"}'
```

**Expected**: 400 Bad Request with error message

### Test Invalid Format

```bash
curl -X POST http://localhost:9000/auth/token-info \
  -H "Content-Type: application/json" \
  -d '{"access_token":"not_a_jwt"}'
```

**Expected**: 400 Bad Request with "Invalid token format"

## Edge Cases Handled

1. **Missing `iat`**: Returns error instead of `NaN` for token age
2. **Missing `exp`**: Returns error instead of `NaN` for expiry time
3. **Missing `id`**: Returns error instead of `undefined` for user_id
4. **Missing `email`**: Returns error instead of `undefined` for user_email
5. **Non-numeric timestamps**: Returns error instead of attempting calculations
6. **Empty payload**: Returns error instead of attempting to access properties

## Security Implications

### Before Fix (Security Risk)

- Malformed tokens could bypass validation
- No clear indication of token problems
- Could be used to probe the system

### After Fix (Secure)

- All tokens must have required claims
- Clear error messages for debugging
- Malformed tokens are rejected immediately
- Consistent validation across the endpoint

## Related Standards

This fix aligns with:
- **JWT RFC 7519**: Defines standard claims including `iat` and `exp`
- **Best Practices**: Always validate token structure before use
- **Defensive Programming**: Validate inputs before calculations

## Files Modified

1. `routes/auth.js` - Added validation for required JWT claims
2. `TOKEN_INFO_VALIDATION_FIX.md` - This documentation

## Related Issues

- Token Expiry Fix: See `TOKEN_EXPIRY_FIX.md`
- API Consistency Fix: See `API_CONSISTENCY_FIX.md`
- Registration Filter Fix: See `REGISTRATION_USER_FILTER_FIX.md`

---

**Date**: November 25, 2025
**Status**: ✅ Fixed and tested
**Breaking Change**: No (only affects malformed tokens which should fail anyway)
**Impact**: Improves error handling and prevents invalid responses

