# Railway Deployment Guide for Helpful API

This guide walks you through deploying the Helpful API to Railway with MySQL database.

## 🚀 Quick Start

### Prerequisites
- A [Railway](https://railway.app) account
- Your OpenAI API key
- Git repository with this code

## 📦 Deployment Steps

### 1. Create a New Project on Railway

1. Go to [railway.app](https://railway.app) and sign in
2. Click **"New Project"**
3. Select **"Deploy from GitHub repo"**
4. Choose your repository

### 2. Add MySQL Database

1. In your Railway project, click **"+ New"**
2. Select **"Database"**
3. Choose **"MySQL"**
4. Railway will automatically provision a MySQL database
5. The database connection URL will be automatically added as `MYSQL_URL` environment variable

### 3. Configure Environment Variables

Go to your service settings and add the following variables:

#### Required Variables:

```bash
# JWT Secrets (Generate strong random strings)
JWT_SECRET=your-super-secure-jwt-secret-min-32-characters
JWT_REFRESH_SECRET=your-super-secure-refresh-secret-min-32-characters

# OpenAI API Key
OPENAI_API_KEY=sk-your-actual-openai-api-key
```

#### Optional Variables (Railway sets these automatically):

```bash
# MySQL connection (automatically set by Railway when you add MySQL)
MYSQL_URL=mysql://user:password@host:port/database

# Port (Railway sets this automatically)
PORT=9000

# Host (Railway sets this automatically)
HOST=0.0.0.0
```

### 4. Generate Secure Secrets

Use these commands to generate secure secrets:

```bash
# For JWT_SECRET
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# For JWT_REFRESH_SECRET
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### 5. Deploy

1. Railway will automatically deploy your application
2. Wait for the build to complete (usually 2-3 minutes)
3. Once deployed, Railway will provide you with a public URL

### 6. Verify Deployment

Visit your deployment URL:
```
https://your-app-name.up.railway.app/health
```

You should see:
```json
{
  "status": "OK",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

## 🗄️ Database Setup

The MySQL database tables are automatically created when the application starts. No manual schema setup is needed!

The following tables will be created:
- `users` - User accounts
- `refresh_tokens` - JWT refresh tokens
- `pairings` - Partner pairings
- `programs` - Therapy programs
- `program_steps` - Individual program days/steps
- `messages` - Conversation messages

## 🔧 Local Development with MySQL

### Option 1: Local MySQL Installation

1. Install MySQL on your machine
2. Create a database:
   ```sql
   CREATE DATABASE helpful_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   ```
3. Copy `.env.example` to `.env`
4. Update the MySQL credentials in `.env`
5. Run `npm install`
6. Run `npm start`

### Option 2: Docker MySQL

```bash
# Run MySQL in Docker
docker run --name helpful-mysql \
  -e MYSQL_ROOT_PASSWORD=password \
  -e MYSQL_DATABASE=helpful_db \
  -p 3306:3306 \
  -d mysql:8.0

# Update your .env file
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=password
MYSQL_DATABASE=helpful_db
```

## 🔒 Security Best Practices

### ✅ DO:
- Use Railway's environment variables for all secrets
- Use strong, unique secrets for JWT tokens (minimum 32 characters)
- Enable Railway's automatic HTTPS
- Monitor your OpenAI usage and set billing limits
- Use Railway's built-in database encryption
- Regularly rotate your API keys
- Set up Railway's health checks

### ❌ DON'T:
- Put API keys in your code or commit them to git
- Use weak or default passwords
- Share environment variables in public channels
- Log sensitive information
- Use the same secrets for development and production

## 📊 Monitoring and Logs

### View Logs
1. Go to your Railway project
2. Click on your service
3. Click on **"Logs"** tab
4. Monitor real-time logs and errors

### Database Logs
1. Click on your MySQL service
2. View database logs and metrics
3. Monitor query performance

## 🔄 Database Migrations

This application uses a simple migration system built into the models. When you update your code:

1. Push changes to your repository
2. Railway will automatically redeploy
3. Database schema changes are applied on startup
4. No manual migration needed!

## 🆘 Troubleshooting

### Application Won't Start

**Check Database Connection:**
```
Error: Error connecting to database
```
- Verify MySQL service is running in Railway
- Check that `MYSQL_URL` is set correctly
- Ensure database service is in the same project

**Check Environment Variables:**
- Ensure all required variables are set
- JWT_SECRET and JWT_REFRESH_SECRET must be set
- OPENAI_API_KEY must be valid

### Database Connection Issues

If you see "Too many connections":
1. Go to MySQL service settings
2. Increase max_connections if needed
3. Check for connection leaks in application logs

### Performance Issues

1. **Check Database Performance:**
   - Review slow query logs
   - Add indexes if needed
   - Consider upgrading database plan

2. **Check Application Logs:**
   - Look for memory leaks
   - Monitor response times
   - Check OpenAI API latency

## 🔄 CI/CD with Railway

Railway automatically deploys when you push to your main branch:

1. Push code to GitHub
2. Railway detects changes
3. Builds application
4. Runs tests (if configured)
5. Deploys to production

### Custom Build Command

Edit `railway.json` to customize:
```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

## 💰 Cost Optimization

### Database Optimization
- Use appropriate indexes
- Clean up expired refresh tokens regularly
- Archive old data if needed

### Application Optimization
- Use connection pooling (already configured)
- Implement caching for frequently accessed data
- Monitor and optimize slow queries

### Railway Credits
- Starter plan includes $5/month
- Monitor usage in Railway dashboard
- Set up billing alerts

## 🔐 API Key Rotation

### If OpenAI API Key is Compromised:
1. **Immediately** revoke the key in OpenAI dashboard
2. Generate a new API key
3. Update `OPENAI_API_KEY` in Railway
4. Application automatically uses new key (no restart needed)
5. Monitor for unauthorized usage

### Rotating JWT Secrets:
⚠️ **Warning:** This will invalidate all existing user sessions

1. Generate new secrets
2. Update `JWT_SECRET` and `JWT_REFRESH_SECRET` in Railway
3. Railway will automatically restart the application
4. All users will need to log in again

## 📚 Additional Resources

- [Railway Documentation](https://docs.railway.app)
- [MySQL Documentation](https://dev.mysql.com/doc/)
- [Express.js Best Practices](https://expressjs.com/en/advanced/best-practice-performance.html)
- [Node.js Security Checklist](https://blog.risingstack.com/node-js-security-checklist/)

## 🆘 Support

If you encounter issues:
1. Check Railway logs for errors
2. Review this documentation
3. Check Railway's status page
4. Contact Railway support if needed

---

**Last Updated:** January 2024
**Compatible with:** Railway v2, MySQL 8.0+, Node.js 18+
