# Test Data Management Guide

## Overview

Tests create data in the MySQL database during execution. This guide explains how to manage test data to keep your database clean.

## 🧪 Test Data Behavior

### What Gets Created

When tests run, they create:
- **Users**: Test accounts with emails like `test_*@example.com`
- **Pairings**: Test pairing requests between users
- **Programs**: Test therapy programs
- **Program Steps**: Individual conversation steps
- **Messages**: Test messages in conversations
- **Refresh Tokens**: JWT refresh tokens

### Test Email Patterns

Tests use these email patterns (easy to identify and clean up):
- `test_[timestamp]@example.com`
- `test_[timestamp]_[random]@example.com`
- `john.doe.[timestamp]@example.com`
- `jane.doe.[timestamp]@example.com`
- `loadtest-[uuid]@example.com`

## 🧹 Cleanup Workflow (Simple & Effective)

### ✅ Recommended Workflow

**Step 1: Run Tests**
```bash
npm run test:mysql
```

**Step 2: Clean Up When Ready**
```bash
npm run test:cleanup
```

That's it! This two-step process gives you full control:
- ✅ **Run tests anytime** without worrying about cleanup
- ✅ **Inspect test data** in database if tests fail
- ✅ **Debug easily** with real data in the database
- ✅ **Clean up periodically** with one simple command

### Why This Approach?

**Flexibility:**
- Tests don't fail due to cleanup issues
- You can inspect data after test runs
- Clean up on your own schedule

**Safety:**
- Cleanup runs in a transaction (all-or-nothing)
- Only test data is removed (safe patterns)
- No risk of deleting production data

**Simplicity:**
- Two commands: test and cleanup
- No complex flags or environment variables
- Works the same everywhere (local, CI/CD, staging)

## 🔍 Inspecting Test Data

### View Test Users

```sql
-- See all test users
SELECT id, email, user_name, created_at 
FROM users 
WHERE email LIKE 'test%@example.com' 
   OR email LIKE '%test%@example.com'
ORDER BY created_at DESC;

-- Count test users
SELECT COUNT(*) as test_user_count 
FROM users 
WHERE email LIKE 'test%@example.com';
```

### View All Test Data

```sql
-- Summary of test data
SELECT 
  (SELECT COUNT(*) FROM users WHERE email LIKE 'test%@example.com') as test_users,
  (SELECT COUNT(*) FROM pairings WHERE user1_id IN (SELECT id FROM users WHERE email LIKE 'test%@example.com')) as test_pairings,
  (SELECT COUNT(*) FROM programs WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'test%@example.com')) as test_programs,
  (SELECT COUNT(*) FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'test%@example.com')) as test_tokens;
```

## 🗑️ Manual Database Cleanup

### Quick Cleanup (Recommended)

Use the cleanup script:

```bash
npm run cleanup:test-data
```

This script:
1. Connects to your MySQL database
2. Counts all test data
3. Shows what will be deleted
4. Deletes in correct order (respecting foreign keys):
   - Messages
   - Program steps
   - Programs
   - Pairings
   - Refresh tokens
   - Users
5. Shows summary of deleted records

### Manual SQL Cleanup

If you prefer SQL commands:

```sql
-- 1. Delete messages from test conversations
DELETE m FROM messages m
INNER JOIN program_steps ps ON m.conversation_id = ps.id
INNER JOIN programs p ON ps.program_id = p.id
WHERE p.user_id IN (
  SELECT id FROM users WHERE email LIKE 'test%@example.com'
);

-- 2. Delete program steps
DELETE ps FROM program_steps ps
INNER JOIN programs p ON ps.program_id = p.id
WHERE p.user_id IN (
  SELECT id FROM users WHERE email LIKE 'test%@example.com'
);

-- 3. Delete programs
DELETE FROM programs 
WHERE user_id IN (
  SELECT id FROM users WHERE email LIKE 'test%@example.com'
);

-- 4. Delete pairings
DELETE FROM pairings 
WHERE user1_id IN (SELECT id FROM users WHERE email LIKE 'test%@example.com')
   OR user2_id IN (SELECT id FROM users WHERE email LIKE 'test%@example.com');

-- 5. Delete refresh tokens
DELETE FROM refresh_tokens 
WHERE user_id IN (
  SELECT id FROM users WHERE email LIKE 'test%@example.com'
);

-- 6. Delete test users
DELETE FROM users 
WHERE email LIKE 'test%@example.com'
   OR email LIKE 'john.doe.%@example.com'
   OR email LIKE 'jane.doe.%@example.com'
   OR email LIKE 'loadtest-%@example.com';
```

## 📋 Best Practices

### For Development

1. **Run tests**: `npm run test:mysql`
2. **Inspect data if needed**: Use SQL queries or database GUI
3. **Clean up before commits**: `npm run test:cleanup`

### For CI/CD Pipelines

**Option 1: Cleanup After Tests (Recommended)**
```bash
npm run test:mysql && npm run test:cleanup
```

**Option 2: Use Fresh Database**
- Spin up a new MySQL container for each test run
- Tear down container after tests complete
- No cleanup needed (container is destroyed)

### For Staging/Production-Like Environments

1. **Never run tests against production database** ⚠️
2. **Use separate test database**: Isolated from staging/production
3. **Always cleanup after tests**: Run `test:cleanup` after test suite
4. **Schedule periodic cleanup**: Cron job running cleanup script daily

## 🔐 Safety Features

### Foreign Key Protection

The cleanup script respects foreign key constraints by deleting in the correct order:
```
1. Messages (depends on program_steps)
2. Program Steps (depends on programs)
3. Programs (depends on users)
4. Pairings (depends on users)
5. Refresh Tokens (depends on users)
6. Test Users (base table)
```

### Transaction Safety

All cleanup operations use transactions:
- ✅ All-or-nothing deletion
- ✅ Rollback on errors
- ✅ Database consistency maintained

### Identification Safety

Only test data is deleted:
- ✅ Email pattern matching
- ✅ No production user deletion
- ✅ Clear test prefixes

## 🚨 Troubleshooting

### "Cannot delete or update a parent row"

**Problem:** Foreign key constraint violation

**Solution:** Use the cleanup script instead of manual SQL:
```bash
npm run cleanup:test-data
```

The script deletes in the correct order.

### "Access denied for user"

**Problem:** MySQL permissions insufficient

**Solution:** Ensure your MySQL user has DELETE permissions:
```sql
GRANT DELETE ON helpful_db.* TO 'your_user'@'localhost';
```

### "Table doesn't exist"

**Problem:** Test database not initialized

**Solution:** Start the server to initialize tables:
```bash
npm start
```

### Cleanup Script Connection Errors

**Problem:** Cannot connect to MySQL

**Solution:**
1. Check MySQL is running: `brew services list`
2. Verify `.env` credentials
3. Test connection: `mysql -u root -p helpful_db`

## 📊 Monitoring Test Data

### Check Database Size

```sql
-- Check test data size
SELECT 
  table_name,
  ROUND(((data_length + index_length) / 1024 / 1024), 2) AS "Size (MB)"
FROM information_schema.TABLES 
WHERE table_schema = 'helpful_db'
ORDER BY (data_length + index_length) DESC;
```

### Count Records by Table

```sql
SELECT 
  'users' as table_name, COUNT(*) as total_records 
FROM users
UNION ALL
SELECT 'pairings', COUNT(*) FROM pairings
UNION ALL
SELECT 'programs', COUNT(*) FROM programs
UNION ALL
SELECT 'program_steps', COUNT(*) FROM program_steps
UNION ALL
SELECT 'messages', COUNT(*) FROM messages
UNION ALL
SELECT 'refresh_tokens', COUNT(*) FROM refresh_tokens;
```

## 🎯 Quick Reference

| Task | Command |
|------|---------|
| Run MySQL integration tests | `npm run test:mysql` |
| Clean up all test data | `npm run test:cleanup` |
| Run tests + cleanup (CI/CD) | `npm run test:mysql && npm run test:cleanup` |
| View test users | SQL query above |
| View all test data | SQL query above |

## 📝 Notes

- Test data helps with debugging but should be cleaned regularly
- Auto-cleanup is safer for CI/CD environments
- Manual cleanup gives more control during development
- All test users are clearly identifiable by email pattern
- Cleanup is safe and respects database constraints

