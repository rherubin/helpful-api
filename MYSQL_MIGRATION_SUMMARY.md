# MySQL Migration Summary

## Overview

The Helpful API has been successfully migrated from SQLite to MySQL to enable scalable production deployment on Railway. This document summarizes all changes made during the migration.

## Changes Made

### 1. Dependencies

**Updated: `package.json`**
- ✅ Removed: `better-sqlite3: ^9.2.2`
- ✅ Added: `mysql2: ^3.6.5`
- ✅ Updated keywords: `sqlite` → `mysql`

### 2. Database Configuration

**Created: `config/database.js`**
- ✅ MySQL connection pool management
- ✅ Support for both individual connection parameters and connection URLs
- ✅ Railway `MYSQL_URL` format support
- ✅ Connection pooling (10 concurrent connections)
- ✅ Keep-alive and automatic reconnection
- ✅ Graceful connection testing and closure

### 3. Server Configuration

**Updated: `server.js`**
- ✅ Replaced SQLite database initialization with MySQL pool
- ✅ Async database setup with connection testing
- ✅ Updated graceful shutdown to close MySQL pool
- ✅ Added SIGTERM handler for Railway deployments
- ✅ Removed SQLite-specific error handling

### 4. Model Files

All model files updated to use MySQL syntax and connection pooling:

**Updated: `models/User.js`**
- ✅ Replaced better-sqlite3 methods with mysql2 pool
- ✅ Updated SQL syntax (TEXT → VARCHAR, INTEGER → INT)
- ✅ Changed CURRENT_TIMESTAMP to NOW() where appropriate
- ✅ Updated error handling for MySQL error codes
- ✅ Added proper indexes for performance
- ✅ Used ON UPDATE CURRENT_TIMESTAMP for auto-updates

**Updated: `models/RefreshToken.js`**
- ✅ MySQL connection pool integration
- ✅ Updated token expiration queries to use NOW()
- ✅ Added indexes for token lookup optimization
- ✅ MySQL-specific error handling

**Updated: `models/Pairing.js`**
- ✅ MySQL syntax for all queries
- ✅ Updated foreign key constraints
- ✅ Added indexes for partner code lookup
- ✅ MySQL-specific unique constraint handling

**Updated: `models/Program.js`**
- ✅ Changed TEXT to LONGTEXT for therapy_response
- ✅ MySQL syntax for all operations
- ✅ Added proper indexes
- ✅ Updated CASCADE deletion handling

**Updated: `models/ProgramStep.js`**
- ✅ MySQL connection pool methods
- ✅ Updated table creation with proper indexes
- ✅ INT for day numbers
- ✅ VARCHAR for themes

**Updated: `models/Message.js`**
- ✅ Updated step_id foreign keys
- ✅ MySQL syntax for all queries
- ✅ Added indexes for message type and timestamps
- ✅ Proper CASCADE and SET NULL handling

### 5. Railway Configuration

**Updated: `nixpacks.toml`**
- ✅ Removed SQLite dependencies (python3, sqlite3)
- ✅ Kept essential build tools (make, g++)
- ✅ Removed better-sqlite3 build commands

**Updated: `railway.json`**
- ✅ Changed builder from DOCKERFILE to NIXPACKS
- ✅ Maintained restart policy configuration

### 6. Documentation

**Created: `.env.example`**
- ✅ MySQL connection parameters
- ✅ MYSQL_URL format for Railway
- ✅ Complete environment variable reference
- ✅ Railway deployment notes

**Updated: `RAILWAY_SETUP.md`**
- ✅ Complete Railway deployment guide
- ✅ MySQL database service setup
- ✅ Environment variable configuration
- ✅ Security best practices
- ✅ Troubleshooting guide
- ✅ Cost optimization tips
- ✅ Database migration instructions

**Updated: `README.md`**
- ✅ Changed all SQLite references to MySQL
- ✅ Updated database setup instructions
- ✅ Added Docker MySQL option
- ✅ Updated schema documentation
- ✅ Added Railway deployment section
- ✅ Updated all SQL examples to MySQL syntax

**Created: `MIGRATION_GUIDE.md`**
- ✅ Step-by-step migration instructions
- ✅ SQLite to MySQL data export/import guide
- ✅ Syntax differences reference
- ✅ Troubleshooting common issues
- ✅ Rollback instructions
- ✅ Testing procedures

## Database Schema Changes

### Data Type Conversions

| SQLite Type | MySQL Type | Notes |
|------------|-----------|-------|
| `TEXT` (ID fields) | `VARCHAR(50)` | Primary and foreign keys |
| `TEXT` (short) | `VARCHAR(255)` | Email, names, themes |
| `TEXT` (content) | `TEXT` | Messages, content |
| `TEXT` (large) | `LONGTEXT` | Therapy responses |
| `INTEGER` | `INT` | Numeric fields |
| `DATETIME` | `DATETIME` | Date/time fields |

### New Features

- ✅ Automatic timestamp updates with `ON UPDATE CURRENT_TIMESTAMP`
- ✅ Proper indexes on all foreign keys
- ✅ Additional performance indexes (email, tokens, dates)
- ✅ InnoDB engine for transaction support
- ✅ UTF8MB4 character set for full Unicode support

## Environment Variables

### New Required Variables

```bash
# MySQL Connection (Option 1: Individual parameters)
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=your_password
MYSQL_DATABASE=helpful_db

# MySQL Connection (Option 2: Connection URL - Railway preferred)
MYSQL_URL=mysql://user:password@host:port/database
```

### Removed Variables

```bash
DATABASE_PATH=./helpful-db.sqlite  # No longer used
```

## Compatibility

### Breaking Changes

- ⚠️ **Database**: Application now requires MySQL 8.0+ instead of SQLite
- ⚠️ **Configuration**: New environment variables required
- ⚠️ **Dependencies**: `better-sqlite3` replaced with `mysql2`

### No Breaking Changes For

- ✅ API endpoints (all remain the same)
- ✅ Request/response formats
- ✅ Authentication tokens
- ✅ Business logic
- ✅ Test suites

## Deployment Options

### Local Development

**Before:**
```bash
# SQLite (old)
npm install
npm start  # Database file created automatically
```

**After:**
```bash
# MySQL (new)
# 1. Install and start MySQL
# 2. Create database
# 3. Update .env
npm install
npm start  # Tables created automatically
```

### Railway Production

**Before:**
- Deploy with automatic SQLite file creation
- No separate database service needed

**After:**
- Add MySQL database service in Railway
- Configure environment variables
- Automatic database provisioning
- Better scalability and performance

## Performance Improvements

1. **Connection Pooling**: Up to 10 concurrent connections
2. **Indexed Queries**: Faster lookups on foreign keys
3. **Query Optimization**: MySQL query optimizer
4. **Scalability**: Better handling of concurrent users
5. **Transactions**: InnoDB engine support

## Testing

All existing tests remain compatible:
- ✅ API functionality tests
- ✅ Authentication tests
- ✅ Security tests
- ✅ Load tests
- ✅ OpenAI integration tests
- ✅ Therapy response tests

**Note:** Tests now use MySQL instead of SQLite, but test code remains unchanged.

## Rollback Plan

If issues arise, you can rollback:

1. Revert to previous git commit
2. Restore SQLite database from backup
3. Reinstall `better-sqlite3`
4. Update `.env` to use `DATABASE_PATH`
5. Restart server

See [MIGRATION_GUIDE.md](./MIGRATION_GUIDE.md) for detailed rollback steps.

## Next Steps

### For Existing Users

1. Review [MIGRATION_GUIDE.md](./MIGRATION_GUIDE.md)
2. Backup your SQLite database
3. Set up MySQL (local or Docker)
4. Update environment variables
5. Run tests to verify functionality

### For New Users

1. Install MySQL
2. Create database
3. Copy `.env.example` to `.env`
4. Update MySQL credentials
5. Run `npm install`
6. Run `npm start`

### For Railway Deployment

1. Review [RAILWAY_SETUP.md](./RAILWAY_SETUP.md)
2. Create Railway account
3. Add MySQL database service
4. Configure environment variables
5. Deploy application

## Support Resources

- **Setup Guide**: [README.md](./README.md)
- **Railway Deployment**: [RAILWAY_SETUP.md](./RAILWAY_SETUP.md)
- **Migration Help**: [MIGRATION_GUIDE.md](./MIGRATION_GUIDE.md)
- **Environment Config**: [.env.example](./.env.example)

## Benefits of MySQL Migration

1. ✅ **Production Ready**: Industry-standard database for production
2. ✅ **Scalability**: Better handling of concurrent connections
3. ✅ **Railway Support**: Native MySQL service integration
4. ✅ **Performance**: Connection pooling and query optimization
5. ✅ **Reliability**: ACID compliance and transaction support
6. ✅ **Monitoring**: Better tools for database monitoring
7. ✅ **Backups**: Easier automated backup solutions
8. ✅ **Industry Standard**: More familiar to most developers

---

**Migration Date:** January 2024  
**MySQL Version:** 8.0+  
**Node.js Version:** 18+  
**Status:** ✅ Complete and Production Ready

