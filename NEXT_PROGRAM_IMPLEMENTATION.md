# Next Program Generation - Implementation Summary

## Overview

Implemented a new endpoint `POST /api/programs/:id/next_program` that generates follow-up therapy programs based on previous conversation starters. This enables couples to continue their therapy journey with contextual, progressive programs.

## Changes Made

### 1. Database Schema Updates

**File: `models/Program.js`**

- Added `previous_program_id` column to programs table
- Added migration logic to handle existing databases
- Added foreign key constraint: `FOREIGN KEY (previous_program_id) REFERENCES programs (id) ON DELETE SET NULL`
- Added index on `previous_program_id` for query performance

### 2. New Model Methods

**File: `models/Program.js`**

#### `getConversationStartersWithMessages(programId)`
- Retrieves conversation starters from program steps that have at least one user message
- Uses INNER JOIN with messages table to filter only answered questions
- Returns array of conversation starter strings ordered by day
- Used to provide context to the AI for generating the next program

#### Updated `createProgram(userId, programData)`
- Now accepts `previous_program_id` parameter
- Stores the link to the previous program when creating a next program

### 3. ChatGPT Service Enhancement

**File: `services/ChatGPTService.js`**

#### `generateNextCouplesProgram(userName, partnerName, previousConversationStarters, userInput)`
- Public interface for generating next programs
- Queues the request for rate limiting and concurrency control

#### `generateNextCouplesProgramInternal(requestData, retryCount)`
- Implements the custom prompt template provided
- Sanitizes all inputs (names, conversation starters, user input)
- Validates input safety to prevent prompt injection
- Builds numbered list of previous conversation starters
- Includes instruction to avoid repeating previous questions
- Uses same JSON response format as initial program generation
- Implements exponential backoff retry logic for rate limiting

**Prompt Structure:**
```
You're a top-tier couples therapist...

You've been working with a couple, whose names are [UserName] and [PartnerName].

[UserName] and [PartnerName] have answered the following questions:

1. "[Conversation Starter 1]"
2. "[Conversation Starter 2]"
...

Having completed those questions together, they are ready to make more progress...

[UserName] says: "[User Input]"

Your goal is to provide 14 new conversation-starters...

You should not use any of the conversation-starters that they've already answered.
```

### 4. New API Endpoint

**File: `routes/programs.js`**

#### `POST /api/programs/:id/next_program`

**Request Body:**
```json
{
  "user_input": "We've made progress on communication...",
  "steps_required_for_unlock": 7
}
```

**Validation:**
- Requires authentication
- Checks user has access to previous program
- Verifies `next_program_unlocked === true`
- Requires `user_input` field

**User Name Resolution:**
1. Primary: Uses `user_name` and `partner_name` from user profile
2. Fallback: If pairing exists and `partner_name` is null, fetches partner's `user_name`
3. Default: Uses "User" and "Partner" if names not available

**Process:**
1. Validates previous program is unlocked
2. Retrieves user names from profile and pairing
3. Gets conversation starters that have user messages
4. Creates new program with inherited `pairing_id` and set `previous_program_id`
5. Returns immediate response
6. Generates AI content asynchronously in background
7. Creates program steps from AI response

**Response:**
```json
{
  "message": "Next program created successfully",
  "program": {
    "id": "new_program_id",
    "user_id": "user_id",
    "user_input": "...",
    "pairing_id": "pairing_id",
    "previous_program_id": "previous_program_id",
    "steps_required_for_unlock": 7,
    "next_program_unlocked": false,
    "created_at": "2024-01-15T00:00:00.000Z"
  }
}
```

**Error Responses:**
- `400`: Missing `user_input` field
- `403`: Previous program not unlocked or no access
- `404`: Previous program not found
- `500`: Failed to create program

### 5. Server Configuration

**File: `server.js`**

- Updated `createProgramRoutes` call to pass `userModel` and `pairingModel`
- Enables the route to access user profiles and pairing data

### 6. Documentation

**File: `README.md`**

#### Added Endpoint Documentation
- Complete API documentation for `POST /api/programs/:id/next_program`
- Request/response examples
- Validation requirements
- "How It Works" section explaining the process

#### Updated Database Schema
- Added `previous_program_id` field to Programs Table schema
- Added foreign key relationship documentation
- Added description of the field's purpose

### 7. Test Suite

**File: `tests/next-program-test.js`**

Comprehensive test coverage:
- ✅ Create initial program and unlock it
- ✅ Add messages to program steps
- ✅ Verify program unlock status
- ✅ Test validation: program not unlocked (403 error)
- ✅ Test validation: missing user_input (400 error)
- ✅ Generate next program successfully
- ✅ Verify `previous_program_id` is set correctly
- ✅ Verify `pairing_id` is inherited
- ✅ Verify user names are pulled from profiles
- ✅ Verify conversation starters are retrieved
- ✅ Verify new program steps are created
- ✅ Automatic cleanup of test data

## Key Features

### 1. Contextual Continuity
- AI receives all answered conversation starters from previous program
- Generates new questions that build upon previous work
- Avoids repeating questions the couple has already answered

### 2. Automatic Inheritance
- New program inherits `pairing_id` from previous program
- Maintains relationship context across program sequence
- Links programs via `previous_program_id` for tracking

### 3. User Name Integration
- Dynamically pulls user names from profiles
- Falls back to partner's name from pairing if needed
- Personalizes AI-generated content with actual names

### 4. Security & Validation
- Unlock requirement prevents premature progression
- Access control ensures only authorized users can create next programs
- Input sanitization prevents prompt injection attacks
- Comprehensive error handling with appropriate status codes

### 5. Asynchronous Processing
- Immediate API response for better UX
- AI content generation happens in background
- Non-blocking architecture maintains performance

## Database Migration

The implementation includes automatic migration logic that:
- Checks if `previous_program_id` column exists
- Adds column if missing
- Creates index for query performance
- Adds foreign key constraint with ON DELETE SET NULL
- Handles errors gracefully if column already exists

**Migration runs automatically on server startup.**

## Usage Example

```bash
# 1. Create initial program
POST /api/programs
{
  "user_input": "We want to improve communication",
  "steps_required_for_unlock": 7
}

# 2. Add messages to program steps (at least 7 steps)
POST /api/programSteps/{step_id}/messages
{
  "content": "We completed this exercise together..."
}

# 3. Program automatically unlocks when threshold is met
# next_program_unlocked becomes true

# 4. Create next program
POST /api/programs/{previous_program_id}/next_program
{
  "user_input": "Now we want to work on quality time together",
  "steps_required_for_unlock": 7
}

# Response includes previous_program_id linking to first program
```

## Testing

Run the test suite:
```bash
node tests/next-program-test.js
```

The test creates a complete workflow:
1. Creates user with names
2. Creates first program
3. Adds messages to unlock it
4. Tests validation scenarios
5. Creates next program
6. Verifies all relationships and data
7. Cleans up test data

## Performance Considerations

- **Database Queries**: Optimized with proper indexes
- **AI Generation**: Runs asynchronously to avoid blocking
- **Rate Limiting**: Uses existing queue system for OpenAI requests
- **Caching**: Conversation starters retrieved once per request

## Security Considerations

- **Input Sanitization**: All user inputs sanitized before AI prompt
- **Validation**: Multiple layers of validation (auth, access, unlock status)
- **SQL Injection**: Parameterized queries prevent SQL injection
- **Prompt Injection**: Input validation prevents malicious prompts
- **Access Control**: Users can only create next programs for their own programs

## Future Enhancements

Potential improvements:
1. **Program Chain Visualization**: API endpoint to retrieve full program sequence
2. **Progress Tracking**: Analytics on completion rates across program chains
3. **Recommendation Engine**: Suggest next program topics based on completion patterns
4. **Bulk Operations**: Create multiple next programs at once
5. **Program Templates**: Pre-defined program sequences for common issues

## Files Modified

1. `models/Program.js` - Added field, migration, and method
2. `services/ChatGPTService.js` - Added next program generation method
3. `routes/programs.js` - Added new endpoint
4. `server.js` - Updated route configuration
5. `README.md` - Added documentation
6. `tests/next-program-test.js` - Created test suite
7. `NEXT_PROGRAM_IMPLEMENTATION.md` - This summary document

## Deployment Notes

- No manual database migration required
- Migration runs automatically on server startup
- Existing programs unaffected
- Backward compatible with existing API clients
- New endpoint is opt-in (existing workflows unchanged)

## Support

For questions or issues:
1. Check test suite for usage examples
2. Review API documentation in README.md
3. Check server logs for error details
4. Verify OpenAI API key is configured for AI generation

