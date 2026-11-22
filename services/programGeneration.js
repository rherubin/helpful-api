'use strict';

/**
 * Shared program-generation helpers used by routes/programs.js.
 * The follow-up delay is read at call time so tests can set
 * PROGRAM_GENERATION_FOLLOWUP_DELAY_MS without changing production's
 * 60-second default.
 */

function getGenerationFollowUpDelayMs() {
  const raw = process.env.PROGRAM_GENERATION_FOLLOWUP_DELAY_MS;
  if (raw === undefined || raw === '') return 60000;
  const n = Number(raw);
  // Zero and other non-positive values fall back to the 60s production default.
  // Any positive value (including the coverage runner's 50) still overrides.
  return Number.isFinite(n) && n > 0 ? n : 60000;
}

function isGenerationFollowUpEnabled() {
  return process.env.PROGRAM_GENERATION_FOLLOWUP_ENABLED !== 'false';
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function hasProgramSteps(programStepModel, programId) {
  if (!programStepModel) return false;
  const steps = await programStepModel.getProgramSteps(programId);
  return Array.isArray(steps) && steps.length > 0;
}

// True only when the program has a full validated day set (7 or 14 unique
// contiguous days). "Any rows exist" is not enough: a mid-insert failure can
// leave a partial set, and treating that as success skips follow-up forever.
async function hasCompleteProgramSteps(programStepModel, programId) {
  if (!programStepModel) return false;
  const steps = await programStepModel.getProgramSteps(programId);
  if (!Array.isArray(steps) || steps.length === 0) return false;
  const days = new Set(steps.map((s) => Number(s.day)));
  const n = days.size;
  if (n !== 7 && n !== 14) return false;
  for (let d = 1; d <= n; d++) {
    if (!days.has(d)) return false;
  }
  return true;
}

async function generateAndPersistProgramContent({
  programModel,
  programStepModel,
  programId,
  generateResponse,
  successLogPrefix,
  forceRegenerate = false
}) {
  if (!forceRegenerate && await hasCompleteProgramSteps(programStepModel, programId)) {
    console.log(`${successLogPrefix} Program steps already exist, skipping generation for:`, programId);
    return;
  }

  if (programStepModel && await hasProgramSteps(programStepModel, programId)
      && !(await hasCompleteProgramSteps(programStepModel, programId))) {
    console.log(`${successLogPrefix} Clearing incomplete steps for program:`, programId);
    await programStepModel.deleteProgramSteps(programId);
  }

  const generationStart = Date.now();
  const therapyResponse = await generateResponse();
  const secondsToLoad = parseFloat(((Date.now() - generationStart) / 1000).toFixed(4));
  const therapyResponseString = typeof therapyResponse === 'object'
    ? JSON.stringify(therapyResponse)
    : therapyResponse;

  const generationPrompt = (therapyResponse && typeof therapyResponse === 'object')
    ? (therapyResponse.__prompt || null)
    : null;

  await programModel.updateTherapyResponse(programId, therapyResponseString, secondsToLoad, generationPrompt);

  if (programStepModel) {
    if (forceRegenerate) {
      console.log(`${successLogPrefix} Force-regenerating: replacing steps for program:`, programId);
      await programStepModel.replaceProgramSteps(programId, therapyResponseString);
    } else if (!(await hasCompleteProgramSteps(programStepModel, programId))) {
      await programStepModel.createProgramSteps(programId, therapyResponseString);
    }
    if (!(await hasCompleteProgramSteps(programStepModel, programId))) {
      throw new Error('Program step persist incomplete: expected 7 or 14 contiguous days');
    }
    console.log(`${successLogPrefix} Program steps created for program:`, programId);
  }

  console.log(`${successLogPrefix} ChatGPT response generated and saved for program:`, programId);
}

async function runGenerationWithFollowUp({
  programModel,
  programStepModel,
  programId,
  generateResponse,
  logPrefix,
  forceRegenerate = false,
  delayMs,
  followUpEnabled
}) {
  const attemptLogs = [];
  let lastAttemptPrompt = null;
  const enabled = followUpEnabled ?? isGenerationFollowUpEnabled();
  const delay = delayMs ?? getGenerationFollowUpDelayMs();

  try {
    await generateAndPersistProgramContent({
      programModel,
      programStepModel,
      programId,
      generateResponse,
      successLogPrefix: logPrefix,
      forceRegenerate
    });
    return { status: 'succeeded', attempts: 1 };
  } catch (firstError) {
    attemptLogs.push(`attempt_1: ${firstError.message}`);
    if (firstError && firstError.__prompt) {
      lastAttemptPrompt = firstError.__prompt;
    }
    console.error(`${logPrefix} Initial generation attempt failed for program ${programId}:`, firstError.message);
  }

  if (enabled) {
    try {
      console.log(`${logPrefix} Scheduling follow-up generation attempt in ${delay}ms for program:`, programId);
      await sleep(delay);

      if (!forceRegenerate && await hasCompleteProgramSteps(programStepModel, programId)) {
        console.log(`${logPrefix} Follow-up skipped; program already has complete steps:`, programId);
        return { status: 'succeeded', attempts: 1, followedUp: false };
      }

      await generateAndPersistProgramContent({
        programModel,
        programStepModel,
        programId,
        generateResponse,
        successLogPrefix: `${logPrefix} [follow-up]`,
        forceRegenerate
      });
      return { status: 'succeeded', attempts: 2, followedUp: true };
    } catch (followUpError) {
      attemptLogs.push(`attempt_2: ${followUpError.message}`);
      if (followUpError && followUpError.__prompt) {
        lastAttemptPrompt = followUpError.__prompt;
      }
      console.error(`${logPrefix} Follow-up generation attempt failed for program ${programId}:`, followUpError.message);
    }
  }

  if (!forceRegenerate && await hasCompleteProgramSteps(programStepModel, programId)) {
    console.log(`${logPrefix} Skipping generation_error persist; program already has complete steps:`, programId);
    return { status: 'succeeded', attempts: attemptLogs.length, followedUp: enabled };
  }

  const combinedError = `Program generation failed after ${enabled ? '2 attempts' : '1 attempt'} (${attemptLogs.join(' | ')})`;
  try {
    await programModel.updateGenerationError(programId, combinedError, lastAttemptPrompt);
  } catch (saveError) {
    console.error(`${logPrefix} Failed to save generation error for program ${programId}:`, saveError.message);
  }
  return { status: 'failed', attempts: attemptLogs.length, error: combinedError };
}

module.exports = {
  getGenerationFollowUpDelayMs,
  isGenerationFollowUpEnabled,
  hasProgramSteps,
  hasCompleteProgramSteps,
  generateAndPersistProgramContent,
  runGenerationWithFollowUp
};
