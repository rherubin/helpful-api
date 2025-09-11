const axios = require('axios');
const jwt = require('jsonwebtoken');

/**
 * Comprehensive load testing suite for API scalability
 * Tests concurrent request handling and performance under load
 * Run with: node tests/load-test.js
 */

class LoadTestRunner {
  constructor(options = {}) {
    this.baseURL = options.baseURL || 'http://localhost:9000';
    this.timeout = options.timeout || 30000; // 30 seconds
    this.JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
    this.testResults = [];
  }

  log(message, type = 'info') {
    const timestamp = new Date().toISOString();
    const prefix = {
      info: '📝',
      success: '✅',
      error: '❌',
      warn: '⚠️',
      section: '🚀'
    }[type] || '📝';
    
    console.log(`${prefix} [${timestamp}] ${message}`);
  }

  // Generate JWT token for testing
  generateTestToken(userId = 'test-user-id', email = 'test@example.com') {
    return jwt.sign({ id: userId, email }, this.JWT_SECRET, { expiresIn: '24h' });
  }

  // Create a single program
  async createProgram(token, index, testName = 'LoadTest') {
    const startTime = Date.now();
    
    try {
      this.log(`Starting program ${index} (${testName})`, 'info');
      
      const response = await axios.post(`${this.baseURL}/api/programs`, {
        user_name: `User${index}`,
        partner_name: `Partner${index}`,
        children: Math.floor(Math.random() * 3), // 0-2 children
        user_input: `Test input for ${testName} ${index} - we need help with communication and would like to strengthen our relationship through better understanding of each other's needs and emotions. We have been together for ${Math.floor(Math.random() * 10) + 1} years.`
      }, {
        headers: { 
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        timeout: this.timeout
      });
      
      const duration = Date.now() - startTime;
      this.log(`✅ Program ${index} created in ${duration}ms - ID: ${response.data.program.id}`, 'success');
      
      return { 
        success: true, 
        duration, 
        programId: response.data.program.id,
        index,
        testName
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMsg = error.response?.data?.error || error.message;
      const statusCode = error.response?.status || error.code;
      
      this.log(`❌ Program ${index} failed after ${duration}ms: ${statusCode} - ${errorMsg}`, 'error');
      
      return { 
        success: false, 
        error: statusCode, 
        duration,
        errorMessage: errorMsg,
        index,
        testName
      };
    }
  }

  // Get OpenAI metrics
  async getMetrics(token) {
    try {
      const response = await axios.get(`${this.baseURL}/api/programs/metrics`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 5000
      });
      return response.data.metrics;
    } catch (error) {
      this.log(`Failed to get metrics: ${error.response?.data?.error || error.message}`, 'warn');
      return null;
    }
  }

  // Test server health
  async testServerHealth() {
    try {
      const response = await axios.get(`${this.baseURL}/health`, { timeout: 5000 });
      this.log(`Server health check: ${response.data.status}`, 'success');
      return true;
    } catch (error) {
      this.log(`Server health check failed: ${error.message}`, 'error');
      return false;
    }
  }

  // Basic concurrent load test
  async runConcurrentTest(concurrency = 8, testName = 'ConcurrentTest') {
    this.log(`🚀 Starting ${testName} with ${concurrency} concurrent requests`, 'section');
    
    const token = this.generateTestToken();
    const startTime = Date.now();
    
    // Create promises for concurrent execution
    const promises = Array.from({ length: concurrency }, (_, i) => 
      this.createProgram(token, i + 1, testName)
    );
    
    // Wait for all requests to complete
    const results = await Promise.all(promises);
    const totalTime = Date.now() - startTime;
    
    // Analyze results
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    const avgDuration = successful.length > 0 
      ? successful.reduce((sum, r) => sum + r.duration, 0) / successful.length 
      : 0;
    
    const testResult = {
      testName,
      concurrency,
      totalTime,
      successful: successful.length,
      failed: failed.length,
      successRate: (successful.length / concurrency * 100).toFixed(1),
      avgResponseTime: avgDuration.toFixed(2),
      results
    };
    
    this.testResults.push(testResult);
    
    this.log(`📊 ${testName} Results:`, 'section');
    this.log(`Total time: ${totalTime}ms`);
    this.log(`Successful: ${successful.length}/${concurrency} (${testResult.successRate}%)`);
    this.log(`Failed: ${failed.length}/${concurrency}`);
    this.log(`Average response time: ${testResult.avgResponseTime}ms`);
    
    return testResult;
  }

  // Stress test with increasing load
  async runStressTest() {
    this.log('🔥 Starting Stress Test with Increasing Load', 'section');
    
    const loadLevels = [2, 4, 8, 12, 16];
    const stressResults = [];
    
    for (const concurrency of loadLevels) {
      this.log(`Testing with ${concurrency} concurrent requests...`);
      
      const result = await this.runConcurrentTest(concurrency, `StressTest-${concurrency}`);
      stressResults.push(result);
      
      // Wait between tests to avoid overwhelming the system
      this.log('Waiting 5 seconds before next test level...');
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    
    // Analyze stress test results
    this.log('📈 Stress Test Analysis:', 'section');
    stressResults.forEach(result => {
      const status = result.successRate >= '95.0' ? '✅' : result.successRate >= '80.0' ? '⚠️' : '❌';
      this.log(`${status} ${result.concurrency} concurrent: ${result.successRate}% success, ${result.avgResponseTime}ms avg`);
    });
    
    return stressResults;
  }

  // Test error handling and recovery
  async runErrorHandlingTest() {
    this.log('🛡️ Starting Error Handling Test', 'section');
    
    const token = this.generateTestToken();
    
    // Test with invalid data
    const errorTests = [
      {
        name: 'Missing required fields',
        data: { user_name: 'Test' }, // Missing required fields
        expectedError: 400
      },
      {
        name: 'Invalid children value',
        data: {
          user_name: 'Test',
          partner_name: 'Partner',
          children: -1, // Invalid negative value
          user_input: 'Test input'
        },
        expectedError: 400
      },
      {
        name: 'Empty user input',
        data: {
          user_name: 'Test',
          partner_name: 'Partner',
          children: 0,
          user_input: '' // Empty input
        },
        expectedError: 400
      }
    ];
    
    const errorResults = [];
    
    for (const test of errorTests) {
      try {
        const startTime = Date.now();
        await axios.post(`${this.baseURL}/api/programs`, test.data, {
          headers: { 
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          timeout: this.timeout
        });
        
        // If we get here, the test failed (should have thrown an error)
        errorResults.push({
          name: test.name,
          success: false,
          reason: 'Expected error but request succeeded'
        });
        
      } catch (error) {
        const duration = Date.now() - startTime;
        const actualError = error.response?.status;
        const success = actualError === test.expectedError;
        
        errorResults.push({
          name: test.name,
          success,
          expectedError: test.expectedError,
          actualError,
          duration
        });
        
        const status = success ? '✅' : '❌';
        this.log(`${status} ${test.name}: Expected ${test.expectedError}, got ${actualError}`, success ? 'success' : 'error');
      }
    }
    
    return errorResults;
  }

  // Performance benchmark test
  async runPerformanceBenchmark() {
    this.log('⚡ Starting Performance Benchmark', 'section');
    
    const token = this.generateTestToken();
    const iterations = 20;
    const results = [];
    
    this.log(`Running ${iterations} sequential program creations...`);
    
    for (let i = 1; i <= iterations; i++) {
      const result = await this.createProgram(token, i, 'Benchmark');
      results.push(result);
      
      // Small delay to avoid overwhelming
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    const successful = results.filter(r => r.success);
    const durations = successful.map(r => r.duration);
    
    if (durations.length > 0) {
      const min = Math.min(...durations);
      const max = Math.max(...durations);
      const avg = durations.reduce((sum, d) => sum + d, 0) / durations.length;
      const median = durations.sort((a, b) => a - b)[Math.floor(durations.length / 2)];
      
      this.log('📊 Performance Benchmark Results:', 'section');
      this.log(`Successful requests: ${successful.length}/${iterations}`);
      this.log(`Min response time: ${min}ms`);
      this.log(`Max response time: ${max}ms`);
      this.log(`Average response time: ${avg.toFixed(2)}ms`);
      this.log(`Median response time: ${median}ms`);
      
      return { min, max, avg, median, successful: successful.length, total: iterations };
    }
    
    return null;
  }

  // Run comprehensive load test suite
  async runFullTestSuite() {
    this.log('🚀 Starting Comprehensive Load Test Suite', 'section');
    
    try {
      // Check server health first
      const healthOk = await this.testServerHealth();
      if (!healthOk) {
        throw new Error('Server health check failed');
      }
      
      // Get initial metrics
      const token = this.generateTestToken();
      this.log('📊 Getting initial OpenAI metrics...');
      const initialMetrics = await this.getMetrics(token);
      if (initialMetrics) {
        this.log(`Initial metrics: ${JSON.stringify(initialMetrics, null, 2)}`);
      }
      
      // Run basic concurrent test
      await this.runConcurrentTest(8, 'BasicConcurrency');
      console.log('');
      
      // Run stress test
      const stressResults = await this.runStressTest();
      console.log('');
      
      // Run error handling test
      await this.runErrorHandlingTest();
      console.log('');
      
      // Run performance benchmark
      await this.runPerformanceBenchmark();
      console.log('');
      
      // Get final metrics
      this.log('⏳ Waiting 10 seconds for background processing...');
      await new Promise(resolve => setTimeout(resolve, 10000));
      
      this.log('📊 Getting final OpenAI metrics...');
      const finalMetrics = await this.getMetrics(token);
      if (finalMetrics) {
        this.log(`Final metrics: ${JSON.stringify(finalMetrics, null, 2)}`);
      }
      
      // Print overall summary
      this.printOverallSummary();
      
      return true;
      
    } catch (error) {
      this.log(`Load test suite failed: ${error.message}`, 'error');
      return false;
    }
  }

  // Print comprehensive summary
  printOverallSummary() {
    this.log('📊 Overall Load Test Summary', 'section');
    
    const totalTests = this.testResults.length;
    const successfulTests = this.testResults.filter(r => parseFloat(r.successRate) >= 95.0).length;
    
    this.log(`Test Scenarios Completed: ${totalTests}`);
    this.log(`High Success Rate Tests (≥95%): ${successfulTests}/${totalTests}`);
    
    if (totalTests > 0) {
      const avgSuccessRate = this.testResults.reduce((sum, r) => sum + parseFloat(r.successRate), 0) / totalTests;
      const avgResponseTime = this.testResults.reduce((sum, r) => sum + parseFloat(r.avgResponseTime), 0) / totalTests;
      
      this.log(`Average Success Rate: ${avgSuccessRate.toFixed(1)}%`);
      this.log(`Average Response Time: ${avgResponseTime.toFixed(2)}ms`);
    }
    
    // Recommendations
    this.log('🎯 Scalability Assessment:', 'section');
    if (successfulTests === totalTests) {
      this.log('✅ EXCELLENT: API demonstrates strong scalability characteristics', 'success');
      this.log('✅ Recommended for production deployment', 'success');
    } else if (successfulTests >= totalTests * 0.8) {
      this.log('⚠️ GOOD: API shows good scalability with minor issues', 'warn');
      this.log('⚠️ Consider optimization before high-load production', 'warn');
    } else {
      this.log('❌ NEEDS IMPROVEMENT: Scalability issues detected', 'error');
      this.log('❌ Optimization required before production deployment', 'error');
    }
    
    this.log('🎉 Load testing completed!', 'success');
  }
}

// Run tests if called directly
if (require.main === module) {
  const loadTester = new LoadTestRunner();
  loadTester.runFullTestSuite().then(success => {
    process.exit(success ? 0 : 1);
  }).catch(error => {
    console.error('Load test runner failed:', error);
    process.exit(1);
  });
}

module.exports = LoadTestRunner;
