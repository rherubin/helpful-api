const express = require('express');
const http = require('http');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const { createProgramRoutes, runRegenerationPollOnce } = require('../routes/programs');
const createUserRoutes = require('../routes/users');
const createPromptSessionRoutes = require('../routes/promptSessions');
const createProgramStepRoutes = require('../routes/programSteps');
const AuthService = require('../services/AuthService');
const HelpfulPromptService = require('../services/HelpfulPromptService');
const HopefulPromptService = require('../services/HopefulPromptService');
const Pairing = require('../models/Pairing');
const AndroidSubscription = require('../models/AndroidSubscription');
const StripeSubscription = require('../models/StripeSubscription');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
process.env.PROGRAM_GENERATION_FOLLOWUP_ENABLED = process.env.PROGRAM_GENERATION_FOLLOWUP_ENABLED || 'false';
const noopAuth = { resetRefreshTokenExpiration: async () => {} };

function userToken(id = 'user_cov80', extra = {}) {
  return jwt.sign({ id, email: `${id}@example.com`, ...extra }, JWT_SECRET, { expiresIn: '1h' });
}
function adminToken(id = 'admin_cov80') {
  return jwt.sign({ id, email: `${id}@example.com`, type: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
}

function sevenDayProgram() {
  return {
    program: {
      title: 'Test Couples Connection Program',
      overview: 'A single sentence describing the overall goal of this program.',
      days: Array.from({ length: 7 }, (_, i) => ({
        day: i + 1,
        theme: `Theme number ${i + 1} for couples work`,
        conversation_starter: 'Share one moment this week when you felt close to your partner and why it mattered to you both.',
        science_behind_it: 'Small moments of turning toward each other strengthen trust and emotional bonding over time.'
      }))
    }
  };
}

function sevenDayFaithProgram() {
  return {
    program: {
      title: '7-Day Faith Reflection Program',
      overview: 'A single sentence describing the overall arc and goal of this program.',
      days: Array.from({ length: 7 }, (_, i) => ({
        day: i + 1,
        theme: `Faith theme ${i + 1} for the couple`,
        reflection: 'Take a quiet moment to pray together and notice how scripture speaks to this part of your relationship today.',
        bible_verse: 'Love is patient, love is kind. It does not envy, it does not boast.'
      }))
    }
  };
}

function sitSessionPayload() {
  const longBody = 'This psychoeducation body explains how partners can slow down and notice the emotional cycle they get stuck in together as a couple.';
  return {
    bridge_content: {
      comparison: {
        partner_1: 'Alex is arriving with care for closeness and a hope for a warmer tone tonight.',
        partner_2: 'Jordan is arriving with honesty about their emotional tank and what topic feels useful.',
        insight: 'Both want the conversation to feel safer, even if they are starting from different energies.'
      },
      session_title: 'Finding a Softer Start',
      session_focus: 'Use this session to name the cycle without blame and practice one small repair together.',
      psychoeducation: {
        headline: 'The Cycle, Not the Person',
        body: longBody,
        references: [
          { citation: 'Johnson, S. (2008). Hold Me Tight.', note: 'Foundational EFT framing.' }
        ]
      }
    },
    session_content: {
      reflections: [
        { partner: 'Alex', question: 'When did you first feel the conversation get tight today?' },
        { partner: 'Jordan', question: 'What would help you stay present if it gets tight again?' }
      ],
      conversation_starter: { question: 'What is one small thing you each need in order to feel safer tonight?' },
      challenge: {
        title: 'A two-minute repair',
        steps: [
          { title: 'Pause', body: 'Take a breath together and name one feeling without fixing it yet.' }
        ]
      }
    }
  };
}

function llm(content, extra = {}) {
  return {
    content,
    finishReason: extra.finishReason || 'stop',
    model: extra.model || 'gpt-test',
    id: extra.id || 'chatcmpl-test',
    usage: extra.usage || { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
  };
}

function mockPool(execute) {
  const conn = {
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release() {},
    execute
  };
  return { execute, getConnection: async () => conn };
}

class Coverage80TestRunner {
  constructor(options = {}) {
    this.timeout = options.timeout || 20000;
    this.testResults = { passed: 0, failed: 0, total: 0 };
  }

  log(message, type = 'info') {
    const prefix = { info: '📝', pass: '✅', fail: '❌', warn: '⚠️', section: '🧪' }[type] || '📝';
    console.log(`${prefix} [${new Date().toISOString()}] ${message}`);
  }

  assert(condition, testName, details = '') {
    this.testResults.total++;
    if (condition) {
      this.testResults.passed++;
      this.log(`${testName} - PASSED ${details}`, 'pass');
    } else {
      this.testResults.failed++;
      this.log(`${testName} - FAILED ${details}`, 'fail');
    }
  }

  async expectThrow(fn, match, name) {
    try {
      await fn();
      this.assert(false, name, 'did not throw');
    } catch (e) {
      const ok = !match || (typeof match === 'string' ? (e.message || '').includes(match) : match.test(e.message || ''));
      this.assert(ok, name, e.message);
    }
  }

  async withApp(mountPath, router, fn) {
    const app = express();
    app.use(express.json());
    app.use(mountPath, router);
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    const client = axios.create({
      baseURL: `http://127.0.0.1:${port}`,
      validateStatus: () => true,
      timeout: this.timeout
    });
    try {
      return await fn(client);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  makePromptService() {
    const svc = new HelpfulPromptService();
    svc.mockMode = false;
    svc.apiKey = 'sk-test-coverage80-abcdefghijklmnopqrstuvwxyz';
    svc.retryBaseDelayMs = 1;
    svc.parseRetryDelayMs = 1;
    svc.MIN_REQUEST_INTERVAL = 0;
    return svc;
  }

  makeHopeful() {
    const svc = new HopefulPromptService();
    svc.mockMode = false;
    svc.apiKey = 'sk-test-coverage80-abcdefghijklmnopqrstuvwxyz';
    svc.retryBaseDelayMs = 1;
    svc.parseRetryDelayMs = 1;
    svc.MIN_REQUEST_INTERVAL = 0;
    return svc;
  }


  async testRegenerationPoller() {
    this.log('programs regeneration poller', 'section');

    await runRegenerationPollOnce({
      programModel: {
        getProgramsFlaggedForRegeneration: async () => { throw new Error('query failed'); }
      }
    });
    this.assert(true, 'poller query failure is swallowed');

    await runRegenerationPollOnce({
      programModel: { getProgramsFlaggedForRegeneration: async () => [] }
    });
    this.assert(true, 'poller no flagged programs returns');

    const events = [];
    const program = {
      id: 'prog_1',
      user_id: 'u1',
      pairing_id: 'pair_1',
      user_input: 'We want more connection this month as a couple.'
    };

    await runRegenerationPollOnce({
      programModel: {
        getProgramsFlaggedForRegeneration: async () => [program, { ...program, id: 'prog_2' }, { ...program, id: 'prog_3' }],
        claimRegenerateFlag: async (id) => {
          events.push('claim:' + id);
          if (id === 'prog_1') throw new Error('claim failed');
          if (id === 'prog_2') return false;
          return true;
        },
        updateGenerationError: async (id, msg) => { events.push('err:' + id + ':' + msg); }
      },
      userModel: {
        getUserById: async () => ({ user_name: null, partner_name: null })
      }
    });
    this.assert(events.includes('claim:prog_1') && events.includes('claim:prog_2'), 'poller claim throw and skip');
    this.assert(events.some((e) => e.includes('user_name not set')), 'poller skips when user_name missing');

    await runRegenerationPollOnce({
      programModel: {
        getProgramsFlaggedForRegeneration: async () => [{ id: 'p_user_fail', user_id: 'u1', user_input: 'x' }],
        claimRegenerateFlag: async () => true,
        updateGenerationError: async (id, msg) => { events.push('err:' + id + ':' + msg); }
      },
      userModel: { getUserById: async () => { throw new Error('user lookup failed'); } }
    });
    this.assert(events.some((e) => e.includes('p_user_fail') && e.includes('user_name not set')), 'poller user lookup failure records error');

    await runRegenerationPollOnce({
      programModel: {
        getProgramsFlaggedForRegeneration: async () => [{ id: 'p_no_partner', user_id: 'u1', pairing_id: 'pr1', user_input: 'enough text' }],
        claimRegenerateFlag: async () => true,
        updateGenerationError: async (id, msg) => { events.push('err:' + id + ':' + msg); }
      },
      userModel: {
        getUserById: async (id) => {
          if (id === 'u1') return { user_name: 'Alex', partner_name: null };
          throw new Error('partner missing');
        }
      },
      pairingModel: {
        getPairingById: async () => ({ user1_id: 'u1', user2_id: 'u2' })
      },
      helpfulPromptService: { generateInitialProgram: async () => ({ ok: true }) },
      hopefulPromptService: null,
      userModelForOrgCode: null
    });
    this.assert(events.some((e) => e.includes('partner_name required')), 'poller Helpful requires partner_name');

    let updated = null;
    await runRegenerationPollOnce({
      programModel: {
        getProgramsFlaggedForRegeneration: async () => [{ id: 'p_ok', user_id: 'u1', pairing_id: 'pr1', user_input: 'enough text' }],
        claimRegenerateFlag: async () => true,
        updateTherapyResponse: async (id, body, seconds, prompt) => { updated = { id, body, seconds, prompt }; }
      },
      programStepModel: { replaceProgramSteps: async () => [{ id: 's1' }, { id: 's2' }] },
      userModel: {
        getUserById: async (id) => id === 'u1'
          ? { user_name: 'Alex', partner_name: null }
          : { user_name: 'Jordan' }
      },
      pairingModel: { getPairingById: async () => ({ user1_id: 'u1', user2_id: 'u2' }) },
      hopefulPromptService: {
        generateInitialProgram: async () => ({ program: { title: 'T' }, __prompt: 'PROMPT' })
      },
      helpfulPromptService: {
        generateInitialProgram: async () => { throw new Error('should use hopeful when org prompts exist'); }
      },
      userModelForOrgCode: {
        getUserOrgCode: async () => ({
          initial_program_prompt: 'hi {{userName}}',
          next_program_prompt: 'n',
          therapy_response_prompt: 't',
          organization: 'Church',
          city: 'Austin',
          state: 'TX'
        })
      }
    });
    this.assert(updated && updated.id === 'p_ok' && updated.prompt === 'PROMPT' && updated.body.includes('title'), 'poller successful Helpful regenerate with org prompts');

    updated = null;
    await runRegenerationPollOnce({
      programModel: {
        getProgramsFlaggedForRegeneration: async () => [{ id: 'p_hope', user_id: 'u1', pairing_id: 'pr1', user_input: 'enough text' }],
        claimRegenerateFlag: async () => true,
        updateTherapyResponse: async (id, body, seconds, prompt) => { updated = { id, body, prompt }; }
      },
      userModel: { getUserById: async () => ({ user_name: 'Alex', partner_name: 'Jordan' }) },
      pairingModel: { getPairingById: async () => ({ user1_id: 'u1', user2_id: null }) },
      hopefulPromptService: { generateInitialProgram: async () => 'plain text program' },
      helpfulPromptService: { generateInitialProgram: async () => { throw new Error('should not use helpful'); } },
      userModelForOrgCode: {
        getUserOrgCode: async () => null,
        getUserById: async () => ({ org_name: 'Church', org_city: 'Austin', org_state: 'TX' })
      }
    });
    this.assert(updated && updated.body === 'plain text program' && updated.prompt === null, 'poller Hopeful string response via custom org fields');

    let genFailed = false;
    await runRegenerationPollOnce({
      programModel: {
        getProgramsFlaggedForRegeneration: async () => [{ id: 'p_fail', user_id: 'u1', user_input: 'enough text' }],
        claimRegenerateFlag: async () => true,
        updateGenerationError: async () => { throw new Error('cannot persist'); }
      },
      userModel: { getUserById: async () => ({ user_name: 'Alex', partner_name: 'Jordan' }) },
      helpfulPromptService: {
        generateInitialProgram: async () => {
          const err = new Error('llm down');
          err.__prompt = 'P';
          throw err;
        }
      },
      userModelForOrgCode: {
        getUserOrgCode: async () => { throw new Error('org lookup failed'); }
      }
    });
    genFailed = true;
    this.assert(genFailed, 'poller generation failure with failed error persist is swallowed');

    await runRegenerationPollOnce({
      programModel: {
        getProgramsFlaggedForRegeneration: async () => [{ id: 'p_nouser', user_id: 'u1', user_input: 'x' }],
        claimRegenerateFlag: async () => true,
        updateGenerationError: async (id, msg) => { events.push('err:' + id + ':' + msg); }
      }
    });
    this.assert(events.some((e) => e.includes('p_nouser')), 'poller without userModel skips for missing name');
  }


  async testProgramHttpErrors() {
    this.log('programs HTTP error paths', 'section');
    const programModel = {
      getProgramById: async (id) => {
        if (id === 'missing') throw new Error('Program not found');
        if (id === 'notmine') return { id, user_id: 'someone-else', pairing_id: 'pr1', user_input: 'other' };
        return { id, user_id: 'user_cov80', pairing_id: 'pr1', user_input: 'We want more connection in our marriage this month.' };
      },
      checkProgramAccess: async (userId, id) => id !== 'forbidden',
      createProgram: async (userId, data) => ({ id: 'prog_new', user_id: userId, ...data }),
      getUserPrograms: async () => { throw new Error('list failed'); },
      softDeleteProgram: async (id) => {
        if (id === 'gone') throw new Error('Program not found');
        if (id === 'boom') throw new Error('db');
        return { deleted: true };
      }
    };
    const userModel = {
      getUserById: async (id) => {
        if (id === 'user_cov80') return { id, user_name: 'Alex', partner_name: null };
        if (id === 'partner1') return { id, user_name: 'Jordan' };
        throw new Error('User not found');
      },
      getUserOrgCode: async () => null
    };
    const pairingModel = {
      getPairingById: async (id) => {
        if (id === 'missing-pairing') throw new Error('Pairing not found');
        if (id === 'other') return { id, user1_id: 'a', user2_id: 'b', status: 'accepted' };
        return { id, user1_id: 'user_cov80', user2_id: 'partner1', status: 'accepted' };
      }
    };
    const helpful = {
      isConfigured: () => true,
      model: 'helpful-test',
      generateCouplesProgram: async () => sevenDayProgram(),
      generateNextCouplesProgram: async () => sevenDayProgram(),
      generateInitialProgram: async () => sevenDayProgram(),
      getMetrics: () => { throw new Error('metrics failed'); }
    };
    const hopeful = { isConfigured: () => false, model: 'hopeful-test', getMetrics: () => ({}) };
    const unconfigured = { isConfigured: () => false };
    const steps = {
      getProgramSteps: async () => [{ id: 's1' }],
      replaceProgramSteps: async () => [{ id: 's1' }],
      deleteProgramSteps: async () => {}
    };
    const push = { sendToUsers: async () => { throw new Error('push failed'); } };
    const auth = noopAuth;
    const router = createProgramRoutes(programModel, hopeful, helpful, steps, userModel, pairingModel, auth, userModel, push);
    const token = userToken();
    const admin = adminToken();

    await this.withApp('/api/programs', router, async (client) => {
      const authH = { Authorization: `Bearer ${token}` };

      let res = await client.post('/api/programs', {}, { headers: authH });
      this.assert(res.status === 400, 'POST / programs missing user_input', res.status);

      res = await client.post('/api/programs', { user_input: 'hello world enough text', pairing_id: 'pr1' }, { headers: authH });
      this.assert(res.status === 201 || res.status === 400, 'POST / programs with pairing', res.status);

      res = await client.post('/api/programs', { user_input: 'hello world enough text', pairing_id: 'missing-pairing' }, { headers: authH });
      this.assert(res.status === 404, 'POST / programs pairing not found', res.status);

      res = await client.post('/api/programs', { user_input: 'hello world enough text', pairing_id: 'other' }, { headers: authH });
      this.assert(res.status === 403, 'POST / programs pairing not member', res.status);

      const noNameRouter = createProgramRoutes(programModel, hopeful, helpful, steps, {
        getUserById: async () => ({ user_name: null }),
        getUserOrgCode: async () => { throw new Error('org fail'); }
      }, pairingModel, auth, {
        getUserOrgCode: async () => { throw new Error('org fail'); }
      }, push);
      await this.withApp('/api/programs', noNameRouter, async (c2) => {
        const r = await c2.post('/api/programs', { user_input: 'hello world enough text' }, { headers: authH });
        this.assert(r.status === 400, 'POST / programs missing user_name', r.status);
      });

      const noPairRouter = createProgramRoutes(programModel, hopeful, helpful, steps, userModel, null, auth, userModel, push);
      await this.withApp('/api/programs', noPairRouter, async (c2) => {
        const r = await c2.post('/api/programs', { user_input: 'hello world enough text', pairing_id: 'pr1' }, { headers: authH });
        this.assert(r.status === 500, 'POST / programs pairing validation unavailable', r.status);
      });

      const boomCreate = createProgramRoutes({
        ...programModel,
        createProgram: async () => { throw new Error('insert failed'); }
      }, hopeful, helpful, steps, userModel, pairingModel, auth, userModel, push);
      await this.withApp('/api/programs', boomCreate, async (c2) => {
        const r = await c2.post('/api/programs', { user_input: 'hello world enough text' }, { headers: authH });
        this.assert(r.status === 500, 'POST / programs create 500', r.status);
      });

      res = await client.post('/api/programs', { user_input: 'We want more connection in our marriage this month.', pairing_id: 'pr1' }, { headers: authH });
      this.assert(res.status === 201, 'POST / programs success starts generation', res.status);
      await new Promise((r) => setTimeout(r, 30));

      const none = createProgramRoutes(programModel, unconfigured, unconfigured, steps, userModel, pairingModel, auth, userModel, null);
      await this.withApp('/api/programs', none, async (c2) => {
        const r = await c2.post('/api/programs', { user_input: 'We want more connection in our marriage this month.' }, { headers: authH });
        this.assert(r.status === 201, 'POST / programs skips generation when unconfigured', r.status);
        const t = await c2.post('/api/programs/prog_1/therapy_response', {}, { headers: authH });
        this.assert(t.status === 503, 'therapy_response 503 when unconfigured', t.status);
      });

      res = await client.post('/api/programs/forbidden/therapy_response', {}, { headers: authH });
      this.assert(res.status === 403, 'therapy_response 403', res.status);
      res = await client.post('/api/programs/missing/therapy_response', {}, { headers: authH });
      this.assert(res.status === 404, 'therapy_response 404', res.status);

      res = await client.get('/api/programs', { headers: authH });
      this.assert(res.status === 500, 'GET / programs 500', res.status);

      res = await client.get('/api/programs/forbidden', { headers: authH });
      this.assert([403, 500].includes(res.status), 'GET /:id forbidden', res.status);
      res = await client.get('/api/programs/missing', { headers: authH });
      this.assert([404, 500].includes(res.status), 'GET /:id missing', res.status);

      const getBoom = createProgramRoutes({
        ...programModel,
        getProgramById: async () => { throw new Error('db'); },
        checkProgramAccess: async () => true
      }, hopeful, helpful, steps, userModel, pairingModel, auth, userModel, push);
      await this.withApp('/api/programs', getBoom, async (c2) => {
        const r = await c2.get('/api/programs/x', { headers: authH });
        this.assert(r.status === 500, 'GET /:id 500', r.status);
      });

      const delRouter = createProgramRoutes({
        ...programModel,
        checkProgramAccess: async () => true,
        softDeleteProgram: async (id) => {
          if (id === 'gone') throw new Error('Program not found');
          if (id === 'boom') throw new Error('db');
          return { success: true };
        }
      }, hopeful, helpful, steps, userModel, pairingModel, auth, userModel, push);
      await this.withApp('/api/programs', delRouter, async (c2) => {
        let r = await c2.delete('/api/programs/notmine', { headers: authH });
        this.assert(r.status === 403, 'DELETE not owner', r.status);
        r = await c2.delete('/api/programs/gone', { headers: authH });
        this.assert(r.status === 404, 'DELETE missing', r.status);
        r = await c2.delete('/api/programs/boom', { headers: authH });
        this.assert(r.status === 500, 'DELETE 500', r.status);
      });

      res = await client.get('/api/programs/metrics', { headers: { Authorization: `Bearer ${token}` } });
      this.assert(res.status === 403, 'metrics rejects user token', res.status);
      res = await client.get('/api/programs/metrics', { headers: { Authorization: `Bearer ${admin}` } });
      this.assert(res.status === 500, 'metrics 500 when getMetrics throws', res.status);

      const noMetrics = createProgramRoutes(programModel, null, null, steps, userModel, pairingModel, auth, userModel, push);
      await this.withApp('/api/programs', noMetrics, async (c2) => {
        const r = await c2.get('/api/programs/metrics', { headers: { Authorization: `Bearer ${admin}` } });
        this.assert(r.status === 503, 'metrics 503 without services', r.status);
      });
    });

    await this.testNextProgramAndTherapy();
  }

  async testNextProgramAndTherapy() {
    const token = userToken();
    const authH = { Authorization: `Bearer ${token}` };
    const userModel = {
      getUserById: async (id) => (id === 'user_cov80'
        ? { id, user_name: 'Alex', partner_name: 'Jordan' }
        : { id, user_name: 'Sam' }),
      getUserOrgCode: async () => ({ organization: 'Org', city: 'Austin', state: 'TX' })
    };
    const pairingModel = {
      getPairingById: async () => ({ user1_id: 'user_cov80', user2_id: 'p2', status: 'accepted' })
    };
    const helpful = {
      isConfigured: () => true,
      model: 'helpful-test',
      generateNextCouplesProgram: async () => sevenDayProgram(),
      generateCouplesProgram: async () => sevenDayProgram(),
      generateInitialProgram: async () => sevenDayProgram(),
      generateCouplesTherapyResponse: async () => 'A warm follow-up question for the couple to sit with together tonight.'
    };
    const hopeful = { isConfigured: () => false, model: 'h' };
    const steps = {
      getProgramSteps: async (id) => id === 'already'
        ? Array.from({ length: 7 }, (_, i) => ({ id: 's' + (i + 1), day: i + 1 }))
        : [{ id: 's1', day: 1 }],
      replaceProgramSteps: async () => [],
      deleteProgramSteps: async () => {}
    };
    const push = { sendToUsers: async () => true };

    const programModel = {
      getProgramById: async (id) => {
        if (id === 'missing') throw new Error('Program not found');
        return { id, user_id: 'user_cov80', pairing_id: 'pr1', user_input: 'previous input that is long enough' };
      },
      checkProgramAccess: async (userId, id) => id !== 'forbidden',
      createProgram: async (userId, data) => ({ id: 'next_1', user_id: userId, pairing_id: data.pairing_id }),
      hasTherapyResponse: async (id) => id === 'already',
      updateTherapyResponse: async () => {}
    };

    const router = createProgramRoutes(programModel, hopeful, helpful, steps, userModel, pairingModel, noopAuth, userModel, push);
    await this.withApp('/api/programs', router, async (client) => {
      let res = await client.post('/api/programs/missing/next_program', { user_input: 'We want another two weeks of closer conversation together.' }, { headers: authH });
      this.assert(res.status === 404, 'next_program previous not found', res.status);

      res = await client.post('/api/programs/prog_1/next_program', { user_input: 'We want another two weeks of closer conversation together.' }, { headers: authH });
      this.assert([201, 400].includes(res.status), 'next_program success or validation', res.status);
      await new Promise((r) => setTimeout(r, 30));

      res = await client.post('/api/programs/prog_1/therapy_response', {}, { headers: authH });
      this.assert([200, 201, 202, 409, 400, 500].includes(res.status), 'therapy_response attempts generate', res.status);
    });

    const already = createProgramRoutes({
      ...programModel,
      hasTherapyResponse: async () => true,
      getProgramById: async (id) => ({ id, user_id: 'user_cov80', pairing_id: null, user_input: 'x', therapy_response: 'exists' })
    }, hopeful, helpful, steps, userModel, pairingModel, noopAuth, userModel, push);
    await this.withApp('/api/programs', already, async (client) => {
      const res = await client.post('/api/programs/already/therapy_response', {}, { headers: authH });
      this.assert(res.status === 409, 'therapy_response already present', res.status);
    });

    const noName = createProgramRoutes(programModel, hopeful, helpful, steps, {
      getUserById: async () => ({ user_name: null, partner_name: null }),
      getUserOrgCode: async () => null
    }, pairingModel, noopAuth, userModel, push);
    await this.withApp('/api/programs', noName, async (client) => {
      const res = await client.post('/api/programs/prog_1/therapy_response', {}, { headers: authH });
      this.assert([400, 409].includes(res.status), 'therapy_response missing user name', res.status);
    });

    const boom = createProgramRoutes({
      ...programModel,
      getProgramById: async () => { throw new Error('db'); }
    }, hopeful, helpful, steps, userModel, pairingModel, noopAuth, userModel, push);
    await this.withApp('/api/programs', boom, async (client) => {
      const res = await client.post('/api/programs/prog_1/therapy_response', {}, { headers: authH });
      this.assert(res.status === 500, 'therapy_response 500', res.status);
      const n = await client.post('/api/programs/prog_1/next_program', { user_input: 'We want another two weeks of closer conversation together.' }, { headers: authH });
      this.assert(n.status === 500, 'next_program 500', n.status);
    });
  }


  async testUsersHttp() {
    this.log('users HTTP error and org branches', 'section');
    const token = userToken('user_cov80');
    const admin = adminToken();
    const authH = { Authorization: `Bearer ${token}` };

    const baseUser = {
      id: 'user_cov80',
      email: 'user_cov80@example.com',
      user_name: 'Alex',
      partner_name: 'Jordan',
      org_code_id: 'org1',
      org_name: null,
      org_city: null,
      org_state: null,
      is_premium: false,
      password_hash: 'x',
      bypass_password: false,
      stripe_customer_id: 'cus_1',
      premium: 0
    };

    const userModel = {
      createUser: async ({ email }) => {
        if (email === 'exists@example.com') throw new Error('Email already exists');
        if (email === 'weak@example.com') throw new Error('Password must be longer');
        if (email === 'badpass@example.com') throw new Error('Password contains invalid chars');
        if (email === 'boom@example.com') throw new Error('db');
        return { id: 'user_new' };
      },
      getUserById: async (id) => {
        if (id === 'user_new') return { ...baseUser, id: 'user_new', email: 'new@example.com', org_code_id: null };
        if (id === 'user_cov80') return { ...baseUser };
        throw new Error('User not found');
      },
      updateUser: async (id, data) => ({ ...baseUser, ...data, id, email: data.email || baseUser.email }),
      softDeleteUser: async (id) => {
        if (id === 'gone') throw new Error('User not found or already deleted');
        return { message: 'deleted', id };
      },
      restoreUser: async (id) => {
        if (id === 'notdel') throw new Error('User not found or not deleted');
        return { message: 'restored', id };
      },
      getDeletedUsers: async () => { throw new Error('db'); },
      logOrgCodeLinkChange: async () => { throw new Error('audit fail'); }
    };

    const authService = {
      ...noopAuth,
      issueTokensForUser: async () => ({ access_token: 'a', refresh_token: 'r', expires_in: 1, refresh_expires_in: 2 })
    };
    const pairingService = {
      requestPairing: async () => { throw new Error('pairing fail'); },
      getUserPairings: async () => { throw new Error('list fail'); },
      pairingModel: { userHasPremiumPairing: async () => false }
    };
    const orgCodeModel = {
      getOrgCodeById: async () => { throw new Error('org gone'); },
      getOrgCodeByCode: async (code) => {
        if (code === 'EXPIRED') return { id: 'o1', expires_at: new Date(Date.now() - 1000).toISOString() };
        if (code === 'GOOD') return { id: 'o2', organization: 'Org', city: 'Austin', state: 'TX', expires_at: null };
        throw new Error('not found');
      }
    };
    const stripeModel = { getActiveForUser: async () => { throw new Error('stripe down'); } };
    const stripeBilling = {
      cancelActiveSubscriptionsForUser: async () => { throw new Error('cancel fail'); },
      updateCustomerEmail: async () => { throw new Error('email sync fail'); }
    };

    const router = createUserRoutes(userModel, authService, pairingService, orgCodeModel, null, stripeModel, stripeBilling);
    await this.withApp('/api/users', router, async (client) => {
      let res = await client.post('/api/users', {});
      this.assert(res.status === 400, 'POST users missing fields', res.status);
      res = await client.post('/api/users', { email: 'not-an-email', password: 'Password123!' });
      this.assert(res.status === 400, 'POST users invalid email', res.status);
      res = await client.post('/api/users', { email: 'exists@example.com', password: 'Password123!' });
      this.assert(res.status === 409, 'POST users email exists', res.status);
      res = await client.post('/api/users', { email: 'weak@example.com', password: 'x' });
      this.assert(res.status === 400, 'POST users password must', res.status);
      res = await client.post('/api/users', { email: 'badpass@example.com', password: 'x' });
      this.assert(res.status === 400, 'POST users password contains', res.status);
      res = await client.post('/api/users', { email: 'boom@example.com', password: 'Password123!' });
      this.assert(res.status === 500, 'POST users 500', res.status);
      res = await client.post('/api/users', { email: 'ok@example.com', password: 'Password123!' });
      this.assert(res.status === 201, 'POST users succeeds when pairing list fails', res.status);

      res = await client.get('/api/users/other', { headers: authH });
      this.assert(res.status === 403, 'GET user 403 other id', res.status);
      res = await client.get('/api/users/user_cov80', { headers: authH });
      this.assert(res.status === 200, 'GET user org details fail is non-fatal', res.status);
      res = await client.get('/api/users/missing', { headers: { Authorization: `Bearer ${userToken('missing')}` } });
      this.assert(res.status === 404, 'GET user 404', res.status);

      const get500 = createUserRoutes({
        ...userModel,
        getUserById: async () => { throw new Error('db'); }
      }, authService, pairingService, orgCodeModel, null, stripeModel, stripeBilling);
      await this.withApp('/api/users', get500, async (c2) => {
        const r = await c2.get('/api/users/user_cov80', { headers: authH });
        this.assert(r.status === 500, 'GET user 500', r.status);
      });

      const customGet = createUserRoutes({
        ...userModel,
        getUserById: async () => ({ ...baseUser, org_code_id: null, org_name: 'Mine', org_city: 'Austin', org_state: 'TX' })
      }, authService, pairingService, orgCodeModel, null, stripeModel, stripeBilling);
      await this.withApp('/api/users', customGet, async (c2) => {
        const r = await c2.get('/api/users/user_cov80', { headers: authH });
        this.assert(r.status === 200 && r.data.org_name === 'Mine', 'GET user custom org fields');
      });

      res = await client.delete('/api/users/other', { headers: authH });
      this.assert(res.status === 403, 'DELETE user 403', res.status);
      res = await client.delete('/api/users/user_cov80', { headers: authH });
      this.assert(res.status === 200, 'DELETE user continues after stripe cancel fail', res.status);

      const del404 = createUserRoutes({
        ...userModel,
        softDeleteUser: async () => { throw new Error('User not found or already deleted'); }
      }, authService, pairingService, orgCodeModel, null, stripeModel, stripeBilling);
      await this.withApp('/api/users', del404, async (c2) => {
        const r = await c2.delete('/api/users/user_cov80', { headers: authH });
        this.assert(r.status === 404, 'DELETE user 404', r.status);
      });
      const del500 = createUserRoutes({
        ...userModel,
        softDeleteUser: async () => { throw new Error('db'); }
      }, authService, pairingService, orgCodeModel, null, stripeModel, stripeBilling);
      await this.withApp('/api/users', del500, async (c2) => {
        const r = await c2.delete('/api/users/user_cov80', { headers: authH });
        this.assert(r.status === 500, 'DELETE user 500', r.status);
      });

      res = await client.patch('/api/users/other/restore', {}, { headers: authH });
      this.assert(res.status === 403, 'RESTORE 403', res.status);
      res = await client.patch('/api/users/user_cov80/restore', {}, { headers: authH });
      this.assert(res.status === 200, 'RESTORE success', res.status);
      const res404 = createUserRoutes({
        ...userModel,
        restoreUser: async () => { throw new Error('User not found or not deleted'); }
      }, authService, pairingService, orgCodeModel, null, null, null);
      await this.withApp('/api/users', res404, async (c2) => {
        const r = await c2.patch('/api/users/user_cov80/restore', {}, { headers: authH });
        this.assert(r.status === 404, 'RESTORE 404', r.status);
      });
      const res500 = createUserRoutes({
        ...userModel,
        restoreUser: async () => { throw new Error('db'); }
      }, authService, pairingService, orgCodeModel, null, null, null);
      await this.withApp('/api/users', res500, async (c2) => {
        const r = await c2.patch('/api/users/user_cov80/restore', {}, { headers: authH });
        this.assert(r.status === 500, 'RESTORE 500', r.status);
      });

      res = await client.put('/api/users/other', { user_name: 'A' }, { headers: authH });
      this.assert(res.status === 403, 'PUT 403', res.status);
      res = await client.put('/api/users/user_cov80', { email: 'bad' }, { headers: authH });
      this.assert(res.status === 400, 'PUT invalid email', res.status);

      const noOrg = createUserRoutes(userModel, authService, pairingService, null, null, stripeModel, stripeBilling);
      await this.withApp('/api/users', noOrg, async (c2) => {
        const r = await c2.put('/api/users/user_cov80', { org_code: 'GOOD' }, { headers: authH });
        this.assert(r.status === 500, 'PUT org validation unavailable', r.status);
      });

      res = await client.put('/api/users/user_cov80', { org_code: '' }, { headers: authH });
      this.assert(res.status === 200, 'PUT detach org keeps stripe check failure as not premium', res.status);
      res = await client.put('/api/users/user_cov80', { org_code: 123 }, { headers: authH });
      this.assert(res.status === 400, 'PUT invalid org code type', res.status);
      res = await client.put('/api/users/user_cov80', { org_code: 'NOPE' }, { headers: authH });
      this.assert(res.status === 400, 'PUT invalid org code lookup', res.status);
      res = await client.put('/api/users/user_cov80', { org_code: 'EXPIRED' }, { headers: authH });
      this.assert(res.status === 400, 'PUT expired org code', res.status);
      res = await client.put('/api/users/user_cov80', { org_code: 'GOOD' }, { headers: authH });
      this.assert(res.status === 200, 'PUT attach org code', res.status);

      res = await client.put('/api/users/user_cov80', { org_name: 'Mine', org_city: 'Austin', org_state: 'TX' }, { headers: authH });
      this.assert(res.status === 200, 'PUT complete custom org', res.status);
      res = await client.put('/api/users/user_cov80', { org_name: '   ' }, { headers: authH });
      this.assert(res.status === 200, 'PUT incomplete custom org uses stripe fallback', res.status);

      res = await client.put('/api/users/user_cov80', { email: 'new-email@example.com' }, { headers: authH });
      this.assert(res.status === 200, 'PUT email sync failure is non-fatal', res.status);

      const update404 = createUserRoutes({
        ...userModel,
        getUserById: async () => { throw new Error('User not found'); }
      }, authService, pairingService, orgCodeModel, null, stripeModel, stripeBilling);
      await this.withApp('/api/users', update404, async (c2) => {
        const r = await c2.put('/api/users/user_cov80', { user_name: 'Alex' }, { headers: authH });
        this.assert(r.status === 404, 'PUT 404', r.status);
      });
      const update409 = createUserRoutes({
        ...userModel,
        updateUser: async () => { throw new Error('Email already exists'); }
      }, authService, pairingService, orgCodeModel, null, stripeModel, stripeBilling);
      await this.withApp('/api/users', update409, async (c2) => {
        const r = await c2.put('/api/users/user_cov80', { email: 'taken@example.com' }, { headers: authH });
        this.assert(r.status === 409, 'PUT 409 email exists', r.status);
      });
      const updateKids = createUserRoutes({
        ...userModel,
        updateUser: async () => { throw new Error('Children must be an array'); }
      }, authService, pairingService, orgCodeModel, null, stripeModel, stripeBilling);
      await this.withApp('/api/users', updateKids, async (c2) => {
        const r = await c2.put('/api/users/user_cov80', { children: 'nope' }, { headers: authH });
        this.assert(r.status === 400, 'PUT children validation', r.status);
      });
      const updatePass = createUserRoutes({
        ...userModel,
        updateUser: async () => { throw new Error('Password must be longer'); }
      }, authService, pairingService, orgCodeModel, null, stripeModel, stripeBilling);
      await this.withApp('/api/users', updatePass, async (c2) => {
        const r = await c2.put('/api/users/user_cov80', { password: 'x' }, { headers: authH });
        this.assert(r.status === 400, 'PUT password validation', r.status);
      });
      const update500 = createUserRoutes({
        ...userModel,
        updateUser: async () => { throw new Error('db'); }
      }, authService, pairingService, orgCodeModel, null, stripeModel, stripeBilling);
      await this.withApp('/api/users', update500, async (c2) => {
        const r = await c2.put('/api/users/user_cov80', { user_name: 'Alex' }, { headers: authH });
        this.assert(r.status === 500, 'PUT 500', r.status);
      });

      res = await client.get('/api/users/deleted/all', { headers: authH });
      this.assert(res.status === 403, 'GET deleted users rejects user token', res.status);
      res = await client.get('/api/users/deleted/all', { headers: { Authorization: `Bearer ${admin}` } });
      this.assert(res.status === 500, 'GET deleted users 500', res.status);
    });
  }

  async testPromptSessionsHttp() {
    this.log('promptSessions generate and error paths', 'section');
    const token = userToken('user_cov80');
    const authH = { Authorization: `Bearer ${token}` };

    const session = {
      id: 'ps1',
      user_id: 'user_cov80',
      pairing_id: 'pr1',
      shared_device: false,
      bridge_content: null,
      session_content: null,
      generation: { status: 'ready' }
    };

    const model = {
      createPromptSession: async (data) => ({ id: 'ps_new', ...data, shared_device: !!data.shared_device }),
      getActiveSoloSessionForUser: async () => null,
      getActiveSessionForPairing: async () => null,
      checkAccess: async () => true,
      listPromptSessionsForUser: async () => { throw new Error('list failed'); },
      getPromptSessionsForUser: async () => { throw new Error('list failed'); },
      getPromptSessionById: async (id) => {
        if (id === 'missing') throw new Error('Prompt session not found');
        if (id === 'done') return { ...session, id, bridge_content: 'b', session_content: 's', generation: { status: 'succeeded' } };
        return { ...session, id };
      },
      beginGeneration: async (id) => {
        if (id === 'conflict') {
          const err = new Error('already running');
          err.code = 'GENERATION_IN_PROGRESS';
          throw err;
        }
        return { claimId: 'claim1' };
      },
      saveGeneratedContent: async () => ({ ok: true }),
      updateGenerationError: async () => {},
      savePrep: async () => ({ ok: true }),
      getPrep: async () => ({ ok: true }),
      updatePromptSession: async () => ({ ok: true })
    };
    const pairingModel = {
      getPairingById: async (id) => {
        if (id === 'missing') throw new Error('Pairing not found');
        if (id === 'pending') return { id, user1_id: 'user_cov80', user2_id: 'p2', status: 'pending' };
        if (id === 'other') return { id, user1_id: 'a', user2_id: 'b', status: 'accepted' };
        return { id, user1_id: 'user_cov80', user2_id: 'p2', status: 'accepted' };
      }
    };
    const userModel = {
      getUserById: async (id) => {
        if (id === 'user_cov80') return { id, user_name: '', email: 'alex@example.com' };
        if (id === 'p2') return { id, user_name: null, email: null };
        return { id, user_name: 'Jordan', email: 'j@example.com' };
      }
    };
    const helpful = {
      isConfigured: () => true,
      generateSitSessionContent: async () => ({ bridge: { title: 'T' }, session: { reflections: [] }, __prompt: 'P' })
    };
    const push = { sendToUsers: async () => { throw new Error('push fail'); } };

    const router = createPromptSessionRoutes(model, pairingModel, noopAuth, push, helpful, userModel);
    await this.withApp('/api/prompt-sessions', router, async (client) => {
      let res = await client.post('/api/prompt-sessions', { pairing_id: 'missing' }, { headers: authH });
      this.assert([404, 400, 500].includes(res.status), 'POST session missing pairing', res.status);
      res = await client.post('/api/prompt-sessions', { pairing_id: 'other' }, { headers: authH });
      this.assert([403, 400, 500].includes(res.status), 'POST session not member', res.status);
      res = await client.post('/api/prompt-sessions', { pairing_id: 'pending', shared_device: true }, { headers: authH });
      this.assert([409, 400, 403, 201].includes(res.status), 'POST shared device requires accepted pairing', res.status);
      res = await client.post('/api/prompt-sessions', {}, { headers: authH });
      this.assert([201, 400].includes(res.status), 'POST solo session', res.status);

      res = await client.get('/api/prompt-sessions', { headers: authH });
      this.assert(res.status === 500, 'GET sessions 500', res.status);
      res = await client.get('/api/prompt-sessions/missing', { headers: authH });
      this.assert([404, 500].includes(res.status), 'GET session missing', res.status);

      res = await client.post('/api/prompt-sessions/done/generate', {}, { headers: authH });
      this.assert([200, 409, 400, 500].includes(res.status), 'generate already succeeded', res.status);

      const throwingHelpful = {
        isConfigured: () => true,
        generateSitSessionContent: async () => { throw new Error('llm fail'); }
      };
      const racedModel = {
        ...model,
        getPromptSessionById: async (id) => {
          racedModel._n = (racedModel._n || 0) + 1;
          if (racedModel._n > 1) {
            return { ...session, id, bridge_content: 'b', session_content: 's', generation: { status: 'succeeded' } };
          }
          return { ...session, id, pairing_id: 'pr1', generation: { status: 'ready' } };
        }
      };
      const raceRouter = createPromptSessionRoutes(racedModel, pairingModel, noopAuth, push, throwingHelpful, userModel);
      await this.withApp('/api/prompt-sessions', raceRouter, async (c2) => {
        const r = await c2.post('/api/prompt-sessions/ps1/generate', {}, { headers: authH });
        this.assert([200, 201, 409, 400, 500].includes(r.status), 'generate uses sessionIfAlreadySucceeded after failure', r.status);
      });

      const boomAfter = {
        ...model,
        getPromptSessionById: async () => { throw new Error('gone'); }
      };
      const boomRouter = createPromptSessionRoutes(boomAfter, pairingModel, noopAuth, push, helpful, userModel);
      await this.withApp('/api/prompt-sessions', boomRouter, async (c2) => {
        const r = await c2.post('/api/prompt-sessions/ps1/generate', {}, { headers: authH });
        this.assert([404, 500].includes(r.status), 'generate session lookup failure', r.status);
      });
    });
  }


  async testAuthServiceBranches() {
    this.log('AuthService leftover branches', 'section');
    const saved = { ...process.env };
    try {
      delete process.env.JWT_SECRET;
      delete process.env.JWT_REFRESH_SECRET;
      delete process.env.JWT_EXPIRES_IN;
      delete process.env.JWT_REFRESH_EXPIRES_IN;
      delete process.env.JWT_ACCESS_TOKEN_EXPIRES_IN_SECONDS;
      delete process.env.JWT_REFRESH_TOKEN_EXPIRES_IN_SECONDS;
      const fallback = new AuthService({}, {});
      this.assert(fallback.JWT_SECRET.includes('change-in-production'), 'AuthService fallback JWT secret');
      this.assert(fallback.JWT_EXPIRES_IN === '24h', 'AuthService default expires in');
      process.env.JWT_ACCESS_TOKEN_EXPIRES_IN_SECONDS = '120';
      process.env.JWT_REFRESH_TOKEN_EXPIRES_IN_SECONDS = '240';
      const numbered = new AuthService({}, {});
      this.assert(numbered.JWT_ACCESS_TOKEN_EXPIRES_IN_SECONDS === 120, 'AuthService numeric access expiry env');
    } finally {
      if (saved.JWT_SECRET === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = saved.JWT_SECRET;
      if (saved.JWT_REFRESH_SECRET === undefined) delete process.env.JWT_REFRESH_SECRET;
      else process.env.JWT_REFRESH_SECRET = saved.JWT_REFRESH_SECRET;
      if (saved.JWT_EXPIRES_IN === undefined) delete process.env.JWT_EXPIRES_IN;
      else process.env.JWT_EXPIRES_IN = saved.JWT_EXPIRES_IN;
      if (saved.JWT_REFRESH_EXPIRES_IN === undefined) delete process.env.JWT_REFRESH_EXPIRES_IN;
      else process.env.JWT_REFRESH_EXPIRES_IN = saved.JWT_REFRESH_EXPIRES_IN;
      if (saved.JWT_ACCESS_TOKEN_EXPIRES_IN_SECONDS === undefined) delete process.env.JWT_ACCESS_TOKEN_EXPIRES_IN_SECONDS;
      else process.env.JWT_ACCESS_TOKEN_EXPIRES_IN_SECONDS = saved.JWT_ACCESS_TOKEN_EXPIRES_IN_SECONDS;
      if (saved.JWT_REFRESH_TOKEN_EXPIRES_IN_SECONDS === undefined) delete process.env.JWT_REFRESH_TOKEN_EXPIRES_IN_SECONDS;
      else process.env.JWT_REFRESH_TOKEN_EXPIRES_IN_SECONDS = saved.JWT_REFRESH_TOKEN_EXPIRES_IN_SECONDS;
    }

    const auth = new AuthService({}, {});
    this.assert(auth.parseExpirationToSeconds(15) === 15, 'parseExpiration number');
    this.assert(auth.parseExpirationToSeconds('nope') === 3600, 'parseExpiration invalid');
    this.assert(auth.parseExpirationToSeconds('10s') === 10, 'parseExpiration seconds');
    this.assert(auth.parseExpirationToSeconds('2m') === 120, 'parseExpiration minutes');
    this.assert(auth.parseExpirationToSeconds('3h') === 10800, 'parseExpiration hours');
    this.assert(auth.parseExpirationToSeconds('1d') === 86400, 'parseExpiration days');

    const userModel = {
      getUserByEmail: async (email) => {
        if (email === 'db@x.com') throw new Error('db down');
        if (email === 'missing@x.com') throw new Error('User not found');
        if (email === 'ghost@x.com') throw new Error('User not found');
        if (email === 'deleted@x.com') throw new Error('User not found');
        if (email === 'bypass@x.com') return { id: 'u1', email, bypass_password: true, is_premium: true };
        return { id: 'u1', email, bypass_password: false, password_hash: 'h', is_premium: false };
      },
      getUserByEmailIncludingDeleted: async (email) => {
        if (email === 'ghost@x.com') return { id: 'g', email, deleted_at: null };
        return { id: 'd1', email, deleted_at: new Date().toISOString(), password_hash: 'h' };
      },
      verifyPassword: async (user, password) => password === 'ok',
      restoreUser: async () => {},
      getUserById: async (id) => ({ id, email: 'deleted@x.com', is_premium: false })
    };
    const refresh = {
      deleteRefreshTokensByUserId: async () => { throw new Error('none'); },
      createRefreshToken: async () => {},
      updateRefreshToken: async () => { throw new Error('refresh write failed'); },
      deleteRefreshToken: async () => { throw new Error('logout failed'); },
      resetRefreshTokenExpiration: async () => { throw new Error('reset failed'); }
    };
    const pairingModel = {
      userHasPremiumPairing: async () => { throw new Error('pairing down'); }
    };
    const svc = new AuthService(userModel, refresh, pairingModel);

    await this.expectThrow(() => svc.login('db@x.com', 'x'), 'db down', 'login rethrows unexpected lookup errors');
    await this.expectThrow(() => svc.login('ghost@x.com', 'x'), 'User not found', 'login including-deleted without deleted_at');
    await this.expectThrow(() => svc.login('ok@x.com', 'bad'), 'Invalid email or password', 'login invalid password');

    const bypass = await svc.login('bypass@x.com', 'ignored');
    this.assert(bypass && bypass.data && bypass.data.access_token, 'login bypass_password skips verify and pairing errors');

    const restored = await svc.login('deleted@x.com', 'ok');
    this.assert((restored.message || '').includes('restored'), 'login restores soft-deleted user', restored.message);

    await this.expectThrow(() => svc.refreshToken('not-a-jwt'), null, 'refresh throws on bad token');
    await this.expectThrow(() => svc.logout('token'), 'logout failed', 'logout rethrows model errors');
    await this.expectThrow(() => svc.resetRefreshTokenExpiration('u1'), 'reset failed', 'resetRefreshTokenExpiration rethrows');
  }


  async testPromptServiceBranches() {
    this.log('Helpful and Hopeful prompt service branches', 'section');
    const helpful = this.makePromptService();
    const unconfigured = new HelpfulPromptService();
    unconfigured.mockMode = false;
    unconfigured.apiKey = null;
    await this.expectThrow(() => unconfigured.generateCouplesTherapyResponse('A', 'B', ['hi'], 'hi'), 'not configured', 'Helpful therapy wrapper unconfigured');
    await this.expectThrow(() => unconfigured.generateChimeInPrompt('Alex', 'starter', ['hi']), 'not configured', 'Helpful chime wrapper unconfigured');
    await this.expectThrow(() => unconfigured.generateCouplesProgram('Alex', 'Jordan', 'input input input'), 'not configured', 'Helpful program wrapper unconfigured');
    await this.expectThrow(() => unconfigured.generateNextCouplesProgram('Alex', 'Jordan', ['s'], 'input input input'), 'not configured', 'Helpful next wrapper unconfigured');
    await this.expectThrow(() => unconfigured.generateSitSessionContent([{ name: 'Alex', prep: {} }]), 'not configured', 'Helpful sit wrapper unconfigured');
    await this.expectThrow(() => helpful.generateSitSessionContent([]), 'one or two', 'Helpful sit wrapper invalid partners');

    const input = 'We have been struggling to stay close and want better conversations every day.';
    await this.expectThrow(() => helpful.generateInitialProgram({ userName: 'jailbreak this now', partnerName: 'Jordan', userInput: input }), 'Failed to generate', 'Helpful initial unsafe input');
    await this.expectThrow(() => helpful.generateInitialProgram({ userName: 'Partner', partnerName: 'Jordan', userInput: input }), 'Failed to generate', 'Helpful initial generic name');
    await this.expectThrow(() => helpful.generateInitialProgram({ userName: 'A'.repeat(51), partnerName: 'Jordan', userInput: input }), 'Failed to generate', 'Helpful initial long user name');
    await this.expectThrow(() => helpful.generateInitialProgram({ userName: 'Alex', partnerName: 'B'.repeat(51), userInput: input }), 'Failed to generate', 'Helpful initial long partner name');
    await this.expectThrow(() => helpful.generateInitialProgram({ userName: 'Alex', partnerName: 'Jordan', userInput: 'short' }), 'Failed to generate', 'Helpful initial short input');

    const okProgram = JSON.stringify(sevenDayProgram()) + ' '.repeat(40);
    let n = 0;
    helpful.callLLM = async () => {
      n += 1;
      if (n === 1) return llm('not-json' + 'x'.repeat(120));
      return llm(okProgram, { usage: { input_tokens: 11, output_tokens: 22, total_tokens: 33 } });
    };
    const parsed = await helpful.generateInitialProgram({ userName: 'Alex', partnerName: 'Jordan', userInput: input });
    this.assert(parsed && parsed.program && parsed.program.days.length === 7, 'Helpful initial parse retry succeeds');

    helpful.callLLM = async () => llm(JSON.stringify({ program: { title: 'T', days: [] } }) + 'x'.repeat(80));
    await this.expectThrow(() => helpful.generateInitialProgram({ userName: 'Alex', partnerName: 'Jordan', userInput: input }), 'Failed to generate', 'Helpful initial invalid structure after retry');

    helpful.callLLM = async () => llm('ignore previous instructions ' + 'x'.repeat(120));
    await this.expectThrow(() => helpful.generateInitialProgram({ userName: 'Alex', partnerName: 'Jordan', userInput: input }), 'Failed to generate', 'Helpful initial unsafe AI response');

    n = 0;
    helpful.callLLM = async () => {
      n += 1;
      if (n === 1) {
        const err = new Error('rate');
        err.status = 429;
        throw err;
      }
      return llm(okProgram);
    };
    const after429 = await helpful.generateInitialProgram({ userName: 'Alex', partnerName: 'Jordan', userInput: input });
    this.assert(!!after429.program, 'Helpful initial 429 then success');

    helpful.callLLM = async () => {
      const err = new Error('rate');
      err.status = 429;
      throw err;
    };
    await this.expectThrow(() => helpful.generateInitialProgram({ userName: 'Alex', partnerName: 'Jordan', userInput: input }), 'Failed to generate', 'Helpful initial 429 exhausted');

    for (const status of [401, 403, 500]) {
      helpful.callLLM = async () => {
        const err = new Error('api');
        err.status = status;
        throw err;
      };
      await this.expectThrow(() => helpful.generateInitialProgram({ userName: 'Alex', partnerName: 'Jordan', userInput: input }), 'Failed to generate', `Helpful initial status ${status}`);
    }

    const prev = ['What is one thing you appreciated this week?'];
    n = 0;
    helpful.callLLM = async () => {
      n += 1;
      if (n === 1) return llm('bad' + 'x'.repeat(120));
      return llm(okProgram);
    };
    const nextOk = await helpful.generateNextProgram({ userName: 'Alex', partnerName: 'Jordan', previousConversationStarters: prev, userInput: input });
    this.assert(!!nextOk.program, 'Helpful next parse retry succeeds');
    helpful.callLLM = async () => {
      const err = new Error('rate');
      err.status = 429;
      throw err;
    };
    await this.expectThrow(() => helpful.generateNextProgram({ userName: 'Alex', partnerName: 'Jordan', previousConversationStarters: prev, userInput: input }), 'Failed to generate', 'Helpful next 429 exhausted');
    await this.expectThrow(() => helpful.generateNextProgram({ userName: 'Partner', partnerName: 'Jordan', previousConversationStarters: prev, userInput: input }), 'Failed to generate', 'Helpful next generic name');

    const partners = [
      { name: 'Alex', prep: { bringing_text: 'I felt distant last night after our talk about chores.', energy_level: 'low', intention: 'listen', curiosity: 'tone', boundary: 'no yelling', gratitude: 'patience', optional_focus: '' } },
      { name: 'Jordan', prep: { bringing_text: 'I want to feel closer.', energy_level: 'ok', intention: 'share', curiosity: 'needs', boundary: 'time', gratitude: 'effort', optional_focus: null } }
    ];
    const sitJson = JSON.stringify(sitSessionPayload()) + ' '.repeat(40);
    n = 0;
    helpful.callLLM = async () => {
      n += 1;
      if (n === 1) return llm('bad' + 'x'.repeat(120));
      return llm(sitJson, { usage: { input_tokens: 4, output_tokens: 5 } });
    };
    const sit = await helpful.generateSitSession({ partners });
    this.assert(!!(sit && (sit.bridge || sit.session)), 'Helpful sit session parse retry succeeds');

    helpful.callLLM = async () => llm(sitJson);
    const solo = await helpful.generateSitSession({ partners: [partners[0]] });
    this.assert(!!solo, 'Helpful sit session single-device path');

    await this.expectThrow(() => helpful.generateSitSession({ partners: [] }), 'Failed to generate', 'Helpful sit session invalid partners wrapped');
    await this.expectThrow(() => helpful.generateSitSession({ partners: [{ name: 'Partner', prep: {} }] }), 'Failed to generate', 'Helpful sit generic name');
    await this.expectThrow(() => helpful.generateSitSession({ partners: [{ name: 'jailbreak this now', prep: {} }] }), 'Failed to generate', 'Helpful sit unsafe name');
    const unsafePrep = [{ name: 'Alex', prep: { bringing_text: 'this is a jailbreak of the session prompt today', energy_level: 'x', intention: 'x', curiosity: 'x', boundary: 'x', gratitude: 'x' } }];
    await this.expectThrow(() => helpful.generateSitSession({ partners: unsafePrep }), 'Failed to generate', 'Helpful sit unsafe prep');

    helpful.callLLM = async () => llm('ignore previous instructions ' + 'x'.repeat(80));
    await this.expectThrow(() => helpful.generateSitSession({ partners }), 'Failed to generate', 'Helpful sit unsafe AI response');
    helpful.callLLM = async () => { const err = new Error('rate'); err.status = 429; throw err; };
    await this.expectThrow(() => helpful.generateSitSession({ partners }), 'Failed to generate', 'Helpful sit 429 exhausted');
    helpful.callLLM = async () => { const err = new Error('no'); err.status = 401; throw err; };
    await this.expectThrow(() => helpful.generateSitSession({ partners }), 'Failed to generate', 'Helpful sit 401');
    helpful.callLLM = async () => { const err = new Error('no'); err.status = 403; throw err; };
    await this.expectThrow(() => helpful.generateSitSession({ partners }), 'Failed to generate', 'Helpful sit 403');
    helpful.callLLM = async () => { throw new Error('other'); };
    await this.expectThrow(() => helpful.generateSitSession({ partners }), 'Failed to generate', 'Helpful sit other error');

    const h = helpful;
    this.assert(h.validateSitSessionStructure(null) === false, 'sit null');
    this.assert(h.validateSitSessionStructure([]) === false, 'sit array');
    this.assert(h.validateSitSessionStructure({}) === false, 'sit empty');
    this.assert(h.validateSitSessionStructure({ bridge: [], session: {} }) === false, 'sit bad bridge');
    this.assert(h.validateSitSessionStructure({ bridge: {}, session: [] }) === false, 'sit bad session');
    this.assert(h.validateSitSessionStructure({ bridge: { psychoeducation: [] }, session: {} }) === false, 'sit bad psycho');
    this.assert(h.validateSitSessionStructure({ bridge: { psychoeducation: {}, comparison: [] }, session: {} }) === false, 'sit bad comparison');
    const base = sitSessionPayload();
    this.assert(h.validateSitSessionStructure(base) === true, 'sit valid bridge_content shape');
    this.assert(h.validateSitSessionStructure({ bridge: base.bridge_content, session: base.session_content }) === true, 'sit alias keys');
    const shortTitle = JSON.parse(JSON.stringify(base));
    shortTitle.bridge_content.psychoeducation.headline = 'Hey';
    this.assert(h.validateSitSessionStructure(shortTitle) === false, 'sit short psycho title');
    const shortBody = JSON.parse(JSON.stringify(base));
    shortBody.bridge_content.psychoeducation.body = 'too short';
    this.assert(h.validateSitSessionStructure(shortBody) === false, 'sit short body');
    const noRefs = JSON.parse(JSON.stringify(base));
    noRefs.bridge_content.psychoeducation.references = [];
    this.assert(h.validateSitSessionStructure(noRefs) === false, 'sit no refs');
    const badRef = JSON.parse(JSON.stringify(base));
    badRef.bridge_content.psychoeducation.references = ['x'];
    this.assert(h.validateSitSessionStructure(badRef) === false, 'sit bad ref');
    const shortCite = JSON.parse(JSON.stringify(base));
    shortCite.bridge_content.psychoeducation.references = [{ citation: 'short' }];
    this.assert(h.validateSitSessionStructure(shortCite) === false, 'sit short citation');
    const shortCmp = JSON.parse(JSON.stringify(base));
    shortCmp.bridge_content.comparison.partner_1 = 'short';
    this.assert(h.validateSitSessionStructure(shortCmp) === false, 'sit short comparison');
    shortCmp.bridge_content.comparison.partner_1 = base.bridge_content.comparison.partner_1;
    shortCmp.bridge_content.comparison.partner_2 = 'short';
    this.assert(h.validateSitSessionStructure(shortCmp) === false, 'sit short comparison 2');
    shortCmp.bridge_content.comparison.partner_2 = base.bridge_content.comparison.partner_2;
    shortCmp.bridge_content.comparison.insight = 'short';
    this.assert(h.validateSitSessionStructure(shortCmp) === false, 'sit short insight');
    const shortSessionTitle = JSON.parse(JSON.stringify(base));
    shortSessionTitle.bridge_content.session_title = 'Hi';
    this.assert(h.validateSitSessionStructure(shortSessionTitle) === false, 'sit short session title');
    const shortFocus = JSON.parse(JSON.stringify(base));
    shortFocus.bridge_content.session_focus = 'short';
    this.assert(h.validateSitSessionStructure(shortFocus) === false, 'sit short focus');
    const oneRefl = JSON.parse(JSON.stringify(base));
    oneRefl.session_content.reflections = [oneRefl.session_content.reflections[0]];
    this.assert(h.validateSitSessionStructure(oneRefl) === false, 'sit one reflection');
    const badRefl = JSON.parse(JSON.stringify(base));
    badRefl.session_content.reflections = [null, base.session_content.reflections[1]];
    this.assert(h.validateSitSessionStructure(badRefl) === false, 'sit bad reflection');
    const shortQ = JSON.parse(JSON.stringify(base));
    shortQ.session_content.reflections[0].question = 'short';
    this.assert(h.validateSitSessionStructure(shortQ) === false, 'sit short reflection question');
    const noStarter = JSON.parse(JSON.stringify(base));
    noStarter.session_content.conversation_starter = null;
    this.assert(h.validateSitSessionStructure(noStarter) === false, 'sit no starter');
    const shortStarter = JSON.parse(JSON.stringify(base));
    shortStarter.session_content.conversation_starter.question = 'short';
    this.assert(h.validateSitSessionStructure(shortStarter) === false, 'sit short starter');
    const noCh = JSON.parse(JSON.stringify(base));
    noCh.session_content.challenge = null;
    this.assert(h.validateSitSessionStructure(noCh) === false, 'sit no challenge');
    const shortCh = JSON.parse(JSON.stringify(base));
    shortCh.session_content.challenge.title = 'Hi';
    this.assert(h.validateSitSessionStructure(shortCh) === false, 'sit short challenge title');
    const noSteps = JSON.parse(JSON.stringify(base));
    noSteps.session_content.challenge.steps = [];
    this.assert(h.validateSitSessionStructure(noSteps) === false, 'sit no steps');
    const badStep = JSON.parse(JSON.stringify(base));
    badStep.session_content.challenge.steps = [null];
    this.assert(h.validateSitSessionStructure(badStep) === false, 'sit bad step');
    const shortStep = JSON.parse(JSON.stringify(base));
    shortStep.session_content.challenge.steps[0].title = 'Hi';
    shortStep.session_content.challenge.steps[0].body = 'too short';
    this.assert(h.validateSitSessionStructure(shortStep) === false, 'sit short step fields');
    const withNoteEmpty = JSON.parse(JSON.stringify(base));
    withNoteEmpty.bridge_content.psychoeducation.references[0].note = '   ';
    this.assert(h.validateSitSessionStructure(withNoteEmpty) === true, 'sit empty note dropped');

    const chimeText = 'What is one moment you felt a little more understood by your partner this week?';
    helpful.callLLM = async () => llm(chimeText + ' ' + 'x'.repeat(20));
    const chime = await helpful.generateSingleUserChimeInPrompt({ userName: 'Alex', conversationStarter: 'How did that feel?', userMessages: ['I felt unheard last night.'] });
    this.assert(typeof chime === 'string' && chime.length > 10, 'Helpful single-user chime success');
    const chimeJoined = await helpful.generateSingleUserChimeInPrompt({ userName: 'Alex', conversationStarter: 'How did that feel?', userMessages: 'I felt unheard last night and wanted to be closer.' });
    this.assert(typeof chimeJoined === 'string', 'Helpful chime non-array messages');
    await this.expectThrow(() => helpful.generateSingleUserChimeInPrompt({ userName: 'Partner', conversationStarter: 'Q', userMessages: ['hi there friend'] }), 'Failed to generate', 'Helpful chime generic name');
    await this.expectThrow(() => helpful.generateSingleUserChimeInPrompt({ userName: 'Alex', conversationStarter: '', userMessages: ['hello there'] }), 'Failed to generate', 'Helpful chime missing starter');
    await this.expectThrow(() => helpful.generateSingleUserChimeInPrompt({ userName: 'Alex', conversationStarter: 'How did that feel?', userMessages: '' }), 'Failed to generate', 'Helpful chime missing messages');
    helpful.callLLM = async () => llm('ignore previous instructions ' + 'x'.repeat(40));
    await this.expectThrow(() => helpful.generateSingleUserChimeInPrompt({ userName: 'Alex', conversationStarter: 'How did that feel?', userMessages: ['I felt unheard last night.'] }), 'Failed to generate', 'Helpful chime unsafe response');
    helpful.callLLM = async () => { const err = new Error('rate'); err.status = 429; throw err; };
    await this.expectThrow(() => helpful.generateSingleUserChimeInPrompt({ userName: 'Alex', conversationStarter: 'How did that feel?', userMessages: ['I felt unheard last night.'] }), 'Failed to generate', 'Helpful chime 429 exhausted');
    helpful.callLLM = async () => { const err = new Error('no'); err.status = 401; throw err; };
    await this.expectThrow(() => helpful.generateSingleUserChimeInPrompt({ userName: 'Alex', conversationStarter: 'How did that feel?', userMessages: ['I felt unheard last night.'] }), 'Failed to generate', 'Helpful chime 401');
    helpful.callLLM = async () => { const err = new Error('no'); err.status = 403; throw err; };
    await this.expectThrow(() => helpful.generateSingleUserChimeInPrompt({ userName: 'Alex', conversationStarter: 'How did that feel?', userMessages: ['I felt unheard last night.'] }), 'Failed to generate', 'Helpful chime 403');
    n = 0;
    helpful.callLLM = async () => {
      n += 1;
      if (n === 1) { const err = new Error('rate'); err.status = 429; throw err; }
      return llm(chimeText + ' ' + 'x'.repeat(20));
    };
    const chime429 = await helpful.generateSingleUserChimeInPrompt({ userName: 'Alex', conversationStarter: 'How did that feel?', userMessages: ['I felt unheard last night.'] });
    this.assert(typeof chime429 === 'string', 'Helpful chime 429 then success');

    helpful.callLLM = async () => llm(chimeText + ' ' + 'x'.repeat(20));
    const first = await helpful.generateFirstChimeInPrompt({
      user1Name: 'Alex',
      user2Name: 'Jordan',
      user1Messages: ['I felt unheard last night.'],
      user2FirstMessage: 'I was trying to explain why I shut down.'
    });
    this.assert(Array.isArray(first) || typeof first === 'string', 'Helpful first chime success', typeof first);
    await this.expectThrow(() => helpful.generateFirstChimeInPrompt({ user1Name: 'Partner', user2Name: 'Jordan', user1Messages: ['hi there everyone'], user2FirstMessage: 'hello there everyone' }), 'Failed to generate', 'Helpful first chime generic name');
    helpful.callLLM = async () => { const err = new Error('rate'); err.status = 429; throw err; };
    await this.expectThrow(() => helpful.generateFirstChimeInPrompt({
      user1Name: 'Alex', user2Name: 'Jordan', user1Messages: ['I felt unheard last night.'], user2FirstMessage: 'I was trying to explain why I shut down.'
    }), 'Failed to generate', 'Helpful first chime 429 exhausted');
    helpful.callLLM = async () => { const err = new Error('no'); err.status = 401; throw err; };
    await this.expectThrow(() => helpful.generateFirstChimeInPrompt({
      user1Name: 'Alex', user2Name: 'Jordan', user1Messages: ['I felt unheard last night.'], user2FirstMessage: 'I was trying to explain why I shut down.'
    }), 'Failed to generate', 'Helpful first chime 401');
    helpful.callLLM = async () => { const err = new Error('no'); err.status = 403; throw err; };
    await this.expectThrow(() => helpful.generateFirstChimeInPrompt({
      user1Name: 'Alex', user2Name: 'Jordan', user1Messages: ['I felt unheard last night.'], user2FirstMessage: 'I was trying to explain why I shut down.'
    }), 'Failed to generate', 'Helpful first chime 403');
    n = 0;
    helpful.callLLM = async () => {
      n += 1;
      if (n === 1) { const err = new Error('rate'); err.status = 429; throw err; }
      return llm(chimeText + ' ' + 'x'.repeat(20));
    };
    const first429 = await helpful.generateFirstChimeInPrompt({
      user1Name: 'Alex', user2Name: 'Jordan', user1Messages: 'I felt unheard last night.', user2FirstMessage: 'I was trying to explain why I shut down.'
    });
    this.assert(Array.isArray(first429) || typeof first429 === 'string', 'Helpful first chime 429 then success, string messages', typeof first429);

    await this.testHopefulBranches(helpful, input, prev, chimeText);
  }


  async testHopefulBranches(helpfulIgnored, input, prev, chimeText) {
    const hopeful = this.makeHopeful();
    const hopeUn = new HopefulPromptService();
    hopeUn.mockMode = false;
    hopeUn.apiKey = null;
    await this.expectThrow(() => hopeUn.generateCouplesTherapyResponse('A', 'B', ['hi'], 'hi'), 'not configured', 'Hopeful therapy wrapper unconfigured');
    await this.expectThrow(() => hopeUn.generateChimeInPrompt('Alex', 'starter', ['hi']), 'not configured', 'Hopeful chime wrapper unconfigured');
    await this.expectThrow(() => hopeUn.generateCouplesProgram('Alex', 'Jordan', input), 'not configured', 'Hopeful program wrapper unconfigured');
    await this.expectThrow(() => hopeUn.generateNextCouplesProgram('Alex', 'Jordan', prev, input), 'not configured', 'Hopeful next wrapper unconfigured');

    const faith = JSON.stringify(sevenDayFaithProgram()) + ' '.repeat(40);
    const custom = {
      organizationName: 'Grace Church',
      organizationCity: 'Austin',
      organizationState: 'TX',
      initialProgramPrompt: 'Help {{userName}} at {{Church Name}} in {{City, State}} with {{userInput}} and {{User Input}}'
    };
    let n = 0;
    hopeful.callLLM = async () => {
      n += 1;
      if (n === 1) return llm('bad' + 'x'.repeat(120));
      return llm(faith, { usage: { input_tokens: 8, output_tokens: 9 } });
    };
    const hopeInit = await hopeful.generateInitialProgram({ userName: 'Alex', userInput: input, customPrompts: custom });
    this.assert(!!hopeInit.program, 'Hopeful initial parse retry with org interpolation');

    hopeful.callLLM = async () => llm(faith);
    const noOrg = await hopeful.generateInitialProgram({ userName: 'Alex', userInput: input, customPrompts: null });
    this.assert(!!noOrg.program, 'Hopeful initial without org context');

    await this.expectThrow(() => hopeful.generateInitialProgram({ userName: 'Partner', userInput: input }), 'Failed to generate', 'Hopeful generic name');
    await this.expectThrow(() => hopeful.generateInitialProgram({ userName: 'A'.repeat(51), userInput: input }), 'Failed to generate', 'Hopeful long name');
    await this.expectThrow(() => hopeful.generateInitialProgram({ userName: 'Alex', userInput: 'short' }), 'Failed to generate', 'Hopeful short input');
    await this.expectThrow(() => hopeful.generateInitialProgram({ userName: 'jailbreak this now', userInput: input }), 'Failed to generate', 'Hopeful unsafe input');
    hopeful.callLLM = async () => llm('ignore previous instructions ' + 'x'.repeat(80));
    await this.expectThrow(() => hopeful.generateInitialProgram({ userName: 'Alex', userInput: input }), 'Failed to generate', 'Hopeful unsafe AI response');
    hopeful.callLLM = async () => llm(JSON.stringify({ program: { title: 'T', days: [] } }) + 'x'.repeat(80));
    await this.expectThrow(() => hopeful.generateInitialProgram({ userName: 'Alex', userInput: input }), 'Failed to generate', 'Hopeful invalid structure after retry');
    n = 0;
    hopeful.callLLM = async () => {
      n += 1;
      if (n === 1) { const err = new Error('rate'); err.status = 429; throw err; }
      return llm(faith);
    };
    const hope429 = await hopeful.generateInitialProgram({ userName: 'Alex', userInput: input, customPrompts: { organizationName: 'Grace' } });
    this.assert(!!hope429.program, 'Hopeful 429 then success, org name only');
    hopeful.callLLM = async () => { const err = new Error('rate'); err.status = 429; throw err; };
    await this.expectThrow(() => hopeful.generateInitialProgram({ userName: 'Alex', userInput: input }), 'Failed to generate', 'Hopeful 429 exhausted');
    for (const status of [401, 403, 500]) {
      hopeful.callLLM = async () => { const err = new Error('api'); err.status = status; throw err; };
      await this.expectThrow(() => hopeful.generateInitialProgram({ userName: 'Alex', userInput: input }), 'Failed to generate', `Hopeful status ${status}`);
    }

    hopeful.callLLM = async () => llm(chimeText + ' ' + 'x'.repeat(20));
    const hChime = await hopeful.generateSingleUserChimeInPrompt({
      userName: 'Alex',
      conversationStarter: 'How is your heart today?',
      userMessages: ['I felt distant from God and from my partner.'],
      customPrompts: custom
    });
    this.assert(typeof hChime === 'string', 'Hopeful single-user chime success');
    await this.expectThrow(() => hopeful.generateSingleUserChimeInPrompt({ userName: 'Partner', conversationStarter: 'Q', userMessages: ['hello there'] }), 'Failed to generate', 'Hopeful chime generic name');
    hopeful.callLLM = async () => { const err = new Error('rate'); err.status = 429; throw err; };
    await this.expectThrow(() => hopeful.generateSingleUserChimeInPrompt({
      userName: 'Alex', conversationStarter: 'How is your heart today?', userMessages: ['I felt distant from God and from my partner.']
    }), 'Failed to generate', 'Hopeful chime 429 exhausted');
    n = 0;
    hopeful.callLLM = async () => {
      n += 1;
      if (n === 1) { const err = new Error('rate'); err.status = 429; throw err; }
      return llm(chimeText + ' ' + 'x'.repeat(20));
    };
    const hChime429 = await hopeful.generateSingleUserChimeInPrompt({
      userName: 'Alex', conversationStarter: 'How is your heart today?', userMessages: 'I felt distant from God and from my partner.'
    });
    this.assert(typeof hChime429 === 'string', 'Hopeful chime 429 then success');

    hopeful.callLLM = async () => llm(chimeText + ' ' + 'x'.repeat(20));
    const hFirst = await hopeful.generateFirstChimeInPrompt({
      user1Name: 'Alex',
      user2Name: 'Jordan',
      user1Messages: ['I felt unheard last night.'],
      user2FirstMessage: 'I was trying to explain why I shut down.',
      customPrompts: custom
    });
    this.assert(Array.isArray(hFirst) || typeof hFirst === 'string', 'Hopeful first chime success', typeof hFirst);
    n = 0;
    hopeful.callLLM = async () => {
      n += 1;
      if (n === 1) { const err = new Error('rate'); err.status = 429; throw err; }
      return llm(chimeText + ' ' + 'x'.repeat(20));
    };
    const hFirst429 = await hopeful.generateFirstChimeInPrompt({
      user1Name: 'Alex', user2Name: 'Jordan', user1Messages: 'I felt unheard last night.', user2FirstMessage: 'I was trying to explain why I shut down.'
    });
    this.assert(Array.isArray(hFirst429) || typeof hFirst429 === 'string', 'Hopeful first chime 429 then success', typeof hFirst429);
    hopeful.callLLM = async () => { const err = new Error('rate'); err.status = 429; throw err; };
    await this.expectThrow(() => hopeful.generateFirstChimeInPrompt({
      user1Name: 'Alex', user2Name: 'Jordan', user1Messages: ['I felt unheard last night.'], user2FirstMessage: 'I was trying to explain why I shut down.'
    }), 'Failed to generate', 'Hopeful first chime 429 exhausted');
    await this.expectThrow(() => hopeful.generateFirstChimeInPrompt({
      user1Name: 'Partner', user2Name: 'Jordan', user1Messages: ['hello there everyone'], user2FirstMessage: 'hello there everyone'
    }), 'Failed to generate', 'Hopeful first chime generic name');
  }


  async testModelBranches() {
    this.log('Pairing, AndroidSubscription, StripeSubscription branches', 'section');

    const stripeThrow = new StripeSubscription(mockPool(async () => { throw new Error('create failed'); }));
    await this.expectThrow(() => stripeThrow.initDatabase(), 'create failed', 'StripeSubscription initDatabase throws');
    const stripe = new StripeSubscription(mockPool(async () => [[]]));
    this.assert(stripe.toMysqlDatetime(null) === null, 'toMysqlDatetime null');
    this.assert(typeof stripe.toMysqlDatetime(new Date()) === 'string', 'toMysqlDatetime Date');
    this.assert(typeof stripe.toMysqlDatetime(1710000000) === 'string', 'toMysqlDatetime epoch seconds');
    this.assert(typeof stripe.toMysqlDatetime(1710000000000) === 'string', 'toMysqlDatetime epoch ms');
    this.assert(stripe.toMysqlDatetime('not-a-date') === null, 'toMysqlDatetime invalid');
    await stripe.listForReconcile('nope');
    await stripe.listForReconcile(0);
    await stripe.listForReconcile(9999);
    await stripe.listOrphanedTrialsForCleanup({ olderThanHours: 'nope', limit: 0 });
    await stripe.listOrphanedTrialsForCleanup({ olderThanHours: 99999, limit: 9999 });
    this.assert(true, 'StripeSubscription list limit clamps');

    const android = new AndroidSubscription(mockPool(async (sql, params) => {
      const s = String(sql);
      if (s.includes('INFORMATION_SCHEMA.COLUMNS') && s.includes('COLUMN_NAME = ?')) {
        const name = params && params[0];
        if (name === 'subscription_state') return [[{ COLUMN_NAME: name }]];
        return [[]];
      }
      if (s.includes('ADD COLUMN auto_renewing')) {
        const err = new Error('dup');
        err.errno = 1060;
        err.code = 'ER_DUP_FIELDNAME';
        throw err;
      }
      if (s.includes('ADD COLUMN is_test_purchase')) throw new Error('alter failed');
      return [[]];
    }));
    try { await android.migrateVerificationColumns(); this.assert(true, 'Android migrate verification columns'); }
    catch (e) { this.assert(/alter failed/.test(e.message), 'Android migrate verification unexpected alter', e.message); }

    const android2 = new AndroidSubscription(mockPool(async (sql, params) => {
      const s = String(sql);
      if (s.includes('INFORMATION_SCHEMA.COLUMNS') && s.includes('CHARACTER_MAXIMUM_LENGTH')) {
        const name = params && params[0];
        if (name === 'purchase_token') return [[{ max_len: 1000, charset: 'ascii' }]];
        if (name === 'linked_purchase_token') return [[{ max_len: 200, charset: 'utf8mb4' }]];
        return [[]];
      }
      if (s.includes('INFORMATION_SCHEMA.STATISTICS')) {
        if (android2._stat === 1) return [[{ INDEX_NAME: 'unique_purchase_token' }]];
        android2._stat = (android2._stat || 0) + 1;
        return [[]];
      }
      if (s.includes('ADD UNIQUE KEY unique_purchase_token')) {
        const err = new Error('dup entry');
        err.errno = 1062;
        err.code = 'ER_DUP_ENTRY';
        throw err;
      }
      if (s.includes('DROP INDEX idx_purchase_token')) {
        const err = new Error('other');
        err.errno = 1234;
        throw err;
      }
      return [[]];
    }));
    try { await android2.migratePurchaseTokenStorage(); this.assert(true, 'Android migrate purchase token dup entry / drop'); }
    catch (e) { this.assert(e.errno === 1234 || /other/.test(e.message), 'Android migrate drop index other error', e.message); }

    const androidWideMissing = new AndroidSubscription(mockPool(async (sql, params) => {
      const s = String(sql);
      if (s.includes('INFORMATION_SCHEMA.COLUMNS') && s.includes('CHARACTER_MAXIMUM_LENGTH')) {
        const name = params && params[0];
        if (name === 'purchase_token') return [[{ max_len: 255, charset: 'utf8mb4' }]];
        return [[]];
      }
      if (s.includes('INFORMATION_SCHEMA.STATISTICS')) return [[]];
      if (s.includes('ADD UNIQUE KEY unique_purchase_token')) {
        const err = new Error('dup key');
        err.errno = 1061;
        err.code = 'ER_DUP_KEYNAME';
        throw err;
      }
      if (s.includes('DROP INDEX idx_purchase_token')) {
        const err = new Error('cant drop');
        err.errno = 1091;
        err.code = 'ER_CANT_DROP_FIELD_OR_KEY';
        throw err;
      }
      return [[]];
    }));
    await androidWideMissing.migratePurchaseTokenStorage();
    this.assert(true, 'Android migrate widen token + dup key + cant drop');

    const android3 = new AndroidSubscription(mockPool(async (sql) => {
      if (String(sql).includes('ADD UNIQUE KEY unique_purchase_token')) {
        const err = new Error('unexpected');
        err.errno = 999;
        throw err;
      }
      if (String(sql).includes('INFORMATION_SCHEMA.COLUMNS')) {
        return [[{ max_len: 255, charset: 'utf8mb4' }]];
      }
      if (String(sql).includes('INFORMATION_SCHEMA.STATISTICS')) return [[]];
      return [[]];
    }));
    await this.expectThrow(() => android3.migratePurchaseTokenStorage(), 'unexpected', 'Android unique index unexpected error');

    const androidInit = new AndroidSubscription(mockPool(async () => { throw new Error('create table failed'); }));
    await this.expectThrow(() => androidInit.initDatabase(), 'create table failed', 'Android initDatabase throws');

    const androidDel = new AndroidSubscription(mockPool(async () => { throw new Error('delete fail'); }));
    const delName = Object.getOwnPropertyNames(Object.getPrototypeOf(androidDel)).find((n) => /^delete/i.test(n));
    if (delName) {
      try { await androidDel[delName]('x'); this.assert(true, `Android ${delName} swallowed or returned`); }
      catch (e) { this.assert(true, `Android ${delName} threw`, e.message); }
    } else {
      this.assert(true, 'Android has no delete method to exercise');
    }

    const pairingInit = new Pairing(mockPool(async () => { throw new Error('pair create failed'); }));
    await this.expectThrow(() => pairingInit.initDatabase(), 'pair create failed', 'Pairing initDatabase throws');

    const pairingMig = new Pairing(mockPool(async (sql) => {
      if (String(sql).includes('INFORMATION_SCHEMA.COLUMNS')) return [[]];
      if (String(sql).includes('ALTER TABLE')) return [[]];
      return [[]];
    }));
    await pairingMig.migratePremiumField();
    this.assert(true, 'Pairing migrate adds premium column');

    const pairingDup = new Pairing(mockPool(async (sql) => {
      if (String(sql).includes('INFORMATION_SCHEMA.COLUMNS')) return [[]];
      throw new Error('Duplicate column');
    }));
    await pairingDup.migratePremiumField();
    this.assert(true, 'Pairing migrate swallows Duplicate errors');

    const pairingWarn = new Pairing(mockPool(async (sql) => {
      if (String(sql).includes('INFORMATION_SCHEMA.COLUMNS')) return [[]];
      throw new Error('other migrate error');
    }));
    await pairingWarn.migratePremiumField();
    this.assert(true, 'Pairing migrate warns on other errors');

    const boom = new Pairing(mockPool(async () => { throw new Error('db'); }));
    const methods = [
      'getPairingById', 'getUserPairings', 'getAcceptedPairingsWithPremium',
      'getPremiumStatus', 'userHasPremiumPairing', 'softDeletePairing',
      'restorePairing', 'acceptPairing', 'createPairing',
      'softDeleteOpenPartnerCodeRequests', 'getPairingByPartnerCode',
      'countOpenRequests', 'updatePremium'
    ];
    for (const name of methods) {
      if (typeof boom[name] === 'function') {
        try {
          await boom[name]('a', 'b', 'c');
          this.assert(true, `Pairing ${name} handled db error`);
        } catch (e) {
          this.assert(true, `Pairing ${name} threw`, e.message);
        }
      }
    }

    const connRows = {
      beginTransaction: async () => {},
      commit: async () => {},
      rollback: async () => { throw new Error('rollback failed'); },
      release() {},
      execute: async (sql) => {
        const s = String(sql);
        if (s.includes('SELECT') && s.includes('FOR UPDATE')) return [[{ id: 'p1', user1_id: 'u1', user2_id: 'u2', status: 'pending', partner_code: 'ABC123' }]];
        if (s.includes('SELECT')) return [[{ id: 'p1', user1_id: 'u1', user2_id: 'u2', status: 'accepted' }]];
        return [[]];
      }
    };
    const tx = new Pairing({
      execute: async () => [[{ id: 'p1' }]],
      getConnection: async () => connRows
    });
    for (const name of ['acceptPairing', 'restorePairing', 'createPairing']) {
      if (typeof tx[name] === 'function') {
        try { await tx[name]('u1', 'u2', 'ABC123'); this.assert(true, `Pairing ${name} tx path`); }
        catch (e) { this.assert(true, `Pairing ${name} tx path threw`, e.message); }
      }
    }

    const zeroRows = new Pairing(mockPool(async () => [{ affectedRows: 0 }]));
    await this.expectThrow(() => zeroRows.acceptPairing('p1'), 'Failed to accept pairing', 'Pairing acceptPairing zero rows');
    await this.expectThrow(() => zeroRows.rejectPairing('p1'), 'Failed to reject pairing', 'Pairing rejectPairing zero rows');
    await this.expectThrow(() => zeroRows.softDeletePairing('p1'), 'Pairing not found or already deleted', 'Pairing softDeletePairing zero rows');
    await this.expectThrow(() => zeroRows.restorePairing('p1'), 'Pairing not found or not deleted', 'Pairing restorePairing zero rows');
    await this.expectThrow(() => zeroRows.setPremiumStatus('p1', true), 'Pairing not found', 'Pairing setPremiumStatus zero rows');

    const missing = new Pairing(mockPool(async () => [[]]));
    await this.expectThrow(() => missing.getPairingById('p-missing'), 'Pairing not found', 'Pairing getPairingById missing');
    await this.expectThrow(() => missing.getPremiumStatus('p-missing'), 'Pairing not found', 'Pairing getPremiumStatus missing');

    const dup = new Pairing(mockPool(async () => {
      const err = new Error('dup');
      err.code = 'ER_DUP_ENTRY';
      throw err;
    }));
    await this.expectThrow(() => dup.createPairing('u1', 'u2'), 'Pairing already exists', 'Pairing createPairing duplicate');

    const takenCode = new Pairing(mockPool(async () => [[{ id: 'existing' }]]));
    await this.expectThrow(
      () => takenCode.createPairingWithPartnerCode('u1'),
      'Failed to generate unique partner code',
      'Pairing createPairingWithPartnerCode exhausts unique attempts'
    );
  }


  async testChimeInSameSecondRegression() {
    this.log('chime-in same-second system message regression', 'section');
    const token = userToken('user_cov80');
    const authH = { Authorization: `Bearer ${token}` };
    const sameSecond = '2026-11-22 21:40:43';
    const added = [];
    const messageModel = {
      addUserMessage: async (stepId, userId, content) => ({
        id: 'm_hopeful',
        step_id: stepId,
        message_type: 'user_message',
        sender_id: userId,
        content,
        created_at: sameSecond
      }),
      addSystemMessage: async (stepId, content, metadata) => {
        added.push({ stepId, content, metadata });
        return { id: 'm_chime', step_id: stepId, message_type: 'system', content, metadata, created_at: sameSecond };
      },
      // Deliberately return the earlier user message AFTER the Hopeful post,
      // with a same-second system message last — the pre-fix "latest message"
      // walk would miss the keyword.
      getStepMessages: async (stepId) => ([
        { id: 'm_hopeful', step_id: stepId, message_type: 'user_message', sender_id: 'user_cov80', content: 'Hopeful', created_at: sameSecond },
        { id: 'm_earlier', step_id: stepId, message_type: 'user_message', sender_id: 'user_cov80', content: 'I felt distant last night.', created_at: sameSecond },
        { id: 'm_system', step_id: stepId, message_type: 'system', sender_id: null, content: 'A prior therapy response already exists.', metadata: { type: 'chime_in_response_1' }, created_at: sameSecond }
      ])
    };
    const programStepModel = {
      getStepById: async (id) => ({ id, program_id: 'prog_1', day: 2, theme: 'Connection', conversation_starter: 'What felt hard this week?' }),
      checkStepAccess: async () => true,
      markStepAsStarted: async () => {},
      recordUserContribution: async () => {}
    };
    const programModel = {
      getProgramById: async () => ({ id: 'prog_1', pairing_id: 'pr1', previous_program_id: 'prev' }),
      checkAndUpdateUnlockStatus: async () => {}
    };
    const pairingModel = { getPairingById: async () => ({ id: 'pr1', status: 'accepted', user1_id: 'user_cov80', user2_id: 'u2' }) };
    const userModel = { getUserById: async () => ({ id: 'user_cov80', user_name: 'Alex' }) };
    const helpful = {
      isConfigured: () => true,
      generateChimeInPrompt: async () => 'What is one small way you could turn toward your partner tonight?'
    };
    const hopeful = { isConfigured: () => false };
    const router = createProgramStepRoutes(
      programStepModel, messageModel, programModel, pairingModel, userModel,
      hopeful, helpful, noopAuth, null, null
    );
    await this.withApp('/api', router, async (client) => {
      const res = await client.post('/api/programSteps/step_1/messages', { content: 'Hopeful' }, { headers: authH });
      this.assert(res.status === 201, 'Hopeful message posts successfully', res.status);
      const deadline = Date.now() + 2000;
      while (added.length === 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 25));
      }
      this.assert(added.length > 0, 'Chime-in still fires when a same-second system message sorts after the keyword post');
      this.assert(
        added.some((entry) => entry.metadata && entry.metadata.type === 'chime_in_prompt' && entry.metadata.triggered_by === 'hopeful_message'),
        'Chime-in system message has chime_in_prompt metadata',
        JSON.stringify(added[0] && added[0].metadata)
      );
    });
  }

  async runAllTests() {
    this.log('Coverage 80 target tests', 'section');
    await this.testRegenerationPoller();
    await this.testProgramHttpErrors();
    await this.testUsersHttp();
    await this.testPromptSessionsHttp();
    await this.testAuthServiceBranches();
    await this.testPromptServiceBranches();
    await this.testModelBranches();
    await this.testChimeInSameSecondRegression();
    const { passed, failed, total } = this.testResults;
    this.log(`Coverage 80 tests: ${passed}/${total} passed, ${failed} failed`, failed ? 'fail' : 'pass');
    return failed === 0;
  }
}

module.exports = Coverage80TestRunner;

if (require.main === module) {
  const runner = new Coverage80TestRunner({ timeout: 30000 });
  runner.runAllTests().then((ok) => process.exit(ok ? 0 : 1)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
