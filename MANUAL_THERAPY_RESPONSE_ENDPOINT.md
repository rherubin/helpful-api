# Manual Therapy Response Generation Endpoint

## Issue Identified

When creating a program, the therapy response generation was not happening because:
1. The OpenAI API key was configured in `.env` file
2. However, the server was showing `OPENAI_API_KEY not configured - ChatGPT features will be disabled`
3. This caused program steps to not be created automatically

**Root Cause**: The server needs to be restarted after adding/updating the `OPENAI_API_KEY` in the `.env` file to pick up the environment variable.

## Solution

Created a new endpoint to manually trigger therapy response generation for programs that were created without program steps.

## New Endpoint

### POST `/api/programs/:program_id/therapy_response`

Manually triggers therapy response generation for a program.

#### Request
- **Method**: POST
- **URL**: `/api/programs/:program_id/therapy_response`
- **Headers**: 
  - `Authorization: Bearer {access_token}`
- **URL Parameters**:
  - `program_id`: The ID of the program to generate therapy response for

#### Response (202 Accepted)
```json
{
  "message": "Therapy response generation started",
  "program_id": "program_id",
  "status": "processing"
}
```

The therapy response is generated asynchronously in the background. Check the program steps after a few seconds.

#### Error Responses

**403 Forbidden** - User doesn't have access to the program:
```json
{
  "error": "Not authorized to access this program"
}
```

**404 Not Found** - Program doesn't exist:
```json
{
  "error": "Program not found"
}
```

**409 Conflict** - Program already has therapy response:
```json
{
  "error": "Therapy response already exists for this program",
  "details": "This program already has program steps. Delete the program and create a new one if you need to regenerate.",
  "existing_steps_count": 14
}
```

**503 Service Unavailable** - OpenAI API key not configured:
```json
{
  "error": "ChatGPT service is not configured. Please set OPENAI_API_KEY environment variable.",
  "details": "The OpenAI API key is required to generate therapy responses."
}
```

## Implementation Details

### Features
1. **Access Control**: Verifies user has access to the program (owner or paired user)
2. **Duplicate Prevention**: Returns 409 Conflict if program already has program steps
3. **Service Check**: Returns clear error if OpenAI API key is not configured
4. **User Names**: Fetches user names from user profile and pairing for personalized prompts
5. **Async Processing**: Returns immediately (202 Accepted) while generating in background
6. **Program Steps Creation**: Automatically creates program steps from therapy response
7. **Error Handling**: Comprehensive error handling with detailed messages

### Code Location
- **File**: `routes/programs.js`
- **Position**: Added before the `POST /` (create program) endpoint
- **Lines**: ~138-230

### Background Processing
The endpoint returns immediately with a 202 status, then:
1. Calls `chatGPTService.generateCouplesProgram()` with user names and input
2. Saves the therapy response to the program
3. Creates program steps from the response
4. Logs success or errors to console

## Usage Example

```bash
# Get your access token from login
ACCESS_TOKEN="your_access_token_here"

# Get your program ID (from creating a program or listing programs)
PROGRAM_ID="your_program_id_here"

# Manually trigger therapy response generation
curl -X POST http://localhost:9000/api/programs/$PROGRAM_ID/therapy_response \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json"

# Wait a few seconds, then check if program steps were created
curl http://localhost:9000/api/programs/$PROGRAM_ID/programSteps \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

## Fixing the Original Issue

### Option 1: Restart the Server (Recommended)
If you have the OpenAI API key in your `.env` file:
```bash
# Stop the server (Ctrl+C if running in terminal)
# Then restart it
npm start
```

The server will now pick up the `OPENAI_API_KEY` and automatic therapy response generation will work.

### Option 2: Use the Manual Endpoint
For programs already created without steps:
1. Get the program ID from `GET /api/programs`
2. Call `POST /api/programs/:program_id/therapy_response`
3. Wait a few seconds
4. Verify program steps were created with `GET /api/programs/:program_id/programSteps`

## Verification

After restarting the server, you should see in the logs:
```
OpenAI API key configured successfully: ***XXXX
```

Instead of:
```
OPENAI_API_KEY not configured - ChatGPT features will be disabled
```

## Files Modified

1. `routes/programs.js` - Added new endpoint for manual therapy response generation
2. `README.md` - Added documentation for the new endpoint

## Testing

The endpoint includes:
- ✅ Authentication required
- ✅ Authorization check (user must have access to program)
- ✅ Service availability check (OpenAI API key configured)
- ✅ Async processing with immediate response
- ✅ Comprehensive error handling
- ✅ Detailed logging for debugging

## Date Completed
October 28, 2025

## Status Codes Summary

The endpoint can return the following HTTP status codes:

| Status Code | Meaning | Scenario |
|-------------|---------|----------|
| **202 Accepted** | Success - Processing started | Therapy response generation has been queued and is processing in the background |
| **403 Forbidden** | Authorization failed | User doesn't have access to this program (not owner or paired user) |
| **404 Not Found** | Program not found | The program_id doesn't exist or was deleted |
| **409 Conflict** | Duplicate request | Program already has program steps - cannot regenerate |
| **500 Internal Server Error** | Server error | Unexpected error during request processing |
| **503 Service Unavailable** | Service not configured | OpenAI API key is not set in environment variables |

### Status Code Details

#### 202 Accepted ✅
- **When**: Program exists, user has access, no existing steps, OpenAI configured
- **Action**: Therapy response generation started in background
- **Next Step**: Wait 5-10 seconds, then check program steps

#### 409 Conflict ⚠️
- **When**: Program already has program steps created
- **Why**: Prevents overwriting existing program steps and wasting API calls
- **Solution**: Delete the program and create a new one if regeneration is needed
- **Response includes**: Count of existing program steps

#### 503 Service Unavailable ⚠️
- **When**: OPENAI_API_KEY environment variable is not set
- **Why**: Cannot generate therapy responses without OpenAI API access
- **Solution**: Set OPENAI_API_KEY in .env file and restart server

## Update History

**October 28, 2025**
- Initial implementation with 202, 403, 404, 503 status codes
- Added 409 Conflict check to prevent duplicate therapy response generation
- Added existing_steps_count to 409 response for better debugging
