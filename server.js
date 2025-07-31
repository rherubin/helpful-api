const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
require('dotenv').config();

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

// Middleware
app.use(cors());
app.use(express.json());

// Database setup
const DATABASE_PATH = process.env.DATABASE_PATH || './database.sqlite';
const db = new sqlite3.Database(DATABASE_PATH, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database.');
    initializeApp();
  }
});

// Initialize models and services
let userModel, refreshTokenModel, pairingModel, authService, pairingService;

async function initializeApp() {
  try {
    // Initialize models
    userModel = new User(db);
    refreshTokenModel = new RefreshToken(db);
    pairingModel = new Pairing(db);
    
    // Initialize database tables
    await userModel.initDatabase();
    await refreshTokenModel.initDatabase();
    await pairingModel.initDatabase();
    
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
  app.locals.pairingModel = pairingModel;
  
  // Setup user routes
  app.use('/api/users', createUserRoutes(userModel, authService));
  
  // Setup auth routes
  app.use('/api', createAuthRoutes(authService));
  
  // Setup pairing routes
  app.use('/api/pairing', createPairingRoutes(pairingService));
}

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
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err.message);
    } else {
      console.log('Database connection closed.');
    }
    process.exit(0);
  });
}); 