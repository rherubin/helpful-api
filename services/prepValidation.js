const PromptSession = require('../models/PromptSession');

// Cap matches BasePromptService.sanitizePromptInput so a stored prep field
// cannot overflow the generation prompt budget for a single answer.
const PREP_FIELD_MAX_LENGTH = 2000;

// Hidden / control characters that can smuggle role markers past naive filters.
const CONTROL_OR_ZERO_WIDTH =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200D\uFEFF]/;

// Prompt-injection / jailbreak markers. Keep these tighter than a bare
// "override" or "system:" match so legitimate therapy answers like
// "override the urge to shut down" or "my nervous system is fried" still pass.
const UNSAFE_PREP_PATTERNS = [
  /prompt\s*injection/i,
  /jailbreak/i,
  /ignore\s+(?:all\s+)?(?:previous\s+|prior\s+)?instructions/i,
  /disregard\s+(?:all\s+)?(?:previous|prior|above)\s+(?:instructions|prompts?)/i,
  /forget\s+(?:all\s+)?(?:everything|your\s+(?:instructions|prompt|rules))/i,
  /system\s*override/i,
  /developer\s*mode/i,
  /unrestricted\s*mode/i,
  /god\s*mode/i,
  /admin\s*access/i,
  /root\s*access/i,
  /override\s+(?:previous\s+)?(?:your\s+)?instructions/i,
  /new\s+instructions\s*:/i,
  /you\s+are\s+now\s+(?:dan\b|jailbroken|an?\s+(?:unrestricted|jailbroken|ai|assistant)\b)/i,
  /act\s+as\s+(?:dan|a\s+jailbroken|an?\s+unrestricted)/i,
  /(?:^|[\n\r])\s*(system|assistant|human|user|ai|developer)\s*:/i,
  /\[INST\]/i,
  /\[\/INST\]/i,
  /<\|.*?\|>/,
  /<(?:\/)?(?:system|assistant|instruction)[\s>]/i,
  /```/
];

function unsafePatternMatch(text) {
  for (const pattern of UNSAFE_PREP_PATTERNS) {
    if (pattern.test(text)) {
      return pattern.source;
    }
  }
  return null;
}

function validatePrepField(field, rawValue) {
  if (rawValue === null || rawValue === undefined) {
    return { ok: true, field, value: null };
  }

  let value = rawValue;
  if (typeof value === 'number' && Number.isFinite(value)) {
    value = String(value);
  }
  if (typeof value !== 'string') {
    return {
      ok: false,
      field,
      code: 'PREP_INVALID_TYPE',
      error: `Prep field "${field}" must be a string`
    };
  }

  if (CONTROL_OR_ZERO_WIDTH.test(value)) {
    return {
      ok: false,
      field,
      code: 'PREP_UNSAFE_INPUT',
      error: `Prep field "${field}" contains disallowed control characters`
    };
  }

  const trimmed = value.trim();
  if (trimmed.length > PREP_FIELD_MAX_LENGTH) {
    return {
      ok: false,
      field,
      code: 'PREP_TOO_LONG',
      error: `Prep field "${field}" must be at most ${PREP_FIELD_MAX_LENGTH} characters`
    };
  }

  const matched = unsafePatternMatch(trimmed);
  if (matched) {
    console.warn(`SECURITY: Suspicious pattern in Sit Session prep field ${field}: ${matched}`);
    return {
      ok: false,
      field,
      code: 'PREP_UNSAFE_INPUT',
      error: `Prep field "${field}" contains potentially unsafe content`
    };
  }

  return { ok: true, field, value: trimmed };
}

// Validate the POST /prep body. Unknown keys are ignored (same as the route's
// field allowlist). On success, `answers` contains only recognized, trimmed fields.
function validatePrepAnswers(rawBody) {
  if (rawBody == null || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
    return {
      ok: false,
      code: 'PREP_INVALID_BODY',
      error: 'Prep body must be a JSON object'
    };
  }

  const answers = {};
  for (const field of PromptSession.PREP_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(rawBody, field)) continue;
    const result = validatePrepField(field, rawBody[field]);
    if (!result.ok) return result;
    answers[field] = result.value;
  }

  return { ok: true, answers };
}

module.exports = {
  PREP_FIELD_MAX_LENGTH,
  UNSAFE_PREP_PATTERNS,
  validatePrepField,
  validatePrepAnswers
};
