# Test Email Guidelines

## 🎯 Golden Rule: ALL Test Emails MUST Use @example.com

### Why This Matters

**Safety**: `@example.com` is a reserved domain (RFC 2606) that will never send real emails
**Identification**: Makes test data instantly recognizable in the database
**Cleanup**: Allows safe, automated cleanup of ALL test data without risk
**Consistency**: Ensures all tests follow the same pattern

## ✅ Correct Test Email Patterns

### Using Test Helpers (Recommended)

```javascript
const { generateTestEmail, createTestEmail, generateTestUser } = require('./test-helpers');

// Generate a unique test email
const email = generateTestEmail(); 
// Result: test_1234567890_abc12@example.com

// Generate with custom prefix
const email = generateTestEmail('loadtest');
// Result: loadtest_1234567890_xyz34@example.com

// Create test user with email
const user = generateTestUser({ emailPrefix: 'john' });
// Result: { email: 'john_1234567890_def56@example.com', password: '...' }

// Create custom email (enforces @example.com)
const email = createTestEmail('custom.test.user');
// Result: custom.test.user@example.com
```

### Manual Generation (If Needed)

```javascript
// Always end with @example.com
const email = `test_${Date.now()}@example.com`; ✅
const email = `john.doe.${timestamp}@example.com`; ✅
const email = `loadtest-${uuid}@example.com`; ✅
```

## ❌ NEVER Use These Domains

```javascript
const email = `test@test.com`; ❌ WRONG
const email = `user@gmail.com`; ❌ WRONG
const email = `test@localhost`; ❌ WRONG
const email = `user@mydomain.org`; ❌ WRONG
```

**Why?** These could be real email domains and would:
- Risk sending actual emails
- Be harder to identify as test data
- Complicate database cleanup
- Potentially violate privacy/security

## 🛡️ Validation

### Automatic Validation

Use the validation helper to ensure compliance:

```javascript
const { validateTestEmailDomain } = require('./test-helpers');

// This will throw an error if domain is not @example.com
validateTestEmailDomain(email);
```

### Check Before Using

```javascript
const { isValidTestEmail } = require('./test-helpers');

if (!isValidTestEmail(email)) {
  throw new Error('Invalid test email domain. Must use @example.com');
}
```

## 📋 Standard Test Email Patterns

### Current Patterns in Use

| Pattern | Example | Used By |
|---------|---------|---------|
| `test_*@example.com` | `test_1234567890_abc12@example.com` | MySQL integration tests |
| `john.doe.*@example.com` | `john.doe.1234567890@example.com` | API tests (user 1) |
| `jane.doe.*@example.com` | `jane.doe.1234567890@example.com` | API tests (user 2) |
| `loadtest-*@example.com` | `loadtest-uuid-here@example.com` | Load tests |
| `pairings.user*@example.com` | `pairings.user1.1234567890@example.com` | Pairing tests |
| `login-test-*@example.com` | `login-test-uuid@example.com` | Auth tests |

### Adding New Patterns

When adding new test patterns:
1. ✅ Always end with `@example.com`
2. ✅ Use descriptive prefixes (e.g., `auth-test-`, `profile-`)
3. ✅ Include timestamp or UUID for uniqueness
4. ✅ Document the pattern in this file
5. ✅ Update `getTestEmailPatterns()` in `test-helpers.js`

## 🧹 Cleanup Benefits

Because all test emails use `@example.com`, cleanup is simple:

```sql
-- Find all test users
SELECT * FROM users WHERE email LIKE '%@example.com';

-- Clean up via script
npm run test:cleanup
```

The cleanup script automatically removes:
- All users with `%@example.com` emails
- All their related data (pairings, programs, tokens, etc.)
- Does NOT touch production data

## 🚀 Best Practices

### 1. Always Use Test Helpers

```javascript
// ✅ GOOD: Use helper functions
const { generateTestEmail } = require('./test-helpers');
const email = generateTestEmail();

// ❌ BAD: Hardcode domain
const email = `test_${Date.now()}@test.com`;
```

### 2. Validate When Accepting External Input

```javascript
// If test accepts email as parameter
function createTestUser(email) {
  validateTestEmailDomain(email); // Ensures @example.com
  // ... rest of test
}
```

### 3. Document Custom Patterns

```javascript
// When creating a specialized test user
const email = `specialtest_${Date.now()}@example.com`; // ✅ 
// Document this pattern in TEST_EMAIL_GUIDELINES.md
```

### 4. Use Descriptive Prefixes

```javascript
// ✅ GOOD: Clear purpose
const email = generateTestEmail('payment-test');
const email = generateTestEmail('security-test');

// ⚠️ OKAY but less clear
const email = generateTestEmail('test');
```

## 📝 Updating Tests

### Converting Existing Tests

If you find a test using a different domain:

```javascript
// Before
const email = `user@test.com`; ❌

// After - Option 1: Use helper
const email = generateTestEmail(); ✅

// After - Option 2: Use @example.com
const email = `user_${Date.now()}@example.com`; ✅
```

### Adding to New Tests

Always start with:

```javascript
const { generateTestEmail, validateTestEmailDomain } = require('./test-helpers');

// In your test
const testEmail = generateTestEmail('mytest');
```

## 🔍 Verification

### Check All Test Files

```bash
# Search for potential violations
grep -r "@" tests/*.js | grep -v "@example.com" | grep -v "require\|import\|//"
```

### Run Test Suite

```bash
# All tests use @example.com
npm run test:mysql

# Verify cleanup works
npm run test:cleanup
```

## 📚 Reference

### Why @example.com?

**RFC 2606** reserves these domains for testing:
- `example.com`
- `example.net`
- `example.org`

We use `example.com` as our standard for consistency.

### Test Helper API

See `tests/test-helpers.js` for complete API documentation:
- `generateTestEmail(prefix)` - Generate unique test email
- `generateTestEmailWithUUID(prefix)` - Generate with UUID
- `createTestEmail(localPart)` - Create with custom local part
- `validateTestEmailDomain(email)` - Validate domain
- `isValidTestEmail(email)` - Check if valid test email
- `generateTestUser(options)` - Generate complete user data
- `TEST_EMAIL_DOMAIN` - Constant: '@example.com'
- `getTestEmailPatterns()` - Get all SQL LIKE patterns

## ✅ Compliance Checklist

When writing or reviewing tests:

- [ ] All test emails use `@example.com` domain
- [ ] Using test helper functions where possible
- [ ] Custom patterns are documented
- [ ] Validation is in place for external input
- [ ] Test comments explain the email pattern used
- [ ] Cleanup script can find and remove the test data
- [ ] No hardcoded non-example.com domains

## 🆘 Need Help?

**Question**: Can I use a different domain for a special test?
**Answer**: No. Always use `@example.com`. Use different prefixes to distinguish tests.

**Question**: What if I need to test with a "real-looking" email?
**Answer**: Use `realistic.name@example.com` - still follows the rule!

**Question**: My test needs multiple users. How do I differentiate?
**Answer**: Use descriptive prefixes: `user1.test@example.com`, `user2.test@example.com`

**Question**: Can I use `@example.net` or `@example.org`?
**Answer**: No. Stick to `@example.com` for consistency across all tests.

---

## 🎯 Summary

**Remember**: ALL test emails MUST end with `@example.com`

Use the test helpers to make this automatic and easy!

