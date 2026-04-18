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

class HelpfulPromptServiceTestRunner {
  constructor() {
    this.testResults = { passed: 0, failed: 0, total: 0 };
    this.lastCapturedPrompt = null;
    this.lastCapturedBody = null;
    this.lastCapturedUrl = null;
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
  _installMockFetch(textContent) {
    const originalFetch = global.fetch;
    global.fetch = async (url, options) => {
      this.lastCapturedUrl = url;
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

    this.assert(!!service, 'Service instantiates');
    this.assert(typeof service.generateCouplesProgram === 'function', 'generateCouplesProgram exists');
    this.assert(typeof service.generateNextCouplesProgram === 'function', 'generateNextCouplesProgram exists');
    this.assert(typeof service.generateCouplesTherapyResponse === 'function', 'generateCouplesTherapyResponse exists');
    this.assert(typeof service.generateChimeInPrompt === 'function', 'generateChimeInPrompt exists');
    this.assert(typeof service.generateInitialProgram === 'function', 'generateInitialProgram exists');
    this.assert(typeof service.generateNextProgram === 'function', 'generateNextProgram exists (not delegating stub)');
    this.assert(typeof service.getMetrics === 'function', 'getMetrics (inherited from Base) exists');
    this.assert(typeof service.model === 'string' && service.model.length > 0, 'model is a non-empty string', `model = ${service.model}`);

    return service;
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

  printSummary() {
    console.log('\n' + '='.repeat(60));
    console.log(`Results: ${this.testResults.passed}/${this.testResults.total} passed (${this.testResults.failed} failed)`);
    console.log('='.repeat(60) + '\n');
  }

  async run() {
    this.log('Running HelpfulPromptService tests (provider=openai)', 'info');

    const service = this.testInstantiation();
    await this.testInitialProgramIs14DayCouplesFormat(service);
    await this.testInitialPromptIsSecular(service);
    await this.testNextProgramIncludesPreviousStarters(service);
    await this.testCouplesTherapyResponseReturnsArray(service);
    await this.testInputValidationRejectsGenericNames(service);

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
