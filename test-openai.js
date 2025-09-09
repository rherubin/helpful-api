#!/usr/bin/env node

// Test script to verify OpenAI API key configuration
require('dotenv').config();

const ChatGPTService = require('./services/ChatGPTService');

async function testOpenAI() {
  console.log('🧪 Testing OpenAI API Key Configuration...\n');
  
  // Check environment variable
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.log('❌ OPENAI_API_KEY is not set');
    console.log('\n📝 To fix this:');
    console.log('1. Get your API key from: https://platform.openai.com/api-keys');
    console.log('2. Create a .env file with: OPENAI_API_KEY=sk-your-key-here');
    console.log('3. Or run: export OPENAI_API_KEY="sk-your-key-here"');
    return;
  }
  
  // Mask the key for display
  const maskedKey = `***${apiKey.slice(-4)}`;
  console.log(`✅ OPENAI_API_KEY is set: ${maskedKey}`);
  
  // Test ChatGPT service
  try {
    const chatGPTService = new ChatGPTService();
    
    if (!chatGPTService.isConfigured()) {
      console.log('❌ ChatGPTService is not configured properly');
      return;
    }
    
    console.log('✅ ChatGPTService initialized successfully');
    
    // Test a simple API call
    console.log('\n🔄 Testing API connection...');
    const testResponse = await chatGPTService.generateCouplesProgram(
      'TestUser', 
      'TestPartner', 
      'This is just a test to verify the API is working.'
    );
    
    if (testResponse) {
      console.log('✅ OpenAI API is working! Test response received.');
      console.log('🎉 Your OpenAI API key is configured correctly.\n');
    }
    
  } catch (error) {
    console.log('❌ Error testing OpenAI API:', error.message);
    
    if (error.message.includes('Invalid API key')) {
      console.log('\n💡 Suggestions:');
      console.log('- Check your API key is correct');
      console.log('- Verify the key has not expired');
      console.log('- Make sure you have credits in your OpenAI account');
    }
  }
}

testOpenAI();

