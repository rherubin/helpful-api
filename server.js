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
const AuthService = require('./services/AuthService');
const PairingService = require('./services/PairingService');
const ChatGPTService = require('./services/ChatGPTService');

// Import routes
const createUserRoutes = require('./routes/users');
const createAuthRoutes = require('./routes/auth');
const createPairingRoutes = require('./routes/pairing');
const createProgramRoutes = require('./routes/programs');
const createProgramStepRoutes = require('./routes/programSteps');

const app = express();
const PORT = process.env.PORT || 9000;

// Import security middleware
const { apiLimiter } = require('./middleware/security');

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
let userModel, refreshTokenModel, pairingModel, programModel, programStepModel, messageModel, authService, pairingService, chatGPTService;

async function initializeApp() {
  try {
    // Initialize models
    const userModelInstance = new User(db);
    const refreshTokenModelInstance = new RefreshToken(db);
    const pairingModelInstance = new Pairing(db);
    const programModelInstance = new Program(db);
    const programStepModelInstance = new ProgramStep(db);
    const messageModelInstance = new Message(db);
    
    // Initialize database tables
    await userModelInstance.initDatabase();
    await refreshTokenModelInstance.initDatabase();
    await pairingModelInstance.initDatabase();
    await programModelInstance.initDatabase();
    await programStepModelInstance.initDatabase();
    await messageModelInstance.initDatabase();
    
    // Assign to global variables after successful initialization
    userModel = userModelInstance;
    refreshTokenModel = refreshTokenModelInstance;
    pairingModel = pairingModelInstance;
    programModel = programModelInstance;
    programStepModel = programStepModelInstance;
    messageModel = messageModelInstance;
    
    // Validate JWT secrets in production
    if (process.env.NODE_ENV === 'production') {
      const jwtSecret = process.env.JWT_SECRET;
      const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET;

      if (!jwtSecret || jwtSecret === 'your-secret-key-change-in-production') {
        console.error('SECURITY ERROR: JWT_SECRET must be set to a secure value in production');
        throw new Error('JWT_SECRET not properly configured for production');
      }

      if (!jwtRefreshSecret || jwtRefreshSecret === 'your-refresh-secret-key-change-in-production') {
        console.error('SECURITY ERROR: JWT_REFRESH_SECRET must be set to a secure value in production');
        throw new Error('JWT_REFRESH_SECRET not properly configured for production');
      }

      console.log('✅ JWT secrets validated for production environment');
    }

    // Initialize services
    authService = new AuthService(userModel, refreshTokenModel);
    pairingService = new PairingService(userModel, pairingModel);
    chatGPTService = new ChatGPTService();
    
    // Setup routes
    setupRoutes();
    
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
    app.use('/api/users', createUserRoutes(userModel, authService, pairingService));
  }

  // Setup auth routes
  if (authService && userModel && pairingService) {
    app.use('/api', createAuthRoutes(authService, userModel, pairingService));
  }

  // Setup pairing routes
  if (pairingService && authService) {
    app.use('/api/pairing', createPairingRoutes(pairingService, authService));
  }

  // Setup program routes
  if (programModel && chatGPTService && authService) {
    app.use('/api/programs', createProgramRoutes(programModel, chatGPTService, programStepModel, userModel, pairingModel, authService));
  }

  // Setup conversation routes
  if (programStepModel && messageModel && programModel && pairingModel && userModel && chatGPTService && authService) {
    app.use('/api', createProgramStepRoutes(programStepModel, messageModel, programModel, pairingModel, userModel, chatGPTService, authService));
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

// Health check endpoints
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Alternative health check for Railway
app.get('/', (req, res) => {
  res.json({ status: 'OK', message: 'Helpful API is running', timestamp: new Date().toISOString() });
});

// Start server
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`Server running on ${HOST}:${PORT}`);
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