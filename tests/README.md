# Test Suite Documentation

This directory contains comprehensive test suites for the Helpful API, designed for both development and CI/CD pipeline integration.

## Test Categories

### 🔒 Security Tests (`security-test.js`)
Tests prompt injection protection and input validation:
- Input sanitization (code blocks, role switching, instruction tags)
- Safety validation (suspicious patterns, jailbreak attempts)
- AI response validation (compromise detection)
- Program structure validation
- Queue management functionality
- Edge cases and error handling

**Run with:**
```bash
npm run test:security
# or
node tests/security-test.js
```

### 🧪 API Functionality Tests (`api-test.js`)
Tests all API endpoints and core functionality:
- Health endpoint
- User creation and authentication
- Program CRUD operations
- Conversation management
- Message handling
- Metrics endpoint
- Authorization and security

**Run with:**
```bash
npm run test:api
# or
node tests/api-test.js
```

### 🚀 Load Tests (`load-test.js`)
Tests scalability and performance under load:
- Concurrent request handling (8+ simultaneous requests)
- Stress testing with increasing load levels
- Error handling and recovery
- Performance benchmarking
- OpenAI queue management validation
- Response time analysis

**Run with:**
```bash
npm run test:load
# or
node tests/load-test.js
```

### 🤖 OpenAI Integration Tests (`openai-test.js`)
Tests OpenAI API key configuration and ChatGPT service functionality:
- API key validation (format, length, environment setup)
- ChatGPT service initialization and configuration
- OpenAI API connectivity and response validation
- Metrics functionality and queue management
- Error handling for invalid inputs
- 14-day therapy program structure validation

**Run with:**
```bash
npm run test:openai
# or
node tests/openai-test.js
```

### 🎯 Complete Test Suite (`run-all-tests.js`)
Orchestrates all test categories with comprehensive reporting:
- Runs security, API, load, and OpenAI tests in sequence
- Generates detailed reports
- Provides CI/CD integration
- Configurable test execution

**Run with:**
```bash
npm test
# or
node tests/run-all-tests.js
```

## CI/CD Integration

### Package.json Scripts

The following npm scripts are available for different testing scenarios:

```json
{
  "scripts": {
    "test": "node tests/run-all-tests.js",
    "test:security": "node tests/security-test.js", 
    "test:api": "node tests/api-test.js",
    "test:load": "node tests/load-test.js",
    "test:openai": "node tests/openai-test.js",
    "test:ci": "node tests/run-all-tests.js --skip-server-check",
    "test:quick": "node tests/run-all-tests.js --no-load"
  }
}
```

### Command Line Options

The main test runner supports several CLI options:

```bash
# Skip server health check (useful in CI where server starts separately)
npm run test -- --skip-server-check

# Skip specific test categories
npm run test -- --no-security  # Skip security tests
npm run test -- --no-api       # Skip API tests  
npm run test -- --no-load      # Skip load tests
npm run test -- --no-openai    # Skip OpenAI tests

# Custom server URL and timeout
npm run test -- --url=http://localhost:3000 --timeout=60000
```

### GitHub Actions Example

```yaml
name: Test Suite
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          
      - name: Install dependencies
        run: npm ci
        
      - name: Start server
        run: npm start &
        
      - name: Wait for server
        run: sleep 10
        
      - name: Run tests
        run: npm run test:ci
        env:
          JWT_SECRET: ${{ secrets.JWT_SECRET }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          TEST_REPORT_FILE: test-report.json
          
      - name: Upload test report
        uses: actions/upload-artifact@v3
        if: always()
        with:
          name: test-report
          path: test-report.json
```

### Jenkins Pipeline Example

```groovy
pipeline {
    agent any
    
    environment {
        JWT_SECRET = credentials('jwt-secret')
        OPENAI_API_KEY = credentials('openai-api-key')
    }
    
    stages {
        stage('Install') {
            steps {
                sh 'npm ci'
            }
        }
        
        stage('Start Server') {
            steps {
                sh 'npm start &'
                sh 'sleep 10'
            }
        }
        
        stage('Test') {
            parallel {
                stage('Security Tests') {
                    steps {
                        sh 'npm run test:security'
                    }
                }
                stage('API Tests') {
                    steps {
                        sh 'npm run test:api'
                    }
                }
                stage('Load Tests') {
                    steps {
                        sh 'npm run test:load'
                    }
                }
            }
        }
    }
    
    post {
        always {
            sh 'pkill -f "node server.js" || true'
        }
    }
}
```

## Test Output Examples

### Security Test Output
```
🔒 [2024-01-01T00:00:00.000Z] Testing Input Sanitization
✅ [2024-01-01T00:00:00.001Z] Code block removal - PASSED
✅ [2024-01-01T00:00:00.002Z] System role removal - PASSED
✅ [2024-01-01T00:00:00.003Z] Instruction override removal - PASSED

📊 Test Results Summary
Total Tests: 45
Passed: 45
Failed: 0
Success Rate: 100.0%
🎉 All security tests passed! The API is secure against prompt injection attacks.
```

### Load Test Output
```
🚀 [2024-01-01T00:00:00.000Z] Starting ConcurrentTest with 8 concurrent requests
✅ [2024-01-01T00:00:00.050Z] Program 1 created in 45ms - ID: abc123
✅ [2024-01-01T00:00:00.052Z] Program 2 created in 47ms - ID: def456

📊 ConcurrentTest Results:
Total time: 55ms
Successful: 8/8 (100.0%)
Failed: 0/8
Average response time: 44.38ms

🎯 Scalability Assessment:
✅ EXCELLENT: API demonstrates strong scalability characteristics
✅ Recommended for production deployment
```

### Complete Suite Output
```
🎯 [2024-01-01T00:00:00.000Z] Starting Comprehensive Test Suite
✅ [2024-01-01T00:00:00.001Z] Server is running at http://localhost:9000

🎯 Comprehensive Test Suite Summary
Total Duration: 45.23 seconds

🔒 Security Tests: PASSED (45/45)
🧪 API Tests: PASSED (38/38)
🚀 Load Tests: PASSED

🎉 ALL TESTS PASSED - API is ready for production!
✅ Security: Prompt injection protection working
✅ Functionality: All endpoints working correctly  
✅ Performance: API handles concurrent load well
```

## Test Configuration

### Environment Variables

Tests can be configured using environment variables:

```bash
# Server configuration
BASE_URL=http://localhost:9000
REQUEST_TIMEOUT=30000

# JWT configuration  
JWT_SECRET=your-jwt-secret

# OpenAI configuration (for integration tests)
OPENAI_API_KEY=your-openai-key

# Test reporting
TEST_REPORT_FILE=test-results.json
```

### Test Data

Tests use predictable test data that can be customized:

```javascript
// Example test user
{
  email: "test-user@example.com",
  first_name: "Test",
  last_name: "User", 
  password: "testpass123"
}

// Example test program
{
  user_name: "Alice",
  partner_name: "Bob",
  children: 1,
  user_input: "We need help with communication..."
}
```

## Extending Tests

### Adding New Test Cases

To add new security test cases:

```javascript
// In security-test.js
const newTestCases = [
  {
    input: 'Your malicious input',
    expected: 'Expected sanitized output',
    name: 'Description of test case'
  }
];
```

To add new API endpoints:

```javascript
// In api-test.js
async testNewEndpoint() {
  try {
    const response = await axios.get(`${this.baseURL}/api/new-endpoint`);
    this.assert(response.status === 200, 'New endpoint returns 200');
  } catch (error) {
    this.assert(false, 'New endpoint test', error.message);
  }
}
```

### Custom Test Runners

You can create custom test configurations:

```javascript
const TestSuiteRunner = require('./tests/run-all-tests');

const customRunner = new TestSuiteRunner({
  baseURL: 'https://staging.example.com',
  timeout: 60000,
  runLoad: false // Skip load tests in staging
});

customRunner.runAllTests();
```

## Best Practices

1. **Run tests before every deployment**
2. **Include security tests in every CI run**
3. **Run load tests before production releases**
4. **Monitor test execution times for performance regression**
5. **Keep test data isolated and predictable**
6. **Use proper cleanup in tests to avoid side effects**
7. **Configure appropriate timeouts for different environments**

## Troubleshooting

### Common Issues

**Server not running:**
```bash
# Make sure server is started
npm start

# Or run tests with server check disabled
npm run test:ci
```

**Timeout errors:**
```bash
# Increase timeout for slower environments
npm run test -- --timeout=60000
```

**Permission errors:**
```bash
# Check JWT secret configuration
export JWT_SECRET=your-secret-key
```

**OpenAI integration tests failing:**
```bash
# Set OpenAI API key for full integration tests
export OPENAI_API_KEY=your-openai-key

# Or skip load tests that use OpenAI heavily
npm run test:quick
```

## Maintenance

- **Update test data** when API schemas change
- **Add new test cases** for new features
- **Review test coverage** regularly
- **Update CI configurations** when deployment changes
- **Monitor test execution times** for performance issues
- **Keep dependencies updated** for security

For questions or issues with the test suite, please refer to the main project documentation or create an issue in the repository.
