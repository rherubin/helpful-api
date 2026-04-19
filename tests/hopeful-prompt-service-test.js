/**
 * HopefulPromptService Test Suite
 *
 * Mirror of tests/helpful-prompt-service-test.js but for the faith-based
 * 7-day reflection prompt service used when a user has an org_code.
 *
 * Coverage:
 *   - Service instantiation and method signatures
 *   - generateCouplesProgram returns a 7-day faith-based program
 *     (reflection + bible_verse fields, not conversation_starter/science)
 *   - Initial-program prompt contains faith terminology (pastor/scripture/etc.)
 *     and does NOT contain Gottman / Emotionally Focused Therapy
 *   - generateNextCouplesProgram returns a 7-day program
 *   - generateChimeInPrompt (single-user) frames the LLM as faith-based
 *   - generateCouplesTherapyResponse returns an array of 1-3 non-empty strings
 *   - Input validation rejects generic placeholder names
 *
 * Org-code customPrompts coverage (dedicated block):
 *   - customPrompts.initialProgramPrompt is embedded in the default initial template
 *   - customPrompts.initialProgramPrompt still lands via generateNextCouplesProgram
 *     (the delegating path)
 *   - customPrompts.therapyResponsePrompt replaces the default couples-therapy
 *     framing for generateCouplesTherapyResponse
 *   - customPrompts.organizationName / organizationCity / organizationState are
 *     woven into the default initial-program and single-user chime-in prompts
 *   - When customPrompts is null, the default pastor framing / 'their local
 *     church' / 'their city' fallbacks are present
 *   - Partial identity (only organizationName) is tolerated without producing
 *     a malformed ", " city/state fragment
 *
 * Deliberate non-goals (documented gaps in the service itself, not missed
 * test coverage):
 *   - customPrompts.nextProgramPrompt: routes plumb it through but
 *     HopefulPromptService does not consume it today.
 *   - generateNextCouplesProgram drops previousConversationStarters and
 *     partnerName before delegating to generateInitialProgram — so we do not
 *     assert that previous starters appear in the prompt.
 *   - generateCouplesTherapyResponse's default prompt is actually
 *     EFT/Gottman-framed (shared with HelpfulPromptService). Only the
 *     customPrompts.therapyResponsePrompt override path produces faith-framed
 *     output; the default path does not. We document this via the override
 *     test below.
 *
 * Run with: node tests/hopeful-prompt-service-test.js
 *
 * All LLM calls are mocked via `global.fetch`, so this test does not require
 * a live OPENAI_API_KEY and NEVER hits the real API.
 */

// Set a dummy OPENAI_API_KEY BEFORE requiring the service, since
// BasePromptService captures process.env.OPENAI_API_KEY in its constructor.
// This satisfies the key length validation (20-200 chars, no whitespace)
// without hitting the API.
if (!process.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = 'sk-test-hopeful-prompt-service-mock-key-000';

const HopefulPromptService = require('../services/HopefulPromptService');

// Token-safety tripwire: any test that forgets to install its local mock
// will hit this guard instead of silently calling the real OpenAI API.
// The counter on `guard.__realCallAttempts` is checked at end-of-suite so a
// future regression surfaces as a hard failure, not a surprise bill.
function installFetchGuard() {
  const guard = async () => {
    guard.__realCallAttempts = (guard.__realCallAttempts || 0) + 1;
    throw new Error('global.fetch called without test mock installed - would hit real OpenAI API');
  };
  guard.__realCallAttempts = 0;
  guard.__isTokenSafetyGuard = true;
  global.fetch = guard;
  return guard;
}
const FETCH_GUARD = installFetchGuard();

class HopefulPromptServiceTestRunner {
  constructor() {
    this.testResults = { passed: 0, failed: 0, total: 0 };
    this.lastCapturedPrompt = null;
    this.lastCapturedSystemPrompt = null;
    this.lastCapturedBody = null;
    this.lastCapturedUrl = null;
    this.capturedUrls = [];
  }

  log(message, type = 'info') {
    const timestamp = new Date().toISOString();
    const prefix = {
      info: '📝', pass: '✅', fail: '❌', warn: '⚠️', section: '🙏'
    }[type] || '📝';
    console.log(`${prefix} [${timestamp}] ${message}`);
  }

  assert(condition, testName, detail) {
    this.testResults.total++;
    if (condition) {
      this.testResults.passed++;
      this.log(`${testName} - PASSED${detail ? ' — ' + detail : ''}`, 'pass');
    } else {
      this.testResults.failed++;
      this.log(`${testName} - FAILED${detail ? ' — ' + detail : ''}`, 'fail');
    }
  }

  // Build a 7-day faith-based mock program response with reflection +
  // bible_verse fields (and no conversation_starter / science_behind_it),
  // matching the Hopeful output shape the service expects back from the LLM.
  buildMockFaithProgram(userName = 'Ruth') {
    return {
      program: {
        title: `7-Day Reflection Program for ${userName}`,
        overview: 'A seven-day faith-rooted journey to draw closer to God and grow in Christian community.',
        days: Array.from({ length: 7 }, (_, i) => ({
          day: i + 1,
          theme: `Day ${i + 1} theme: scripture and spiritual reflection in faith and church community`,
          reflection: `Reflect prayerfully on how God is drawing you closer to Him today. How does your church community and scripture shape the way you love and serve others on day ${i + 1}?`,
          bible_verse: '"Above all, love each other deeply, because love covers over a multitude of sins." — 1 Peter 4:8'
        }))
      }
    };
  }

  // Build a mock OpenAI fetch response envelope.
  _buildMockHttpResponse(textContent, parsedBody = {}) {
    return {
      ok: true,
      async json() {
        return {
          id: 'chatcmpl-hopeful-test',
          model: parsedBody.model || 'gpt-5.4',
          choices: [
            { message: { content: textContent }, finish_reason: 'stop' }
          ],
          usage: { prompt_tokens: 400, completion_tokens: 900, total_tokens: 1300 }
        };
      }
    };
  }

  // Install a mock fetch that captures prompt text so we can assert on it.
  // Callers MUST restore to the returned originalFetch in a `finally` so the
  // token-safety guard is re-armed between tests. Every captured URL is
  // tracked so end-of-suite can verify all calls went through mocks.
  _installMockFetch(textContent) {
    const originalFetch = global.fetch;
    global.fetch = async (url, options) => {
      this.lastCapturedUrl = url;
      this.capturedUrls.push(url);
      const body = options && options.body ? JSON.parse(options.body) : {};
      this.lastCapturedBody = body;

      const userMsg = (body.messages || []).find(m => m.role === 'user');
      const sysMsg = (body.messages || []).find(m => m.role === 'system');
      this.lastCapturedPrompt = userMsg?.content || '';
      this.lastCapturedSystemPrompt = sysMsg?.content || '';

      return this._buildMockHttpResponse(textContent, body);
    };
    return originalFetch;
  }

  // ── Tests ────────────────────────────────────────────────────────────────

  testInstantiation() {
    this.log('Testing HopefulPromptService instantiation & method signatures', 'section');
    const service = new HopefulPromptService();

    // Force mockMode off so every callLLM() goes through _callOpenAI ->
    // global.fetch and hits our local mock. This keeps the unit test
    // independent of the TEST_MOCK_LLM env var (item 5 of "Token safety"
    // in the plan).
    service.mockMode = false;

    this.assert(!!service, 'Service instantiates');
    this.assert(typeof service.generateCouplesProgram === 'function', 'generateCouplesProgram exists');
    this.assert(typeof service.generateNextCouplesProgram === 'function', 'generateNextCouplesProgram exists');
    this.assert(typeof service.generateCouplesTherapyResponse === 'function', 'generateCouplesTherapyResponse exists');
    this.assert(typeof service.generateChimeInPrompt === 'function', 'generateChimeInPrompt exists');
    this.assert(typeof service.generateInitialProgram === 'function', 'generateInitialProgram exists');
    this.assert(typeof service.generateNextProgram === 'function', 'generateNextProgram exists');
    this.assert(typeof service.generateSingleUserChimeInPrompt === 'function', 'generateSingleUserChimeInPrompt exists');
    this.assert(typeof service.generateFirstChimeInPrompt === 'function', 'generateFirstChimeInPrompt exists');
    this.assert(typeof service.getMetrics === 'function', 'getMetrics (inherited from Base) exists');
    this.assert(typeof service.model === 'string' && service.model.length > 0, 'model is a non-empty string', `model = ${service.model}`);

    return service;
  }

  async testInitialProgramIs7DayFaithFormat(service) {
    this.log('Testing generateCouplesProgram returns a 7-day faith-based program', 'section');
    const originalFetch = global.fetch;
    this._installMockFetch(JSON.stringify(this.buildMockFaithProgram('Ruth')));

    try {
      const result = await service.generateCouplesProgram(
        'Ruth',
        'Boaz',
        'We want to deepen our walk of faith together and grow spiritually as a couple.'
      );

      this.assert(!!result && typeof result === 'object', 'Returns an object');
      this.assert(!!result.program, 'Has a program field');
      this.assert(Array.isArray(result.program.days), 'program.days is an array');
      this.assert(result.program.days.length === 7, 'program has exactly 7 days', `got ${result.program.days.length}`);

      const day1 = result.program.days[0];
      this.assert(typeof day1.reflection === 'string' && day1.reflection.length > 0, 'day 1 has reflection');
      this.assert(typeof day1.bible_verse === 'string' && day1.bible_verse.length > 0, 'day 1 has bible_verse');
    } catch (error) {
      this.assert(false, 'generateCouplesProgram call', `Error: ${error.message}`);
    } finally {
      global.fetch = originalFetch;
    }
  }

  async testInitialPromptIsFaithBased(service) {
    this.log('Testing that the initial-program prompt text is faith-based (contains pastor/scripture/etc.)', 'section');
    const originalFetch = global.fetch;
    this._installMockFetch(JSON.stringify(this.buildMockFaithProgram()));

    try {
      await service.generateCouplesProgram('Ruth', 'Boaz', 'We want to grow spiritually together.');

      const prompt = (this.lastCapturedPrompt || '').toLowerCase();
      const system = (this.lastCapturedSystemPrompt || '').toLowerCase();

      // The default Hopeful initial-program prompt MUST contain at least one
      // recognizable faith-based term so users understand which model voice
      // the LLM will adopt.
      const faithTerms = ['pastor', 'scripture', 'bible', 'christian values', 'faith', 'christian', 'spiritual'];
      const foundFaithTerms = faithTerms.filter(term => prompt.includes(term) || system.includes(term));
      this.assert(
        foundFaithTerms.length > 0,
        'Prompt contains at least one faith-based term',
        `found: ${foundFaithTerms.join(', ') || 'none'}`
      );

      // And it must NOT contain the couples-therapy EFT/Gottman framing
      // that Helpful uses — otherwise the two services would be
      // indistinguishable at the prompt level.
      this.assert(
        !/gottman/.test(prompt),
        'Prompt does not mention Gottman (that framing belongs to Helpful)'
      );
      this.assert(
        !/emotionally focused therapy/.test(prompt),
        'Prompt does not mention Emotionally Focused Therapy (that framing belongs to Helpful)'
      );

      // And it must ask for a 7-day program (not 14).
      this.assert(
        /7-day/.test(this.lastCapturedPrompt || ''),
        'Prompt explicitly asks for a 7-day program'
      );
    } catch (error) {
      this.assert(false, 'Prompt inspection', `Error: ${error.message}`);
    } finally {
      global.fetch = originalFetch;
    }
  }

  async testNextProgramReturns7Days(service) {
    this.log('Testing generateNextCouplesProgram returns a 7-day faith-based program', 'section');
    // NOTE: HopefulPromptService.generateNextProgram delegates to
    // generateInitialProgram and drops the previousConversationStarters +
    // partnerName args. That is a documented gap in the service today — we
    // therefore do NOT assert that previous starters appear in the prompt.
    const originalFetch = global.fetch;
    this._installMockFetch(JSON.stringify(this.buildMockFaithProgram('Ruth')));

    try {
      const result = await service.generateNextCouplesProgram(
        'Ruth',
        'Boaz',
        ['Reflect on a moment this week when you felt closest to God.'],
        'We want to go deeper on how we navigate conflict spiritually.'
      );

      this.assert(!!result && !!result.program, 'Returns a program');
      this.assert(result.program.days.length === 7, 'Next program is also 7 days', `got ${result.program.days.length}`);
    } catch (error) {
      this.assert(false, 'generateNextCouplesProgram call', `Error: ${error.message}`);
    } finally {
      global.fetch = originalFetch;
    }
  }

  async testSingleUserChimeInIsFaithFramed(service) {
    this.log('Testing generateChimeInPrompt returns a string with faith framing', 'section');
    const originalFetch = global.fetch;

    const mockReply = 'How might this moment be an invitation for you to lean more deeply on God in your marriage?';
    this._installMockFetch(mockReply);

    try {
      const reply = await service.generateChimeInPrompt(
        'Ruth',
        'When did you most feel God at work in your marriage this week?',
        ['I felt a quiet sense of gratitude during our prayer time together.']
      );

      this.assert(typeof reply === 'string' && reply.length > 0, 'Returns a non-empty string');

      const prompt = (this.lastCapturedPrompt || '').toLowerCase();
      const system = (this.lastCapturedSystemPrompt || '').toLowerCase();
      const faithCues = ['faith-based', 'spiritual wellness', 'christian', 'biblical', 'pastor'];
      const foundCues = faithCues.filter(cue => prompt.includes(cue) || system.includes(cue));
      this.assert(
        foundCues.length > 0,
        'Prompt frames the LLM as a faith-based guide',
        `found: ${foundCues.join(', ') || 'none'}`
      );
    } catch (error) {
      this.assert(false, 'generateChimeInPrompt call', `Error: ${error.message}`);
    } finally {
      global.fetch = originalFetch;
    }
  }

  async testCouplesTherapyResponseReturnsArray(service) {
    this.log('Testing generateCouplesTherapyResponse returns an array of 1-3 messages', 'section');
    // NOTE: the Hopeful generateCouplesTherapyResponse default prompt is
    // actually EFT/Gottman-framed today (shared wording with Helpful), not
    // faith-framed. The customPrompts.therapyResponsePrompt override path is
    // what produces a faith-framed couples response; that override is
    // covered in the customPrompts block below. Here we only assert shape.
    const originalFetch = global.fetch;

    const mockReply =
      '1. Ruth, it sounds like your prayer time together was deeply meaningful.\n\n' +
      '2. Boaz, thank you for sharing how that moment felt for you.\n\n' +
      '3. What would it look like for each of you to invite God into another area of your relationship this week?';
    this._installMockFetch(mockReply);

    try {
      const messages = await service.generateCouplesTherapyResponse(
        'Ruth',
        'Boaz',
        ['I felt a quiet gratitude in our prayer time.'],
        'I noticed that too — it felt like a turning point for us.'
      );

      this.assert(Array.isArray(messages), 'Returns an array');
      this.assert(messages.length >= 1 && messages.length <= 3, 'Array has 1-3 messages', `length = ${messages.length}`);
      this.assert(
        messages.every(m => typeof m === 'string' && m.length > 0),
        'All array entries are non-empty strings'
      );
    } catch (error) {
      this.assert(false, 'generateCouplesTherapyResponse call', `Error: ${error.message}`);
    } finally {
      global.fetch = originalFetch;
    }
  }

  async testInputValidationRejectsGenericNames(service) {
    this.log('Testing input validation rejects generic placeholder names', 'section');
    const originalFetch = global.fetch;
    this._installMockFetch(JSON.stringify(this.buildMockFaithProgram()));

    try {
      let threw = false;
      try {
        await service.generateCouplesProgram('User 1', 'Partner', 'We want to grow closer to God together.');
      } catch (error) {
        threw = true;
        this.assert(
          /Failed to generate reflection program/.test(error.message),
          'Generic placeholder name surfaces a validation failure'
        );
      }
      this.assert(threw, 'Service rejects generic placeholder names (did not silently proceed)');
    } finally {
      global.fetch = originalFetch;
    }
  }

  // ── customPrompts coverage ───────────────────────────────────────────────
  //
  // Goal: prove every org-code custom_X field the service consumes actually
  // lands in the LLM request body verbatim, and that absence falls back to
  // the default copy. These are prompt-text assertions only; we never assert
  // on the mock response.

  async testCustomInitialProgramPromptOverride(service) {
    this.log('Testing customPrompts.initialProgramPrompt is embedded in default generateCouplesProgram prompt', 'section');
    const originalFetch = global.fetch;
    this._installMockFetch(JSON.stringify(this.buildMockFaithProgram()));

    const sentinel = 'CUSTOM_TEMPLATE_SENTINEL_INIT_PROG: reflect on community at Acme Church';
    const customPrompts = { initialProgramPrompt: sentinel };

    try {
      await service.generateCouplesProgram(
        'Ruth',
        'Boaz',
        'We want to deepen our walk of faith together and grow spiritually.',
        customPrompts
      );

      const prompt = this.lastCapturedPrompt || '';
      this.assert(prompt.includes(sentinel), 'Captured prompt contains the initialProgramPrompt sentinel verbatim');
      this.assert(
        /you are a church pastor/i.test(prompt),
        'Captured prompt still contains the default pastor framing'
      );
      this.assert(
        /skilled at creating personalized 7-day reflection/i.test(prompt),
        'Captured prompt still contains the default 7-day template framing'
      );
      const guidelinesIdx = prompt.indexOf('not 7 independent prompts');
      const sentinelIdx = prompt.indexOf(sentinel);
      this.assert(
        guidelinesIdx !== -1 && sentinelIdx > guidelinesIdx,
        'initialProgramPrompt appears after the default guidelines block (middle insertion)'
      );
      this.assert(
        prompt.includes('"program"') && prompt.includes('Respond only with a valid JSON object'),
        'Captured prompt ends with the standard Hopeful JSON response schema block'
      );
    } catch (error) {
      this.assert(false, 'initialProgramPrompt override call', `Error: ${error.message}`);
    } finally {
      global.fetch = originalFetch;
    }
  }

  async testCustomInitialProgramPromptLandsViaNextProgram(service) {
    this.log('Testing customPrompts.initialProgramPrompt also lands via generateNextCouplesProgram (delegated path)', 'section');
    const originalFetch = global.fetch;
    this._installMockFetch(JSON.stringify(this.buildMockFaithProgram()));

    const sentinel = 'CUSTOM_TEMPLATE_SENTINEL_NEXT_PROG_DELEGATION: delegated to initial';
    const customPrompts = { initialProgramPrompt: sentinel };

    try {
      await service.generateNextCouplesProgram(
        'Ruth',
        'Boaz',
        ['Reflect on a moment you felt God present this week.'],
        'We want to keep going deeper spiritually.',
        customPrompts
      );

      const prompt = this.lastCapturedPrompt || '';
      this.assert(
        prompt.includes(sentinel),
        'Delegated next-program prompt contains the initialProgramPrompt sentinel verbatim'
      );
    } catch (error) {
      this.assert(false, 'initialProgramPrompt override (next-program) call', `Error: ${error.message}`);
    } finally {
      global.fetch = originalFetch;
    }
  }

  async testCustomTherapyResponsePromptOverride(service) {
    this.log('Testing customPrompts.therapyResponsePrompt overrides default in generateCouplesTherapyResponse', 'section');
    const originalFetch = global.fetch;

    const mockReply =
      '1. Ruth, your faith shines through in how you described that moment.\n\n' +
      '2. Boaz, thanks for honoring your wife with that response.\n\n' +
      '3. How could you invite scripture into the next tough conversation between you?';
    this._installMockFetch(mockReply);

    const sentinel = 'CUSTOM_TEMPLATE_SENTINEL_THERAPY: offer one faith-rooted reflection';
    const customPrompts = { therapyResponsePrompt: sentinel };

    try {
      await service.generateCouplesTherapyResponse(
        'Ruth',
        'Boaz',
        ['I felt a quiet gratitude during prayer.'],
        'That meant a lot to me too.',
        customPrompts
      );

      const prompt = this.lastCapturedPrompt || '';
      this.assert(prompt.includes(sentinel), 'Captured prompt contains the therapyResponsePrompt sentinel verbatim');
      this.assert(
        !/top-tier couples therapist/i.test(prompt),
        'Captured prompt does NOT contain the default couples-therapist framing'
      );
      this.assert(
        !/emotionally focused therapy/i.test(prompt),
        'Captured prompt does NOT contain the default Emotionally Focused Therapy framing'
      );
    } catch (error) {
      this.assert(false, 'therapyResponsePrompt override call', `Error: ${error.message}`);
    } finally {
      global.fetch = originalFetch;
    }
  }

  async testFullOrgIdentityWeavingInitialProgram(service) {
    this.log('Testing organizationName/City/State are woven verbatim into the default initial-program prompt', 'section');
    const originalFetch = global.fetch;
    this._installMockFetch(JSON.stringify(this.buildMockFaithProgram()));

    const customPrompts = {
      organizationName: 'ACME_ORG_SENTINEL',
      organizationCity: 'ACME_CITY_SENTINEL',
      organizationState: 'ACME_STATE_SENTINEL'
    };

    try {
      await service.generateCouplesProgram(
        'Ruth',
        'Boaz',
        'We want to grow closer to God through our marriage.',
        customPrompts
      );

      const prompt = this.lastCapturedPrompt || '';
      this.assert(prompt.includes('ACME_ORG_SENTINEL'), 'organizationName sentinel appears verbatim in initial-program prompt');
      this.assert(prompt.includes('ACME_CITY_SENTINEL'), 'organizationCity sentinel appears verbatim in initial-program prompt');
      this.assert(prompt.includes('ACME_STATE_SENTINEL'), 'organizationState sentinel appears verbatim in initial-program prompt');
      this.assert(
        prompt.includes('ACME_CITY_SENTINEL, ACME_STATE_SENTINEL'),
        'organizationCity + organizationState are joined as "City, State"'
      );
    } catch (error) {
      this.assert(false, 'org-identity weaving (initial program) call', `Error: ${error.message}`);
    } finally {
      global.fetch = originalFetch;
    }
  }

  async testFullOrgIdentityWeavingSingleUserChimeIn(service) {
    this.log('Testing organizationName/City/State are woven verbatim into the default single-user chime-in prompt', 'section');
    const originalFetch = global.fetch;
    this._installMockFetch('How is God inviting you deeper into community at ACME this week?');

    const customPrompts = {
      organizationName: 'ACME_ORG_SENTINEL',
      organizationCity: 'ACME_CITY_SENTINEL',
      organizationState: 'ACME_STATE_SENTINEL'
    };

    try {
      await service.generateChimeInPrompt(
        'Ruth',
        'When did you feel closest to God this week?',
        ['I felt it during worship on Sunday.'],
        customPrompts
      );

      const prompt = this.lastCapturedPrompt || '';
      this.assert(prompt.includes('ACME_ORG_SENTINEL'), 'organizationName sentinel appears verbatim in single-user chime-in prompt');
      this.assert(prompt.includes('ACME_CITY_SENTINEL'), 'organizationCity sentinel appears verbatim in single-user chime-in prompt');
      this.assert(prompt.includes('ACME_STATE_SENTINEL'), 'organizationState sentinel appears verbatim in single-user chime-in prompt');
      this.assert(
        !prompt.includes('their local church'),
        'Default fallback "their local church" is NOT present when organizationName is supplied'
      );
      this.assert(
        !prompt.includes('their city'),
        'Default fallback "their city" is NOT present when city/state are supplied'
      );
    } catch (error) {
      this.assert(false, 'org-identity weaving (single-user chime-in) call', `Error: ${error.message}`);
    } finally {
      global.fetch = originalFetch;
    }
  }

  async testNoCustomPromptsFallsBackInitialProgram(service) {
    this.log('Testing absence of customPrompts falls back to default pastor framing (initial program)', 'section');
    const originalFetch = global.fetch;
    this._installMockFetch(JSON.stringify(this.buildMockFaithProgram()));

    try {
      // Explicit null case.
      await service.generateCouplesProgram(
        'Ruth',
        'Boaz',
        'We want to grow closer to God through our marriage.',
        null
      );

      let prompt = this.lastCapturedPrompt || '';
      this.assert(
        /you are a church pastor/i.test(prompt),
        'Default pastor framing is present when customPrompts is null'
      );
      this.assert(
        !prompt.includes('CUSTOM_TEMPLATE_SENTINEL_INIT_PROG'),
        'No leaked sentinel from earlier override tests'
      );
      this.assert(
        !prompt.includes('ACME_ORG_SENTINEL'),
        'No leaked org-identity sentinel from earlier tests'
      );

      // Omitted-arg case (customPrompts defaults to null in the service).
      this._installMockFetch(JSON.stringify(this.buildMockFaithProgram()));
      await service.generateCouplesProgram(
        'Ruth',
        'Boaz',
        'We want to grow closer to God through our marriage.'
      );
      prompt = this.lastCapturedPrompt || '';
      this.assert(
        /you are a church pastor/i.test(prompt),
        'Default pastor framing is present when customPrompts arg is omitted'
      );
    } catch (error) {
      this.assert(false, 'fallback initial-program call', `Error: ${error.message}`);
    } finally {
      global.fetch = originalFetch;
    }
  }

  async testNoCustomPromptsFallsBackSingleUserChimeIn(service) {
    this.log('Testing absence of customPrompts falls back to "their local church"/"their city" (single-user chime-in)', 'section');
    const originalFetch = global.fetch;
    this._installMockFetch('How is God inviting you deeper today?');

    try {
      await service.generateChimeInPrompt(
        'Ruth',
        'When did you feel closest to God this week?',
        ['I felt it during worship on Sunday.'],
        null
      );

      const prompt = this.lastCapturedPrompt || '';
      this.assert(
        prompt.includes('their local church'),
        'Default fallback "their local church" is present when organizationName is absent'
      );
      this.assert(
        prompt.includes('their city'),
        'Default fallback "their city" is present when city/state are absent'
      );
    } catch (error) {
      this.assert(false, 'fallback single-user chime-in call', `Error: ${error.message}`);
    } finally {
      global.fetch = originalFetch;
    }
  }

  async testPartialIdentityFieldsTolerated(service) {
    this.log('Testing partial identity (only organizationName) is tolerated without malformed city/state fragment', 'section');
    // HopefulPromptService only builds the
    // "City, State" clause when BOTH organizationCity AND organizationState
    // are present. With only organizationName supplied, the prompt should
    // contain the org name but NOT a half-built ", " fragment.
    const originalFetch = global.fetch;
    this._installMockFetch(JSON.stringify(this.buildMockFaithProgram()));

    try {
      await service.generateCouplesProgram(
        'Ruth',
        'Boaz',
        'We want to grow closer to God through our marriage.',
        { organizationName: 'ACME_ORG_ONLY_SENTINEL' }
      );

      const prompt = this.lastCapturedPrompt || '';
      this.assert(
        prompt.includes('ACME_ORG_ONLY_SENTINEL'),
        'organizationName sentinel appears when only name is supplied'
      );
      // Full "teachings of ACME_ORG_ONLY_SENTINEL in ," would be malformed;
      // the code should omit the " in City, State" clause entirely.
      this.assert(
        !/ACME_ORG_ONLY_SENTINEL\s+in\s+,/.test(prompt),
        'No malformed "ORG in ," fragment when city/state are absent'
      );
      this.assert(
        !/teachings of ACME_ORG_ONLY_SENTINEL in\s*\./.test(prompt),
        'No malformed "teachings of ORG in ." fragment when city/state are absent'
      );
    } catch (error) {
      this.assert(false, 'partial-identity call', `Error: ${error.message}`);
    } finally {
      global.fetch = originalFetch;
    }
  }

  printSummary() {
    console.log('\n' + '='.repeat(60));
    console.log(`Results: ${this.testResults.passed}/${this.testResults.total} passed (${this.testResults.failed} failed)`);
    console.log('='.repeat(60) + '\n');
  }

  // Token-safety post-check: assert no test ever tripped the fail-closed
  // guard (which would mean a mock was not installed), and that every
  // captured URL was the OpenAI endpoint routed through a mock.
  assertTokenSafety() {
    this.log('Verifying token safety (no real OpenAI calls attempted)', 'section');

    this.assert(
      FETCH_GUARD.__realCallAttempts === 0,
      'Fail-closed fetch guard never fired',
      `realCallAttempts=${FETCH_GUARD.__realCallAttempts}`
    );

    const EXPECTED_URL = 'https://api.openai.com/v1/chat/completions';
    const badUrls = this.capturedUrls.filter(u => u !== EXPECTED_URL);
    this.assert(
      this.capturedUrls.length > 0,
      'At least one LLM call was captured through the mock',
      `captured=${this.capturedUrls.length}`
    );
    this.assert(
      badUrls.length === 0,
      'Every captured fetch URL is the expected OpenAI endpoint',
      badUrls.length ? `unexpected: ${badUrls.join(', ')}` : `all ${this.capturedUrls.length} calls routed via mock to ${EXPECTED_URL}`
    );
  }

  async run() {
    this.log('Running HopefulPromptService tests (provider=openai, faith-based)', 'info');

    const service = this.testInstantiation();
    await this.testInitialProgramIs7DayFaithFormat(service);
    await this.testInitialPromptIsFaithBased(service);
    await this.testNextProgramReturns7Days(service);
    await this.testSingleUserChimeInIsFaithFramed(service);
    await this.testCouplesTherapyResponseReturnsArray(service);
    await this.testInputValidationRejectsGenericNames(service);

    // customPrompts / org-code coverage block
    await this.testCustomInitialProgramPromptOverride(service);
    await this.testCustomInitialProgramPromptLandsViaNextProgram(service);
    await this.testCustomTherapyResponsePromptOverride(service);
    await this.testFullOrgIdentityWeavingInitialProgram(service);
    await this.testFullOrgIdentityWeavingSingleUserChimeIn(service);
    await this.testNoCustomPromptsFallsBackInitialProgram(service);
    await this.testNoCustomPromptsFallsBackSingleUserChimeIn(service);
    await this.testPartialIdentityFieldsTolerated(service);

    this.assertTokenSafety();

    this.printSummary();
    return this.testResults.failed === 0;
  }
}

if (require.main === module) {
  const runner = new HopefulPromptServiceTestRunner();
  runner.run()
    .then(success => process.exit(success ? 0 : 1))
    .catch(err => {
      console.error('Fatal error in test runner:', err);
      process.exit(1);
    });
}

module.exports = HopefulPromptServiceTestRunner;
