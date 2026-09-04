/**
 * HelpfulPromptService Test Suite
 *
 * Covers the couples-focused EFT/Gottman prompt service:
 *   - Service instantiation and method signatures
 *   - generateCouplesProgram returns a 14-day couples program
 *   - generateNextCouplesProgram includes previousConversationStarters in its prompt
 *   - Output structure uses conversation_starter + science_behind_it (not reflection/bible_verse)
 *   - Prompt text stays secular — no church/Bible/faith terminology leaks in
 *   - Prompt instructs the LLM not to name EFT / Gottman by name
 *
 * Run with: node tests/helpful-prompt-service-test.js
 *
 * All LLM calls are mocked via `global.fetch`, so this test does not require
 * a live OPENAI_API_KEY.
 */

// Set a dummy OPENAI_API_KEY BEFORE requiring the service, since BasePromptService
// captures process.env.OPENAI_API_KEY in its constructor. This satisfies the key
// length validation (20–200 chars, no whitespace) without hitting the API.
if (!process.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = 'sk-test-helpful-prompt-service-mock-key-000';

const HelpfulPromptService = require('../services/HelpfulPromptService');

// Token-safety tripwire: any test that forgets to install its local mock will
// hit this guard instead of silently calling the real OpenAI API. The counter
// on `global.fetch.__realCallAttempts` is checked at end-of-suite so that a
// future regression surfaces as a hard failure rather than a surprise bill.
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

class HelpfulPromptServiceTestRunner {
  constructor() {
    this.testResults = { passed: 0, failed: 0, total: 0 };
    this.lastCapturedPrompt = null;
    this.lastCapturedBody = null;
    this.lastCapturedUrl = null;
    this.capturedUrls = [];
  }

  log(message, type = 'info') {
    const timestamp = new Date().toISOString();
    const prefix = {
      info: '📝', pass: '✅', fail: '❌', warn: '⚠️', section: '💞'
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

  // Build a 14-day couples-shaped mock program response.
  buildMockCouplesProgram(userName = 'Sarah', partnerName = 'Michael') {
    return {
      program: {
        title: `14-Day Emotional Connection Program for ${userName} and ${partnerName}`,
        overview: 'A fourteen-day journey to help the couple build emotional connection and communication.',
        days: Array.from({ length: 14 }, (_, i) => ({
          day: i + 1,
          theme: `Theme for day ${i + 1}: Communication and Connection`,
          conversation_starter: `${i === 0 ? `${userName} and ${partnerName}, ` : ''}What is one moment from this week where you felt most connected to your partner, and what made it feel that way?`,
          science_behind_it: 'Research-based couples therapy approaches consistently show that reflecting on moments of connection strengthens the bond between partners and builds emotional intimacy over time.'
        }))
      }
    };
  }

  // Build a mock OpenAI fetch response.
  _buildMockResponse(textContent, parsedBody = {}) {
    return {
      ok: true,
      async json() {
        return {
          id: 'chatcmpl-helpful-test',
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
  // token-safety guard is re-armed for the next test. Every captured URL is
  // tracked so end-of-suite can verify all calls went through mocks.
  _installMockFetch(textContent) {
    const originalFetch = global.fetch;
    global.fetch = async (url, options) => {
      this.lastCapturedUrl = url;
      this.capturedUrls.push(url);
      const body = options && options.body ? JSON.parse(options.body) : {};
      this.lastCapturedBody = body;

      const userMsg = (body.messages || []).find(m => m.role === 'user');
      this.lastCapturedPrompt = userMsg?.content || '';

      return this._buildMockResponse(textContent, body);
    };
    return originalFetch;
  }

  // ── Tests ────────────────────────────────────────────────────────────────

  testInstantiation() {
    this.log('Testing HelpfulPromptService instantiation & method signatures', 'section');
    const service = new HelpfulPromptService();

    // Force mockMode off so every callLLM() goes through _callOpenAI -> global.fetch
    // and hits our local mock. This keeps the unit test independent of the
    // TEST_MOCK_LLM env var (item 5 of "Token safety" in the plan).
    service.mockMode = false;

    this.assert(!!service, 'Service instantiates');
    this.assert(typeof service.generateCouplesProgram === 'function', 'generateCouplesProgram exists');
    this.assert(typeof service.generateNextCouplesProgram === 'function', 'generateNextCouplesProgram exists');
    this.assert(typeof service.generateCouplesTherapyResponse === 'function', 'generateCouplesTherapyResponse exists');
    this.assert(typeof service.generateChimeInPrompt === 'function', 'generateChimeInPrompt exists');
    this.assert(typeof service.generateSitSessionContent === 'function', 'generateSitSessionContent exists');
    this.assert(typeof service.buildSitSessionPrepPrompt === 'function', 'buildSitSessionPrepPrompt exists');
    this.assert(typeof service.generateInitialProgram === 'function', 'generateInitialProgram exists');
    this.assert(typeof service.generateNextProgram === 'function', 'generateNextProgram exists (not delegating stub)');
    this.assert(typeof service.getMetrics === 'function', 'getMetrics (inherited from Base) exists');
    this.assert(typeof service.model === 'string' && service.model.length > 0, 'model is a non-empty string', `model = ${service.model}`);

    return service;
  }

  buildMockSitSession(overrides = {}) {
    const bridgeOverrides = overrides.bridge_content || overrides.bridge || {};
    const sessionOverrides = overrides.session_content || overrides.session || {};

    return {
      bridge_content: {
        comparison: {
          partner_1: 'Alex is arriving hopeful, wanting a gentle tone and more team energy.',
          partner_2: 'Jordan is arriving honest about an empty tank and needing more patience.',
          insight: 'Both want closeness, but they are entering with different energy levels tonight.',
          ...(bridgeOverrides.comparison || {})
        },
        session_title: bridgeOverrides.session_title || bridgeOverrides.title || 'Feeling like a team again',
        session_focus: bridgeOverrides.session_focus || bridgeOverrides.focus || 'Tonight is about slowing down enough to feel like a team again, even if your energy levels do not match.',
        psychoeducation: {
          headline: 'Turning Toward When Energy Is Uneven',
          body: 'When couples slow down and name what they feel, their nervous systems often settle enough for connection to return. Research on emotional attunement shows that brief, structured check-ins can reduce defensiveness and help partners feel safer reaching for each other.',
          references: [
            {
              citation: 'Gottman, J. & Silver, N. — emotional bids and turning toward',
              note: 'Supports noticing and responding to emotional signals.'
            },
            {
              citation: 'Johnson, S. — Emotionally Focused Therapy attachment bonding',
              note: 'Supports creating a safe emotional bridge before problem-solving.'
            }
          ],
          ...(bridgeOverrides.psychoeducation || {})
        }
      },
      session_content: {
        reflections: sessionOverrides.reflections || [
          {
            partner: 'Alex',
            question: 'What feeling are you bringing into this Sit Session, and what would help you feel more settled with Jordan?'
          },
          {
            partner: 'Jordan',
            question: 'Where is your emotional tank right now, and what support from Alex would feel genuinely helpful?'
          }
        ],
        conversation_starter: {
          question: 'Building on what you each just named, where do you already feel on the same team — and where do you still feel a little apart?',
          ...(sessionOverrides.conversation_starter || {})
        },
        challenge: {
          title: 'The Hidden Team Token',
          steps: [
            {
              number: 1,
              title: 'Choose an object',
              body: 'Each of you silently pick a small object in the room that represents how you want to feel as a team tonight. Do not show it yet.',
              bullets: ['Phones stay face-down', 'Any ordinary object is fine']
            },
            {
              number: 2,
              title: 'Exchange without speaking',
              body: 'At the same time, place your object in your partner\'s hands. Hold theirs for ten seconds. No explaining yet.'
            },
            {
              number: 3,
              title: 'Reveal with one gesture',
              body: 'Still without words, make one physical gesture that shows what the object you received made you feel. Then set both objects together in the space between you.'
            }
          ],
          ...(sessionOverrides.challenge || {})
        }
      }
    };
  }

  async testInitialProgramIs14DayCouplesFormat(service) {
    this.log('Testing generateCouplesProgram returns a 14-day couples program', 'section');
    const originalFetch = global.fetch;
    const mockResponse = this.buildMockCouplesProgram('Sarah', 'Michael');
    this._installMockFetch(JSON.stringify(mockResponse));

    try {
      const result = await service.generateCouplesProgram(
        'Sarah',
        'Michael',
        'We want to improve communication and feel more emotionally connected.'
      );

      this.assert(!!result && typeof result === 'object', 'Returns an object');
      this.assert(!!result.program, 'Has a program field');
      this.assert(Array.isArray(result.program.days), 'program.days is an array');
      this.assert(result.program.days.length === 14, 'program has exactly 14 days', `got ${result.program.days.length}`);

      const day1 = result.program.days[0];
      this.assert(typeof day1.conversation_starter === 'string', 'day 1 has conversation_starter');
      this.assert(typeof day1.science_behind_it === 'string', 'day 1 has science_behind_it');
      this.assert(day1.reflection === undefined, 'day 1 does NOT have reflection (faith-based field)');
      this.assert(day1.bible_verse === undefined, 'day 1 does NOT have bible_verse (faith-based field)');
    } catch (error) {
      this.assert(false, 'generateCouplesProgram call', `Error: ${error.message}`);
    } finally {
      global.fetch = originalFetch;
    }
  }

  async testInitialPromptIsSecular(service) {
    this.log('Testing that the initial-program prompt text is secular (no church terminology)', 'section');
    const originalFetch = global.fetch;
    this._installMockFetch(JSON.stringify(this.buildMockCouplesProgram()));

    try {
      await service.generateCouplesProgram('Sarah', 'Michael', 'We want to improve communication.');

      const prompt = this.lastCapturedPrompt || '';
      const faithTerms = ['church', 'bible', 'scripture', 'pastor', 'god ', 'jesus', 'christian', 'faith'];
      const offenders = faithTerms.filter(term => prompt.toLowerCase().includes(term));

      this.assert(
        offenders.length === 0,
        'Prompt contains no church/faith terminology',
        offenders.length ? `offenders: ${offenders.join(', ')}` : 'clean'
      );

      this.assert(
        /couples therapist/i.test(prompt),
        'Prompt frames the LLM as a couples therapist'
      );
      this.assert(
        /Emotionally Focused Therapy/i.test(prompt),
        'Prompt mentions EFT methodology to anchor the LLM'
      );
      this.assert(
        /14 consecutive days/i.test(prompt),
        'Prompt explicitly asks for 14 days'
      );
    } catch (error) {
      this.assert(false, 'Prompt inspection', `Error: ${error.message}`);
    } finally {
      global.fetch = originalFetch;
    }
  }

  async testNextProgramIncludesPreviousStarters(service) {
    this.log('Testing generateNextCouplesProgram dedupes via previousConversationStarters', 'section');
    const originalFetch = global.fetch;
    this._installMockFetch(JSON.stringify(this.buildMockCouplesProgram('Sarah', 'Michael')));

    const previousStarters = [
      'Sarah and Michael, what is one thing you admire about each other today?',
      'What is a small moment this week that made you feel especially close?'
    ];

    try {
      const result = await service.generateNextCouplesProgram(
        'Sarah',
        'Michael',
        previousStarters,
        'We want to go deeper on how we handle conflict.'
      );

      this.assert(result && result.program, 'Returns a program');
      this.assert(result.program.days.length === 14, 'Next program is also 14 days');

      const prompt = this.lastCapturedPrompt || '';
      this.assert(
        prompt.includes(previousStarters[0]),
        'Prompt includes first previous conversation starter verbatim'
      );
      this.assert(
        prompt.includes(previousStarters[1]),
        'Prompt includes second previous conversation starter verbatim'
      );
      this.assert(
        /should not use any of the conversation-starters that they've already answered/i.test(prompt),
        'Prompt instructs the LLM to not repeat previous conversation-starters'
      );
    } catch (error) {
      this.assert(false, 'generateNextCouplesProgram call', `Error: ${error.message}`);
    } finally {
      global.fetch = originalFetch;
    }
  }

  async testCouplesTherapyResponseReturnsArray(service) {
    this.log('Testing generateCouplesTherapyResponse returns an array of messages', 'section');
    const originalFetch = global.fetch;

    // The chime-in path splits the response by double-newline / numbered sections.
    const mockReply =
      '1. Sarah, it sounds like connection is really important for you here.\n\n' +
      '2. Michael, thanks for sharing how you experienced that moment.\n\n' +
      '3. What would it look like for each of you to ask for that kind of moment more often?';

    this._installMockFetch(mockReply);

    try {
      const messages = await service.generateCouplesTherapyResponse(
        'Sarah',
        'Michael',
        ['I felt a little disconnected this week.'],
        'I thought things were fine, honestly.'
      );

      this.assert(Array.isArray(messages), 'Returns an array');
      this.assert(messages.length >= 1 && messages.length <= 3, 'Array has 1–3 messages', `length = ${messages.length}`);
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
    this._installMockFetch(JSON.stringify(this.buildMockCouplesProgram()));

    try {
      let threw = false;
      try {
        await service.generateCouplesProgram('User 1', 'Partner', 'We want to improve communication.');
      } catch (error) {
        threw = true;
        this.assert(
          /Failed to generate couples therapy program/.test(error.message),
          'Generic placeholder name surfaces a validation failure'
        );
      }
      this.assert(threw, 'Service rejects generic placeholder names (did not silently proceed)');
    } finally {
      global.fetch = originalFetch;
    }
  }

  testSitSessionPrepPromptShape(service) {
    this.log('Testing Sit Session prep prompt is filled from prep fields', 'section');
    const prepA = {
      gratitude: 'hopeful',
      energy_level: 'somewhat full',
      boundary: 'somewhat close',
      intention: 'gentle',
      curiosity: 'stay on reconnecting',
      bringing_text: 'I want us to feel like a team again.',
      optional_focus: 'evening check-ins'
    };
    const prepB = {
      gratitude: 'tired but open',
      energy_level: 'empty',
      boundary: 'distant',
      intention: 'honest',
      curiosity: 'talk about conflict',
      bringing_text: 'I need more patience from both of us.'
    };

    const prompt = service.buildSitSessionPrepPrompt([
      { name: 'Alex', prep: prepA },
      { name: 'Jordan', prep: prepB }
    ]);

    this.assert(/Alex says:/.test(prompt), 'Includes Partner A name block');
    this.assert(/Jordan says:/.test(prompt), 'Includes Partner B name block');
    this.assert(/1\. They're feeling hopeful/.test(prompt), 'Line 1 maps gratitude → feeling');
    this.assert(/2\. Their emotional tank is feeling somewhat full right now/.test(prompt), 'Line 2 maps energy_level → tank');
    this.assert(/3\. They're feeling somewhat close to their partner/.test(prompt), 'Line 3 maps boundary → closeness');
    this.assert(/4\. They want the tone of the session to be gentle/.test(prompt), 'Line 4 maps intention → tone');
    this.assert(/5\. They want the topic to stay on reconnecting/.test(prompt), 'Line 5 maps curiosity → topic');
    this.assert(/6\. In a free form text field, they've entered I want us to feel like a team again\./.test(prompt), 'Line 6 maps bringing_text → free form');
    this.assert(/optional focus: evening check-ins/.test(prompt), 'optional_focus appended to free-form line');
    this.assert(/They're feeling tired but open/.test(prompt), 'Partner B feeling present');
    this.assert(/emotional tank is feeling empty/.test(prompt), 'Partner B tank present');
  }

  async testSitSessionGeneration(service) {
    this.log('Testing generateSitSessionContent returns strict bridge + session schema', 'section');
    const originalFetch = global.fetch;
    this._installMockFetch(JSON.stringify(this.buildMockSitSession()));

    try {
      const result = await service.generateSitSessionContent([
        {
          name: 'Alex',
          prep: {
            gratitude: 'hopeful',
            energy_level: 'somewhat full',
            boundary: 'somewhat close',
            intention: 'gentle',
            curiosity: 'reconnect',
            bringing_text: 'I want us on the same team.'
          }
        },
        {
          name: 'Jordan',
          prep: {
            gratitude: 'open',
            energy_level: 'empty',
            boundary: 'distant',
            intention: 'honest',
            curiosity: 'conflict',
            bringing_text: 'I need more patience.'
          }
        }
      ]);

      this.assert(!!result && !!result.bridge && !!result.session, 'Returns bridge + session objects');
      this.assert(
        typeof result.bridge.title === 'string' && result.bridge.title.length >= 8,
        'bridge.title (from session_title) is a non-trivial session title'
      );
      this.assert(
        typeof result.bridge.focus === 'string' && result.bridge.focus.length >= 40,
        'bridge.focus is a non-trivial paragraph'
      );
      this.assert(
        typeof result.bridge.psychoeducation?.title === 'string' && result.bridge.psychoeducation.title.length >= 5,
        'bridge.psychoeducation.title is present'
      );
      this.assert(
        typeof result.bridge.psychoeducation?.body === 'string' && result.bridge.psychoeducation.body.length >= 40,
        'bridge.psychoeducation.body is non-trivial text'
      );
      this.assert(
        Array.isArray(result.bridge.psychoeducation?.references) && result.bridge.psychoeducation.references.length >= 1,
        'bridge.psychoeducation.references is a non-empty array',
        `len=${result.bridge.psychoeducation?.references?.length}`
      );
      this.assert(
        result.bridge.psychoeducation.references.every(r => typeof r.citation === 'string' && r.citation.length >= 8),
        'each psychoeducation reference has a citation'
      );
      this.assert(
        typeof result.bridge.comparison?.partner_1 === 'string' &&
          typeof result.bridge.comparison?.partner_2 === 'string' &&
          typeof result.bridge.comparison?.insight === 'string',
        'bridge.comparison has partner_1, partner_2, insight'
      );
      this.assert(
        Array.isArray(result.session.reflections) && result.session.reflections.length === 2,
        'session.reflections has exactly 2 entries',
        `len=${result.session.reflections?.length}`
      );
      this.assert(
        result.session.reflections.every(r => typeof r.partner === 'string' && typeof r.question === 'string'),
        'each reflection has partner + question'
      );
      this.assert(
        typeof result.session.conversation_starter?.question === 'string' &&
          result.session.conversation_starter.question.length >= 15,
        'session.conversation_starter.question present'
      );
      this.assert(
        typeof result.session.challenge?.title === 'string' &&
          Array.isArray(result.session.challenge?.steps) &&
          result.session.challenge.steps.length >= 1,
        'session.challenge has title + steps'
      );
      this.assert(
        result.session.challenge.steps.every(s =>
          typeof s.number === 'number' && typeof s.title === 'string' && typeof s.body === 'string'
        ),
        'each challenge step has number, title, body'
      );
      this.assert(!('summary' in result.bridge), 'legacy bridge.summary not present after normalize');
      this.assert(!('phases' in result.session), 'legacy session.phases not present after normalize');
      this.assert(typeof result.__prompt === 'string' && result.__prompt.length > 0, '__prompt attached for persistence');

      const prompt = this.lastCapturedPrompt || '';
      this.assert(/relationship expert/i.test(prompt), 'User prompt frames the LLM as a relationship expert');
      this.assert(/Alex says:/.test(prompt), 'User prompt includes Partner A prep block');
      this.assert(/Jordan says:/.test(prompt), 'User prompt includes Partner B prep block');
      this.assert(/emotional tank is feeling somewhat full/i.test(prompt), 'User prompt fills tank selection from prep');
      this.assert(/1\. A quick comparison/.test(prompt), 'User prompt starts session content with comparison');
      this.assert(/focus of tonight's session/i.test(prompt), 'User prompt requests a session-focus paragraph');
      this.assert(/When the Motions Feel Hollow/.test(prompt), 'User prompt gives a human-register session-title example');
      this.assert(/psychoeducation/i.test(prompt), 'User prompt requests psychoeducation');
      this.assert(/Give this section a title/.test(prompt), 'User prompt requests a psychoeducation title');
      this.assert(/going through the motions lately/.test(prompt), 'User prompt calibrates reflection questions against a concrete example');
      this.assert(/2-4 of each partner's own words/.test(prompt), 'User prompt requires working partner words into reflections');
      this.assert(/"bridge_content"/.test(prompt), 'User prompt asks for bridge_content top-level key');
      this.assert(/"session_content"/.test(prompt), 'User prompt asks for session_content top-level key');
      this.assert(/"session_title"/.test(prompt), 'User prompt asks for session_title');
      this.assert(/"session_focus"/.test(prompt), 'User prompt asks for session_focus');
      this.assert(/"headline"/.test(prompt), 'User prompt asks for psychoeducation.headline');
      this.assert(/<strong>/.test(prompt), 'User prompt allows <strong> emphasis in psychoeducation');
      this.assert(/"references"/i.test(prompt), 'User prompt requests references array');
      this.assert(/conversation.starter/i.test(prompt), 'User prompt requests conversation-starter');
      this.assert(/should NOT be more talking/.test(prompt), 'User prompt requires a non-talking in-person challenge');
      this.assert(/we've never done anything like this before/.test(prompt), 'User prompt asks for a novel tangible challenge');
      this.assert(
        this.lastCapturedBody?.response_format?.type === 'json_object',
        'Sit Session generation uses jsonMode'
      );
    } catch (error) {
      this.assert(false, 'generateSitSessionContent call', `Error: ${error.message}`);
    } finally {
      global.fetch = originalFetch;
    }

    const soloOriginalFetch = global.fetch;
    this._installMockFetch(JSON.stringify(this.buildMockSitSession()));
    try {
      const soloResult = await service.generateSitSessionContent([
        {
          name: 'Alex',
          prep: {
            gratitude: 'hopeful',
            energy_level: 'somewhat full',
            boundary: 'somewhat close',
            intention: 'gentle',
            curiosity: 'reconnect',
            bringing_text: 'I want us on the same team.'
          }
        }
      ]);
      this.assert(!!soloResult?.bridge && !!soloResult?.session, 'Solo (1 prep) generateSitSessionContent succeeds');
      this.assert(
        Array.isArray(soloResult.session.reflections) && soloResult.session.reflections.length === 2,
        'Solo generate still returns couple-shaped reflections (2)',
        `len=${soloResult.session.reflections?.length}`
      );
      this.assert(
        /single-device/i.test(soloResult.__prompt || ''),
        'Solo user prompt notes single-device flow'
      );
    } catch (error) {
      this.assert(false, 'Solo generateSitSessionContent call', `Error: ${error.message}`);
    } finally {
      global.fetch = soloOriginalFetch;
    }
  }

  async testSamplingTemperatureByModel(service) {
    this.log('Testing GPT-5 family omits temperature; gpt-4o keeps it', 'section');
    const partners = [
      {
        name: 'Alex',
        prep: {
          gratitude: 'hopeful',
          energy_level: 'somewhat full',
          boundary: 'somewhat close',
          intention: 'gentle',
          curiosity: 'reconnect',
          bringing_text: 'I want us on the same team.'
        }
      }
    ];
    const originalModel = service.model;

    const originalFetch = global.fetch;
    this._installMockFetch(JSON.stringify(this.buildMockSitSession()));
    try {
      service.model = 'gpt-5.4';
      await service.generateSitSessionContent(partners);
      this.assert(
        !Object.prototype.hasOwnProperty.call(this.lastCapturedBody || {}, 'temperature'),
        'gpt-5.4 Sit Session request omits temperature'
      );
    } catch (error) {
      this.assert(false, 'gpt-5.4 generateSitSessionContent call', `Error: ${error.message}`);
    } finally {
      global.fetch = originalFetch;
    }

    const gpt4Fetch = global.fetch;
    this._installMockFetch(JSON.stringify(this.buildMockSitSession()));
    try {
      service.model = 'gpt-4o';
      await service.generateSitSessionContent(partners);
      this.assert(
        this.lastCapturedBody && this.lastCapturedBody.temperature === 0.7,
        'gpt-4o Sit Session request keeps temperature 0.7'
      );
    } catch (error) {
      this.assert(false, 'gpt-4o generateSitSessionContent call', `Error: ${error.message}`);
    } finally {
      service.model = originalModel;
      global.fetch = gpt4Fetch;
    }
  }

  testSitSessionNormalizeStrictness(service) {
    this.log('Testing normalizeSitSessionResponse rejects bad shapes and strips extras', 'section');

    const good = this.buildMockSitSession();
    const normalized = service.normalizeSitSessionResponse({
      ...good,
      extra_top: true,
      bridge_content: { ...good.bridge_content, extra_bridge: 1 },
      session_content: {
        ...good.session_content,
        challenge: {
          ...good.session_content.challenge,
          steps: [...good.session_content.challenge.steps].reverse(),
          extra_challenge: 'x'
        },
        extra_session: 'x'
      }
    });
    this.assert(!!normalized, 'Valid payload with extras still normalizes');
    this.assert(!('extra_top' in normalized), 'Top-level extras stripped');
    this.assert(!('extra_bridge' in normalized.bridge), 'Bridge extras stripped');
    this.assert(
      normalized.bridge.title === good.bridge_content.session_title,
      'session_title maps to stored bridge.title'
    );
    this.assert(
      normalized.bridge.focus === good.bridge_content.session_focus,
      'session_focus maps to stored bridge.focus'
    );
    this.assert(
      normalized.bridge.psychoeducation.title === good.bridge_content.psychoeducation.headline,
      'headline maps to stored psychoeducation.title'
    );
    this.assert(
      !('session_title' in normalized.bridge) && !('session_focus' in normalized.bridge),
      'Prompt-contract aliases are not stored on the normalized bridge'
    );
    this.assert(
      normalized.session.challenge.steps.map(s => s.number).join(',') ===
        Array.from({ length: good.session_content.challenge.steps.length }, (_, i) => i + 1).join(','),
      'Challenge steps renumbered 1..n regardless of LLM order'
    );

    this.assert(
      service.normalizeSitSessionResponse({ bridge: { content: 'old' }, session: { content: 'old' } }) === null,
      'Legacy content-only shape is rejected'
    );
    this.assert(
      service.normalizeSitSessionResponse(this.buildMockSitSession({
        bridge: {
          psychoeducation: {
            body: good.bridge_content.psychoeducation.body,
            references: []
          }
        }
      })) === null,
      'Empty psychoeducation.references is rejected'
    );
    this.assert(
      service.normalizeSitSessionResponse(this.buildMockSitSession({
        bridge: {
          psychoeducation: {
            headline: '',
            body: good.bridge_content.psychoeducation.body,
            references: good.bridge_content.psychoeducation.references
          }
        }
      })) === null,
      'Empty psychoeducation.headline is rejected'
    );
    this.assert(
      service.normalizeSitSessionResponse(this.buildMockSitSession({
        bridge: { session_focus: 'Too short.' }
      })) === null,
      'Short session_focus is rejected'
    );
    this.assert(
      service.normalizeSitSessionResponse(this.buildMockSitSession({
        bridge: { session_title: 'Hi' }
      })) === null,
      'Short session_title is rejected'
    );
    this.assert(
      service.normalizeSitSessionResponse(this.buildMockSitSession({
        session: {
          reflections: [
            { partner: 'Alex', question: 'Enough text for a reflection question here.' }
          ]
        }
      })) === null,
      'Single reflection is rejected'
    );
    this.assert(
      service.normalizeSitSessionResponse(this.buildMockSitSession({
        session: {
          challenge: {
            title: good.session_content.challenge.title,
            steps: []
          }
        }
      })) === null,
      'Empty challenge.steps is rejected'
    );

    const legacyShape = {
      bridge: {
        comparison: good.bridge_content.comparison,
        title: 'Feeling like a team again',
        focus: good.bridge_content.session_focus,
        psychoeducation: {
          title: good.bridge_content.psychoeducation.headline,
          body: good.bridge_content.psychoeducation.body,
          references: good.bridge_content.psychoeducation.references
        }
      },
      session: good.session_content
    };
    const legacyNormalized = service.normalizeSitSessionResponse(legacyShape);
    this.assert(!!legacyNormalized, 'Older bridge/session aliases still normalize');
    this.assert(
      legacyNormalized.bridge.title === 'Feeling like a team again' &&
        legacyNormalized.bridge.psychoeducation.title === good.bridge_content.psychoeducation.headline,
      'Older title / focus / psychoeducation.title aliases map to the stored shape'
    );
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
    this.log('Running HelpfulPromptService tests (provider=openai)', 'info');

    const service = this.testInstantiation();
    await this.testInitialProgramIs14DayCouplesFormat(service);
    await this.testInitialPromptIsSecular(service);
    await this.testNextProgramIncludesPreviousStarters(service);
    await this.testCouplesTherapyResponseReturnsArray(service);
    await this.testInputValidationRejectsGenericNames(service);
    this.testSitSessionPrepPromptShape(service);
    await this.testSitSessionGeneration(service);
    await this.testSamplingTemperatureByModel(service);
    this.testSitSessionNormalizeStrictness(service);

    this.assertTokenSafety();

    this.printSummary();
    return this.testResults.failed === 0;
  }
}

if (require.main === module) {
  const runner = new HelpfulPromptServiceTestRunner();
  runner.run()
    .then(success => process.exit(success ? 0 : 1))
    .catch(err => {
      console.error('Fatal error in test runner:', err);
      process.exit(1);
    });
}

module.exports = HelpfulPromptServiceTestRunner;
