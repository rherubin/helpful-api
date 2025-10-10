# Migration Guide: SQLite to MySQL

This guide helps you migrate your existing SQLite database to MySQL.

## Overview

The Helpful API has been migrated from SQLite to MySQL to enable better scalability and production deployment on Railway. This guide covers the migration process.

## Quick Start

### For New Installations

If you're setting up the API for the first time, simply:

1. Install MySQL (see [RAILWAY_SETUP.md](./RAILWAY_SETUP.md) for options)
2. Update your `.env` file with MySQL credentials
3. Run `npm install` to install mysql2
4. Start the server - tables will be created automatically

**No migration needed!**

### For Existing SQLite Users

If you have an existing SQLite database with data you want to preserve, follow the migration steps below.

## Migration Steps

### 1. Backup Your SQLite Database

```bash
# Create a backup of your existing database
cp helpful-db.sqlite helpful-db.sqlite.backup
```

### 2. Set Up MySQL

**Option A: Local MySQL**
```bash
# Install MySQL 8.0+
# On macOS with Homebrew:
brew install mysql

# Start MySQL
brew services start mysql

# Create database
mysql -u root -p
CREATE DATABASE helpful_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
EXIT;
```

**Option B: Docker MySQL**
```bash
docker run --name helpful-mysql \
  -e MYSQL_ROOT_PASSWORD=password \
  -e MYSQL_DATABASE=helpful_db \
  -p 3306:3306 \
  -d mysql:8.0
```

### 3. Update Environment Variables

Update your `.env` file:

```bash
# Comment out or remove SQLite path
# DATABASE_PATH=./helpful-db.sqlite

# Add MySQL configuration
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=your_password
MYSQL_DATABASE=helpful_db

# Or use connection URL
# MYSQL_URL=mysql://root:password@localhost:3306/helpful_db
```

### 4. Install MySQL Dependencies

```bash
npm install mysql2
```

### 5. Initialize MySQL Tables

Start the server to auto-create MySQL tables:

```bash
npm start
```

The server will automatically create all necessary tables in MySQL.

### 6. Export Data from SQLite (Optional)

If you have existing data you want to migrate:

```bash
# Install sqlite3 command-line tool if not already installed
# macOS:
brew install sqlite3

# Export data
sqlite3 helpful-db.sqlite.backup <<EOF
.mode insert users
.output users_data.sql
SELECT * FROM users;
.output refresh_tokens_data.sql
SELECT * FROM refresh_tokens;
.output pairings_data.sql
SELECT * FROM pairings;
.output programs_data.sql
SELECT * FROM programs;
.output program_steps_data.sql
SELECT * FROM program_steps;
.output messages_data.sql
SELECT * FROM messages;
.output stdout
EOF
```

### 7. Import Data into MySQL (Optional)

**Note:** The exported INSERT statements from SQLite may need manual adjustment for MySQL compatibility. This is a manual process and depends on your data.

Basic import process:
```bash
# Review and edit the SQL files to ensure MySQL compatibility
# Then import:
mysql -u root -p helpful_db < users_data.sql
mysql -u root -p helpful_db < refresh_tokens_data.sql
mysql -u root -p helpful_db < pairings_data.sql
mysql -u root -p helpful_db < programs_data.sql
mysql -u root -p helpful_db < program_steps_data.sql
mysql -u root -p helpful_db < messages_data.sql
```

**Important Notes:**
- Review date/time formats (SQLite vs MySQL)
- Check TEXT vs VARCHAR field sizes
- Verify foreign key constraints
- Test with a subset of data first

## Key Differences

### Database Syntax Changes

| Feature | SQLite | MySQL |
|---------|--------|-------|
| Primary Keys | `TEXT PRIMARY KEY` | `VARCHAR(50) PRIMARY KEY` |
| Text Fields | `TEXT` | `TEXT` or `VARCHAR(255)` |
| Integers | `INTEGER` | `INT` |
| Current Time | `CURRENT_TIMESTAMP` | `NOW()` or `CURRENT_TIMESTAMP` |
| Auto Update | N/A | `ON UPDATE CURRENT_TIMESTAMP` |
| Date Comparison | `datetime('now')` | `NOW()` |

### Connection Pooling

MySQL uses connection pooling for better performance:
- 10 concurrent connections by default
- Automatic connection reuse
- Built-in connection keep-alive

## Testing After Migration

### 1. Verify Database Connection

```bash
# Check logs for successful connection
npm start

# Look for:
# "Connected to MySQL database."
# "Users table initialized successfully."
```

### 2. Test API Endpoints

```bash
# Health check
curl http://localhost:9000/health

# Create a test user
curl -X POST http://localhost:9000/api/users \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "Test1!@#"
  }'

# Login
curl -X POST http://localhost:9000/api/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "Test1!@#"
  }'
```

### 3. Run Test Suite

```bash
npm test
```

## Troubleshooting

### Connection Errors

**Error: "Cannot connect to MySQL server"**
```bash
# Check MySQL is running
mysql -u root -p

# Verify connection details in .env
# Check firewall settings
```

**Error: "Access denied for user"**
```bash
# Verify MySQL credentials
# Grant necessary privileges:
mysql -u root -p
GRANT ALL PRIVILEGES ON helpful_db.* TO 'your_user'@'localhost';
FLUSH PRIVILEGES;
```

### Migration Issues

**Error: "Foreign key constraint fails"**
- Ensure parent records exist before child records
- Import tables in order: users → refresh_tokens, pairings → programs → program_steps → messages

**Error: "Data too long for column"**
- Check VARCHAR lengths in schema
- Review TEXT field usage for large content

### Performance Issues

If you experience slow queries:
```sql
-- Check indexes
SHOW INDEX FROM users;
SHOW INDEX FROM programs;

-- Analyze table performance
EXPLAIN SELECT * FROM programs WHERE user_id = 'some_id';
```

## Rollback to SQLite

If you need to rollback:

1. Stop the server
2. Restore your backup:
   ```bash
   cp helpful-db.sqlite.backup helpful-db.sqlite
   ```
3. Reinstall SQLite dependency:
   ```bash
   npm install better-sqlite3
   ```
4. Restore old code from git:
   ```bash
   git checkout <previous-commit>
   ```
5. Update .env to use SQLite
6. Start the server

## Railway Deployment

For deploying to Railway with MySQL:

1. Follow the [RAILWAY_SETUP.md](./RAILWAY_SETUP.md) guide
2. Add MySQL database service in Railway
3. Set environment variables
4. Deploy your application

Railway automatically handles database provisioning and connection.

## Support

If you encounter issues during migration:

1. Check the [README.md](./README.md) for configuration details
2. Review [RAILWAY_SETUP.md](./RAILWAY_SETUP.md) for deployment help
3. Ensure all environment variables are set correctly
4. Check MySQL server logs for detailed errors

## Additional Resources

- [MySQL Documentation](https://dev.mysql.com/doc/)
- [MySQL Workbench](https://www.mysql.com/products/workbench/) - GUI tool for MySQL
- [Railway Documentation](https://docs.railway.app)
- [Node.js MySQL2 Package](https://github.com/sidorares/node-mysql2)

---

**Last Updated:** January 2024
**Compatible with:** MySQL 8.0+, Node.js 18+

