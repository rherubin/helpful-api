# Helpful API

A comprehensive Node.js REST API with MySQL backend featuring user management, JWT authentication, a flexible pairing system, AI-generated therapy programs with structured program steps, push notification device registration, an admin surface for org codes, and efficient combined endpoints for clients.

## Features

### Core Functionality
- **User Management**: Create, update, soft-delete, and retrieve users with secure password authentication
- **JWT Authentication**: Secure login with access and refresh tokens (default access token **24h**, refresh **14d**, overridable via env)
- **Combined Profile Endpoint**: Single API call for complete user state (profile, premium, org context, pairings)
- **Unified Pairing System**: Request, accept, reject, and soft-delete pairings with partner codes
- **AI Therapy Programs**: OpenAI-backed program generation with **two prompt tracks**: **Helpful** (default, secular EFT/Gottman-style) vs **Hopeful** (faith-based) when the user has an org code or custom org fields — plus automatic retry/follow-up when initial generation fails
- **Program Steps**: Day-based program steps per program with message threading, unlock tracking, and optional paired “therapy response” system messages

### Advanced Features  
- **Smart Pairing Responses**: Pending requests show `partner: null`, accepted pairings show full partner data
- **Org Code Premium**: Users can gain premium status by validating an org code or self-registering org details — no iOS/Android subscription required
- **Push notifications**: Register FCM device tokens (iOS/Android/web); sends are no-ops when Firebase is not configured
- **Admin auth & org administration**: Separate admin JWT flow (`/api/admin/auth/*`) for managing org codes, including per-org LLM prompt overrides (not exposed to non-admin list responses)
- **Rate Limiting**: Configurable limits (1000 req/15min general API, 100 req/15min login, **3 req/5min** for `PUT /api/users/:id` unless `USER_UPDATE_RATE_LIMIT` is overridden)
- **Comprehensive Testing**: `npm test` runs the consolidated suite; additional test scripts are listed under [Testing](#testing)
- **Complete Pairing System**: Full end-to-end pairing workflow with acceptance, rejection, and profile integration
- **Password Security**: Bcrypt hashing with strict password requirements (uppercase, lowercase, number, special char)
- **Token Management**: Configurable access token lifetime (default **24h**) with refresh token rotation
- **Refresh Token Rotation**: Automatic token rotation with sliding expiration window (14 days)
- **Automatic Refresh Token Extension**: Refresh tokens automatically reset to 14-day expiration on every authenticated API call
- **Database Integrity**: MySQL with automatic schema creation and proper JOIN handling
- **RESTful Design**: Clean, consistent API with comprehensive error handling and status codes
- **Railway Deployment**: Optimized for Railway platform with MySQL database service

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a `.env` file in the root directory. **`PORT` is required** (Railway injects it automatically; for local development set e.g. `PORT=9000` or the server will exit on startup).
   ```
   PORT=9000
   HOST=0.0.0.0
   
   # MySQL Database Configuration
   MYSQL_HOST=localhost
   MYSQL_PORT=3306
   MYSQL_USER=root
   MYSQL_PASSWORD=your_password
   MYSQL_DATABASE=helpful_db
   
   # Or use MySQL connection URL (preferred for Railway)
   # MYSQL_URL=mysql://user:password@host:port/database
   
   # JWT Configuration
   JWT_SECRET=your-secret-key-change-in-production
   JWT_REFRESH_SECRET=your-refresh-secret-key-change-in-production
   JWT_EXPIRES_IN=24h  # Access token expiry (default: 24h)
   JWT_REFRESH_EXPIRES_IN=14d  # Refresh token expiry (default: 14 days)

   # JWT Response Configuration (optional - calculated from above if not set)
   JWT_ACCESS_TOKEN_EXPIRES_IN_SECONDS=86400  # 24 hours in seconds
   JWT_REFRESH_TOKEN_EXPIRES_IN_SECONDS=1209600  # 14 days in seconds
   
   # OpenAI API (program + step messaging features)
   OPENAI_API_KEY=your-openai-api-key-for-therapy-content
   # OPENAI_MODEL=gpt-4o  # Optional: override the default OpenAI model

   # Optional: rate limit for PUT /api/users/:id (org code / profile updates)
   # USER_UPDATE_RATE_LIMIT=3

   # Optional: rate limit for POST /api/device-tokens (default 10 req/5min per IP)
   # DEVICE_TOKEN_RATE_LIMIT=10

   # Optional: program generation — second LLM attempt after failures (default on; ~60s delay)
   # PROGRAM_GENERATION_FOLLOWUP_ENABLED=true
   # PROGRAM_GENERATION_FOLLOWUP_DELAY_MS=60000

   # Optional: default steps_required_for_unlock when creating a program (default 0)
   # DEFAULT_STEPS_REQUIRED_FOR_UNLOCK=0

   # Optional: background poller for programs flagged regenerate_therapy_response
   # REGENERATION_POLL_INTERVAL_MS=30000

   # Optional: testing / CI — deterministic mock LLM responses (no tokens)
   # TEST_MOCK_LLM=true

   # Optional: Firebase Cloud Messaging (JSON string or path to service account)
   # FIREBASE_SERVICE_ACCOUNT_JSON=
   # FIREBASE_SERVICE_ACCOUNT_PATH=
   # TEST_MOCK_PUSH=true
   ```

3. **Database Setup**:
   
   ### Local Development
   
   **Option 1: Local MySQL**
   1. Install MySQL 8.0+
   2. Create a database:
      ```sql
      CREATE DATABASE helpful_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
      ```
   3. Update your `.env` file with MySQL credentials
   4. Start the server - tables will be created automatically
   
   **Option 2: Docker MySQL**
   ```bash
   docker run --name helpful-mysql \
     -e MYSQL_ROOT_PASSWORD=password \
     -e MYSQL_DATABASE=helpful_db \
     -p 3306:3306 \
     -d mysql:8.0
   ```
   
   ### Railway Deployment
   
   For production deployment on Railway:
   1. See [RAILWAY_SETUP.md](./RAILWAY_SETUP.md) for detailed instructions
   2. Add MySQL database service in Railway dashboard
   3. Railway automatically provides `MYSQL_URL` environment variable
   4. Set `JWT_SECRET`, `JWT_REFRESH_SECRET`, and `OPENAI_API_KEY`
   
   **Automatic Schema Creation**:
   - All tables are created automatically on first connection
   - Proper indexes and foreign keys are set up automatically
   - No manual SQL migration needed

4. Start the server:
   ```bash
   npm start
   ```

   Or for development with auto-restart:
   ```bash
   npm run dev
   ```

## 🎯 Quick Reference

### Most Important Endpoints
- **`GET /health`** - Liveness probe (plain text `OK`)
- **`GET /health/diagnostics`** - JSON (`test_mock_llm`, etc.) for local/integration checks
- **`GET /api/profile`** - Complete user profile with pairings and org summary (recommended)
- **`POST /api/login`** - User authentication
- **`POST /api/refresh`** / **`POST /api/logout`** - Token rotation and logout
- **`POST /api/token-info`** - Decode access token metadata (no signature verification; debugging)
- **`POST /api/pairing/request`** - Create partner code for pairing (**201**)
- **`POST /api/pairing/accept`** - Accept pairing with partner code (**200**, empty body)
- **`GET /api/pairings`** - All pairings (accepted + pending) for current user
- **`DELETE /api/pairing/:pairingId`** - Soft-delete a pairing (must be a participant)
- **`GET /api/org-codes`** - List org codes (LLM prompt fields omitted unless caller is admin)
- **`POST /api/org-codes`** / **`GET|PUT|DELETE /api/org-codes/:id`** - Org code admin CRUD (**admin JWT**)
- **`GET /api/org-codes/audit/org-linkages`** - Org linkage audit logs (**admin**)
- **`POST /api/subscription`** - Submit iOS/Android subscription receipts
- **`GET /api/subscription`** - Active subscription / premium summary
- **`GET /api/subscription/receipts`** - Stored receipts for current user
- **`POST|GET|DELETE /api/device-tokens`** - Push device token registration
- **`GET /api/programs/metrics`** - Prompt-service queue/latency metrics (both tracks)
- **`GET /api/programs/:id/programSteps`** - Program steps for a program
- **`POST /api/programSteps/:id/messages`** - Add message to a program step
- **`GET /api/programSteps/:id/messages`** - Messages for a program step
- **`GET /api/messages-stats?date=&programId=`** - Message stats since epoch (authenticated)
- **`POST /api/admin/auth/login`** (etc.) - Admin accounts (separate from app users)

### Key Features
- ✅ **Combined Profile Endpoint**: Single call for complete user state (including `premium` and org summary)
- ✅ **Unified Pairings**: Both accepted and pending pairings in one array
- ✅ **Program steps + messaging**: REST surface under `/api/programs/...` and `/api/programSteps/...`
- ✅ **Rate Limited**: 1000 requests per 15 minutes for general API (plus stricter login / profile-update limits)
- ✅ **JWT Authentication**: Access + refresh tokens with rotation (`npm test` exercises core flows)

### API Design Philosophy
- **Clean Responses**: Minimal, essential data only - no unnecessary nesting or metadata
- **Efficient Structure**: Array-based responses instead of complex nested objects
- **Structured Data**: Program steps returned as structured arrays instead of raw JSON responses
- **Separation of Concerns**: Messages fetched separately when needed, not bundled with program steps
- **RESTful Design**: Intuitive endpoints that follow REST conventions
- **Performance First**: Optimized for speed and minimal bandwidth usage

## API Endpoints

**Note**: User profiles now use `user_name` and `partner_name` fields for relationship information instead of generic first/last names.

### 🚀 User Profile (Recommended - Most Efficient)

#### Get User Profile with Pairings (Combined)
- **GET** `/api/profile`
- **Headers:** `Authorization: Bearer {access_token}`
- **Description:** 🎯 **Most efficient endpoint** - Returns the authenticated user's complete profile combined with all their pairing information (both accepted and pending) in a single API call
- **Response:**
  ```json
  {
    "message": "User profile retrieved successfully",
    "profile": {
      "id": "user_id",
      "email": "user@example.com",
      "user_name": "John",
      "partner_name": "Jane",
      "children": 2,
      "max_pairings": 1,
      "premium": false,
      "org_id": null,
      "org_name": null,
      "org_city": null,
      "org_state": null,
      "created_at": "2024-01-01T00:00:00.000Z",
      "updated_at": "2024-01-01T00:00:00.000Z",
      "pairings": [
        {
          "id": "accepted_pairing_id",
          "status": "accepted",
          "partner_code": "ABC123",
          "created_at": "2024-01-01T00:30:00.000Z",
          "updated_at": "2024-01-01T00:35:00.000Z",
          "partner": {
            "id": "partner_user_id",
            "user_name": "Jane",
            "email": "jane.doe@example.com"
          }
        },
        {
          "id": "pending_pairing_id",
          "status": "pending",
          "partner_code": "XYZ789",
          "created_at": "2024-01-01T00:45:00.000Z",
          "updated_at": "2024-01-01T00:45:00.000Z",
          "partner": null
        }
      ],
      "pairing_codes": ["ABC123", "XYZ789"]
    }
  }
  ```

**✨ Why Use This Endpoint:**
- **Single API Call**: Get complete user state without multiple requests
- **Comprehensive Data**: User info + all pairings (accepted & pending) in one array
- **Pairing Codes Array**: Quick access to all partner codes without parsing pairings
- **Optimized Performance**: Reduces network calls and improves app responsiveness
- **Real-time State**: Always returns current pairing status

**📋 Data Explanation:**
- **`pairings`**: Contains both accepted pairings (with full partner info) and pending requests (with `partner: null`)
- **`pairing_codes`**: Array of all partner codes for this user (both accepted and pending) for quick access
- **`premium`**: `true` if the user has org-based premium (`is_premium`) or premium access through any accepted pairing subscription
- **`org_id` / `org_*`**: When the user is linked to an admin-managed org code, these reflect that record; otherwise custom on-profile org fields (`org_name`, `org_city`, `org_state`) are returned when set

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
- **Response:** User payload and tokens are nested under `data` (top-level `message` plus `data`).
  ```json
  {
    "message": "Login successful",
    "data": {
      "user": {
        "id": "unique_id",
        "email": "user@example.com",
        "user_name": "John",
        "partner_name": "Jane",
        "children": 2,
        "max_pairings": 1,
        "premium": false,
        "created_at": "2024-01-01T00:00:00.000Z"
      },
      "access_token": "jwt_token",
      "refresh_token": "refresh_jwt_token",
      "expires_in": 86400,
      "refresh_expires_in": 1209600
    }
  }
  ```
  **`expires_in` / `refresh_expires_in`** are **seconds** (derived from `JWT_*_EXPIRES_IN` / `JWT_*_EXPIRES_IN_SECONDS`; default access **24h**, refresh **14d**).

#### Refresh Token
- **POST** `/api/refresh`
- **Description:** Refreshes the access token and rotates the refresh token for enhanced security. The old refresh token is invalidated and a new one is issued.
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
    "refresh_token": "new_refresh_jwt_token",
    "expires_in": 86400,
    "refresh_expires_in": 1209600
  }
  ```
- **Security Note:**
  - The old refresh token is immediately invalidated after use
  - A new refresh token is issued with extended expiration (sliding window)
  - This prevents refresh token reuse and enhances security
  - Always store the new refresh token for subsequent refresh requests

#### Automatic Refresh Token Extension
- **Automatic**: Every time a valid access token is used for any authenticated API call, the associated refresh token expiration is automatically reset to 14 days from that moment
- **Non-blocking**: The token extension happens asynchronously in the background and does not slow down API responses
- **User Experience**: Active users effectively have "infinite" session duration as long as they use the API regularly
- **Security**: Inactive users' refresh tokens still expire normally, preventing abandoned sessions

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

#### Token info (debug)
- **POST** `/api/token-info`
- **Body:** `{ "access_token": "jwt..." }`
- **Description:** Decodes JWT payload **without verifying the signature** — for local debugging only. Returns issued/expiry times, user id/email, and `is_expired`.

### Subscriptions

#### Submit Subscription Receipt
- **POST** `/api/subscription`
- **Headers:** `Authorization: Bearer {access_token}`
- **Body (iOS):**
  ```json
  {
    "platform": "ios",
    "product_id": "com.helpful.yearly.29.99",
    "transaction_id": "ios_txn_123",
    "original_transaction_id": "ios_txn_123",
    "jws_receipt": "base64_jws_receipt",
    "environment": "Production",
    "purchase_date": 1737390462000,
    "expiration_date": 1768926462000
  }
  ```
- **Body (Android):**
  ```json
  {
    "platform": "android",
    "product_id": "com.helpful.yearly.29.99",
    "purchase_token": "token_from_google",
    "order_id": "GPA.1234-5678-9012-34567",
    "package_name": "com.helpful.app",
    "purchase_date": 1737390462000,
    "expiration_date": 1768926462000
  }
  ```
- **Notes:**
  - `environment` must be `Production` or `Sandbox` (case-insensitive accepted).
  - `purchase_date` and `expiration_date` must be positive millisecond timestamps.
  - If a receipt belongs to another user, the API returns `409 Conflict`.
  - **Premium Access**: Premium status is granted to pairings, not individual users. When a user purchases a subscription, all their accepted pairings become premium-enabled, allowing both partners access to premium features.

#### Get Subscription Status
- **GET** `/api/subscription`
- **Headers:** `Authorization: Bearer {access_token}`
- **Response:**
 ```json
 {
   "premium": true,
   "active_subscriptions": 1,
   "latest_expiration": 1768926462000,
   "subscriptions": [
     {
       "id": "subscription_id",
       "platform": "ios",
       "product_id": "com.helpful.yearly.29.99",
       "expiration_date": 1768926462000,
       "purchase_date": 1737390462000
     }
   ]
 }
 ```
- **Notes:**
  - `premium`: Whether the user has access to premium features through any of their accepted pairings
  - Premium access is pairing-based: users get premium access when they have accepted pairings where at least one partner has an active subscription

#### Get Stored Receipts
- **GET** `/api/subscription/receipts`
- **Headers:** `Authorization: Bearer {access_token}`
- **Response:**
  ```json
  {
    "message": "Receipts retrieved successfully",
    "data": {
      "ios_receipts": [],
      "android_receipts": [],
      "total_receipts": 0
    }
  }
  ```

### User Management

#### Create User
- **POST** `/api/users`
- **Body:**
  ```json
  {
    "email": "user@example.com",
    "password": "Test1!@#"
  }
  ```
  **Note**: Only `email` and `password` are required.
- **Response:**
  ```json
  {
    "message": "Account created successfully",
    "user": {
      "id": "unique_id",
      "email": "user@example.com",
      "user_name": null,
      "partner_name": null,
      "children": null
    },
    "access_token": "jwt_token",
    "refresh_token": "refresh_jwt_token", 
    "expires_in": 3600,
    "refresh_expires_in": 604800,
    "pairings": [
      {
        "id": "pairing_id",
        "status": "pending",
        "partner_code": "ABC123",
        "created_at": "2024-01-01T00:00:00.000Z",
        "updated_at": "2024-01-01T00:00:00.000Z",
        "partner": null
      }
    ],
    "pairing_code": "ABC123"
  }
  ```
  **Note**: 
  - The response now includes a `pairings` array containing the user's current pairings
  - A pairing request is automatically created for new users
  - The `pairing_code` field contains the partner code for sharing (when automatic pairing is created)
  - User object excludes sensitive fields (`max_pairings`, `created_at`, `password_hash`)


#### Get User by ID
- **GET** `/api/users/:id`
- **Headers:** `Authorization: Bearer {access_token}`
- **Response:** User object with computed `premium` and org summary fields (not wrapped in `{ user: ... }`).

#### Update User
- **PUT** `/api/users/:id`
- **Headers:** `Authorization: Bearer {access_token}`
- **Rate Limit:** Default 3 requests per 5 minutes per IP (`USER_UPDATE_RATE_LIMIT`)
- **Description:** Update user profile including relationship details and org association. Users can only update their own profile.
- **Body:**
  ```json
  {
    "email": "johnny.smith@example.com",
    "user_name": "Johnny",
    "partner_name": "Sarah",
    "children": 2
  }
  ```
- **Response:**
  ```json
  {
    "message": "User updated successfully",
    "user": {
      "id": "unique_id",
      "email": "johnny.smith@example.com",
      "user_name": "Johnny",
      "partner_name": "Sarah",
      "children": 2,
      "max_pairings": 1,
      "premium": false,
      "org_code_id": null,
      "org_name": null,
      "org_city": null,
      "org_state": null,
      "created_at": "2024-01-01T00:00:00.000Z",
      "updated_at": "2024-01-01T01:00:00.000Z"
    }
  }
  ```
  **Note**: All fields are optional. Only provided fields will be updated. The `children` field must be a non-negative integer if provided.

##### Associating an Org Code (Premium via Org)

Passing a valid `org_code` string activates premium status on the user record without requiring an iOS/Android subscription. This is an alternative premium pathway for users affiliated with an organization.

**Path A — Validate an existing org code:**
- Pass the `org_code` string. The API looks it up, checks it is not expired, links it to the user, and sets `premium: true`.
  ```json
  {
    "org_code": "ACME2024"
  }
  ```
  - `400 Invalid org code` — code does not exist
  - `400 Org code has expired` — code exists but its `expires_at` has passed

**Path B — Create a new org record on the fly:**
- Omit `org_code` but supply all three of `org_name`, `org_city`, and `org_state`. The API creates a new org_codes record with a generated unique code, links it to the user, and sets `premium: true`. All three fields are required together; providing fewer than three has no org side-effect.
  ```json
  {
    "org_name": "Acme Health",
    "org_city": "Austin",
    "org_state": "TX"
  }
  ```

**Response when premium is granted (either path):**
```json
{
  "message": "User updated successfully",
  "user": {
    "id": "unique_id",
    "premium": true,
    "org_code_id": "abc123",
    "org_name": "Acme Health",
    "org_city": "Austin",
    "org_state": "TX",
    "created_at": "2024-01-01T00:00:00.000Z",
    "updated_at": "2024-01-01T01:00:00.000Z"
  }
}
```

**Rate limiting note:** This endpoint is throttled at 3 requests per 5 minutes per IP by default (`USER_UPDATE_RATE_LIMIT`) to prevent org code farming/enumeration attacks. Exceeding the limit returns `429 Too Many Requests`.

#### Soft-delete user
- **DELETE** `/api/users/:id`
- **Headers:** `Authorization: Bearer {access_token}`
- **Description:** Soft-deletes the user (and cascades per model rules).

#### Restore user
- **PATCH** `/api/users/:id/restore`
- **Headers:** `Authorization: Bearer {access_token}`
- **Description:** Restores a soft-deleted user record.

#### List deleted users
- **GET** `/api/users/deleted/all`
- **Headers:** `Authorization: Bearer {access_token}`
- **Description:** Returns users in deleted state (support/admin-style).

### Organization Code Management

Organization codes are used to manage organizational access and configuration. They contain organization information and can include address details. **Admin JWT** (`POST /api/admin/auth/login`) is required to create, read by id, update, delete org codes, or view audit logs. Regular authenticated **app** users can **list** org codes; LLM prompt fields (`initial_program_prompt`, `next_program_prompt`, `therapy_response_prompt`) are **stripped** from that list unless the caller’s token has `type: "admin"`.

#### Create Organization Code
- **POST** `/api/org-codes`
- **Headers:** `Authorization: Bearer {access_token}` (Admin required)
- **Description:** Creates a new organization code with organization details and optional address information
- **Body:**
  ```json
  {
    "org_code": "ACME123",
    "organization": "ACME Corporation",
    "address1": "123 Business St",
    "address2": "Suite 456",
    "city": "Business City",
    "state": "BC",
    "postalCode": "12345",
    "expires_at": "2025-12-31T23:59:59.000Z"
  }
  ```
- **Required Fields:** `org_code`, `organization`
- **Optional Fields:** `address1`, `address2`, `city`, `state`, `postalCode`, `expires_at`
- **Response:**
  ```json
  {
    "message": "Org code created successfully",
    "org_code": {
      "id": "unique_id",
      "org_code": "ACME123",
      "organization": "ACME Corporation",
      "address1": "123 Business St",
      "address2": "Suite 456",
      "city": "Business City",
      "state": "BC",
      "postalCode": "12345",
      "expires_at": "2025-12-31T23:59:59.000Z",
      "created_at": "2024-01-01T00:00:00.000Z",
      "updated_at": "2024-01-01T00:00:00.000Z"
    }
  }
  ```
- **Error Responses:**
  - `400`: `org_code already exists` or `org_code and organization are required`
  - `403`: Admin access required

#### Get All Organization Codes
- **GET** `/api/org-codes`
- **Headers:** `Authorization: Bearer {access_token}` (any authenticated **app** user; **admin** tokens list with prompt fields intact)
- **Description:** Returns all organization codes with address information. For non-admin callers, `initial_program_prompt`, `next_program_prompt`, and `therapy_response_prompt` are omitted.
- **Response:**
  ```json
  {
    "message": "Org codes retrieved successfully",
    "org_codes": [
      {
        "id": "unique_id",
        "org_code": "ACME123",
        "organization": "ACME Corporation",
        "address1": "123 Business St",
        "address2": "Suite 456",
        "city": "Business City",
        "state": "BC",
        "postalCode": "12345",
        "expires_at": "2025-12-31T23:59:59.000Z",
        "created_at": "2024-01-01T00:00:00.000Z",
        "updated_at": "2024-01-01T00:00:00.000Z"
      }
    ]
  }
  ```

#### Org linkage audit (admin)
- **GET** `/api/org-codes/audit/org-linkages`
- **Headers:** `Authorization: Bearer {admin_access_token}`
- **Query:** optional `user_id`, `limit`, `offset`
- **Description:** Returns `user_org_code_audit_logs` entries for org-code linkage changes.

#### Get Organization Code by ID
- **GET** `/api/org-codes/:id`
- **Headers:** `Authorization: Bearer {access_token}` (Admin required)
- **Description:** Returns a specific organization code by its ID
- **Response:**
  ```json
  {
    "message": "Org code retrieved successfully",
    "org_code": {
      "id": "unique_id",
      "org_code": "ACME123",
      "organization": "ACME Corporation",
      "address1": "123 Business St",
      "address2": "Suite 456",
      "city": "Business City",
      "state": "BC",
      "postalCode": "12345",
      "expires_at": "2025-12-31T23:59:59.000Z",
      "created_at": "2024-01-01T00:00:00.000Z",
      "updated_at": "2024-01-01T00:00:00.000Z"
    }
  }
  ```
- **Error Responses:**
  - `403`: Admin access required
  - `404`: OrgCode not found

#### Update Organization Code
- **PUT** `/api/org-codes/:id`
- **Headers:** `Authorization: Bearer {access_token}` (Admin required)
- **Description:** Updates an organization code with new information. All fields are optional - only provided fields will be updated
- **Body:**
  ```json
  {
    "organization": "Updated ACME Corporation",
    "address1": "456 Updated St",
    "city": "Updated City",
    "state": "UC",
    "postalCode": "67890"
  }
  ```
- **Response:**
  ```json
  {
    "message": "Org code updated successfully",
    "org_code": {
      "id": "unique_id",
      "org_code": "ACME123",
      "organization": "Updated ACME Corporation",
      "address1": "456 Updated St",
      "address2": "Suite 456",
      "city": "Updated City",
      "state": "UC",
      "postalCode": "67890",
      "expires_at": "2025-12-31T23:59:59.000Z",
      "created_at": "2024-01-01T00:00:00.000Z",
      "updated_at": "2024-01-01T01:00:00.000Z"
    }
  }
  ```
- **Error Responses:**
  - `403`: Admin access required
  - `404`: OrgCode not found
  - `400`: `org_code already exists`

#### Delete Organization Code
- **DELETE** `/api/org-codes/:id`
- **Headers:** `Authorization: Bearer {access_token}` (Admin required)
- **Description:** Deletes an organization code permanently
- **Response:**
  ```json
  {
    "message": "OrgCode deleted successfully"
  }
  ```
- **Error Responses:**
  - `403`: Admin access required
  - `404`: OrgCode not found

### Pairing System

**New Pairing Flow**: The pairing system now uses a two-step process:
1. **Request**: A user creates a temporary partner code without specifying who they want to pair with
2. **Accept**: Another user uses that partner code to pair with the original user

This makes pairing more flexible since you don't need to know the other person's pairing code in advance.

#### Request Pairing
- **POST** `/api/pairing/request`
- **Headers:** `Authorization: Bearer {access_token}`
- **Body:** No body required
- **Response:** **201 Created**
  ```json
  {
    "message": "Partner code generated successfully. Share this code with someone to pair with you.",
    "partner_code": "ABC123",
    "pairing_id": "pairing_id",
    "requester": {
      "id": "user_id",
      "user_name": "John",
      "email": "john.doe@example.com"
    },
    "expires_note": "This partner code is valid until someone uses it or you cancel the request."
  }
  ```
  **Note**: This generates a temporary partner code that others can use to pair with you. The response includes your information so you can share it along with the partner code.

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
- **Response:** `200 OK` (empty response body)
  
  **Note**: On successful pairing acceptance, only a 200 status code is returned. Use the "Get Accepted Pairings" endpoint to retrieve pairing details if needed.

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

#### Get User's Pairings (All - Accepted & Pending)
- **GET** `/api/pairings`
- **Headers:** `Authorization: Bearer {access_token}`
- **Description:** Returns all pairings for the authenticated user, including both accepted pairings and pending pairing requests
- **Response:**
  ```json
  {
    "message": "User pairings retrieved successfully",
    "pairings": [
      {
        "id": "accepted_pairing_id",
        "status": "accepted",
        "partner_code": "ABC123",
        "created_at": "2025-01-20T10:30:00.000Z",
        "updated_at": "2025-01-20T10:35:00.000Z",
        "partner": {
          "id": "partner_user_id",
          "user_name": "Jane",
          "email": "jane.doe@example.com"
        }
      },
      {
        "id": "pending_pairing_id",
        "status": "pending",
        "partner_code": "XYZ789",
        "created_at": "2025-01-20T10:45:00.000Z",
        "updated_at": "2025-01-20T10:45:00.000Z",
        "partner": null
      }
    ]
  }
  ```

**Note**: This endpoint now returns both accepted pairings and pending pairing requests in a single response, sorted by creation date (most recent first). For pending partner code requests, the `partner` field will be `null` until someone accepts the code. Only partner information is returned (not your own user data).

#### Get Pending Pairings
- **GET** `/api/pairing/pending`
- **Headers:** `Authorization: Bearer {access_token}`
- **Response:**
  ```json
  {
    "message": "Pending pairings retrieved successfully",
    "pairings": [
      {
        "id": "pairing_id",
        "status": "pending",
        "partner_code": "XYZ789",
        "created_at": "2025-01-20T10:30:00.000Z",
        "updated_at": "2025-01-20T10:30:00.000Z",
        "partner": {
          "id": "partner_user_id",
          "user_name": "PendingUser",
          "email": "pending@example.com"
        }
      }
    ]
  }
  ```

#### Get Accepted Pairings
- **GET** `/api/pairing/accepted`
- **Headers:** `Authorization: Bearer {access_token}`
- **Response:**
  ```json
  {
    "message": "Accepted pairings retrieved successfully",
    "pairings": [
      {
        "id": "pairing_id",
        "status": "accepted",
        "partner_code": "ABC123",
        "created_at": "2025-01-20T10:30:00.000Z",
        "updated_at": "2025-01-20T10:35:00.000Z",
        "partner": {
          "id": "partner_user_id",
          "user_name": "Jane",
          "email": "jane.doe@example.com"
        }
      }
    ]
  }
  ```

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

#### Soft-delete pairing
- **DELETE** `/api/pairing/:pairingId`
- **Headers:** `Authorization: Bearer {access_token}`
- **Description:** Soft-deletes the pairing; caller must be `user1_id` or `user2_id`.

#### Restore pairing
- **PATCH** `/api/pairing/:pairingId/restore`
- **Headers:** `Authorization: Bearer {access_token}`
- **Description:** Restores a soft-deleted pairing (intended for admin/support tooling).

#### List deleted pairings
- **GET** `/api/pairing/deleted/all`
- **Headers:** `Authorization: Bearer {access_token}`
- **Description:** Returns soft-deleted pairings (support/admin-style endpoint).

### Programs

Programs are AI-generated couples therapy programs that can be created with or without pairings. Each program contains structured daily exercises. When a program is created, the API runs LLM generation **asynchronously** (immediate HTTP response, then steps appear once generation completes).

**Helpful vs Hopeful:** Program generation picks a prompt stack per user: **Helpful** (default, secular EFT/Gottman-oriented) or **Hopeful** (faith-based) when the user has a linked admin **org code** (with optional per-org prompt overrides) **or** custom org fields on their profile (`org_name` / `org_city` / `org_state`). Pairing-based **step messages** use the same selection for chime-in and couples therapy responses.

**Reliability:** If the first LLM call fails, a **follow-up attempt** is scheduled after `PROGRAM_GENERATION_FOLLOWUP_DELAY_MS` (default **60000** ms) unless `PROGRAM_GENERATION_FOLLOWUP_ENABLED=false`. Persistent failures set `generation_error` on the program row.

**Key Features:**
- **AI-Generated Content**: Each program is structured as **14** day-level steps once generation succeeds
- **Flexible Pairing**: Programs can be created with or without `pairing_id` (pairing must be **accepted** for paired step messaging / couples therapy responses)
- **Program owner must set `user_name`**: `POST /api/programs` returns **400** if `user_name` is missing on the profile
- **Observability:** `GET /api/programs/metrics` exposes queue/latency counters for both prompt services

**Privacy / fields:** `GET /api/programs` and `GET /api/programs/:id` both return `user_input` and `pairing_id` for authorized users (owner or accepted pair partner). Raw `therapy_response` is not included in these responses.

#### Create Program
- **POST** `/api/programs`
- **Headers:** `Authorization: Bearer {access_token}`
- **Success:** **201 Created**
- **Body:**
  ```json
  {
    "user_input": "I feel less and less connected with my wife. I want a plan that will help us have what we used to. We would laugh and joke all the time and now things feel disconnected and distant",
    "pairing_id": "pairing_id",
    "steps_required_for_unlock": 5
  }
  ```
  **Note**: 
  - `pairing_id` is optional. Programs can be created independently without a pairing.
  - `steps_required_for_unlock` is optional; if omitted it defaults to `DEFAULT_STEPS_REQUIRED_FOR_UNLOCK` (**0** when that env var is unset). This is how many distinct steps must have at least one message before `next_program_unlocked` becomes `true`.
  - Set `user_name` (and ideally `partner_name`) via `PUT /api/users/:id` before creating a program.
  - Initial generation runs in the background after **201/200** returns; poll `GET /api/programs/:id` or `GET /api/programs/:id/programSteps` for steps. If generation fails, check the program row / logs for `generation_error`, or call the manual endpoint below.
- **Response:**
  ```json
  {
    "message": "Program created successfully",
    "program": {
      "id": "unique_id",
      "user_id": "user_id",
      "user_input": "I feel less and less connected with my wife...",
      "pairing_id": "pairing_id",
      "steps_required_for_unlock": 5,
      "next_program_unlocked": false,
      "created_at": "2024-01-01T00:00:00.000Z"
    }
  }
  ```

#### Generate Therapy Response Manually
- **POST** `/api/programs/:program_id/therapy_response`
- **Headers:** `Authorization: Bearer {access_token}`
- **Description:** Manually trigger therapy response generation for a program. Use this if automatic generation failed or if program steps are missing.
- **Response (202 Accepted):**
  ```json
  {
    "message": "Therapy response generation started",
    "program_id": "program_id",
    "status": "processing"
  }
  ```
- **Error Responses:**
  
  **409 Conflict** - Program already has therapy response:
  ```json
  {
    "error": "Therapy response already exists for this program",
    "details": "This program already has program steps. Delete the program and create a new one if you need to regenerate.",
    "existing_steps_count": 14
  }
  ```
  
  **503 Service Unavailable** - Prompt service not configured:
  ```json
  {
    "error": "Prompt service is not configured. Please set OPENAI_API_KEY.",
    "details": "An LLM API key is required to generate therapy responses."
  }
  ```
  
  **Note**: The therapy response is generated asynchronously with the same follow-up behavior as automatic generation. Check program steps after a short delay. This endpoint returns **409** if steps already exist. **503** if no prompt service is configured (`OPENAI_API_KEY`).

#### Prompt service metrics
- **GET** `/api/programs/metrics`
- **Headers:** `Authorization: Bearer {access_token}`
- **Description:** JSON snapshot of request counts, timing, and queue depth for **Hopeful** and **Helpful** services (each includes `configured` and `model` when active).

#### Get User's Programs
- **GET** `/api/programs`
- **Headers:** `Authorization: Bearer {access_token}`
- **Description:** Returns all programs for the authenticated user with their program steps.
- **Response:**
  ```json
  {
    "message": "Programs retrieved successfully",
    "programs": [
      {
        "id": "unique_id",
        "user_id": "user_id",
        "user_input": "I feel less and less connected with my wife...",
        "pairing_id": "pairing_id",
        "steps_required_for_unlock": 5,
        "next_program_unlocked": false,
        "created_at": "2024-01-01T00:00:00.000Z",
        "updated_at": "2024-01-01T00:00:00.000Z",
        "program_steps": [
          {
            "id": "step_id",
            "day": 1,
            "theme": "Reflecting on Happy Memories",
            "conversation_starter": "Hey Steve, do you remember the time we went on that spontaneous road trip?",
            "science_behind_it": "Reflecting on happy memories together can help strengthen emotional bonds...",
            "started": false,
            "created_at": "2024-01-01T00:00:00.000Z",
            "updated_at": "2024-01-01T00:00:00.000Z"
          }
        ]
      }
    ]
  }
  ```

#### Get Program by ID
- **GET** `/api/programs/:id`
- **Headers:** `Authorization: Bearer {access_token}`
- **Description:** Returns a specific program with its program steps.
- **Response:**
  ```json
  {
    "message": "Program retrieved successfully",
    "program": {
      "id": "unique_id",
      "user_id": "user_id",
      "user_input": "I feel less and less connected with my wife...",
      "pairing_id": "pairing_id",
      "steps_required_for_unlock": 5,
      "next_program_unlocked": false,
      "created_at": "2024-01-01T00:00:00.000Z",
      "updated_at": "2024-01-01T00:00:00.000Z",
      "program_steps": [
        {
          "id": "step_id",
          "day": 1,
          "theme": "Reflecting on Happy Memories",
          "conversation_starter": "Hey Steve, do you remember the time we went on that spontaneous road trip?",
          "science_behind_it": "Reflecting on happy memories together can help strengthen emotional bonds...",
          "created_at": "2024-01-01T00:00:00.000Z",
          "updated_at": "2024-01-01T00:00:00.000Z"
        }
      ]
    }
  }
  ```

#### Create Next Program
- **POST** `/api/programs/:id/next_program`
- **Headers:** `Authorization: Bearer {access_token}`
- **Description:** Creates a follow-up program from an existing one. The caller must have access to the previous program. There is **no** `next_program_unlocked` gate in the current API — this endpoint bases eligibility on ownership/access checks only.
- **Body:**
  ```json
  {
    "user_input": "We've made great progress on communication. Now we want to work on spending more quality time together and being more present.",
    "steps_required_for_unlock": 5
  }
  ```
  **Note**: 
  - `user_input` is required.
  - `steps_required_for_unlock` is optional; when omitted it defaults like `POST /api/programs` (`DEFAULT_STEPS_REQUIRED_FOR_UNLOCK`, default **0**).
  - The new program inherits `pairing_id` from the previous program.
  - User names come from profile / pairing resolution, same as initial program creation.
  - The prompt can include conversation starters from the prior program where users posted messages.
- **Response:**
  ```json
  {
    "message": "Next program created successfully",
    "program": {
      "id": "new_program_id",
      "user_id": "user_id",
      "user_input": "We've made great progress on communication...",
      "pairing_id": "pairing_id",
      "previous_program_id": "previous_program_id",
      "steps_required_for_unlock": 5,
      "next_program_unlocked": false,
      "created_at": "2024-01-15T00:00:00.000Z"
    }
  }
  ```
- **Validation Errors:**
  - `400`: Missing `user_input` field
  - `403`: User doesn't have access to previous program
  - `404`: Previous program not found

**How It Works:**
1. The system retrieves all conversation starters from the previous program where users have posted messages
2. These conversation starters are included in the AI prompt to provide context
3. The AI generates 14 new conversation starters that build upon the previous work
4. The new program is linked to the previous program via `previous_program_id`

#### Delete Program
- **DELETE** `/api/programs/:id`
- **Headers:** `Authorization: Bearer {access_token}`
- **Response:**
  ```json
  {
    "message": "Program deleted successfully",
    "deleted_at": "2024-01-01T00:00:00.000Z"
  }
  ```

### Program Unlock Feature

The program unlock feature tracks user engagement and can require participation across multiple steps before `next_program_unlocked` becomes `true` (drives client UX; **not** a hard gate for `POST /api/programs/:id/next_program`).

**How It Works:**
1. Each program has a `steps_required_for_unlock` threshold (API default **0** when omitted — set `DEFAULT_STEPS_REQUIRED_FOR_UNLOCK` or pass an explicit integer)
2. When users add messages to program steps, the service counts how many steps have at least one message (paired programs count both users)
3. When the count reaches the threshold and the threshold is greater than zero, `next_program_unlocked` flips to `true`
4. After each new message, unlock status is re-checked on a short delay from the request path

**Key Features:**
- **Automatic Tracking**: Updates when messages are added
- **Configurable Threshold**: Per-program via create / next-program bodies or env default
- **Shared Progress**: In paired programs, both users' contributions count

**Example Usage:**
```javascript
// Create a program with custom unlock threshold
POST /api/programs
{
  "user_input": "Help us reconnect",
  "steps_required_for_unlock": 5  // Unlock after 5 steps have messages
}

// Add messages to program steps
POST /api/programSteps/{step_id}/messages
{
  "content": "We tried the exercise today..."
}

// Check unlock status
GET /api/programs/{program_id}
// Response includes:
{
  "steps_required_for_unlock": 5,
  "next_program_unlocked": true  // Unlocked after 5 steps had messages
}
```

**Use Cases:**
- **Progress Gates**: Require users to complete X exercises before accessing advanced content
- **Engagement Tracking**: Ensure consistent participation before program progression
- **Pairing Coordination**: Track combined progress of both users in a relationship
- **Flexible Requirements**: Different programs can have different unlock thresholds based on complexity

### Program Steps

The program steps system allows users to engage with each day of their therapy program. When a program is created, each day automatically gets its own program step containing the AI-generated exercise content. Users can then add their own messages to discuss their progress, experiences, and reflections for each specific day.

**Key Features:**
- **Day-Based Organization**: Each program day (1-14) has its own program step
- **AI Content Integration**: Each day's theme, conversation starter, and science explanation are stored as program steps
- **Background Therapy Responses**: Automatic AI-powered therapeutic guidance when both users engage
- **Separate Message Storage**: Each message is stored as a separate database record for better organization
- **User Participation**: Both users in a pairing can contribute messages to any day's program step
- **Message Management**: Users can add and edit their own messages (**edits**: `content` only on `PUT`); metadata is set server-side for system messages

**Database Structure:**
- **Program Steps Table**: Stores day-level metadata (theme, conversation starter, science explanation)
- **Messages Table**: Stores individual messages within program steps with full user tracking

## Background therapy & step messaging

### Couples therapy response (paired programs)

When a program has an **accepted** `pairing_id`, both partners can post `user_message` rows on the same program step. After **both** users have posted, the API runs **Hopeful** or **Helpful** (per org context) to append one or more **`system`** messages with metadata such as `type: "chime_in_response_1"`, `triggered_by: "both_users_posted"`. Processing is kicked off via `setImmediate` so HTTP responses stay fast.

### Chime-in (“Hopeful” / “Helpful”) prompts

If the **latest** user message contains **`hopeful`** or **`helpful`** (case-insensitive), the API treats it as a request for an extra reflection and may add **`system`** messages with `type: "chime_in_prompt"` (driven by the same prompt service).

### First-step welcome

On the **first** program (no `previous_program_id`), **day 1**, the **first** user message on that step triggers a synchronous welcome **`system`** message (`type: "first_message_welcome"`) that explains the chime-in behavior. The HTTP **201** response from `POST /api/programSteps/:id/messages` can include `system_messages: [...]` in that case.

### Legacy “conversation” routes

Older docs referred to `/api/programs/.../conversations` and `/api/conversations/...`. **Those paths are not mounted in the current server.** Use **`/api/programSteps/...`** for all step messaging.

### Technical notes

- Requires `OPENAI_API_KEY` (or `TEST_MOCK_LLM=true` for deterministic stubs in dev/CI).
- Honors per-org **therapy_response_prompt** on linked org codes when using Hopeful.

### Configuration

The therapy response system requires:

```env
OPENAI_API_KEY=your-openai-api-key-for-therapy-responses
```

Without this configuration, the system will log warnings but continue normal operation without therapy responses.

#### Get All Program Steps (Organized by Days)
- **GET** `/api/programs/:programId/programSteps`
- **Headers:** `Authorization: Bearer {access_token}`
- **Description:** Returns all program steps for a program without messages. Use `GET /programSteps/:id/messages` to get messages for a specific step.
- **Response:**
  ```json
  {
    "message": "Program steps retrieved successfully",
    "total_steps": 14,
    "program_steps": [
      {
        "id": "step_id",
        "day": 1,
        "theme": "Reflecting on Happy Memories",
        "conversation_starter": "Hey Steve, do you remember the time we went on that spontaneous road trip?",
        "science_behind_it": "Reflecting on happy memories together can help strengthen emotional bonds...",
        "started": true,
        "created_at": "2024-01-01T00:00:00.000Z",
        "updated_at": "2024-01-01T00:00:00.000Z"
      },
      {
        "id": "step_id_2",
        "day": 2,
        "theme": "Appreciating Each Other",
        "conversation_starter": "Share three things you appreciate about your partner today...",
        "science_behind_it": "Expressing appreciation strengthens positive emotions...",
        "started": false,
        "created_at": "2024-01-01T00:00:00.000Z",
        "updated_at": "2024-01-01T00:00:00.000Z"
      }
    ]
  }
  ```

#### Get Specific Program Step
- **GET** `/api/programSteps/:id`
- **Headers:** `Authorization: Bearer {access_token}`
- **Response:**
  ```json
  {
    "message": "Program step retrieved successfully",
    "step": {
      "id": "step_id",
      "program_id": "program_id",
      "day": 1,
      "theme": "Reflecting on Happy Memories",
      "conversation_starter": "Hey Steve, do you remember the time we went on that spontaneous road trip?",
      "science_behind_it": "Reflecting on happy memories together can help strengthen emotional bonds...",
      "started": true,
      "created_at": "2024-01-01T00:00:00.000Z",
      "updated_at": "2024-01-01T00:00:00.000Z"
    }
  }
  ```

#### Get All Messages in a Program Step
- **GET** `/api/programSteps/:id/messages`
- **Headers:** `Authorization: Bearer {access_token}`
- **Response:**
  ```json
  {
    "message": "Messages retrieved successfully",
    "step_id": "step_id",
    "messages": [
      {
        "id": "message_id",
        "step_id": "step_id",
        "message_type": "user_message",
        "sender_id": "user_id",
        "content": "Becca and I completed day 1 together! We talked about our first vacation and remembered why we fell in love.",
        "created_at": "2024-01-01T01:00:00.000Z",
        "updated_at": "2024-01-01T01:00:00.000Z"
      }
    ]
  }
  ```

#### Add Message to Program Step
- **POST** `/api/programSteps/:id/messages`
- **Headers:** `Authorization: Bearer {access_token}`
- **Body:**
  ```json
  {
    "content": "This exercise really helped us reconnect! We spent over an hour talking about our favorite memories together."
  }
  ```
- **Response:**
  ```json
  {
    "message": "Message added successfully",
    "data": {
      "id": "message_id",
      "step_id": "step_id",
      "message_type": "user_message",
      "sender_id": "user_id",
      "content": "This exercise really helped us reconnect! We spent over an hour talking about our favorite memories together.",
      "created_at": "2024-01-01T02:00:00.000Z"
    },
    "system_messages": []
  }
  ```
- **Note:** Status **201**. For the first user message on **day 1** of a user's **first** program, `system_messages` may contain a short welcome string; other therapy/system replies are loaded asynchronously — use `GET .../messages` to poll.

#### Update Message in Program Step
- **PUT** `/api/programSteps/:stepId/messages/:messageId`
- **Headers:** `Authorization: Bearer {access_token}`
- **Body:**
  ```json
  {
    "content": "Updated message content with more details about our experience."
  }
  ```
- **Response:**
  ```json
  {
    "message": "Message updated successfully"
  }
  ```
- **Note**: Only the message sender can edit their own messages. System / LLM messages cannot be edited.

### Admin authentication (dashboard / org tooling)

Admin accounts are separate from app users (`admin_users` table). Tokens use the same `JWT_SECRET` as app users but embed `type: "admin"` in the JWT payload; use these with org-code admin routes (`/api/org-codes`, audit, etc.).

| Method | Path | Notes |
|--------|------|--------|
| POST | `/api/admin/auth/login` | Body: `email`, `password`. Same rate limits as app login. |
| POST | `/api/admin/auth/register` | Bootstrap / create admin (protect in production). |
| GET | `/api/admin/auth/profile` | Admin profile. |
| PUT | `/api/admin/auth/profile` | Update admin email / names. |
| POST | `/api/admin/auth/refresh` | Body: `refresh_token` (admin refresh uses `JWT_REFRESH_SECRET`). |
| POST | `/api/admin/auth/logout` | Requires admin **access** token. |

### Device tokens (push)

Device tokens are FCM registration tokens obtained from the Firebase SDK on the client side (iOS, Android, or web). Registering them here allows the server's `PushNotificationService` to fan out push notifications to all of a user's active devices. Token strings are **never** returned to HTTP clients after registration — only the opaque record `id` is exposed, which is used only for deletion.

**Per-user limit:** A user may have at most **25** registered device tokens. Attempting to register a 26th token (without first removing an existing one) returns `400 Device token limit reached`.

#### Register Device Token
- **POST** `/api/device-tokens`
- **Headers:** `Authorization: Bearer {access_token}`
- **Body:**
  ```json
  {
    "device_token": "fcm_registration_token_from_client_sdk",
    "platform": "ios"
  }
  ```
  - `device_token` — required; string between 10–512 characters
  - `platform` — required; one of `"ios"`, `"android"`, `"web"`
- **Rate Limit:** 10 requests per 5 minutes per IP (overridable via `DEVICE_TOKEN_RATE_LIMIT` env var)
- **Response:** `201 Created` on first registration, `200 OK` on idempotent re-registration (same token already exists for the user — only `platform` is updated if it changed):
  ```json
  {
    "message": "Device token registered successfully",
    "device_token": {
      "id": "record_id",
      "platform": "ios"
    }
  }
  ```
  Re-registration returns `message: "Device token updated successfully"`.
- **Error Responses:**
  - `400`: `device_token is required` / `platform is required` / `Invalid platform. Must be one of: ios, android, web` / `Device token limit reached. A user may have at most 25 registered devices`
  - `404`: `User not found`
  - `429`: Rate limit exceeded

#### List Device Tokens
- **GET** `/api/device-tokens`
- **Headers:** `Authorization: Bearer {access_token}`
- **Description:** Returns all device token records for the authenticated user. Token strings are intentionally omitted; use the record `id` to delete.
- **Response:**
  ```json
  {
    "message": "Device tokens retrieved successfully",
    "device_tokens": [
      {
        "id": "record_id",
        "user_id": "user_id",
        "platform": "ios",
        "created_at": "2024-01-01T00:00:00.000Z",
        "updated_at": "2024-01-01T00:00:00.000Z"
      }
    ],
    "count": 1
  }
  ```

#### Delete Device Token
- **DELETE** `/api/device-tokens/:id`
- **Headers:** `Authorization: Bearer {access_token}`
- **Description:** Removes a specific token record by its `id`. Only removes tokens owned by the authenticated user.
- **Response:** `200 OK`
  ```json
  { "message": "Device token deleted successfully" }
  ```
- **Error Responses:**
  - `404`: `Device token not found`

### Push Notification Service (server-side)

`PushNotificationService` (`services/PushNotificationService.js`) is instantiated once at startup and exposed via `app.locals.pushNotificationService`. Routes and background jobs call it to send push notifications to users' registered devices via **Firebase Cloud Messaging (FCM HTTP v1 API)**, which handles delivery to APNs (iOS), FCM (Android), and Web Push.

#### Configuration

Firebase credentials must be provided via one of two env vars:

| Env var | When to use |
|---------|-------------|
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Recommended for Railway/containerized deploys — paste the full service-account JSON as a single-line string |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | Recommended for local dev — path to a service-account JSON file on disk (ensure the file is gitignored) |

If neither is set, the service starts in **unconfigured mode**: every send silently no-ops and returns `{ skipped: true }` — the rest of the API stays healthy. This is the default for local dev and CI environments that don't need real push.

Set `TEST_MOCK_PUSH=true` to force a deterministic in-memory mock that always returns success without making real FCM calls. This mirrors `TEST_MOCK_LLM=true` for the same purpose.

#### High-level API

Use these from routes or background jobs:

```javascript
const push = req.app.locals.pushNotificationService;

// Send to every device registered for one user
await push.sendToUser(userId, payload);

// Fan out the same payload to every device of every user in the array
await push.sendToUsers([userId1, userId2], payload);
```

Both methods automatically **prune dead FCM tokens** — if FCM responds with `registration-token-not-registered` or similar, those token rows are deleted from `device_tokens` so they're never retried.

#### Payload shape

```javascript
{
  // Visible notification (at least one of title/body required unless using data-only)
  title: "You have a new message",
  body: "Your partner just replied.",
  imageUrl: "https://example.com/icon.png",  // optional

  // Arbitrary data (all values coerced to strings per FCM spec)
  data: {
    screen: "program_step",
    step_id: "abc123"
  },

  // iOS / APNs extras (optional)
  badge: 1,
  sound: "default",
  apnsContentAvailable: true,  // silent background push

  // Android extras (optional)
  android: {
    priority: "high",
    channelId: "reminders"
  }
}
```

A payload with **only** `data` (no `title`/`body`) is valid and delivers a silent data push.

#### Low-level API

```javascript
// Send directly to raw FCM token strings (no model lookup, no auto-prune)
await push.sendToTokens(tokenStrings, payload);
// Returns { successCount, failureCount, invalidTokens }
```

#### Dead token cleanup

FCM returns per-token error codes. The high-level `sendToUser` / `sendToUsers` methods automatically call `DeviceToken.removeDeviceTokenByString()` for any token FCM reports as permanently dead (e.g. the app was uninstalled). This keeps the `device_tokens` table lean without any manual maintenance.

#### Status checks

```javascript
push.isConfigured()  // true if Firebase or mock is active
push.isMockMode()    // true if running against TEST_MOCK_PUSH or injected test double
```

### Message stats

- **GET** `/api/messages-stats?date={epoch_ms}&programId={uuid}` (authenticated) — returns aggregate stats for messages since `date` on the given program.

### Health Check
- **GET** `/health`
- **Response:** Plain text `OK` with `Content-Type: text/plain` (suitable for load balancers).

### Diagnostics
- **GET** `/health/diagnostics`
- **Response:** JSON such as `{ "ok": true, "test_mock_llm": false }` for local/CI checks.

## Database Schema

The MySQL database automatically creates the following tables (and incremental migrations add columns on older installs). **`org_codes`**, **`admin_users`**, **`device_tokens`**, **`ios_subscriptions`**, **`android_subscriptions`**, and related indexes/FKs are defined in the matching `models/*.js` files — the snippets below focus on the core app entities.

### Users Table
```sql
CREATE TABLE users (
  id VARCHAR(50) PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  user_name VARCHAR(255) DEFAULT NULL,
  partner_name VARCHAR(255) DEFAULT NULL,
  children INT DEFAULT NULL,
  max_pairings INT DEFAULT 1,
  org_code_id VARCHAR(50) DEFAULT NULL,
  org_name VARCHAR(255) DEFAULT NULL,
  org_city VARCHAR(100) DEFAULT NULL,
  org_state VARCHAR(50) DEFAULT NULL,
  is_premium TINYINT(1) NOT NULL DEFAULT 0,
  bypass_password TINYINT(1) NOT NULL DEFAULT 0,
  deleted_at DATETIME DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_email (email),
  INDEX idx_deleted_at (deleted_at),
  INDEX idx_org_code_id (org_code_id),
  CONSTRAINT fk_users_org_code
    FOREIGN KEY (org_code_id) REFERENCES org_codes(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```
(Plus `user_org_code_audit_logs` for org linkage history — created by the same model.)

### Refresh Tokens Table
```sql
CREATE TABLE refresh_tokens (
  id VARCHAR(50) PRIMARY KEY,
  user_id VARCHAR(50) NOT NULL,
  user_type ENUM('user', 'admin') DEFAULT 'user',
  token VARCHAR(500) UNIQUE NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_id (user_id),
  INDEX idx_user_type (user_type),
  INDEX idx_token (token),
  INDEX idx_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```
App **user** refresh rows align with `users.id`; **admin** rows align with `admin_users.id` (no FK in schema — enforced in services).

### Pairings Table
```sql
CREATE TABLE pairings (
  id VARCHAR(50) PRIMARY KEY,
  user1_id VARCHAR(50) NOT NULL,
  user2_id VARCHAR(50) DEFAULT NULL,
  partner_code VARCHAR(10) DEFAULT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  premium TINYINT(1) NOT NULL DEFAULT 0,
  deleted_at DATETIME DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_user1_id (user1_id),
  INDEX idx_user2_id (user2_id),
  INDEX idx_partner_code (partner_code),
  INDEX idx_status (status),
  INDEX idx_premium (premium),
  INDEX idx_deleted_at (deleted_at),
  FOREIGN KEY (user1_id) REFERENCES users (id) ON DELETE CASCADE,
  FOREIGN KEY (user2_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### Programs Table
```sql
CREATE TABLE programs (
  id VARCHAR(50) PRIMARY KEY,
  user_id VARCHAR(50) NOT NULL,
  user_input TEXT NOT NULL,
  pairing_id VARCHAR(50) DEFAULT NULL,
  previous_program_id VARCHAR(50) DEFAULT NULL,
  therapy_response LONGTEXT DEFAULT NULL,
  generation_prompt LONGTEXT DEFAULT NULL,
  generation_error TEXT DEFAULT NULL,
  regenerate_therapy_response BOOLEAN DEFAULT FALSE,
  llm_used VARCHAR(100) DEFAULT NULL,
  seconds_to_load DECIMAL(8,4) DEFAULT NULL,
  steps_required_for_unlock INT DEFAULT 7,
  next_program_unlocked BOOLEAN DEFAULT FALSE,
  deleted_at DATETIME DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_user_id (user_id),
  INDEX idx_pairing_id (pairing_id),
  INDEX idx_previous_program_id (previous_program_id),
  INDEX idx_deleted_at (deleted_at),
  INDEX idx_next_program_unlocked (next_program_unlocked),
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  FOREIGN KEY (pairing_id) REFERENCES pairings (id) ON DELETE CASCADE,
  FOREIGN KEY (previous_program_id) REFERENCES programs (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

**Program metadata:**
- `steps_required_for_unlock`: Stored per program; the HTTP API defaults **omitted** values to `DEFAULT_STEPS_REQUIRED_FOR_UNLOCK` (env, default **0**) on create.
- `next_program_unlocked`: Updated as users post messages (threshold must be greater than zero to flip the flag).
- `generation_error` / `generation_prompt`: Auditing fields when LLM generation fails or succeeds.
- `regenerate_therapy_response`: When set, a background poller may re-run initial generation.

### Program Steps Table
```sql
CREATE TABLE program_steps (
  id VARCHAR(50) PRIMARY KEY,
  program_id VARCHAR(50) NOT NULL,
  day INT NOT NULL,
  theme VARCHAR(255) NOT NULL,
  conversation_starter TEXT DEFAULT NULL,
  science_behind_it TEXT DEFAULT NULL,
  started BOOLEAN DEFAULT FALSE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_program_id (program_id),
  INDEX idx_day (day),
  INDEX idx_program_day (program_id, day),
  INDEX idx_started (started),
  FOREIGN KEY (program_id) REFERENCES programs (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

**Program Step Status:**
- `started`: Boolean field (returns `true`/`false`) indicating if any message has been added to this step
- Automatically set to `true` when the first message is added
- Used by the program unlock logic to track engagement
- API responses return JavaScript boolean values (`true`/`false`) instead of numeric values (0/1)

### Messages Table
```sql
CREATE TABLE messages (
  id VARCHAR(50) PRIMARY KEY,
  step_id VARCHAR(50) NOT NULL,
  message_type VARCHAR(20) NOT NULL CHECK (message_type IN ('openai_response', 'user_message', 'system')),
  sender_id VARCHAR(50) DEFAULT NULL,
  content TEXT NOT NULL,
  metadata TEXT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_step_id (step_id),
  INDEX idx_sender_id (sender_id),
  INDEX idx_message_type (message_type),
  INDEX idx_created_at (created_at),
  FOREIGN KEY (step_id) REFERENCES program_steps (id) ON DELETE CASCADE,
  FOREIGN KEY (sender_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

**Message Types:**
- `user_message`: Messages posted by users in the pairing
- `openai_response`: AI-generated program content (legacy)
- `system`: Server-originated messages — welcome copy, chime-in prompts, couples therapy follow-ups, etc. (see `metadata.type` such as `first_message_welcome`, `chime_in_prompt`, `chime_in_response_1`)

### Device Tokens Table
```sql
CREATE TABLE device_tokens (
  id VARCHAR(50) PRIMARY KEY,
  user_id VARCHAR(50) NOT NULL,
  device_token VARCHAR(512) NOT NULL,
  platform ENUM('ios', 'android', 'web') NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_user_device (user_id, device_token),
  INDEX idx_user_id (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

**Notes:**
- `device_token` is a raw FCM registration token (10–512 chars). The `UNIQUE KEY unique_user_device` ensures a token can only appear once per user — re-registering the same token updates `platform` in place (upsert) without creating duplicates.
- `platform` is `NOT NULL`; existing rows with a `NULL` platform are automatically backfilled to `'ios'` on startup via an incremental migration.
- Per-user cap: **25 tokens**. The model enforces this before inserting a new row.
- `ON DELETE CASCADE`: when a user is deleted, all their device token rows are removed automatically.

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

The API uses JWT (JSON Web Tokens) for authentication with automatic refresh token rotation:

- **Access Tokens**: Lifetime from `JWT_EXPIRES_IN` (default **24h**) for app users
- **Refresh Tokens**: Long-lived (**14d** by default) with rotation and sliding extension on activity
- **Bearer Token**: Include `Authorization: Bearer {token}` in request headers

### Refresh Token Rotation & Automatic Extension

For enhanced security and user experience, the API implements automatic refresh token rotation with activity-based extension:

1. **Sliding Expiration**: Each successful **refresh** issues a new refresh token with a fresh **14-day** window (per `JWT_REFRESH_EXPIRES_IN` / stored expiry)
2. **Token Invalidation**: Old refresh tokens are immediately invalidated after use
3. **Reuse Prevention**: Attempting to reuse an old refresh token will fail with 401 error
4. **Automatic Extension**: Every authenticated API call resets refresh token expiration to 14 days
5. **Active Session Management**: Users stay logged in as long as they use the API regularly

**How It Works:**
- **Initial Login**: Refresh tokens expire in 14 days
- **Token Refresh**: Extends expiration to 14 days from refresh time
- **API Activity**: Every authenticated request resets expiration to 14 days from that moment
- **Inactive Sessions**: Tokens still expire normally if user becomes inactive

**Best Practices:**
- Always store the new `refresh_token` returned from the `/api/refresh` endpoint
- Implement automatic refresh logic in your client application
- Handle 401 errors by redirecting to login when refresh fails
- Active users enjoy extended sessions without manual intervention

## Error Handling

The API includes comprehensive error handling for:

- **400 Bad Request**: Missing fields, invalid email format, password validation
- **401 Unauthorized**: Missing or invalid access token (or invalid/expired refresh token where applicable)
- **403 Forbidden**: Authorization failed (wrong user, admin-only route, etc.)
- **404 Not Found**: User or pairing not found
- **409 Conflict**: Duplicate email, pairing already exists
- **423 Locked**: Too many failed logins / account lockout window
- **500 Internal Server Error**: Database errors, server issues

## Development

To run the server in development mode with auto-restart:

```bash
npm run dev
```

The server will automatically restart when you make changes to the code.

## Testing

The API includes a comprehensive test suite with multiple test categories:

### Run All Tests
```bash
npm test
```

### Individual scripts (`package.json`)

| Command | Purpose |
|--------|---------|
| `npm test` | Full orchestrated run (`tests/run-all-tests.js`) |
| `npm run test:ci` | Same runner with `--skip-server-check` |
| `npm run test:quick` | `--no-load` variant |
| `npm run test:security` | `tests/security-test.js` |
| `npm run test:load` | `tests/load-test.js` |
| `npm run test:auth` | `tests/auth-test.js` (also `test:mysql`) |
| `npm run test:programs` | `tests/programs-test.js` |
| `npm run test:steps` | `tests/program-steps-test.js` |
| `npm run test:messages` | `tests/messages-test.js` |
| `npm run test:therapy-trigger` | `tests/therapy-trigger-test.js` |
| `npm run test:push` | `tests/push-notification-service-test.js` |
| `npm run test:cleanup` | `tests/cleanup-test-data.js` |

Additional one-off runners under `tests/` (execute with `node tests/...`) include `user-profile-test.js`, `pairings-endpoint-test.js`, and `refresh-token-reset-test.js`.

## Example Usage

### Complete Pairing Workflow

```bash
# 1. Create two users
curl -X POST http://localhost:9000/api/users \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john.doe@example.com",
    "password": "Test1!@#"
  }'

curl -X POST http://localhost:9000/api/users \
  -H "Content-Type: application/json" \
  -d '{
    "email": "jane.doe@example.com",
    "password": "Test2!@#"
  }'

# 2. Login as both users
curl -X POST http://localhost:9000/api/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john.doe@example.com",
    "password": "Test1!@#"
  }'

# 3. John requests a pairing (generates partner code)
curl -X POST http://localhost:9000/api/pairing/request \
  -H "Authorization: Bearer {john_access_token}"

# This returns a partner_code like "ABC123" that John can share

# 4. Login as Jane and accept the pairing using John's partner code
curl -X POST http://localhost:9000/api/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "jane.doe@example.com",
    "password": "Test2!@#"
  }'

curl -X POST http://localhost:9000/api/pairing/accept \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {jane_access_token}" \
  -d '{
    "partner_code": "ABC123"
  }'

# 5. View accepted pairings
curl -X GET http://localhost:9000/api/pairing/accepted \
  -H "Authorization: Bearer {john_access_token}"
```

### Program and program-step workflow

```bash
# 0. Ensure profile has user_name (and optional partner_name) before POST /programs
curl -X PUT http://localhost:9000/api/users/{user_id} \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {access_token}" \
  -d '{"user_name":"Steve","partner_name":"Becca"}'

# 1. Create a program (pairing_id optional but required for paired step threads)
curl -X POST http://localhost:9000/api/programs \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {access_token}" \
  -d '{
    "user_input": "We want to improve our communication and spend more quality time together.",
    "pairing_id": "pairing_id"
  }'

# Generation runs in the background — poll steps until 14 days exist
curl -s http://localhost:9000/api/programs/{program_id}/programSteps \
  -H "Authorization: Bearer {access_token}"

# 2. Post a message on a step (use step id from the list above)
curl -X POST http://localhost:9000/api/programSteps/{step_id}/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {access_token}" \
  -d "{\"content\":\"We tried today's prompt — it sparked a good talk.\"}"

curl -s http://localhost:9000/api/programSteps/{step_id}/messages \
  -H "Authorization: Bearer {access_token}"
```

### Background Therapy Response Example

```bash
# 1. User 1 (Steve) posts first message to a program step
curl -X POST http://localhost:9000/api/programSteps/{step_id}/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {steve_access_token}" \
  -d '{
    "content": "I feel like we have grown apart over the years. I miss the closeness we used to have."
  }'

# API responds immediately (non-blocking)
# Response: {"message": "Message added successfully", "data": {...}}

# 2. User 2 (Becca) posts first message to the same program step  
curl -X POST http://localhost:9000/api/programSteps/{step_id}/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {becca_access_token}" \
  -d '{
    "content": "I feel the same way. I want us to find our way back to each other."
  }'

# API responds immediately (non-blocking)
# Response: {"message": "Message added successfully", "data": {...}}

# 3. After background processing, re-fetch messages to see optional system replies
# Check messages to see the system responses:
curl -X GET http://localhost:9000/api/programSteps/{step_id}/messages \
  -H "Authorization: Bearer {access_token}"

# Response will now include system messages like:
# {
#   "messages": [
#     {
#       "id": "user_msg_1",
#       "message_type": "user_message", 
#       "sender": {"user_name": "Steve", ...},
#       "content": "I feel like we have grown apart over the years..."
#     },
#     {
#       "id": "user_msg_2", 
#       "message_type": "user_message",
#       "sender": {"user_name": "Becca", ...}, 
#       "content": "I feel the same way. I want us to find our way back..."
#     },
#     {
#       "id": "sys_msg_1",
#       "message_type": "system",
#       "sender_id": null,
#       "content": "Thank you both for sharing your feelings with me. I can hear the longing in both of your voices for deeper connection.",
#       "metadata": {"type": "therapy_response", "sequence": 1, "total_messages": 3}
#     },
#     {
#       "id": "sys_msg_2", 
#       "message_type": "system",
#       "sender_id": null,
#       "content": "Steve, when you shared that you miss the closeness you used to have, what emotions were you experiencing in that moment?",
#       "metadata": {"type": "therapy_response", "sequence": 2, "total_messages": 3}
#     },
#     {
#       "id": "sys_msg_3",
#       "message_type": "system", 
#       "sender_id": null,
#       "content": "Becca, your response shows such openness to rebuilding that bond together. Can you help us understand what finding your way back means to you?",
#       "metadata": {"type": "therapy_response", "sequence": 3, "total_messages": 3}
#     }
#   ]
# }
```

## Project Structure

```
helpful-api/
├── config/
│   └── database.js
├── models/
│   ├── User.js
│   ├── RefreshToken.js
│   ├── Pairing.js
│   ├── Program.js
│   ├── ProgramStep.js
│   ├── Message.js
│   ├── OrgCode.js
│   ├── AdminUser.js
│   ├── DeviceToken.js
│   ├── IosSubscription.js
│   └── AndroidSubscription.js
├── services/
│   ├── AuthService.js
│   ├── AdminAuthService.js
│   ├── PairingService.js
│   ├── SubscriptionService.js
│   ├── PushNotificationService.js
│   ├── BasePromptService.js
│   ├── HelpfulPromptService.js
│   └── HopefulPromptService.js
├── routes/
│   ├── users.js
│   ├── auth.js
│   ├── admin-auth.js
│   ├── pairing.js
│   ├── programs.js
│   ├── programSteps.js
│   ├── subscription.js
│   ├── org-codes.js
│   └── device-tokens.js
├── middleware/
│   ├── auth.js
│   └── security.js
├── tests/                   # many focused integration / load scripts
├── server.js
└── package.json
``` 