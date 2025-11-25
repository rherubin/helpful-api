# WWW-Authenticate Header Implementation

## Overview
Implemented proper `WWW-Authenticate` header support for all 401 Unauthorized responses in the API, following RFC 7235 and OAuth 2.0 Bearer Token specifications.

## Changes Made

### 1. Authentication Middleware (`middleware/auth.js`)
Updated the `createAuthenticateToken` function to include `WWW-Authenticate` headers in all 401 responses:

- **Missing Token**: Returns `WWW-Authenticate: Bearer realm="API"`
- **Expired Token**: Returns `WWW-Authenticate: Bearer realm="API", error="invalid_token", error_description="The access token expired"`
- **Invalid Token**: Returns `WWW-Authenticate: Bearer realm="API", error="invalid_token", error_description="The access token is invalid"`

### 2. Authentication Routes (`routes/auth.js`)
Updated the auth routes to include `WWW-Authenticate` headers:

- **Invalid Login Credentials**: Returns `WWW-Authenticate: Bearer realm="API"`
- **Invalid/Expired Refresh Token**: Returns `WWW-Authenticate: Bearer realm="API", error="invalid_token", error_description="The refresh token is invalid or expired"`

## HTTP Standards Compliance

The implementation follows:
- **RFC 7235**: HTTP Authentication framework
- **RFC 6750**: OAuth 2.0 Bearer Token Usage

### WWW-Authenticate Header Format
```
WWW-Authenticate: Bearer realm="API"[, error="error_code"][, error_description="description"]
```

### Error Codes Used
- `invalid_token`: The access token or refresh token is invalid, expired, or malformed

## Testing

A comprehensive test suite was created to verify the implementation:

### Test Coverage
1. ✅ Request without Authorization header
2. ✅ Request with invalid token
3. ✅ Login with invalid credentials
4. ✅ Refresh with invalid token

All tests verify that:
- The server returns a 401 status code
- The `WWW-Authenticate` header is present
- The header contains the correct authentication scheme (Bearer)
- Error details are included when appropriate

## Benefits

1. **Standards Compliance**: Follows HTTP and OAuth 2.0 specifications
2. **Better Client Experience**: Clients can programmatically determine the authentication scheme required
3. **Improved Error Handling**: Clients receive detailed information about why authentication failed
4. **API Documentation**: The header serves as self-documenting API behavior

## Example Responses

### Missing Authorization Header
```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer realm="API"
Content-Type: application/json

{
  "error": "Access token required"
}
```

### Invalid Token
```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer realm="API", error="invalid_token", error_description="The access token is invalid"
Content-Type: application/json

{
  "error": "Invalid token"
}
```

### Expired Token
```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer realm="API", error="invalid_token", error_description="The access token expired"
Content-Type: application/json

{
  "error": "Token expired"
}
```

## Implementation Date
November 25, 2025

