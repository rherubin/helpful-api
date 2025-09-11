const ChatGPTService = require('../services/ChatGPTService');

/**
 * OpenAI Integration Test Suite
 * Tests OpenAI API key configuration and ChatGPT service functionality
 * Run with: node tests/openai-test.js
 */

class OpenAITestRunner {
  constructor(options = {}) {
    this.timeout = options.timeout || 30000;
    this.testResults = {
      passed: 0,
      failed: 0,
      total: 0
    };
  }

  log(message, type = 'info') {
    const timestamp = new Date().toISOString();
    const prefix = {
      info: '📝',
      pass: '✅',
      fail: '❌',
      warn: '⚠️',
      section: '🧪'
    }[type] || '📝';
    
    console.log(`${prefix} [${timestamp}] ${message}`);
  }

  assert(condition, testName, details = '') {
    this.testResults.total++;
    if (condition) {
      this.testResults.passed++;
      this.log(`${testName} - PASSED ${details}`, 'pass');
    } else {
      this.testResults.failed++;
      this.log(`${testName} - FAILED ${details}`, 'fail');
    }
  }

  // Test OpenAI API key configuration
  async testAPIKeyConfiguration() {
    this.log('Testing OpenAI API Key Configuration', 'section');
    
    // Check environment variable exists
    const apiKey = process.env.OPENAI_API_KEY;
    this.assert(
      !!apiKey,
      'OPENAI_API_KEY environment variable is set',
      apiKey ? `Key: ***${apiKey.slice(-4)}` : 'Not set'
    );
    
    if (!apiKey) {
      this.log('💡 To fix this:', 'info');
      this.log('1. Get your API key from: https://platform.openai.com/api-keys', 'info');
      this.log('2. Create a .env file with: OPENAI_API_KEY=sk-your-key-here', 'info');
      this.log('3. Or run: export OPENAI_API_KEY="sk-your-key-here"', 'info');
      return false;
    }

    // Check API key format
    this.assert(
      apiKey.startsWith('sk-'),
      'API key has correct format',
      apiKey.startsWith('sk-') ? 'Valid format' : 'Invalid format'
    );

    // Check API key length (OpenAI keys are typically 51 characters)
    this.assert(
      apiKey.length >= 40,
      'API key has reasonable length',
      `Length: ${apiKey.length} characters`
    );

    return true;
  }

  // Test ChatGPT service initialization
  async testChatGPTServiceInitialization() {
    this.log('Testing ChatGPT Service Initialization', 'section');
    
    try {
      const chatGPTService = new ChatGPTService();
      
      this.assert(
        !!chatGPTService,
        'ChatGPTService instantiation',
        'Service created successfully'
      );

      this.assert(
        chatGPTService.isConfigured(),
        'ChatGPTService configuration check',
        'Service is properly configured'
      );

      // Test service methods exist
      this.assert(
        typeof chatGPTService.generateCouplesProgram === 'function',
        'generateCouplesProgram method exists',
        'Method is available'
      );

      this.assert(
        typeof chatGPTService.getMetrics === 'function',
        'getMetrics method exists',
        'Method is available'
      );

      return chatGPTService;
      
    } catch (error) {
      this.assert(false, 'ChatGPTService initialization', `Error: ${error.message}`);
      return null;
    }
  }

  // Test OpenAI API connectivity
  async testAPIConnectivity(chatGPTService) {
    this.log('Testing OpenAI API Connectivity', 'section');
    
    if (!chatGPTService) {
      this.log('Skipping API connectivity test - service not initialized', 'warn');
      return;
    }

    try {
      this.log('Making test API call...', 'info');
      const startTime = Date.now();
      
      const testResponse = await Promise.race([
        chatGPTService.generateCouplesProgram(
          'TestUser', 
          'TestPartner', 
          'This is just a test to verify the API is working.'
        ),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('API call timeout')), this.timeout)
        )
      ]);
      
      const duration = Date.now() - startTime;
      
      this.assert(
        !!testResponse,
        'OpenAI API call successful',
        `Response received in ${duration}ms`
      );

      // Validate response structure
      if (testResponse) {
        this.assert(
          typeof testResponse === 'object',
          'API response is object',
          `Type: ${typeof testResponse}`
        );

        // Check for therapy_response or program structure
        const hasTherapyResponse = !!testResponse.therapy_response;
        const hasProgram = !!testResponse.program;
        
        this.assert(
          hasTherapyResponse || hasProgram,
          'Response contains therapy content',
          hasTherapyResponse ? 'therapy_response present' : hasProgram ? 'program present' : 'No therapy content found'
        );

        // Check if it's a proper 14-day program
        const therapyData = testResponse.therapy_response || testResponse.program || testResponse;
        if (therapyData && typeof therapyData === 'object') {
          const days = Object.keys(therapyData).filter(key => key.startsWith('day') || !isNaN(parseInt(key)));
          if (days.length > 0) {
            this.assert(
              days.length === 14,
              'Response contains 14-day program',
              `Days: ${days.length}`
            );
          } else {
            this.log('Response structure does not contain day-based program', 'info');
          }
        }
      }
      
    } catch (error) {
      this.assert(false, 'OpenAI API connectivity', `Error: ${error.message}`);
      
      // Provide helpful error messages
      if (error.message.includes('Invalid API key')) {
        this.log('💡 API Key Issues:', 'warn');
        this.log('- Check your API key is correct', 'info');
        this.log('- Verify the key has not expired', 'info');
        this.log('- Make sure you have credits in your OpenAI account', 'info');
      } else if (error.message.includes('timeout')) {
        this.log('💡 Timeout Issues:', 'warn');
        this.log('- OpenAI API may be slow or unavailable', 'info');
        this.log('- Check your internet connection', 'info');
        this.log('- Try again later', 'info');
      } else if (error.message.includes('rate limit')) {
        this.log('💡 Rate Limit Issues:', 'warn');
        this.log('- You may have exceeded your API rate limits', 'info');
        this.log('- Wait a moment before trying again', 'info');
        this.log('- Consider upgrading your OpenAI plan', 'info');
      }
    }
  }

  // Test service metrics functionality
  async testMetricsFunctionality(chatGPTService) {
    this.log('Testing Metrics Functionality', 'section');
    
    if (!chatGPTService) {
      this.log('Skipping metrics test - service not initialized', 'warn');
      return;
    }

    try {
      const metrics = chatGPTService.getMetrics();
      
      this.assert(
        !!metrics,
        'Metrics retrieval',
        'Metrics object returned'
      );

      if (metrics) {
        // Check for required metric properties
        const requiredMetrics = [
          'totalRequests',
          'successfulRequests', 
          'failedRequests',
          'rateLimitErrors',
          'averageResponseTime',
          'queueLength',
          'activeRequests',
          'successRate'
        ];

        requiredMetrics.forEach(metric => {
          this.assert(
            metrics.hasOwnProperty(metric),
            `Metrics contains ${metric}`,
            `Value: ${metrics[metric]}`
          );
        });
      }
      
    } catch (error) {
      this.assert(false, 'Metrics functionality', `Error: ${error.message}`);
    }
  }

  // Test error handling
  async testErrorHandling(chatGPTService) {
    this.log('Testing Error Handling', 'section');
    
    if (!chatGPTService) {
      this.log('Skipping error handling test - service not initialized', 'warn');
      return;
    }

    // Test with invalid input
    try {
      await chatGPTService.generateCouplesProgram('', '', '');
      this.assert(false, 'Empty input handling', 'Should have thrown error');
    } catch (error) {
      this.assert(
        true,
        'Empty input handling',
        'Correctly rejected empty input'
      );
    }

    // Test with null input
    try {
      await chatGPTService.generateCouplesProgram(null, null, null);
      this.assert(false, 'Null input handling', 'Should have thrown error');
    } catch (error) {
      this.assert(
        true,
        'Null input handling', 
        'Correctly rejected null input'
      );
    }
  }

  // Run comprehensive OpenAI test suite
  async runFullTestSuite() {
    this.log('🧪 Starting Comprehensive OpenAI Test Suite', 'section');
    
    try {
      const hasValidAPIKey = await this.testAPIKeyConfiguration();
      console.log('');
      
      const chatGPTService = await this.testChatGPTServiceInitialization();
      console.log('');
      
      if (hasValidAPIKey && chatGPTService) {
        await this.testAPIConnectivity(chatGPTService);
        console.log('');
        
        await this.testMetricsFunctionality(chatGPTService);
        console.log('');
        
        await this.testErrorHandling(chatGPTService);
        console.log('');
      }
      
      this.printSummary();
      
      return this.testResults.failed === 0;
      
    } catch (error) {
      this.log(`Test suite failed with error: ${error.message}`, 'fail');
      return false;
    }
  }

  printSummary() {
    this.log('📊 OpenAI Test Results Summary', 'section');
    this.log(`Total Tests: ${this.testResults.total}`);
    this.log(`Passed: ${this.testResults.passed}`, this.testResults.passed === this.testResults.total ? 'pass' : 'info');
    this.log(`Failed: ${this.testResults.failed}`, this.testResults.failed === 0 ? 'pass' : 'fail');
    
    const successRate = this.testResults.total > 0 
      ? ((this.testResults.passed / this.testResults.total) * 100).toFixed(1)
      : '0';
    this.log(`Success Rate: ${successRate}%`, this.testResults.failed === 0 ? 'pass' : 'warn');
    
    if (this.testResults.failed === 0) {
      this.log('🎉 All OpenAI tests passed! Your OpenAI integration is working correctly.', 'pass');
    } else {
      this.log('⚠️ Some OpenAI tests failed. Review the failures above.', 'fail');
    }
  }
}

// Export for use in other test files
module.exports = OpenAITestRunner;

// Run tests if called directly
if (require.main === module) {
  require('dotenv').config();
  
  const testRunner = new OpenAITestRunner();
  testRunner.runFullTestSuite()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('Fatal test error:', error);
      process.exit(1);
    });
}
