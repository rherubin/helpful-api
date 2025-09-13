#!/usr/bin/env node

const { TherapyResponseTest } = require('./therapy-response-test');
const TherapyResponseIntegrationTest = require('./therapy-response-integration-test');

class TherapyTestRunner {
  constructor() {
    this.results = {
      unit: null,
      integration: null,
      total: 0,
      passed: 0,
      failed: 0
    };
  }

  async runUnitTests() {
    console.log('🧪 Running Therapy Response Unit Tests...');
    console.log('=' .repeat(50));
    
    const unitTest = new TherapyResponseTest();
    const success = await unitTest.runAllTests();
    
    this.results.unit = success;
    this.results.total++;
    if (success) this.results.passed++;
    else this.results.failed++;
    
    return success;
  }

  async runIntegrationTests() {
    console.log('\n🔗 Running Therapy Response Integration Tests...');
    console.log('=' .repeat(50));
    
    const integrationTest = new TherapyResponseIntegrationTest();
    const success = await integrationTest.runAllTests();
    
    this.results.integration = success;
    this.results.total++;
    if (success) this.results.passed++;
    else this.results.failed++;
    
    return success;
  }

  printSummary() {
    console.log('\n' + '=' .repeat(60));
    console.log('📊 THERAPY RESPONSE TEST SUMMARY');
    console.log('=' .repeat(60));
    
    console.log(`Unit Tests:        ${this.results.unit ? '✅ PASSED' : '❌ FAILED'}`);
    console.log(`Integration Tests: ${this.results.integration ? '✅ PASSED' : '❌ FAILED'}`);
    
    console.log('\n📈 Overall Results:');
    console.log(`Total Test Suites: ${this.results.total}`);
    console.log(`Passed:           ${this.results.passed}`);
    console.log(`Failed:           ${this.results.failed}`);
    
    const successRate = this.results.total > 0 ? (this.results.passed / this.results.total * 100).toFixed(1) : 0;
    console.log(`Success Rate:     ${successRate}%`);
    
    if (this.results.failed === 0) {
      console.log('\n🎉 All therapy response tests passed! The feature is working correctly.');
      console.log('\n✨ Key Features Verified:');
      console.log('   • Background OpenAI requests trigger correctly');
      console.log('   • API responses are non-blocking');
      console.log('   • System messages are stored properly');
      console.log('   • Error handling works as expected');
      console.log('   • Both conversation endpoints work');
      console.log('   • Pairing logic is correct');
    } else {
      console.log('\n⚠️  Some tests failed. Please review the output above.');
    }
    
    console.log('=' .repeat(60));
  }

  async runAllTests() {
    const startTime = Date.now();
    
    console.log('🚀 Starting Therapy Response Test Suite');
    console.log(`📅 ${new Date().toISOString()}`);
    console.log('=' .repeat(60));
    
    try {
      // Run unit tests first
      const unitSuccess = await this.runUnitTests();
      
      // Run integration tests
      const integrationSuccess = await this.runIntegrationTests();
      
      const endTime = Date.now();
      const duration = ((endTime - startTime) / 1000).toFixed(2);
      
      console.log(`\n⏱️  Total execution time: ${duration} seconds`);
      
      this.printSummary();
      
      return unitSuccess && integrationSuccess;
    } catch (error) {
      console.error('\n💥 Test runner encountered an error:', error.message);
      console.error(error.stack);
      return false;
    }
  }
}

// Export for use in other files
module.exports = TherapyTestRunner;

// Run tests if this file is executed directly
if (require.main === module) {
  const runner = new TherapyTestRunner();
  runner.runAllTests().then(success => {
    process.exit(success ? 0 : 1);
  });
}
