'use strict';

// Placeholder values historically shipped in .env.example and used as
// code fallbacks. They are public and must never be used to sign tokens
// in a deployed environment.
const INSECURE_JWT_DEFAULTS = new Set([
  'your-secret-key-change-in-production',
  'your-refresh-secret-key-change-in-production',
]);

function railwayEnvironmentName() {
  return String(
    process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_ENVIRONMENT || ''
  ).trim().toLowerCase();
}

// Railway sets NODE_ENV=production on every deploy, including develop.
// When a Railway environment name is present, it is authoritative so
// TEST_MOCK_* can still be used on develop/staging. With no Railway
// name, NODE_ENV=production means a real production process.
function isProductionEnv() {
  const railway = railwayEnvironmentName();
  if (railway) return railway === 'production';
  return process.env.NODE_ENV === 'production';
}

function isRailwayEnv() {
  return railwayEnvironmentName().length > 0
    || String(process.env.RAILWAY_PROJECT_ID || '').trim().length > 0
    || String(process.env.RAILWAY_ENVIRONMENT_ID || '').trim().length > 0;
}

function isTestEnv() {
  return process.env.NODE_ENV === 'test' || process.env.TEST_MODE === 'true';
}

function isInsecureSecret(value) {
  const v = String(value || '').trim();
  return v.length === 0 || INSECURE_JWT_DEFAULTS.has(v);
}

function jwtSecretsAreInsecure() {
  return isInsecureSecret(process.env.JWT_SECRET)
    || isInsecureSecret(process.env.JWT_REFRESH_SECRET);
}

// Require real secrets in production, on Railway, and in any other
// non-local, non-test environment. Local `npm run dev` (no Railway, not
// NODE_ENV=production) still starts with a warning so existing setups work.
function mustRequireSecureJwtSecrets() {
  if (isTestEnv()) return false;
  if (isProductionEnv()) return true;
  if (isRailwayEnv()) return true;
  return false;
}

function assertJwtSecretsForCurrentEnv() {
  if (!jwtSecretsAreInsecure()) return;

  const message = 'JWT_SECRET and JWT_REFRESH_SECRET must be set to non-default values. '
    + 'The placeholders your-secret-key-change-in-production / '
    + 'your-refresh-secret-key-change-in-production are not allowed.';

  if (mustRequireSecureJwtSecrets()) {
    console.error(`❌ CRITICAL ERROR: ${message}`);
    process.exit(1);
  }

  console.warn(
    `⚠️  ${message} Allowed only for local development. `
    + 'The process will refuse to start in production or on Railway.'
  );
}

// TEST_MOCK_* flags are ignored in the production deploy environment
// (Railway production, or NODE_ENV=production when no Railway name is set),
// even if the variable is still set on the service.
function isMockFlagEnabled(flagName) {
  if (isProductionEnv()) return false;
  return process.env[flagName] === 'true';
}

module.exports = {
  INSECURE_JWT_DEFAULTS,
  isProductionEnv,
  isRailwayEnv,
  isTestEnv,
  isInsecureSecret,
  jwtSecretsAreInsecure,
  mustRequireSecureJwtSecrets,
  assertJwtSecretsForCurrentEnv,
  isMockFlagEnabled,
};
