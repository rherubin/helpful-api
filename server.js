const express = require('express');
const cors = require('cors');
require('dotenv').config();

// Import MySQL database configuration
const { getPool, testConnection, closePool } = require('./config/database');

// Import models and services
const User = require('./models/User');
const RefreshToken = require('./models/RefreshToken');
const Pairing = require('./models/Pairing');
const Program = require('./models/Program');
const ProgramStep = require('./models/ProgramStep');
const Message = require('./models/Message');
const IosSubscription = require('./models/IosSubscription');
const AndroidSubscription = require('./models/AndroidSubscription');
const OrgCode = require('./models/OrgCode');
const AdminUser = require('./models/AdminUser');
const AuthService = require('./services/AuthService');
const PairingService = require('./services/PairingService');
const HopefulPromptService = require('./services/HopefulPromptService');
const HelpfulPromptService = require('./services/HelpfulPromptService');
const { SubscriptionService } = require('./services/SubscriptionService');
const AdminAuthService = require('./services/AdminAuthService');

// Import routes
const createUserRoutes = require('./routes/users');
const createAuthRoutes = require('./routes/auth');
const createPairingRoutes = require('./routes/pairing');
const { createProgramRoutes, startRegenerationPoller } = require('./routes/programs');
const createProgramStepRoutes = require('./routes/programSteps');
const createSubscriptionRoutes = require('./routes/subscription');
const createOrgCodeRoutes = require('./routes/org-codes');
const createAdminAuthRoutes = require('./routes/admin-auth');

const app = express();

// Railway CRITICAL: Must use Railway's PORT environment variable
const PORT = process.env.PORT;
if (!PORT) {
  console.error('❌ CRITICAL ERROR: PORT environment variable not set by Railway!');
  console.error('   Railway requires the app to bind to the PORT it provides');
  console.error('   This is why the container is being stopped!');
  process.exit(1);
}

const HOST = process.env.HOST || '0.0.0.0';

console.log(`✅ Railway PORT detected: ${PORT}`);
console.log(`✅ HOST will be: ${HOST} (from env: ${process.env.HOST || 'default 0.0.0.0'})`);
console.log(`✅ Will bind to: ${HOST}:${PORT}`);

// Railway-specific: Ensure PORT is always used if provided
if (!process.env.PORT) {
  console.log('⚠️  WARNING: PORT environment variable not set by Railway');
  console.log('   Using default port 9000 - this may cause issues');
} else {
  console.log(`✅ Railway PORT detected: ${process.env.PORT}`);
}

// Import security middleware
const { apiLimiter } = require('./middleware/security');

// Health check endpoints (available immediately, before database initialization)
// Railway typically expects plain text responses for health checks
app.get('/health', (req, res) => {
  res.set('Content-Type', 'text/plain');
  res.status(200).send('OK');
});

// Root endpoint for Railway health checks
app.get('/', (req, res) => {
  res.set('Content-Type', 'text/plain');
  res.status(200).send('Helpful API is running');
});

// Security headers middleware
function securityHeaders(req, res, next) {
  // Prevent MIME type sniffing attacks
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Prevent clickjacking attacks
  res.setHeader('X-Frame-Options', 'DENY');

  // Enable XSS protection
  res.setHeader('X-XSS-Protection', '1; mode=block');

  // Control referrer information leakage
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Restrict access to sensitive browser features
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

  // Enforce HTTPS in production (only set if connection is secure)
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }

  next();
}

// Middleware
app.use(cors());
app.use(securityHeaders); // Apply security headers to all responses
app.use(express.json());
app.use(apiLimiter); // Apply rate limiting to all API endpoints

// Database setup
let db;
async function setupDatabase() {
  try {
    await testConnection();
    db = getPool();
    console.log('Connected to MySQL database.');
    await initializeApp();
  } catch (err) {
    console.error('Error connecting to database:', err.message);
    console.error('Please ensure MySQL is running and credentials are correct.');
    process.exit(1);
  }
}

// Start database setup
setupDatabase();

// Initialize models and services
let userModel, refreshTokenModel, pairingModel, programModel, programStepModel, messageModel, iosSubscriptionModel, androidSubscriptionModel, orgCodeModel, adminUserModel, authService, pairingService, hopefulPromptService, helpfulPromptService, subscriptionService, adminAuthService;

async function initializeApp() {
  try {
    // Initialize models
    const userModelInstance = new User(db);
    const refreshTokenModelInstance = new RefreshToken(db);
    const pairingModelInstance = new Pairing(db);
    const programModelInstance = new Program(db);
    const programStepModelInstance = new ProgramStep(db);
    const messageModelInstance = new Message(db);
    const iosSubscriptionModelInstance = new IosSubscription(db);
    const androidSubscriptionModelInstance = new AndroidSubscription(db);
    const orgCodeModelInstance = new OrgCode(db);
    const adminUserModelInstance = new AdminUser(db);
    
    // Initialize database tables
    await userModelInstance.initDatabase();
    await refreshTokenModelInstance.initDatabase();
    await pairingModelInstance.initDatabase();
    await programModelInstance.initDatabase();
    await programStepModelInstance.initDatabase();
    await messageModelInstance.initDatabase();
    await iosSubscriptionModelInstance.initDatabase();
    await androidSubscriptionModelInstance.initDatabase();
    await orgCodeModelInstance.initDatabase();
    await adminUserModelInstance.initDatabase();
    
    // Assign to global variables after successful initialization
    userModel = userModelInstance;
    refreshTokenModel = refreshTokenModelInstance;
    pairingModel = pairingModelInstance;
    programModel = programModelInstance;
    programStepModel = programStepModelInstance;
    messageModel = messageModelInstance;
    iosSubscriptionModel = iosSubscriptionModelInstance;
    androidSubscriptionModel = androidSubscriptionModelInstance;
    orgCodeModel = orgCodeModelInstance;
    adminUserModel = adminUserModelInstance;

    // Initialize services
    authService = new AuthService(userModel, refreshTokenModel, pairingModel);
    pairingService = new PairingService(userModel, pairingModel);
    // Two concrete prompt services are instantiated. Routes select between
    // them per-request based on whether the user has an org_code / custom org
    // fields (Hopeful = faith-based, Helpful = secular couples EFT/Gottman).
    hopefulPromptService = new HopefulPromptService();
    helpfulPromptService = new HelpfulPromptService();
    adminAuthService = new AdminAuthService(adminUserModel, refreshTokenModel);
    subscriptionService = new SubscriptionService(
      iosSubscriptionModel,
      androidSubscriptionModel,
      userModel,
      pairingModel
    );
    
    // Setup routes
    setupRoutes();

    // Start background poller for programs flagged for therapy response regeneration.
    // The poller itself picks Hopeful vs Helpful per-user based on org_code presence.
    if ((hopefulPromptService && hopefulPromptService.isConfigured()) ||
        (helpfulPromptService && helpfulPromptService.isConfigured())) {
      startRegenerationPoller(programModel, programStepModel, hopefulPromptService, helpfulPromptService, userModel, pairingModel, userModel);
    }
    
    console.log('Application initialized successfully.');
  } catch (error) {
    console.error('Error initializing application:', error);
    process.exit(1); // Exit if initialization fails
  }
}

function setupRoutes() {
  // Make models available to routes for soft delete cascading
  if (pairingModel) {
    app.locals.pairingModel = pairingModel;
  }
  
  // Setup user routes
  if (userModel && authService && pairingService) {
    app.use('/api/users', createUserRoutes(userModel, authService, pairingService, orgCodeModel));
  }

  // Setup auth routes
  if (authService && userModel && pairingService) {
    app.use('/api', createAuthRoutes(authService, userModel, pairingService, orgCodeModel));
  }

  // Setup pairing routes
  if (pairingService && authService) {
    app.use('/api/pairing', createPairingRoutes(pairingService, authService));
  }

  // Setup program routes
  if (programModel && hopefulPromptService && helpfulPromptService && authService) {
    app.use('/api/programs', createProgramRoutes(programModel, hopefulPromptService, helpfulPromptService, programStepModel, userModel, pairingModel, authService, userModel));
  }

  // Setup conversation routes
  if (programStepModel && messageModel && programModel && pairingModel && userModel && hopefulPromptService && helpfulPromptService && authService) {
    app.use('/api', createProgramStepRoutes(programStepModel, messageModel, programModel, pairingModel, userModel, hopefulPromptService, helpfulPromptService, authService, userModel));
  }

  // Setup subscription routes
  if (subscriptionService && authService) {
    app.use('/api/subscription', createSubscriptionRoutes(subscriptionService, authService));
  }

  // Setup admin auth routes
  if (adminAuthService && adminUserModel) {
    app.use('/api/admin/auth', createAdminAuthRoutes(adminAuthService, adminUserModel));
  }

  // Setup org code routes (admin only)
  if (orgCodeModel && userModel && authService && adminAuthService) {
    app.use('/api/org-codes', createOrgCodeRoutes(orgCodeModel, userModel, authService, adminAuthService));
  }

  // Setup message stats endpoint
  if (messageModel && authService) {
    const { createAuthenticateToken } = require('./middleware/auth');
    const authenticateToken = createAuthenticateToken(authService);
    
    app.get('/api/messages-stats', authenticateToken, async (req, res) => {
      try {
        const { date, programId } = req.query;

        // Validate required parameters
        if (!date || !programId) {
          return res.status(400).json({ error: 'date and programId query parameters are required' });
        }

        const epochTimestamp = parseInt(date, 10);
        if (isNaN(epochTimestamp)) {
          return res.status(400).json({ error: 'date must be a valid epoch integer' });
        }

        const stats = await messageModel.getMessageStatsSinceDate(epochTimestamp, programId);
        res.status(200).json(stats);
      } catch (error) {
        console.error('Error fetching message stats:', error.message);
        return res.status(500).json({ error: 'Failed to fetch message stats' });
      }
    });
  }
}

// Get all user's pairings endpoint
const { createAuthenticateToken } = require('./middleware/auth');
const authenticateToken = createAuthenticateToken(authService);
app.get('/api/pairings', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await pairingService.getUserPairings(userId);
    res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch pairings' });
  }
});

// Log environment info for debugging
console.log('Environment check:');
console.log(`- PORT: ${PORT} (from env: ${process.env.PORT})`);
console.log(`- HOST: ${HOST} (from env: ${process.env.HOST})`);

// Start server
const server = app.listen(PORT, HOST, () => {
  console.log(`✅ Server successfully started and listening on ${HOST}:${PORT}`);
  console.log(`✅ Health check available at: http://${HOST}:${PORT}/health`);

  // Keep-alive ping every 5 seconds to show server is still running
  setInterval(() => {
    console.log(`🔄 Server still running at ${new Date().toISOString()}`);
  }, 5000);
});

// Handle server startup errors
server.on('error', (error) => {
  console.error('Server failed to start:', error);
  process.exit(1);
});

// Handle uncaught exceptions to prevent silent exits
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  try {
    await closePool();
    console.log('Database connection pool closed.');
  } catch (err) {
    console.error('Error closing database pool:', err.message);
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  try {
    await closePool();
    console.log('Database connection pool closed.');
  } catch (err) {
    console.error('Error closing database pool:', err.message);
  }
  process.exit(0);
}); 