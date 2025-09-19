# Helpful API

A comprehensive Node.js REST API with SQLite backend featuring user management, JWT authentication, a flexible pairing system, AI-generated therapy programs with structured program steps, and efficient combined endpoints for optimal client performance.

## Features

### Core Functionality
- **User Management**: Create, update, and retrieve users with secure password authentication
- **JWT Authentication**: Secure login with access and refresh tokens
- **Combined Profile Endpoint**: Single API call for complete user state (profile + pairings + requests)
- **Unified Pairing System**: Request, accept, and reject pairings with partner codes
- **AI Therapy Programs**: OpenAI-generated couples therapy programs with structured daily exercises
- **Program Steps**: Day-based program steps for each program with message threading

### Advanced Features  
- **Smart Pairing Responses**: Pending requests show `partner: null`, accepted pairings show full partner data
- **Rate Limiting**: Configurable limits (1000 req/15min general, 100 req/15min login)
- **Comprehensive Testing**: 95+ tests across multiple test suites with 100% success rates
- **Password Security**: Bcrypt hashing with strict password requirements (uppercase, lowercase, number, special char)
- **Token Management**: Short-lived access tokens (15min) with long-lived refresh tokens (7 days)
- **Database Integrity**: SQLite with automatic schema creation and proper JOIN handling
- **RESTful Design**: Clean, consistent API with comprehensive error handling and status codes

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a `.env` file in the root directory (optional):
   ```
   PORT=9000
   NODE_ENV=development
   JWT_SECRET=your-secret-key-change-in-production
   JWT_REFRESH_SECRET=your-refresh-secret-key-change-in-production
   JWT_EXPIRES_IN=1h
   JWT_REFRESH_EXPIRES_IN=7d
   DATABASE_PATH=./helpful-db.sqlite
   OPENAI_API_KEY=your-openai-api-key-for-therapy-content
   ```

3. **Database Setup** (Automatic):
   
   The SQLite database (`helpful-db.sqlite`) will be created automatically when you first start the server. The application will:
   - Create the database file if it doesn't exist
   - Initialize all required tables (users, refresh_tokens, pairings, programs, program_steps)
   - Set up proper indexes and constraints
   - Automatically migrate existing databases to support new features
   
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

## 🎯 Quick Reference

### Most Important Endpoints
- **`GET /api/profile`** - Get complete user profile with pairings (recommended)
- **`POST /api/login`** - User authentication
- **`POST /api/pairing/request`** - Create partner code for pairing
- **`POST /api/pairing/accept`** - Accept pairing with partner code
- **`GET /api/pairings`** - Get all pairings (accepted + pending)
- **`GET /api/programs/:id/programSteps`** - Get all program steps for a program
- **`POST /api/programSteps/:id/messages`** - Add message to a program step
- **`GET /api/programSteps/:id/messages`** - Get messages for a program step

### Key Features
- ✅ **Combined Profile Endpoint**: Single call for complete user state
- ✅ **Unified Pairings**: Both accepted and pending pairings in one array
- ✅ **Program Steps**: Clean, efficient day-based therapy program structure
- ✅ **Simplified Messages**: Clean message responses without metadata bloat
- ✅ **Rate Limited**: 1000 requests per 15 minutes for general API
- ✅ **Comprehensive Tests**: 95+ tests with 100% success rates
- ✅ **JWT Authentication**: Secure access and refresh tokens

### API Design Philosophy
- **Clean Responses**: Minimal, essential data only - no unnecessary nesting or metadata
- **Efficient Structure**: Array-based responses instead of complex nested objects
- **Separation of Concerns**: Messages fetched separately when needed, not bundled with program steps
- **RESTful Design**: Intuitive endpoints that follow REST conventions
- **Performance First**: Optimized for speed and minimal bandwidth usage

## API Endpoints

**Note**: `first_name` and `last_name` fields are optional throughout the API. When not provided during user creation, they will be stored as `null` and returned as `null` in responses.

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
      "first_name": "John",
      "last_name": "Doe",
      "max_pairings": 1,
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
            "first_name": "Jane",
            "last_name": "Doe",
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
      ]
    }
  }
  ```

**✨ Why Use This Endpoint:**
- **Single API Call**: Get complete user state without multiple requests
- **Comprehensive Data**: User info + all pairings (accepted & pending) in one array
- **Optimized Performance**: Reduces network calls and improves app responsiveness
- **Real-time State**: Always returns current pairing status

**📋 Data Explanation:**
- **`pairings`**: Contains both accepted pairings (with full partner info) and pending requests (with `partner: null`)

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

#### Get User Profile with Pairings & Requests (Combined)
- **GET** `/api/profile`
- **Headers:** `Authorization: Bearer {access_token}`
- **Description:** Returns the authenticated user's complete profile combined with their pairing information and pending pairing requests
- **Response:**
  ```json
  {
    "message": "User profile retrieved successfully",
    "profile": {
      "id": "unique_id",
      "email": "user@example.com",
      "first_name": "John",
      "last_name": "Doe",
      "password_hash": "$2b$10$...",
      "max_pairings": 1,
      "deleted_at": null,
      "created_at": "2024-01-01T00:00:00.000Z",
      "updated_at": "2024-01-01T00:00:00.000Z",
      "pairings": [
        {
          "id": "pairing_id",
          "status": "accepted",
          "partner_code": "ABC123",
          "created_at": "2024-01-01T00:30:00.000Z",
          "updated_at": "2024-01-01T00:35:00.000Z",
          "partner": {
            "id": "partner_user_id",
            "first_name": "Jane",
            "last_name": "Doe",
            "email": "jane.doe@example.com"
          }
        }
      ],
      "pairing_requests": [
        {
          "id": "pairing_request_id",
          "status": "pending",
          "partner_code": "XYZ789",
          "created_at": "2024-01-01T00:45:00.000Z",
          "updated_at": "2024-01-01T00:45:00.000Z",
          "partner": null
        }
      ]
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
    "requester": {
      "id": "user_id",
      "first_name": "John",
      "last_name": "Doe",
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
          "first_name": "Jane",
          "last_name": "Doe",
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
          "first_name": "Pending",
          "last_name": "User",
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
          "first_name": "Jane",
          "last_name": "Doe",
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

### Programs

Programs are AI-generated couples therapy programs that can be created with or without pairings. Each program contains structured daily exercises designed to help couples improve their relationship. When a program is created, OpenAI automatically generates personalized content based on the user's input.

**Key Features:**
- **AI-Generated Content**: Each program contains 14 days of structured exercises
- **Flexible Pairing**: Programs can be created independently or linked to pairings
- **Automatic Conversation Creation**: Each program day gets its own conversation thread
- **Privacy Protection**: Sensitive fields are excluded from list endpoints

**Privacy Note**: The `user_input` and `pairing_id` fields are returned in the POST creation response and the individual `GET /api/programs/:id` response. The list endpoint `GET /api/programs` excludes these fields for privacy protection.

#### Create Program
- **POST** `/api/programs`
- **Headers:** `Authorization: Bearer {access_token}`
- **Body:**
  ```json
  {
    "user_name": "Steve",
    "partner_name": "Becca",
    "children": 3,
    "user_input": "I feel less and less connected with my wife. I want a plan that will help us have what we used to. We would laugh and joke all the time and now things feel disconnected and distant",
    "pairing_id": "pairing_id"
  }
  ```
  **Note**: `pairing_id` is optional. Programs can be created independently without a pairing.
- **Response:**
  ```json
  {
    "message": "Program created successfully",
    "program": {
      "id": "unique_id",
      "user_id": "user_id",
      "user_name": "Steve",
      "partner_name": "Becca",
      "children": 3,
      "user_input": "I feel less and less connected with my wife...",
      "pairing_id": "pairing_id",
      "created_at": "2024-01-01T00:00:00.000Z"
    }
  }
  ```

#### Get User's Programs
- **GET** `/api/programs`
- **Headers:** `Authorization: Bearer {access_token}`
- **Response:**
  ```json
  {
    "message": "Programs retrieved successfully",
    "programs": [
      {
        "id": "unique_id",
        "user_id": "user_id",
        "user_name": "Steve",
        "partner_name": "Becca",
        "children": 3,
        "created_at": "2024-01-01T00:00:00.000Z"
      }
    ]
  }
  ```

#### Get Program by ID
- **GET** `/api/programs/:id`
- **Headers:** `Authorization: Bearer {access_token}`
- **Response:**
  ```json
  {
    "message": "Program retrieved successfully",
    "program": {
      "id": "unique_id",
      "user_id": "user_id",
      "user_name": "Steve",
      "partner_name": "Becca",
      "children": 3,
      "user_input": "I feel less and less connected with my wife...",
      "pairing_id": "pairing_id",
      "created_at": "2024-01-01T00:00:00.000Z"
    }
  }
  ```

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

### Program Steps

The program steps system allows users to engage with each day of their therapy program. When a program is created, each day automatically gets its own program step containing the AI-generated exercise content. Users can then add their own messages to discuss their progress, experiences, and reflections for each specific day.

**Key Features:**
- **Day-Based Organization**: Each program day (1-14) has its own program step
- **AI Content Integration**: Each day's theme, conversation starter, and science explanation are stored as program steps
- **Background Therapy Responses**: Automatic AI-powered therapeutic guidance when both users engage
- **Separate Message Storage**: Each message is stored as a separate database record for better organization
- **User Participation**: Both users in a pairing can contribute messages to any day's program step
- **Message Management**: Users can add, edit, and view their own messages
- **Progress Tracking**: Messages can include metadata to track exercise completion and engagement
- **Access Control**: Only program owners and paired users can access program steps

**Database Structure:**
- **Program Steps Table**: Stores day-level metadata (theme, conversation starter, science explanation)
- **Messages Table**: Stores individual messages within program steps with full user tracking

## Background Therapy Response System

The API includes an intelligent background therapy response system that automatically provides therapeutic guidance when both users in a pairing engage in conversation. This feature uses advanced AI to deliver contextual, personalized therapy insights based on Emotionally Focused Therapy (EFT) and Gottman Method principles.

### How It Works

1. **Trigger Condition**: When both users in a pairing have posted at least one message to a program step
2. **Timing**: Activates 2 seconds after the second user posts their first message
3. **Non-Blocking**: Runs in the background without affecting API response times
4. **AI Processing**: Uses OpenAI GPT to generate therapeutic responses based on both users' messages
5. **System Messages**: Responses are stored as system messages (up to 3 per trigger)

### Therapeutic Approach

The AI responses are designed using evidence-based couples therapy methods:

- **Emotionally Focused Therapy (EFT)**: Primary therapeutic framework focusing on emotional connection
- **Gottman Method**: Complementary techniques for relationship strengthening
- **Personalized Guidance**: Responses reference specific user names and message content
- **Progressive Support**: Each response builds on the program step context

### Example Therapy Response Flow

```json
{
  "step_messages": [
    {
      "id": "msg1",
      "message_type": "user_message",
      "sender": "Steve",
      "content": "I feel like we've grown apart over the years. I miss the closeness we used to have."
    },
    {
      "id": "msg2", 
      "message_type": "user_message",
      "sender": "Becca",
      "content": "I feel the same way. I want us to find our way back to each other."
    },
    {
      "id": "sys1",
      "message_type": "system",
      "sender_id": null,
      "content": "Thank you both for sharing your feelings with me. I can hear the longing in both of your voices for deeper connection.",
      "metadata": {
        "type": "therapy_response",
        "sequence": 1,
        "total_messages": 3
      }
    },
    {
      "id": "sys2",
      "message_type": "system", 
      "sender_id": null,
      "content": "Steve, when you shared that you miss the closeness you used to have, what emotions were you experiencing in that moment?",
      "metadata": {
        "type": "therapy_response",
        "sequence": 2,
        "total_messages": 3
      }
    },
    {
      "id": "sys3",
      "message_type": "system",
      "sender_id": null, 
      "content": "Becca, your response shows such openness to rebuilding that bond together. Can you help us understand what finding your way back means to you?",
      "metadata": {
        "type": "therapy_response",
        "sequence": 3,
        "total_messages": 3
      }
    }
  ]
}
```

### System Message Characteristics

- **Message Type**: `system` (distinct from `user_message` and `openai_response`)
- **No Sender**: `sender_id` is always `null` for system messages
- **Metadata**: Includes sequence information and therapy response type
- **Content**: Therapeutic guidance, questions, and insights
- **Timing**: Appears 2 seconds after trigger condition is met

### Technical Implementation

- **Non-Blocking Architecture**: API responses return immediately while therapy processing happens in background
- **Error Resilience**: Therapy response failures don't affect main program step functionality  
- **Rate Limiting**: Built-in OpenAI request queuing and rate limiting
- **Security**: Input sanitization and validation for all user content sent to AI
- **Pairing Requirement**: Only works for programs with accepted pairings

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
        "created_at": "2024-01-01T00:00:00.000Z",
        "updated_at": "2024-01-01T00:00:00.000Z"
      },
      {
        "id": "step_id_2",
        "day": 2,
        "theme": "Appreciating Each Other",
        "conversation_starter": "Share three things you appreciate about your partner today...",
        "science_behind_it": "Expressing appreciation strengthens positive emotions...",
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
    }
  }
  ```

#### Update Message in Program Step
- **PUT** `/api/programSteps/:stepId/messages/:messageId`
- **Headers:** `Authorization: Bearer {access_token}`
- **Body:**
  ```json
  {
    "content": "Updated message content with more details about our experience.",
    "metadata": {
      "completed_exercise": true,
      "partner_participated": true,
      "duration_minutes": 75,
      "satisfaction_rating": 5,
      "edited": true,
      "edit_reason": "Added more details"
    }
  }
  ```
- **Response:**
  ```json
  {
    "message": "Message updated successfully"
  }
  ```
- **Note**: Only the message sender can edit their own messages. OpenAI responses cannot be edited.

#### Get Conversations for Specific Day (Legacy)
- **GET** `/api/programs/:programId/conversations/day/:day`
- **Headers:** `Authorization: Bearer {access_token}`
- **Note**: This endpoint is maintained for backward compatibility. For new implementations, use the root-level conversation endpoints above.

#### Add Message to Specific Day (Legacy)
- **POST** `/api/programs/:programId/conversations/day/:day`
- **Headers:** `Authorization: Bearer {access_token}`
- **Note**: This endpoint is maintained for backward compatibility. For new implementations, use `POST /api/conversations/:id/messages`.

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

### Programs Table
```sql
CREATE TABLE programs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  partner_name TEXT NOT NULL,
  children INTEGER NOT NULL,
  user_input TEXT NOT NULL,
  pairing_id TEXT,
  therapy_response TEXT,
  deleted_at DATETIME DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  FOREIGN KEY (pairing_id) REFERENCES pairings (id) ON DELETE CASCADE
);
```

### Conversations Table
```sql
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL,
  day INTEGER NOT NULL,
  theme TEXT NOT NULL,
  conversation_starter TEXT,
  science_behind_it TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (program_id) REFERENCES programs (id) ON DELETE CASCADE
);
```

### Messages Table
```sql
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  message_type TEXT NOT NULL CHECK (message_type IN ('openai_response', 'user_message', 'system')),
  sender_id TEXT,
  content TEXT NOT NULL,
  metadata TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE,
  FOREIGN KEY (sender_id) REFERENCES users (id) ON DELETE SET NULL
);
```

**Message Types:**
- `user_message`: Messages posted by users in the pairing
- `openai_response`: AI-generated program content (legacy)
- `system`: Background therapy responses triggered by user interactions

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

The API includes a comprehensive test suite with multiple test categories:

### Run All Tests
```bash
npm test
```

### Individual Test Suites

#### API Functionality Tests
```bash
npm run test:api
```
Tests all endpoints including user creation, authentication, pairing system, and error handling.

#### Security Tests  
```bash
npm run test:security
```
Tests security measures including rate limiting, input validation, and prompt injection protection.

#### Load Tests
```bash
npm run test:load
```
Tests API performance under concurrent load conditions.

#### OpenAI Integration Tests
```bash
npm run test:openai
```
Tests OpenAI service integration and content generation.

#### Therapy Response Tests
```bash
npm run test:therapy
```
Tests the background therapy response system including:
- Trigger logic for both users posting messages
- Non-blocking API behavior
- System message storage and metadata
- Error handling and recovery
- Mock OpenAI responses for testing without API calls

#### Authentication Tests
```bash
npm run test:auth
```
Comprehensive authentication system tests including:
- User registration with password validation
- Login and logout functionality
- Token refresh mechanisms
- Invalid credential handling
- Profile endpoint access control
- JWT token structure validation
- Error scenarios and edge cases

#### User Profile Tests
```bash
node tests/user-profile-test.js
```
Comprehensive test suite for the GET `/api/profile` endpoint including:

**Core Functionality Tests:**
- Basic profile endpoint functionality and response structure
- User profile data accuracy and completeness
- Authentication and authorization scenarios (invalid tokens, expired tokens, etc.)

**Pairing Integration Tests:**
- Profile with no pairings/requests (new user scenario)
- Profile with pending pairing requests (partner code functionality)
- Profile with accepted pairings (full partner information)
- Verification of `pairing_requests` array with null partner field for pending codes
- Verification of `pairings` array with complete partner information for accepted pairings

**Advanced Testing:**
- Edge cases and error scenarios (nonexistent users, invalid data)
- Data consistency across multiple requests
- Performance testing and response time validation
- Concurrent request handling (3 simultaneous requests)
- Response structure validation for all required fields

**Test Coverage:**
- ✅ GET `/api/profile` endpoint functionality
- ✅ JWT authentication and authorization
- ✅ Pairing requests with partner codes (partner: null)
- ✅ Accepted pairings with partner data
- ✅ Error handling (404, 401, 403 responses)
- ✅ Performance benchmarks (<5s response, <8s concurrent)
- ✅ 65 comprehensive tests with 100% success rate

**Sample Test Output:**
```
🧪 Starting User Profile Endpoint Test Suite
📊 User Profile Test Results Summary
Total Tests: 65
Passed: 65
Failed: 0
Success Rate: 100.0%
🎉 All user profile tests passed! The endpoint is working correctly.
```

#### Pairings Endpoint Tests
```bash
node tests/pairings-endpoint-test.js
```
Comprehensive test suite for the updated GET `/api/pairings` endpoint including:

**Core Functionality Tests:**
- Basic pairings endpoint functionality and response structure
- Authentication and authorization scenarios
- Response format validation and field presence

**Pairing Integration Tests:**
- Pairings with pending requests (partner code functionality)
- Pairings with accepted pairings (full partner information)
- Mixed scenarios with both pending and accepted pairings
- Verification that pending requests show `partner: null`
- Verification that accepted pairings show complete partner data

**Advanced Testing:**
- Response structure validation for all required fields
- Sorting verification (most recent first by created_at)
- Data consistency and proper partner information mapping
- Authentication and authorization edge cases

**Test Coverage:**
- ✅ GET `/api/pairings` endpoint functionality
- ✅ JWT authentication and authorization
- ✅ Pending pairings with partner codes (partner: null)
- ✅ Accepted pairings with partner data
- ✅ Mixed pending and accepted pairings in single response
- ✅ Response sorting and structure validation
- ✅ 30 comprehensive tests with 100% success rate

### Test Categories

- **Unit Tests**: Test individual components and business logic
- **Integration Tests**: Test full API workflows with real HTTP requests
- **Security Tests**: Validate security measures and input sanitization
- **Performance Tests**: Ensure API can handle concurrent load
- **Therapy System Tests**: Validate background AI therapy response functionality

## Example Usage

### Complete Pairing Workflow

```bash
# 1. Create two users (showing both full and minimal request formats)
curl -X POST http://localhost:9000/api/users \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john.doe@example.com",
    "first_name": "John",
    "last_name": "Doe",
    "password": "Test1!@#",
    "max_pairings": 1
  }'

curl -X POST http://localhost:9000/api/users \
  -H "Content-Type: application/json" \
  -d '{
    "email": "jane.doe@example.com",
    "password": "Test2!@#",
    "max_pairings": 1
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

### Complete Program and Conversation Workflow

```bash
# 1. Create a therapy program (after pairing is established)
curl -X POST http://localhost:9000/api/programs \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {access_token}" \
  -d '{
    "user_name": "Steve",
    "partner_name": "Becca",
    "children": 2,
    "user_input": "We want to improve our communication and spend more quality time together.",
    "pairing_id": "pairing_id"
  }'

# This automatically generates 14 days of therapy content and creates conversation threads

# 2. View all program conversations organized by days
curl -X GET http://localhost:9000/api/programs/{program_id}/conversations \
  -H "Authorization: Bearer {access_token}"

# 3. View specific day conversation (e.g., day 1)
curl -X GET http://localhost:9000/api/programs/{program_id}/conversations/day/1 \
  -H "Authorization: Bearer {access_token}"

# 4. Add a message to day 1 conversation
curl -X POST http://localhost:9000/api/programs/{program_id}/conversations/day/1 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {access_token}" \
  -d '{
    "content": "Becca and I completed day 1 together! We talked about our first vacation and remembered why we fell in love. This exercise really helped us reconnect.",
    "metadata": {
      "completed_exercise": true,
      "partner_participated": true,
      "duration_minutes": 30,
      "rating": 5
    }
  }'

# 5. Using the new root-level conversation endpoints
# Get the conversation directly
curl -X GET http://localhost:9000/api/conversations/{conversation_id} \
  -H "Authorization: Bearer {access_token}"

# Add a message using the conversation ID
curl -X POST http://localhost:9000/api/conversations/{conversation_id}/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {access_token}" \
  -d '{
    "content": "This is our follow-up reflection on day 1. We continue to feel more connected!",
    "metadata": {
      "follow_up": true,
      "satisfaction_rating": 5
    }
  }'

# Get all messages for the conversation
curl -X GET http://localhost:9000/api/conversations/{conversation_id}/messages \
  -H "Authorization: Bearer {access_token}"

# Update a message
curl -X PUT http://localhost:9000/api/conversations/{conversation_id}/messages/{message_id} \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {access_token}" \
  -d '{
    "content": "Updated: This is our follow-up reflection on day 1. We continue to feel more connected and are excited for day 2!",
    "metadata": {
      "follow_up": true,
      "satisfaction_rating": 5,
      "edited": true
    }
  }'
```

### Background Therapy Response Example

```bash
# 1. User 1 (Steve) posts first message to a conversation
curl -X POST http://localhost:9000/api/conversations/{conversation_id}/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {steve_access_token}" \
  -d '{
    "content": "I feel like we have grown apart over the years. I miss the closeness we used to have."
  }'

# API responds immediately (non-blocking)
# Response: {"message": "Message added successfully", "data": {...}}

# 2. User 2 (Becca) posts first message to the same conversation  
curl -X POST http://localhost:9000/api/conversations/{conversation_id}/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {becca_access_token}" \
  -d '{
    "content": "I feel the same way. I want us to find our way back to each other."
  }'

# API responds immediately (non-blocking)
# Response: {"message": "Message added successfully", "data": {...}}

# 3. After 2 seconds, system automatically adds therapy response messages
# Check messages to see the system responses:
curl -X GET http://localhost:9000/api/conversations/{conversation_id}/messages \
  -H "Authorization: Bearer {access_token}"

# Response will now include system messages like:
# {
#   "messages": [
#     {
#       "id": "user_msg_1",
#       "message_type": "user_message", 
#       "sender": {"first_name": "Steve", ...},
#       "content": "I feel like we have grown apart over the years..."
#     },
#     {
#       "id": "user_msg_2", 
#       "message_type": "user_message",
#       "sender": {"first_name": "Becca", ...}, 
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
├── models/
│   ├── User.js              # User data model
│   ├── RefreshToken.js      # Refresh token model
│   ├── Pairing.js           # Pairing model
│   ├── Program.js           # Program model
│   ├── Conversation.js      # Conversation model (day-level containers)
│   └── Message.js           # Message model (individual messages)
├── services/
│   ├── AuthService.js       # Authentication service
│   ├── PairingService.js    # Pairing business logic
│   └── ChatGPTService.js    # OpenAI integration service
├── routes/
│   ├── users.js             # User endpoints
│   ├── auth.js              # Authentication endpoints
│   ├── pairing.js           # Pairing endpoints
│   ├── programs.js          # Program endpoints
│   └── conversations.js     # Conversation and message endpoints
├── middleware/
│   ├── auth.js              # JWT authentication middleware
│   └── security.js          # Rate limiting and security
├── tests/
│   ├── api-test.js          # API functionality tests
│   ├── security-test.js     # Security and validation tests
│   ├── load-test.js         # Performance and load tests
│   ├── openai-test.js       # OpenAI integration tests
│   ├── auth-test.js         # Authentication system tests
│   ├── therapy-response-test.js           # Therapy response unit tests
│   ├── therapy-response-integration-test.js # Therapy response integration tests
│   ├── run-therapy-tests.js # Therapy test runner
│   └── run-all-tests.js     # Comprehensive test suite runner
├── server.js                # Main application
└── package.json
``` 