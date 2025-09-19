const rateLimit = require('express-rate-limit');

// Rate limiting for login attempts
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many login attempts, please try again later',
    retryAfter: '15 minutes'
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  // Skip successful requests
  skipSuccessfulRequests: true // Default key generator handles IPv6 properly
});

// Strict rate limiting for repeated failed attempts from same IP
const strictLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // 50 failed attempts per 15 minutes per IP
  message: {
    error: 'Too many failed login attempts. Account temporarily locked.',
    retryAfter: '15 minutes'
  },
  skipSuccessfulRequests: true
});

// General API rate limiting (consistent across all environments)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // 1000 requests per 15 minutes for all environments
  message: {
    error: 'Too many requests, please try again later'
  },
  // Add rate limit headers for debugging
  standardHeaders: true,
  legacyHeaders: false
});

// Account lockout tracking (in-memory store - use Redis in production)
const failedAttempts = new Map();
const lockedAccounts = new Map();

const LOCKOUT_THRESHOLD = 5; // Lock after 5 failed attempts
const LOCKOUT_DURATION = 5 * 60 * 1000; // 5 minutes
const ATTEMPT_WINDOW = 15 * 60 * 1000; // 15 minutes

function isAccountLocked(email) {
  const lockInfo = lockedAccounts.get(email);
  if (!lockInfo) return false;
  
  if (Date.now() > lockInfo.unlockTime) {
    // Lock has expired
    lockedAccounts.delete(email);
    failedAttempts.delete(email);
    return false;
  }
  
  return true;
}

function recordFailedAttempt(email) {
  const now = Date.now();
  const attempts = failedAttempts.get(email) || [];
  
  // Remove attempts older than the window
  const recentAttempts = attempts.filter(timestamp => now - timestamp < ATTEMPT_WINDOW);
  recentAttempts.push(now);
  
  failedAttempts.set(email, recentAttempts);
  
  // Check if we should lock the account
  if (recentAttempts.length >= LOCKOUT_THRESHOLD) {
    const unlockTime = now + LOCKOUT_DURATION;
    lockedAccounts.set(email, { unlockTime, attempts: recentAttempts.length });
    
    // Log security event
    console.warn(`SECURITY ALERT: Account ${email} locked due to ${recentAttempts.length} failed login attempts`);
    
    return true; // Account is now locked
  }
  
  return false; // Account not locked yet
}

function clearFailedAttempts(email) {
  failedAttempts.delete(email);
  lockedAccounts.delete(email);
}

function getAccountLockInfo(email) {
  const lockInfo = lockedAccounts.get(email);
  if (!lockInfo) return null;
  
  const remainingTime = Math.max(0, lockInfo.unlockTime - Date.now());
  return {
    isLocked: remainingTime > 0,
    unlockTime: lockInfo.unlockTime,
    remainingTime: remainingTime,
    attemptCount: lockInfo.attempts
  };
}

// Security monitoring middleware
function securityLogger(req, res, next) {
  const originalSend = res.send;
  
  res.send = function(data) {
    // Log failed login attempts
    if (req.path === '/login' && req.method === 'POST' && res.statusCode === 401) {
      const { email } = req.body;
      console.warn(`Failed login attempt for ${email} from IP ${req.ip}`);
    }
    
    originalSend.call(this, data);
  };
  
  next();
}

module.exports = {
  loginLimiter,
  strictLoginLimiter,
  apiLimiter,
  isAccountLocked,
  recordFailedAttempt,
  clearFailedAttempts,
  getAccountLockInfo,
  securityLogger
};