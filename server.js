const express = require('express');
const cors = require('cors');
require('dotenv').config();

// Try to require better-sqlite3, and if it fails, install it properly
let Database;
try {
  Database = require('better-sqlite3');
  console.log('better-sqlite3 loaded successfully');
} catch (error) {
  console.log('better-sqlite3 failed to load, attempting to install:', error.message);
  try {
    const { execSync } = require('child_process');
    console.log('Installing better-sqlite3 from source...');
    execSync('npm install better-sqlite3 --build-from-source', { stdio: 'inherit' });
    Database = require('better-sqlite3');
    console.log('better-sqlite3 installed and loaded successfully');
  } catch (installError) {
    console.error('Failed to install better-sqlite3:', installError.message);
    console.error('Application cannot start without database support');
    process.exit(1);
  }
}

// Import models and services
const User = require('./models/User');
const RefreshToken = require('./models/RefreshToken');
const Pairing = require('./models/Pairing');
const AuthService = require('./services/AuthService');
const PairingService = require('./services/PairingService');

// Import routes
const createUserRoutes = require('./routes/users');
const createAuthRoutes = require('./routes/auth');
const createPairingRoutes = require('./routes/pairing');

const app = express();
const PORT = process.env.PORT || 9000;

// Import security middleware
const { apiLimiter } = require('./middleware/security');

// Middleware
app.use(cors());
app.use(express.json());
app.use(apiLimiter); // Apply rate limiting to all API endpoints

// Database setup
const DATABASE_PATH = process.env.DATABASE_PATH || './helpful-db.sqlite';
let db;
try {
  db = new Database(DATABASE_PATH);
  console.log('Connected to SQLite database.');
  initializeApp();
} catch (err) {
  console.error('Error opening database:', err.message);
  process.exit(1);
}

// Initialize models and services
let userModel, refreshTokenModel, pairingModel, authService, pairingService;

async function initializeApp() {
  try {
    // Initialize models
    const userModelInstance = new User(db);
    const refreshTokenModelInstance = new RefreshToken(db);
    const pairingModelInstance = new Pairing(db);
    
    // Initialize database tables
    await userModelInstance.initDatabase();
    await refreshTokenModelInstance.initDatabase();
    await pairingModelInstance.initDatabase();
    
    // Assign to global variables after successful initialization
    userModel = userModelInstance;
    refreshTokenModel = refreshTokenModelInstance;
    pairingModel = pairingModelInstance;
    
    // Initialize services
    authService = new AuthService(userModel, refreshTokenModel);
    pairingService = new PairingService(userModel, pairingModel);
    
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
  if (userModel && authService) {
    app.use('/api/users', createUserRoutes(userModel, authService));
  }
  
  // Setup auth routes
  if (authService) {
    app.use('/api', createAuthRoutes(authService));
  }
  
  // Setup pairing routes
  if (pairingService) {
    app.use('/api/pairing', createPairingRoutes(pairingService));
  }
}

// Get all user's pairings endpoint
app.get('/api/pairings', require('./middleware/auth').authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await pairingService.getUserPairings(userId);
    res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch pairings' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Start server
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`Server running on ${HOST}:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  try {
    db.close();
    console.log('Database connection closed.');
  } catch (err) {
    console.error('Error closing database:', err.message);
  }
  process.exit(0);
}); 