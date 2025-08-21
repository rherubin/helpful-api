# User API

A comprehensive Node.js REST API with SQLite backend for managing users with authentication, pairing system, and secure token-based authorization.

## Features

- **User Management**: Create, update, and retrieve users with secure password authentication
- **Authentication System**: JWT-based login with access and refresh tokens
- **Pairing System**: Users can request, accept, and reject pairings with other users
- **Password Security**: Bcrypt hashing with strict password requirements
- **Token Management**: Short-lived access tokens with long-lived refresh tokens
- **Pairing Limits**: Configurable maximum pairings per user
- **SQLite Database**: Persistent data storage with automatic schema creation
- **RESTful API**: Clean, consistent API design with comprehensive error handling

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a `.env` file in the root directory (optional):
   ```
   PORT=3000
   NODE_ENV=development
   JWT_SECRET=your-secret-key-change-in-production
   JWT_REFRESH_SECRET=your-refresh-secret-key-change-in-production
   JWT_EXPIRES_IN=1h
   JWT_REFRESH_EXPIRES_IN=7d
   DATABASE_PATH=./helpful-db.sqlite
   ```

3. **Database Setup** (Automatic):
   
   The SQLite database (`helpful-db.sqlite`) will be created automatically when you first start the server. The application will:
   - Create the database file if it doesn't exist
   - Initialize all required tables (users, refresh_tokens, pairings)
   - Set up proper indexes and constraints
   
   **Note**: Database files are excluded from version control. Each developer gets a clean database on first run.
   
   **Development Tips**:
   - To reset your database: Stop the server, delete `helpful-db.sqlite`, then restart
   - First user created will have ID and pairing code generated automatically
   - All tables and schemas are created automatically - no manual SQL needed

4. Start the server:
   ```bash
   npm start
   ```

   Or for development with auto-restart:
   ```bash
   npm run dev
   ```

## API Endpoints

**Note**: `first_name` and `last_name` fields are optional throughout the API. When not provided during user creation, they will be stored as `null` and returned as `null` in responses.

### Authentication

#### Login
- **POST** `/api/login`
- **Body:**
  ```json
  {
    "email": "user@example.com",
    "password": "Test1!@#"
  }
  ```
- **Response:**
  ```json
  {
    "message": "Login successful",
    "user": {
      "id": "unique_id",
      "email": "user@example.com",
      "first_name": "John",
      "last_name": "Doe",

      "max_pairings": 1,
      "created_at": "2024-01-01T00:00:00.000Z"
    },
    "access_token": "jwt_token",
    "refresh_token": "refresh_jwt_token",
    "expires_in": "1h",
    "refresh_expires_in": "7d"
  }
  ```

#### Refresh Token
- **POST** `/api/refresh`
- **Body:**
  ```json
  {
    "refresh_token": "refresh_jwt_token"
  }
  ```
- **Response:**
  ```json
  {
    "message": "Token refreshed successfully",
    "access_token": "new_jwt_token",
    "expires_in": "1h"
  }
  ```

#### Logout
- **POST** `/api/logout`
- **Body:**
  ```json
  {
    "refresh_token": "refresh_jwt_token"
  }
  ```
- **Response:**
  ```json
  {
    "message": "Logged out successfully"
  }
  ```

### User Management

#### Create User
- **POST** `/api/users`
- **Body:**
  ```json
  {
    "email": "user@example.com",
    "first_name": "John",
    "last_name": "Doe",
    "password": "Test1!@#",
    "max_pairings": 1
  }
  ```
  **Note**: Only `email` and `password` are required. `first_name` and `last_name` are optional and will be set to `null` if not provided.

- **Minimal Request Body:**
  ```json
  {
    "email": "user@example.com",
    "password": "Test1!@#"
  }
  ```
- **Response:**
  ```json
  {
    "message": "Account created successfully",
    "user": {
      "id": "unique_id",
      "email": "user@example.com",
      "first_name": "John",
      "last_name": "Doe",

      "max_pairings": 1,
      "created_at": "2024-01-01T00:00:00.000Z"
    },
    "access_token": "jwt_token",
    "refresh_token": "refresh_jwt_token",
    "expires_in": "1h",
    "refresh_expires_in": "7d"
  }
  ```

- **Response (when first_name and last_name are not provided):**
  ```json
  {
    "message": "Account created successfully",
    "user": {
      "id": "unique_id",
      "email": "user@example.com",
      "first_name": null,
      "last_name": null,

      "max_pairings": 1,
      "created_at": "2024-01-01T00:00:00.000Z"
    },
    "access_token": "jwt_token",
    "refresh_token": "refresh_jwt_token",
    "expires_in": "1h",
    "refresh_expires_in": "7d"
  }
  ```

#### Get All Users
- **GET** `/api/users`
- **Response:** Array of all users

#### Get User by ID
- **GET** `/api/users/:id`
- **Response:** Single user object

#### Update User
- **PUT** `/api/users/:id`
- **Body:**
  ```json
  {
    "first_name": "Johnny",
    "last_name": "Smith",
    "email": "johnny.smith@example.com",
    "max_pairings": 2
  }
  ```
- **Response:**
  ```json
  {
    "message": "User updated successfully",
    "user": {
      "id": "unique_id",
      "email": "johnny.smith@example.com",
      "first_name": "Johnny",
      "last_name": "Smith",

      "max_pairings": 2,
      "updated_at": "2024-01-01T00:00:00.000Z"
    }
  }
  ```

#### Get User Profile (Authenticated)
- **GET** `/api/profile`
- **Headers:** `Authorization: Bearer {access_token}`
- **Response:**
  ```json
  {
    "message": "Profile retrieved successfully",
    "user": {
      "id": "unique_id",
      "email": "user@example.com",
      "first_name": "John",
      "last_name": "Doe",

      "max_pairings": 1,
      "created_at": "2024-01-01T00:00:00.000Z"
    }
  }
  ```

### Pairing System

**New Pairing Flow**: The pairing system now uses a two-step process:
1. **Request**: A user creates a temporary partner code without specifying who they want to pair with
2. **Accept**: Another user uses that partner code to pair with the original user

This makes pairing more flexible since you don't need to know the other person's pairing code in advance.

#### Request Pairing
- **POST** `/api/pairing/request`
- **Headers:** `Authorization: Bearer {access_token}`
- **Body:** No body required
- **Response:**
  ```json
  {
    "message": "Partner code generated successfully. Share this code with someone to pair with you.",
    "partner_code": "ABC123",
    "pairing_id": "pairing_id",
    "expires_note": "This partner code is valid until someone uses it or you cancel the request."
  }
  ```
  **Note**: This generates a temporary partner code that others can use to pair with you. You don't need to specify who you want to pair with.

#### Accept Pairing Request
- **POST** `/api/pairing/accept`
- **Headers:** `Authorization: Bearer {access_token}`
- **Body:**
  ```json
  {
    "partner_code": "ABC123"
  }
  ```
  **Note**: Use the partner code that someone shared with you to pair with them.
- **Response:**
  ```json
  {
    "message": "Pairing accepted successfully",
    "pairing": {
      "id": "pairing_id",
      "partner_code": "ABC123",
      "requester": {
        "id": "requester_user_id",
        "first_name": "John",
        "last_name": "Doe",
        "email": "john.doe@example.com",

      }
    }
  }
  ```

#### Reject Pairing Request
- **POST** `/api/pairing/reject/:pairingId`
- **Headers:** `Authorization: Bearer {access_token}`
- **Response:**
  ```json
  {
    "message": "Pairing rejected successfully",
    "pairing_id": "pairing_id"
  }
  ```

#### Get User's Pairings
- **GET** `/api/pairings`
- **Headers:** `Authorization: Bearer {access_token}`
- **Response:**
  ```json
  {
    "message": "User pairings retrieved successfully",
    "pairings": [
      {
        "id": "pairing_id",
        "user1_id": "user1_id",
        "user2_id": "user2_id",
        "status": "accepted",
        "user1_first_name": "John",
        "user1_last_name": "Doe",
        "user1_email": "john.doe@example.com",
        "user2_first_name": "Jane",
        "user2_last_name": "Doe",
        "user2_email": "jane.doe@example.com"
      }
    ]
  }
  ```

**Note**: This endpoint is also available at `/api/pairing/` for backward compatibility.

#### Get Pending Pairings
- **GET** `/api/pairing/pending`
- **Headers:** `Authorization: Bearer {access_token}`
- **Response:** Array of pending pairing requests

#### Get Accepted Pairings
- **GET** `/api/pairing/accepted`
- **Headers:** `Authorization: Bearer {access_token}`
- **Response:** Array of accepted pairings

#### Get Pairing Statistics
- **GET** `/api/pairing/stats`
- **Headers:** `Authorization: Bearer {access_token}`
- **Response:**
  ```json
  {
    "message": "User pairing statistics retrieved successfully",
    "stats": {
      "max_pairings": 1,
      "current_pairings": 1,
      "available_slots": 0,
      "pending_requests": 0
    }
  }
  ```

#### Get Pairing Details
- **GET** `/api/pairing/:pairingId`
- **Headers:** `Authorization: Bearer {access_token}`
- **Response:** Detailed pairing information

### Health Check
- **GET** `/health`
- **Response:**
  ```json
  {
    "status": "OK",
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
  ```

## Database Schema

The SQLite database automatically creates the following tables:

### Users Table
```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  first_name TEXT,
  last_name TEXT,
  password_hash TEXT NOT NULL,

  max_pairings INTEGER DEFAULT 1,
  deleted_at DATETIME DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Refresh Tokens Table
```sql
CREATE TABLE refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
```

### Pairings Table
```sql
CREATE TABLE pairings (
  id TEXT PRIMARY KEY,
  user1_id TEXT NOT NULL,
  user2_id TEXT,
  partner_code TEXT,
  status TEXT DEFAULT 'pending',
  deleted_at DATETIME DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user1_id) REFERENCES users (id) ON DELETE CASCADE,
  FOREIGN KEY (user2_id) REFERENCES users (id) ON DELETE CASCADE
);
```

## Password Requirements

Passwords must meet the following criteria:
- Exactly 8 characters long
- At least one number (0-9)
- At least one symbol (!@#$%^&*()_+-=[]{}|;':",./<>?)
- At least one capital letter (A-Z)
- At least one lowercase letter (a-z)

## Partner Code Format

Partner codes are temporarily generated when users request pairings:
- Format: `XXXXXX` (e.g., "ABC123", "XYZ789")
- Uses uppercase letters A-Z and numbers 0-9
- Generated only when requesting a pairing
- Valid until someone uses them or the request is cancelled
- No hyphens or special characters

## Authentication

The API uses JWT (JSON Web Tokens) for authentication:

- **Access Tokens**: Short-lived (1 hour) for API requests
- **Refresh Tokens**: Long-lived (7 days) for obtaining new access tokens
- **Bearer Token**: Include `Authorization: Bearer {token}` in request headers

## Error Handling

The API includes comprehensive error handling for:

- **400 Bad Request**: Missing fields, invalid email format, password validation
- **401 Unauthorized**: Missing or invalid access token
- **403 Forbidden**: Invalid refresh token, unauthorized pairing actions
- **404 Not Found**: User or pairing not found
- **409 Conflict**: Duplicate email, pairing already exists
- **500 Internal Server Error**: Database errors, server issues

## Development

To run the server in development mode with auto-restart:

```bash
npm run dev
```

The server will automatically restart when you make changes to the code.

## Testing

Run the comprehensive test suite:

```bash
node test-api.js
```

This will test all endpoints including:
- User creation and management
- Authentication and token refresh
- Pairing system functionality
- Error handling and validation

## Example Usage

### Complete Pairing Workflow

```bash
# 1. Create two users (showing both full and minimal request formats)
curl -X POST http://localhost:3000/api/users \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john.doe@example.com",
    "first_name": "John",
    "last_name": "Doe",
    "password": "Test1!@#",
    "max_pairings": 1
  }'

curl -X POST http://localhost:3000/api/users \
  -H "Content-Type: application/json" \
  -d '{
    "email": "jane.doe@example.com",
    "password": "Test2!@#",
    "max_pairings": 1
  }'

# 2. Login as both users
curl -X POST http://localhost:3000/api/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john.doe@example.com",
    "password": "Test1!@#"
  }'

# 3. John requests a pairing (generates partner code)
curl -X POST http://localhost:3000/api/pairing/request \
  -H "Authorization: Bearer {john_access_token}"

# This returns a partner_code like "ABC123" that John can share

# 4. Login as Jane and accept the pairing using John's partner code
curl -X POST http://localhost:3000/api/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "jane.doe@example.com",
    "password": "Test2!@#"
  }'

curl -X POST http://localhost:3000/api/pairing/accept \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {jane_access_token}" \
  -d '{
    "partner_code": "ABC123"
  }'

# 5. View accepted pairings
curl -X GET http://localhost:3000/api/pairing/accepted \
  -H "Authorization: Bearer {john_access_token}"
```

## Project Structure

```
user-api/
├── models/
│   ├── User.js              # User data model
│   ├── RefreshToken.js      # Refresh token model
│   └── Pairing.js           # Pairing model
├── services/
│   ├── AuthService.js       # Authentication service
│   └── PairingService.js    # Pairing business logic
├── routes/
│   ├── users.js             # User endpoints
│   ├── auth.js              # Authentication endpoints
│   └── pairing.js           # Pairing endpoints
├── middleware/
│   └── auth.js              # JWT authentication middleware
├── server.js                # Main application
├── test-api.js              # Test suite
└── package.json
``` 