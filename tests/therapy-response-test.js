const assert = require('assert');
const Database = require('better-sqlite3');
const path = require('path');

// Import models
const User = require('../models/User');
const Pairing = require('../models/Pairing');
const Program = require('../models/Program');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const ChatGPTService = require('../services/ChatGPTService');

// Mock ChatGPT Service for testing
class MockChatGPTService extends ChatGPTService {
  constructor() {
    super();
    this.mockResponses = [];
    this.callLog = [];
  }

  // Override to avoid needing real API key
  validateApiKey() {
    console.log('Mock ChatGPT service initialized');
  }

  // Mock the therapy response generation
  async generateCouplesTherapyResponse(user1Name, user2Name, user1Messages, user2FirstMessage) {
    this.callLog.push({
      user1Name,
      user2Name,
      user1Messages,
      user2FirstMessage,
      timestamp: new Date().toISOString()
    });

    // Return mock responses - always return an array
    if (this.mockResponses.length > 0) {
      const response = this.mockResponses.shift();
      return Array.isArray(response) ? response : [response];
    }
    
    // Default mock responses
    return [
      `Thank you ${user1Name} and ${user2Name} for sharing. I can see there are some important feelings here that we need to explore together.`,
      `${user1Name}, when you shared "${Array.isArray(user1Messages) ? user1Messages[0] : user1Messages}", what emotions were you experiencing in that moment?`,
      `${user2Name}, I heard you say "${user2FirstMessage}". Can you help us understand what that means for you emotionally?`
    ];
  }

  // Helper methods for testing
  setMockResponse(responses) {
    // Store the responses as a single array that will be returned
    this.mockResponses = [Array.isArray(responses) ? responses : [responses]];
  }

  getCallLog() {
    return this.callLog;
  }

  clearCallLog() {
    this.callLog = [];
  }
}

class TherapyResponseTest {
  constructor() {
    this.testDb = null;
    this.models = {};
    this.mockChatGPT = null;
    this.testData = {};
  }

  async setup() {
    console.log('Setting up therapy response tests...');
    
    // Create in-memory test database
    this.testDb = new Database(':memory:');
    
    // Initialize models
    this.models.user = new User(this.testDb);
    this.models.pairing = new Pairing(this.testDb);
    this.models.program = new Program(this.testDb);
    this.models.conversation = new Conversation(this.testDb);
    this.models.message = new Message(this.testDb);
    
    // Initialize mock ChatGPT service
    this.mockChatGPT = new MockChatGPTService();
    
    // Initialize database tables
    await this.models.user.initDatabase();
    await this.models.pairing.initDatabase();
    await this.models.program.initDatabase();
    await this.models.conversation.initDatabase();
    await this.models.message.initDatabase();
    
    // Create test data
    await this.createTestData();
    
    console.log('Test setup completed successfully');
  }

  async createTestData() {
    // Create test users
    this.testData.user1 = await this.models.user.createUser({
      email: 'steve@test.com',
      first_name: 'Steve',
      last_name: 'Johnson',
      password: 'Test123!'
    });

    this.testData.user2 = await this.models.user.createUser({
      email: 'becca@test.com',
      first_name: 'Becca',
      last_name: 'Johnson',
      password: 'Test123!'
    });

    // Create test pairing
    this.testData.pairing = await this.models.pairing.createPairing(
      this.testData.user1.id,
      this.testData.user2.id
    );

    // Accept the pairing
    await this.models.pairing.acceptPairing(this.testData.pairing.id);

    // Create test program
    this.testData.program = await this.models.program.createProgram(
      this.testData.user1.id,
      {
        user_name: 'Steve',
        partner_name: 'Becca',
        children: 2,
        user_input: 'We need help connecting better',
        pairing_id: this.testData.pairing.id
      }
    );

    // Create test conversation
    this.testData.conversation = await this.models.conversation.createDayConversation(
      this.testData.program.id,
      1,
      'Building Connection',
      'Tell me about a time when you felt really connected',
      'Research shows that sharing positive memories helps couples bond'
    );
  }

  async testTriggerLogic() {
    console.log('\n=== Testing Therapy Response Trigger Logic ===');
    
    // Import the trigger function (we'll need to extract it)
    const { checkAndTriggerTherapyResponse } = await this.createTriggerFunction();
    
    // Test 1: No trigger when only one user has posted
    console.log('Test 1: Single user message - should not trigger');
    await this.models.message.addMessage(
      this.testData.conversation.id,
      'user_message',
      this.testData.user1.id,
      'I feel like we used to be so much closer',
      { day: 1, type: 'user_message' }
    );

    this.mockChatGPT.clearCallLog();
    await checkAndTriggerTherapyResponse(this.testData.conversation.id, this.testData.user1.id);
    
    // Wait a bit to ensure no async calls
    await new Promise(resolve => setTimeout(resolve, 100));
    
    assert.strictEqual(this.mockChatGPT.getCallLog().length, 0, 'Should not trigger with only one user');
    console.log('✓ Correctly did not trigger with single user');

    // Test 2: Trigger when second user posts first message
    console.log('\nTest 2: Second user first message - should trigger');
    await this.models.message.addMessage(
      this.testData.conversation.id,
      'user_message',
      this.testData.user2.id,
      'I miss that too. I want us to find our way back to each other',
      { day: 1, type: 'user_message' }
    );

    this.mockChatGPT.clearCallLog();
    await checkAndTriggerTherapyResponse(this.testData.conversation.id, this.testData.user2.id);
    
    // Wait for the 2-second delay plus processing time
    await new Promise(resolve => setTimeout(resolve, 2500));
    
    const callLog = this.mockChatGPT.getCallLog();
    assert.strictEqual(callLog.length, 1, 'Should trigger exactly once');
    assert.strictEqual(callLog[0].user1Name, 'Steve', 'Should pass correct user1 name');
    assert.strictEqual(callLog[0].user2Name, 'Becca', 'Should pass correct user2 name');
    assert.deepStrictEqual(callLog[0].user1Messages, ['I feel like we used to be so much closer'], 'Should pass user1 messages');
    assert.strictEqual(callLog[0].user2FirstMessage, 'I miss that too. I want us to find our way back to each other', 'Should pass user2 first message');
    console.log('✓ Correctly triggered with second user message');

    // Test 3: No trigger on subsequent messages
    console.log('\nTest 3: Subsequent messages - should not trigger again');
    await this.models.message.addMessage(
      this.testData.conversation.id,
      'user_message',
      this.testData.user1.id,
      'What can we do to rebuild that connection?',
      { day: 1, type: 'user_message' }
    );

    this.mockChatGPT.clearCallLog();
    await checkAndTriggerTherapyResponse(this.testData.conversation.id, this.testData.user1.id);
    
    await new Promise(resolve => setTimeout(resolve, 100));
    
    assert.strictEqual(this.mockChatGPT.getCallLog().length, 0, 'Should not trigger on subsequent messages');
    console.log('✓ Correctly did not trigger on subsequent message');
  }

  async testSystemMessageStorage() {
    console.log('\n=== Testing System Message Storage ===');
    
    // Set up mock responses
    const mockResponses = [
      'This is the first therapy response.',
      'This is the second therapy response.',
      'This is the third therapy response.'
    ];
    this.mockChatGPT.setMockResponse(mockResponses);
    
    console.log('Mock responses set:', mockResponses);
    
    // Create a new conversation for this test
    const testConversation = await this.models.conversation.createDayConversation(
      this.testData.program.id,
      2,
      'Communication',
      'How do you typically express your needs?',
      'Clear communication is key to relationship success'
    );

    // Add user messages to trigger the response
    await this.models.message.addMessage(
      testConversation.id,
      'user_message',
      this.testData.user1.id,
      'I struggle to express what I need',
      { day: 2, type: 'user_message' }
    );

    await this.models.message.addMessage(
      testConversation.id,
      'user_message',
      this.testData.user2.id,
      'I want to understand you better',
      { day: 2, type: 'user_message' }
    );

    // Import and trigger the function
    const { checkAndTriggerTherapyResponse } = await this.createTriggerFunction();
    await checkAndTriggerTherapyResponse(testConversation.id, this.testData.user2.id);
    
    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 2500));
    
    // Check that system messages were added
    const messages = await this.models.message.getConversationMessages(testConversation.id);
    const systemMessages = messages.filter(msg => msg.message_type === 'system');
    
    assert.strictEqual(systemMessages.length, 3, 'Should add 3 system messages');
    
    // Check message content and metadata
    for (let i = 0; i < systemMessages.length; i++) {
      const msg = systemMessages[i];
      assert.strictEqual(msg.content, mockResponses[i], `System message ${i + 1} content should match`);
      assert.strictEqual(msg.sender_id, null, 'System messages should have no sender');
      
      const metadata = typeof msg.metadata === 'string' ? JSON.parse(msg.metadata) : msg.metadata;
      assert.strictEqual(metadata.type, 'therapy_response', 'Should have correct metadata type');
      assert.strictEqual(metadata.sequence, i + 1, `Should have correct sequence number`);
      assert.strictEqual(metadata.total_messages, 3, 'Should have correct total count');
    }
    
    console.log('✓ System messages stored correctly with proper metadata');
  }

  async testNonPairedProgram() {
    console.log('\n=== Testing Non-Paired Program (Should Not Trigger) ===');
    
    // Create program without pairing
    const soloProgram = await this.models.program.createProgram(
      this.testData.user1.id,
      {
        user_name: 'Steve',
        partner_name: 'Becca',
        children: 2,
        user_input: 'Solo program test',
        pairing_id: null
      }
    );

    const soloConversation = await this.models.conversation.createDayConversation(
      soloProgram.id,
      1,
      'Solo Test',
      'This is a solo program',
      'Solo programs should not trigger therapy responses'
    );

    // Add messages
    await this.models.message.addMessage(
      soloConversation.id,
      'user_message',
      this.testData.user1.id,
      'This is a solo message',
      { day: 1, type: 'user_message' }
    );

    const { checkAndTriggerTherapyResponse } = await this.createTriggerFunction();
    this.mockChatGPT.clearCallLog();
    await checkAndTriggerTherapyResponse(soloConversation.id, this.testData.user1.id);
    
    await new Promise(resolve => setTimeout(resolve, 100));
    
    assert.strictEqual(this.mockChatGPT.getCallLog().length, 0, 'Should not trigger for non-paired programs');
    console.log('✓ Correctly did not trigger for non-paired program');
  }

  async testErrorHandling() {
    console.log('\n=== Testing Error Handling ===');
    
    // Create a ChatGPT service that throws errors
    const errorChatGPT = new MockChatGPTService();
    errorChatGPT.generateCouplesTherapyResponse = async () => {
      throw new Error('Mock OpenAI API error');
    };

    // Create conversation and messages
    const errorConversation = await this.models.conversation.createDayConversation(
      this.testData.program.id,
      3,
      'Error Test',
      'This will test error handling',
      'Error handling is important'
    );

    await this.models.message.addMessage(
      errorConversation.id,
      'user_message',
      this.testData.user1.id,
      'First message',
      { day: 3, type: 'user_message' }
    );

    await this.models.message.addMessage(
      errorConversation.id,
      'user_message',
      this.testData.user2.id,
      'Second message',
      { day: 3, type: 'user_message' }
    );

    // Create trigger function with error service
    const { checkAndTriggerTherapyResponse } = await this.createTriggerFunction(errorChatGPT);
    
    // This should not throw an error (should be caught and logged)
    let errorThrown = false;
    try {
      await checkAndTriggerTherapyResponse(errorConversation.id, this.testData.user2.id);
      await new Promise(resolve => setTimeout(resolve, 2500));
    } catch (error) {
      errorThrown = true;
    }
    
    assert.strictEqual(errorThrown, false, 'Error should be caught and not propagate');
    console.log('✓ Errors are properly caught and handled');
  }

  // Helper method to create the trigger function for testing
  async createTriggerFunction(chatGPTService = null) {
    const service = chatGPTService || this.mockChatGPT;
    
    const checkAndTriggerTherapyResponse = async (conversationId, currentUserId) => {
      try {
        // Get the conversation to find the program
        const conversation = await this.models.conversation.getConversationById(conversationId);
        const program = await this.models.program.getProgramById(conversation.program_id);
        
        // Only trigger if program has a pairing
        if (!program.pairing_id) {
          return;
        }

        // Get the pairing to find both users
        const pairing = await this.models.pairing.getPairingById(program.pairing_id);
        if (pairing.status !== 'accepted') {
          return;
        }

        const user1Id = pairing.user1_id;
        const user2Id = pairing.user2_id;

        // Get all messages in this conversation
        const messages = await this.models.message.getConversationMessages(conversationId);
        
        // Filter user messages only
        const userMessages = messages.filter(msg => msg.message_type === 'user_message');
        
        // Check if both users have posted messages
        const user1Messages = userMessages.filter(msg => msg.sender_id === user1Id);
        const user2Messages = userMessages.filter(msg => msg.sender_id === user2Id);
        
        // Only trigger if both users have posted at least one message
        // and this is the second user's first message (either user1 or user2 could be second)
        const shouldTrigger = 
          (user1Messages.length === 1 && user2Messages.length > 0 && currentUserId === user1Id) ||
          (user2Messages.length === 1 && user1Messages.length > 0 && currentUserId === user2Id);
          
        if (shouldTrigger) {
          // Get user names
          const user1 = await this.models.user.getUserById(user1Id);
          const user2 = await this.models.user.getUserById(user2Id);
          
          const user1Name = user1.first_name || 'User 1';
          const user2Name = user2.first_name || 'User 2';
          
          // Get user1's messages content and user2's first message
          const user1MessagesContent = user1Messages.map(msg => msg.content);
          const user2FirstMessage = user2Messages[0].content;
          
          // Trigger background request with 2-second delay
          setTimeout(async () => {
            try {
              console.log(`Triggering background therapy response for conversation ${conversationId}`);
              
              const therapyMessages = await service.generateCouplesTherapyResponse(
                user1Name,
                user2Name,
                user1MessagesContent,
                user2FirstMessage
              );
              
              // Add each therapy message as a system message
              for (let i = 0; i < therapyMessages.length; i++) {
                const message = therapyMessages[i];
                if (message && message.trim().length > 0) {
                  await this.models.message.addMessage(
                    conversationId,
                    'system',
                    null, // No sender for system messages
                    message.trim(),
                    {
                      type: 'therapy_response',
                      sequence: i + 1,
                      total_messages: therapyMessages.length
                    }
                  );
                }
              }
              
              console.log(`Added ${therapyMessages.length} therapy response messages to conversation ${conversationId}`);
            } catch (error) {
              console.error('Error generating background therapy response:', error.message);
            }
          }, 2000); // 2-second delay
        }
      } catch (error) {
        console.error('Error checking therapy response trigger:', error.message);
      }
    };

    return { checkAndTriggerTherapyResponse };
  }

  async cleanup() {
    if (this.testDb) {
      this.testDb.close();
    }
  }

  async runAllTests() {
    try {
      await this.setup();
      await this.testTriggerLogic();
      await this.testSystemMessageStorage();
      await this.testNonPairedProgram();
      await this.testErrorHandling();
      
      console.log('\n🎉 All therapy response tests passed!');
      return true;
    } catch (error) {
      console.error('\n❌ Test failed:', error.message);
      console.error(error.stack);
      return false;
    } finally {
      await this.cleanup();
    }
  }
}

// Export for use in other test files
module.exports = { TherapyResponseTest, MockChatGPTService };

// Run tests if this file is executed directly
if (require.main === module) {
  const test = new TherapyResponseTest();
  test.runAllTests().then(success => {
    process.exit(success ? 0 : 1);
  });
}
