const mysql = require('mysql2/promise');

// Refuse the mysql_clear_password auth-switch even if a server (or MITM)
// requests it. mysql2 3.22+ also guards this, but an explicit rejection is
// a defense in depth if TLS verification is still off (see ssl options).
function mysqlAuthPlugins() {
  return {
    mysql_clear_password() {
      return () => {
        throw new Error('mysql_clear_password authentication is disabled');
      };
    }
  };
}

// MYSQL_SSL_REJECT_UNAUTHORIZED defaults to false so existing Railway MySQL
// connections keep working if the server cert is not verifiable with public
// CAs. Set it to true once the cert chain is trusted (recommended).
function sslRejectUnauthorized() {
  const raw = String(process.env.MYSQL_SSL_REJECT_UNAUTHORIZED || '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return false;
}

function mysqlSslOptions(enabled) {
  if (!enabled) return false;
  return { rejectUnauthorized: sslRejectUnauthorized() };
}

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
  // Local / individual-var setups typically talk to MySQL without TLS.
  // Enable TLS with MYSQL_SSL=true and optionally MYSQL_SSL_REJECT_UNAUTHORIZED=true.
  ssl: mysqlSslOptions(String(process.env.MYSQL_SSL || '').trim().toLowerCase() === 'true'),
  authPlugins: mysqlAuthPlugins(),
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
        // Railway MySQL often requires TLS but may present a cert that does
        // not verify against public CAs. Default rejectUnauthorized is false
        // (same as before). Set MYSQL_SSL_REJECT_UNAUTHORIZED=true to verify.
        ssl: mysqlSslOptions(true),
        authPlugins: mysqlAuthPlugins(),
      });
      const verify = sslRejectUnauthorized();
      console.log(
        'MySQL connection pool created from MYSQL_URL '
        + `(ssl rejectUnauthorized=${verify})`
      );
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
  createPool,
  sslRejectUnauthorized,
  mysqlAuthPlugins,
};

