/**
 * BasePromptService
 *
 * Shared foundation for all concrete prompt services (HopefulPromptService,
 * HelpfulPromptService, etc.). Handles:
 *   - OpenAI LLM configuration and request/response handling
 *   - Input sanitization and safety validation
 *   - Output validation (program JSON shape + dangerous-pattern checks)
 *   - Rate-limited / concurrency-bounded request queue with metrics
 *   - Common message post-processing helpers
 *   - Deterministic mock responses when TEST_MOCK_LLM=true (so tests never
 *     spend real tokens)
 *
 * Subclasses MUST override processOpenAIRequest(requestData) to dispatch
 * queued request types to their concrete generation methods.
 */
class BasePromptService {
  constructor() {
    this.provider = 'openai';
    this.apiKey = process.env.OPENAI_API_KEY || null;
    this.model = process.env.OPENAI_MODEL || 'gpt-5.4';
    this.apiUrl = 'https://api.openai.com/v1/chat/completions';

    this.mockMode = process.env.TEST_MOCK_LLM === 'true';

    this.validateApiKey();

    this.requestQueue = [];
    this.processing = false;
    this.lastRequestTime = 0;
    this.MIN_REQUEST_INTERVAL = 200;
    this.MAX_CONCURRENT = 3;
    this.QUEUE_TIMEOUT = 30000;
    this.activeRequests = 0;
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      rateLimitErrors: 0,
      averageResponseTime: 0
    };
  }

  validateApiKey() {
    if (this.mockMode) {
      console.log(`LLM configured: service=${this.constructor.name}, provider=openai, model=${this.model}, mock=TEST_MOCK_LLM`);
      return;
    }

    if (!this.apiKey) {
      console.warn('OPENAI_API_KEY not configured - LLM features will be disabled');
      return;
    }

    if (this.apiKey.length < 20 || this.apiKey.length > 200) {
      console.error('OPENAI_API_KEY appears to have invalid length - check your configuration');
      return;
    }

    if (this.apiKey.includes(' ') || this.apiKey.includes('\n') || this.apiKey.includes('\t')) {
      console.error('OPENAI_API_KEY contains whitespace - check for copy/paste errors');
      return;
    }

    const maskedKey = `***${this.apiKey.slice(-4)}`;
    console.log(`LLM configured: service=${this.constructor.name}, provider=openai, model=${this.model}, key=${maskedKey}`);
  }

  async callLLM(systemPrompt, userPrompt, options = {}) {
    const { maxTokens, temperature = 0.7, jsonMode = false } = options;

    if (this.mockMode) {
      return this._buildMockResponse({ jsonMode, systemPrompt, userPrompt });
    }

    return this._callOpenAI(systemPrompt, userPrompt, { maxTokens, temperature, jsonMode });
  }

  // Mocked LLM response used when TEST_MOCK_LLM=true. Keeps tests deterministic
  // and free (no real tokens spent) while still exercising the real server
  // code paths and validators.
  //
  // The mock is service-aware: it sniffs the system + user prompt for faith
  // cues and returns a 7-day faith-shaped program (reflection + bible_verse)
  // for HopefulPromptService calls, and a 14-day couples-shaped program
  // (conversation_starter + science_behind_it) for HelpfulPromptService
  // calls. This lets downstream integration tests (e.g. program-org-context)
  // verify that routing actually picks the correct service by inspecting
  // the program shape.
  _buildMockResponse({ jsonMode, systemPrompt, userPrompt }) {
    const combined = `${systemPrompt || ''}\n${userPrompt || ''}`.toLowerCase();

    // Hopeful cues: faith-based / spiritual wellness appear in the system
    // prompt for initial-program and single-user chime-in; the couples
    // first-chime-in path uses systemPrompt=null but the user prompt pulls
    // in org / church / scripture / bible / pastor language. Keep the
    // regex intentionally broad so custom prompts that mention any of
    // those still route to the faith-shaped mock.
    const isHopeful = /faith-based|spiritual wellness|pastor|scripture|bible|church/.test(combined);

    if (jsonMode) {
      const content = isHopeful
        ? JSON.stringify(this._buildHopefulMockProgram())
        : JSON.stringify(this._buildHelpfulMockProgram());
      return {
        content,
        finishReason: 'stop',
        model: this.model,
        id: 'mock-llm-response',
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
      };
    }

    const content = isHopeful
      ? 'Take a quiet moment today to reflect on how scripture speaks to the part of your relationship that feels tender right now. What is one small step of faith you can take toward your partner this week, trusting God to shape the way you love one another?'
      : 'What is one small moment from this week where you felt genuinely understood by your partner? Share it with them, and invite them to share one of their own. Small moments of honest communication build lasting trust and emotional connection over time.';

    return {
      content,
      finishReason: 'stop',
      model: this.model,
      id: 'mock-llm-response',
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    };
  }

  // 7-day faith-based mock program (reflection + bible_verse only).
  _buildHopefulMockProgram() {
    return {
      program: {
        title: '7-Day Mock Reflection Program',
        overview: 'A mocked 7-day faith-based reflection program used during automated testing so no real LLM tokens are spent.',
        days: Array.from({ length: 7 }, (_, i) => {
          const day = i + 1;
          return {
            day,
            theme: `Day ${day} theme: scripture and spiritual reflection in faith and church community`,
            reflection: `Reflect prayerfully on day ${day} about how God is drawing you closer to Him. How does your church community and scripture shape the way you love, forgive, and serve your partner this week?`,
            bible_verse: `"Above all, love each other deeply, because love covers over a multitude of sins." — 1 Peter 4:8 (Day ${day} reflection)`
          };
        })
      }
    };
  }

  // 14-day couples-shaped mock program (conversation_starter + science_behind_it only).
  _buildHelpfulMockProgram() {
    return {
      program: {
        title: '14-Day Mock Couples Program',
        overview: 'A mocked 14-day couples program used during automated testing so no real LLM tokens are spent.',
        days: Array.from({ length: 14 }, (_, i) => {
          const day = i + 1;
          return {
            day,
            theme: `Day ${day} theme: communication and connection in the relationship`,
            conversation_starter: `What does healthy partner communication and trust look like between you two on day ${day}? Share an example where you felt especially connected and understood together.`,
            science_behind_it: `On day ${day}, research on couples communication shows that partners who actively listen and share feelings build deeper trust, stronger emotional connection, intimacy, and long-term relationship satisfaction. Reflect together on what you can share to support each other.`
          };
        })
      }
    };
  }

  async _callOpenAI(systemPrompt, userPrompt, { maxTokens, temperature, jsonMode }) {
    const body = {
      model: this.model,
      messages: [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        { role: 'user', content: userPrompt }
      ],
      temperature
    };
    if (maxTokens) body.max_completion_tokens = maxTokens;
    if (jsonMode) body.response_format = { type: 'json_object' };

    const res = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      const error = new Error(errorData.error?.message || 'OpenAI API request failed');
      error.status = res.status;
      throw error;
    }

    const data = await res.json();
    const choice = data.choices?.[0];
    return {
      content: choice?.message?.content || '',
      finishReason: choice?.finish_reason || 'unknown',
      model: data.model || this.model,
      id: data.id || 'unknown',
      usage: data.usage || {}
    };
  }

  sanitizePromptInput(input) {
    if (typeof input !== 'string') return '';

    return input
      .replace(/```[\s\S]*?```/g, '[code block removed]')
      .replace(/`([^`]*)`/g, '$1')

      .replace(/\n\s*(System|Assistant|Human|User|AI):\s*/gi, '\n')
      .replace(/^(System|Assistant|Human|User|AI):\s*/gi, '')

      .replace(/\[INST\][\s\S]*?\[\/INST\]/gi, '[instruction removed]')
      .replace(/\[\/INST\]/gi, '')
      .replace(/\[INST\]/gi, '')
      .replace(/<\|.*?\|>/g, '[control sequence removed]')

      .replace(/ignore\s+previous\s+instructions/gi, '[instruction attempt removed]')
      .replace(/forget\s+everything/gi, '[instruction attempt removed]')
      .replace(/new\s+instructions/gi, '[instruction attempt removed]')
      .replace(/override\s+instructions/gi, '[instruction attempt removed]')

      .replace(/\n{3,}/g, '\n\n')
      .replace(/\s{3,}/g, ' ')
      .trim()

      .substring(0, 2000);
  }

  validateInputSafety(input) {
    const suspiciousPatterns = [
      /prompt\s*injection/i,
      /jailbreak/i,
      /ignore\s+instructions/i,
      /system\s*override/i,
      /developer\s*mode/i,
      /unrestricted\s*mode/i,
      /god\s*mode/i,
      /admin\s*access/i,
      /root\s*access/i
    ];

    for (const pattern of suspiciousPatterns) {
      if (pattern.test(input)) {
        console.warn(`SECURITY: Suspicious pattern detected in user input: ${pattern.source}`);
        return false;
      }
    }
    return true;
  }

  validateUserNames(names) {
    const genericPatterns = [
      /^user\s*\d*$/i,
      /^partner\s*\d*$/i,
      /^person\s*\d*$/i,
      /^name\s*\d*$/i,
      /^unknown$/i,
      /^anonymous$/i,
      /^placeholder$/i,
      /^test\s*user\s*\d*$/i
    ];

    for (const name of names) {
      if (!name || typeof name !== 'string' || name.trim() === '') {
        return { valid: false, error: 'User names are required and cannot be empty' };
      }

      const trimmedName = name.trim();

      for (const pattern of genericPatterns) {
        if (pattern.test(trimmedName)) {
          return {
            valid: false,
            error: `User name "${trimmedName}" appears to be a generic placeholder. Please set actual user names before generating therapy content.`
          };
        }
      }
    }
    return { valid: true };
  }

  async queueOpenAIRequest(requestData) {
    return new Promise((resolve, reject) => {
      this.requestQueue.push({ requestData, resolve, reject, timestamp: Date.now() });
      this.processQueue();
    });
  }

  async processQueue() {
    if (this.processing || this.requestQueue.length === 0) return;
    if (this.activeRequests >= this.MAX_CONCURRENT) return;

    this.processing = true;

    while (this.requestQueue.length > 0 && this.activeRequests < this.MAX_CONCURRENT) {
      const { requestData, resolve, reject, timestamp } = this.requestQueue.shift();

      if (Date.now() - timestamp > this.QUEUE_TIMEOUT) {
        reject(new Error(`Request timeout - ${this.provider} queue processing took too long`));
        continue;
      }

      const now = Date.now();
      const timeSinceLastRequest = now - this.lastRequestTime;

      if (timeSinceLastRequest < this.MIN_REQUEST_INTERVAL) {
        const waitTime = this.MIN_REQUEST_INTERVAL - timeSinceLastRequest;
        await new Promise(r => setTimeout(r, waitTime));
      }

      this.activeRequests++;
      this.lastRequestTime = Date.now();

      const requestStart = Date.now();
      this.processOpenAIRequest(requestData)
        .then(result => {
          const duration = Date.now() - requestStart;
          this.recordMetrics(duration, true, null);
          resolve(result);
        })
        .catch(error => {
          const duration = Date.now() - requestStart;
          this.recordMetrics(duration, false, error);
          reject(error);
        })
        .finally(() => {
          this.activeRequests--;
          setTimeout(() => this.processQueue(), 0);
        });
    }

    this.processing = false;
  }

  recordMetrics(duration, success, error) {
    this.metrics.totalRequests++;
    if (success) this.metrics.successfulRequests++;
    if (!success) this.metrics.failedRequests++;
    if (error?.status === 429) this.metrics.rateLimitErrors++;

    this.metrics.averageResponseTime =
      (this.metrics.averageResponseTime * (this.metrics.totalRequests - 1) + duration)
      / this.metrics.totalRequests;
  }

  getMetrics() {
    return {
      ...this.metrics,
      queueLength: this.requestQueue.length,
      activeRequests: this.activeRequests,
      successRate: this.metrics.totalRequests > 0
        ? (this.metrics.successfulRequests / this.metrics.totalRequests * 100).toFixed(2) + '%'
        : '0%'
    };
  }

  // Abstract: each concrete service dispatches queued request types to its
  // own generation methods. Subclasses MUST override this.
  async processOpenAIRequest(_requestData, _retryCount = 0) {
    throw new Error(`${this.constructor.name} must implement processOpenAIRequest()`);
  }

  isConfigured() {
    return this.mockMode || !!this.apiKey;
  }

  validateAIResponse(response, minLength = 100) {
    if (typeof response !== 'string') return false;

    const dangerousPatterns = [
      /ignore\s+previous\s+instructions/i,
      /i'm\s+not\s+a\s+therapist/i,
      /as\s+an\s+ai\s+language\s+model/i,
      /i\s+cannot\s+provide\s+therapy/i,
      /\[INST\]/i,
      /\[\/INST\]/i,
      /<\|.*?\|>/,
      /system\s*:/i,
      /assistant\s*:/i,
      /human\s*:/i,
      /developer\s*mode/i,
      /jailbreak/i,
      /override/i
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(response)) {
        console.warn(`SECURITY: Dangerous pattern detected in AI response: ${pattern.source}`);
        return false;
      }
    }

    if (response.length < minLength) {
      console.warn('SECURITY: AI response too short, possible refusal');
      return false;
    }

    return true;
  }

  // Accepts both the couples (conversation_starter + science_behind_it) and
  // faith-based (reflection + bible_verse) day shapes, and 7- or 14-day programs.
  validateProgramStructure(programData) {
    try {
      if (!programData || typeof programData !== 'object') return false;
      if (!programData.program || typeof programData.program !== 'object') return false;

      const program = programData.program;

      if (!program.title || typeof program.title !== 'string') return false;
      if (!program.days || !Array.isArray(program.days)) return false;

      if (program.days.length !== 7 && program.days.length !== 14) return false;

      for (let i = 0; i < program.days.length; i++) {
        const day = program.days[i];

        if (typeof day !== 'object') return false;
        if (day.day !== (i + 1)) return false;
        if (!day.theme || typeof day.theme !== 'string') return false;

        const hasReflectionFormat = typeof day.reflection === 'string' && typeof day.bible_verse === 'string';
        const hasConversationFormat = typeof day.conversation_starter === 'string' && typeof day.science_behind_it === 'string';
        if (!hasReflectionFormat && !hasConversationFormat) return false;

        if (day.theme.length < 3 || day.theme.length > 300) {
          console.warn(`Day ${day.day} theme length out of range: ${day.theme.length}`);
          return false;
        }

        const mainContent = day.reflection || day.conversation_starter;
        if (mainContent.length < 10 || mainContent.length > 2000) {
          console.warn(`Day ${day.day} main content length out of range: ${mainContent.length}`);
          return false;
        }

        const supportContent = day.bible_verse || day.science_behind_it;
        if (supportContent.length < 5 || supportContent.length > 5000) {
          console.warn(`Day ${day.day} support content length out of range: ${supportContent.length}`);
          return false;
        }

        const contentKeywords = [
          /relationship/i, /couple/i, /partner/i, /communication/i,
          /emotion/i, /feeling/i, /connect/i, /bond/i, /love/i, /trust/i,
          /together/i, /share/i, /understand/i, /listen/i, /support/i,
          /care/i, /respect/i, /intimacy/i, /attachment/i, /secure/i,
          /faith/i, /god/i, /prayer/i, /reflect/i, /grace/i, /spirit/i,
          /church/i, /bible/i, /scripture/i, /worship/i, /heart/i
        ];

        const hasRelevantContent = contentKeywords.some(keyword =>
          keyword.test(mainContent) ||
          keyword.test(supportContent) ||
          keyword.test(day.theme)
        );

        if (!hasRelevantContent) {
          console.warn(`SECURITY: Day ${day.day} lacks common content keywords (but may still be valid)`);
        }
      }

      return true;
    } catch (error) {
      console.error('Error validating program structure:', error.message);
      return false;
    }
  }

  cleanMessageText(text) {
    if (!text || typeof text !== 'string') return text;

    const cleaned = text
      .trim()
      .replace(/\.\s*["']+\s*$/, '.')
      .replace(/"\.\s*$/, '.')
      .replace(/^["']+/, '')
      .replace(/["']+\.?\s*$/, '')
      .replace(/^["']/, '')
      .replace(/["']$/, '')
      .trim();

    if (cleaned.length > 0 && !/[a-zA-Z0-9]/.test(cleaned)) {
      return '';
    }

    return cleaned;
  }

  splitTherapyResponse(response) {
    if (!response || typeof response !== 'string') {
      return [response || ''];
    }

    const numberedSections = response.split(/(?=\d+\.\s)/);
    if (numberedSections.length > 1 && numberedSections.length <= 3) {
      return numberedSections
        .map(section => this.cleanMessageText(section.replace(/^\d+\.\s*/, '')))
        .filter(section => section.length > 0)
        .slice(0, 3);
    }

    const paragraphs = response.split(/\n\s*\n/);
    if (paragraphs.length > 1 && paragraphs.length <= 3) {
      return paragraphs
        .map(p => this.cleanMessageText(p))
        .filter(p => p.length > 0)
        .slice(0, 3);
    }

    const sentences = response.split(/[.!?]+/).filter(s => s.trim().length > 0);
    if (sentences.length > 3) {
      const messagesPerGroup = Math.ceil(sentences.length / 3);
      const groups = [];
      for (let i = 0; i < sentences.length; i += messagesPerGroup) {
        const group = sentences.slice(i, i + messagesPerGroup).join('. ').trim();
        if (group.length > 0) {
          groups.push(this.cleanMessageText(group + (group.endsWith('.') ? '' : '.')));
        }
      }
      return groups.slice(0, 3);
    }

    return [this.cleanMessageText(response)];
  }
}

module.exports = BasePromptService;
