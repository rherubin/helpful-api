const mysql = require('mysql2/promise');

// Database connection configuration
const dbConfig = {
  host: process.env.MYSQL_HOST || 'localhost',
  port: process.env.MYSQL_PORT || 3306,
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'helpful_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  // Railway MySQL URLs come in format: mysql://user:password@host:port/database
  // If MYSQL_URL is provided, it will be parsed and used instead
};

// Create connection pool
let pool = null;

function createPool() {
  // If MYSQL_URL is provided (Railway format), parse it
  if (process.env.MYSQL_URL) {
    try {
      const url = new URL(process.env.MYSQL_URL);
      pool = mysql.createPool({
        host: url.hostname,
        port: url.port || 3306,
        user: url.username,
        password: url.password,
        database: url.pathname.slice(1), // Remove leading slash
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        enableKeepAlive: true,
        keepAliveInitialDelay: 0,
      });
      console.log('MySQL connection pool created from MYSQL_URL');
    } catch (error) {
      console.error('Error parsing MYSQL_URL:', error.message);
      throw error;
    }
  } else {
    pool = mysql.createPool(dbConfig);
    console.log('MySQL connection pool created from individual config');
  }
  
  return pool;
}

function getPool() {
  if (!pool) {
    pool = createPool();
  }
  return pool;
}

async function testConnection() {
  try {
    const connection = await getPool().getConnection();
    console.log('Successfully connected to MySQL database');
    connection.release();
    return true;
  } catch (error) {
    console.error('Error connecting to MySQL database:', error.message);
    throw error;
  }
}

async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('MySQL connection pool closed');
  }
}

module.exports = {
  getPool,
  testConnection,
  closePool,
  createPool
};

