#!/usr/bin/env node

// Script to generate therapy response for existing program
require('dotenv').config();

const Database = require('better-sqlite3');
const Program = require('./models/Program');
const ChatGPTService = require('./services/ChatGPTService');

async function fixProgramResponse() {
  const programId = 'mf6zdcaqpz2lpon80t9';
  let db;
  
  try {
    // Connect to database
    db = new Database('./helpful-db.sqlite');
    console.log('✅ Connected to database');
    
    // Initialize models
    const programModel = new Program(db);
    const chatGPTService = new ChatGPTService();
    
    // Get the program
    console.log(`🔍 Looking for program ${programId}...`);
    const program = await programModel.getProgramById(programId);
    
    console.log(`📋 Program found:`);
    console.log(`- User: ${program.user_name}`);
    console.log(`- Partner: ${program.partner_name}`);
    console.log(`- Children: ${program.children}`);
    console.log(`- Input: "${program.user_input.substring(0, 100)}..."`);
    console.log(`- Has therapy response: ${!!program.therapy_response}`);
    
    if (program.therapy_response) {
      console.log('⚠️  Program already has a therapy response. Overwriting...');
    }
    
    // Check if ChatGPT is configured
    if (!chatGPTService.isConfigured()) {
      console.error('❌ ChatGPT service is not configured');
      return;
    }
    
    console.log('🤖 Generating ChatGPT therapy response...');
    
    // Generate the therapy response
    const therapyResponse = await chatGPTService.generateCouplesProgram(
      program.user_name, 
      program.partner_name, 
      program.user_input
    );
    
    // Convert response to string if it's an object
    const therapyResponseString = typeof therapyResponse === 'object' 
      ? JSON.stringify(therapyResponse) 
      : therapyResponse;
    
    console.log('💾 Saving therapy response to database...');
    
    // Update the program with the therapy response
    await programModel.updateTherapyResponse(programId, therapyResponseString);
    
    console.log('✅ Success! Therapy response generated and saved.');
    console.log(`📊 Response length: ${therapyResponseString.length} characters`);
    
    // Show a preview of the response
    if (typeof therapyResponse === 'object' && therapyResponse.program) {
      console.log(`\n📋 Program Preview:`);
      console.log(`Title: ${therapyResponse.program.title || 'N/A'}`);
      console.log(`Overview: ${therapyResponse.program.overview || 'N/A'}`);
      if (therapyResponse.program.days && therapyResponse.program.days.length > 0) {
        console.log(`Days: ${therapyResponse.program.days.length}`);
        console.log(`First day theme: ${therapyResponse.program.days[0].theme || 'N/A'}`);
      }
    } else {
      console.log(`\n📋 Response preview: ${therapyResponseString.substring(0, 200)}...`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.message.includes('Program not found')) {
      console.log('💡 Make sure the program ID is correct');
    }
  } finally {
    if (db) {
      db.close();
      console.log('\n🔒 Database connection closed');
    }
  }
}

// Run the fix
fixProgramResponse();

