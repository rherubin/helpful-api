# Registration User Filter Fix

## Issue
The `register()` method was explicitly filtering user data to return only specific fields (`id`, `email`, `first_name`, `last_name`), but this filtering was being overwritten by spreading the result from `issueTokensForUser()`, which included a full `user` object. This made the explicit filtering pointless and inconsistent with the intended design.

## Problem Details

### The Bug

**Before the fix:**

```javascript
// In register() method
return {
  message: 'User registered successfully',
  data: {
    user: {
      id: user.id,
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name
    },  // ← Explicitly filtered to 4 fields
    ...tokens  // ← Contains user: { ...all fields except password_hash }
  }
};
```

The spread operation `...tokens` would overwrite the explicitly constructed `user` object because `issueTokensForUser()` returned:

```javascript
{
  user: userData,  // ← Full user object (all fields except password_hash)
  access_token: "...",
  refresh_token: "...",
  expires_in: 86400,
  refresh_expires_in: 1209600
}
```

### Impact

1. **Explicit filtering was pointless**: The carefully constructed 4-field user object was immediately overwritten
2. **Inconsistent behavior**: Registration returned more user fields than intended
3. **Potential data leakage**: Fields like `max_pairings`, `created_at`, `updated_at`, etc. were exposed when they shouldn't be
4. **Confusing code**: The explicit filtering gave the false impression that only those fields would be returned

## Solution

Modified `issueTokensForUser()` to return **only token data**, without the user object. This allows callers to construct their own user response with appropriate filtering.

### Changes Made

#### 1. Updated `issueTokensForUser()` method
**File**: `services/AuthService.js` (lines 23-36)

```javascript
// Before
async issueTokensForUser(user) {
  const accessToken = this.generateAccessToken(user);
  const refreshToken = this.generateRefreshToken(user.id);
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  await this.refreshTokenModel.createRefreshToken(user.id, refreshToken, expiresAt);
  const { password_hash, ...userData } = user;
  return {
    user: userData,  // ← Removed this
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: this.parseExpirationToSeconds(this.JWT_EXPIRES_IN),
    refresh_expires_in: this.parseExpirationToSeconds(this.JWT_REFRESH_EXPIRES_IN)
  };
}

// After
async issueTokensForUser(user) {
  const accessToken = this.generateAccessToken(user);
  const refreshToken = this.generateRefreshToken(user.id);
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  await this.refreshTokenModel.createRefreshToken(user.id, refreshToken, expiresAt);
  return {
    // No user object - callers handle user data themselves
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: this.parseExpirationToSeconds(this.JWT_EXPIRES_IN),
    refresh_expires_in: this.parseExpirationToSeconds(this.JWT_REFRESH_EXPIRES_IN)
  };
}
```

#### 2. Updated `POST /users` endpoint
**File**: `routes/users.js` (line 59)

```javascript
// Before
const { max_pairings, created_at, updated_at, deleted_at, ...filteredUser } = tokenPayload.user;

// After
const { password_hash, max_pairings, created_at, updated_at, deleted_at, ...filteredUser } = user;
```

Now the route constructs the filtered user object directly from the `user` variable instead of expecting it from `tokenPayload`.

#### 3. `register()` method now works correctly
**File**: `services/AuthService.js` (lines 132-143)

The explicit filtering now works as intended:

```javascript
return {
  message: 'User registered successfully',
  data: {
    user: {
      id: user.id,
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name
    },  // ← This is now the final user object
    ...tokens  // ← Only contains token fields
  }
};
```

## API Response Changes

### Registration Endpoint (`POST /auth/register`)

**Before (Bug):**
```json
{
  "message": "User registered successfully",
  "data": {
    "user": {
      "id": 1,
      "email": "user@example.com",
      "first_name": "John",
      "last_name": "Doe",
      "max_pairings": 5,
      "created_at": "2024-01-01T00:00:00.000Z",
      "updated_at": "2024-01-01T00:00:00.000Z"
    },
    "access_token": "...",
    "refresh_token": "...",
    "expires_in": 86400,
    "refresh_expires_in": 1209600
  }
}
```

**After (Fixed):**
```json
{
  "message": "User registered successfully",
  "data": {
    "user": {
      "id": 1,
      "email": "user@example.com",
      "first_name": "John",
      "last_name": "Doe"
    },
    "access_token": "...",
    "refresh_token": "...",
    "expires_in": 86400,
    "refresh_expires_in": 1209600
  }
}
```

### User Creation Endpoint (`POST /users`)

**No change in response format** - the endpoint already had its own filtering logic, which now works correctly by filtering directly from the `user` object.

## Benefits

1. **Explicit filtering works**: The `register()` method now correctly returns only the intended fields
2. **Cleaner separation of concerns**: `issueTokensForUser()` focuses only on token generation
3. **More flexible**: Callers can decide what user data to include in their responses
4. **Reduced data exposure**: Only intended user fields are returned
5. **Clearer code**: No confusing overwrites or pointless filtering

## Design Rationale

### Why Remove User from `issueTokensForUser()`?

1. **Single Responsibility**: The method should focus on token generation, not user data formatting
2. **Flexibility**: Different endpoints may want to return different user fields
3. **Consistency**: Callers already have access to the `user` object, so they can format it as needed
4. **Prevents Bugs**: Eliminates the possibility of spread operations overwriting explicit user objects

### Method Responsibilities

| Method | Responsibility | Returns |
|--------|---------------|---------|
| `issueTokensForUser()` | Generate and persist tokens | Token data only |
| `register()` | Register user and issue tokens | Filtered user + tokens |
| `login()` | Authenticate and issue tokens | Full user (minus password) + tokens |
| `POST /users` | Create user with pairing | Filtered user + tokens + pairings |

## Testing

### Verify Registration Response

```bash
curl -X POST http://localhost:9000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "password123",
    "first_name": "Test",
    "last_name": "User"
  }'
```

**Expected response should contain only:**
- `user.id`
- `user.email`
- `user.first_name`
- `user.last_name`

**Should NOT contain:**
- `user.max_pairings`
- `user.created_at`
- `user.updated_at`
- `user.deleted_at`
- `user.password_hash`

### Verify User Creation Response

```bash
curl -X POST http://localhost:9000/users \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test2@example.com",
    "password": "password123",
    "first_name": "Test",
    "last_name": "User"
  }'
```

**Expected response should contain:**
- `user.id`
- `user.email`
- `user.first_name`
- `user.last_name`
- `user.password_hash` should be excluded
- `max_pairings`, `created_at`, `updated_at`, `deleted_at` should be excluded

## Files Modified

1. `services/AuthService.js` - Removed user object from `issueTokensForUser()` return value
2. `routes/users.js` - Updated to filter user directly instead of from tokenPayload
3. `API_CONSISTENCY_FIX.md` - Updated documentation
4. `REGISTRATION_USER_FILTER_FIX.md` - This documentation

## Related Issues

- API Consistency Fix: See `API_CONSISTENCY_FIX.md`
- Token Expiry Fix: See `TOKEN_EXPIRY_FIX.md`

## Migration Notes

If you have any custom code that calls `issueTokensForUser()` and expects a `user` property in the response:

**Before:**
```javascript
const result = await authService.issueTokensForUser(user);
console.log(result.user); // ← This will now be undefined
```

**After:**
```javascript
const tokens = await authService.issueTokensForUser(user);
// Construct your own user object as needed
const { password_hash, ...userData } = user;
const result = {
  user: userData,
  ...tokens
};
```

---

**Date**: November 25, 2025
**Status**: ✅ Fixed and tested
**Breaking Change**: Yes (for code calling `issueTokensForUser()` directly)
**Impact**: Registration now correctly returns only intended user fields

