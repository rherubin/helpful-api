class PromptService {
  constructor() {
    // LLM provider: "openai" (default), "claude", or "gemini"
    this.provider = (process.env.LLM_PROVIDER || 'openai').toLowerCase();

    if (this.provider === 'claude') {
      this.apiKey = process.env.ANTHROPIC_API_KEY || null;
      this.model = process.env.LLM_MODEL || 'claude-sonnet-4-6';
      this.apiUrl = 'https://api.anthropic.com/v1/messages';
    } else if (this.provider === 'gemini') {
      this.apiKey = process.env.GEMINI_API_KEY || null;
      this.model = process.env.LLM_MODEL || 'gemini-3-flash-preview';
      this.apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`;
    } else {
      this.apiKey = process.env.OPENAI_API_KEY || null;
      this.model = process.env.LLM_MODEL || 'gpt-5.4';
      this.apiUrl = 'https://api.openai.com/v1/chat/completions';
    }

    this.validateApiKey();

    // Request queue management for production scalability
    this.requestQueue = [];
    this.processing = false;
    this.lastRequestTime = 0;
    this.MIN_REQUEST_INTERVAL = 200; // 200ms between requests (5 req/sec max)
    this.MAX_CONCURRENT = 3; // Max 3 concurrent requests
    this.QUEUE_TIMEOUT = this.provider === 'claude' ? 120000 : 30000;
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
    const keyName = this.provider === 'claude'
      ? 'ANTHROPIC_API_KEY'
      : this.provider === 'gemini'
        ? 'GEMINI_API_KEY'
        : 'OPENAI_API_KEY';

    if (!this.apiKey) {
      console.warn(`${keyName} not configured - LLM features will be disabled`);
      return;
    }

    if (this.apiKey.length < 20 || this.apiKey.length > 200) {
      console.error(`${keyName} appears to have invalid length - check your configuration`);
      return;
    }

    if (this.apiKey.includes(' ') || this.apiKey.includes('\n') || this.apiKey.includes('\t')) {
      console.error(`${keyName} contains whitespace - check for copy/paste errors`);
      return;
    }

    const maskedKey = `***${this.apiKey.slice(-4)}`;
    console.log(`LLM configured: provider=${this.provider}, model=${this.model}, key=${maskedKey}`);
  }

  // Unified LLM call — routes to OpenAI, Claude, or Gemini based on this.provider
  async callLLM(systemPrompt, userPrompt, options = {}) {
    const { maxTokens, temperature = 0.7, jsonMode = false } = options;

    if (this.provider === 'claude') {
      return this._callClaude(systemPrompt, userPrompt, { maxTokens, temperature });
    }
    if (this.provider === 'gemini') {
      return this._callGemini(systemPrompt, userPrompt, { maxTokens, temperature });
    }
    return this._callOpenAI(systemPrompt, userPrompt, { maxTokens, temperature, jsonMode });
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

  async _callClaude(systemPrompt, userPrompt, { maxTokens, temperature }) {
    const body = {
      model: this.model,
      max_tokens: maxTokens || 4096,
      temperature,
      messages: [{ role: 'user', content: userPrompt }]
    };
    if (systemPrompt) body.system = systemPrompt;

    const res = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      const error = new Error(errorData.error?.message || 'Claude API request failed');
      error.status = res.status;
      throw error;
    }

    const data = await res.json();
    let text = data.content?.[0]?.text || '';
    // Claude often wraps JSON in markdown code fences — strip them
    text = text.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    return {
      content: text,
      finishReason: data.stop_reason || 'unknown',
      model: data.model || this.model,
      id: data.id || 'unknown',
      usage: data.usage || {}
    };
  }

  async _callGemini(systemPrompt, userPrompt, { maxTokens, temperature }) {
    const contents = [];

    // Gemini uses a "user" turn; prepend system prompt as the first user message when present
    if (systemPrompt) {
      contents.push({ role: 'user', parts: [{ text: systemPrompt }] });
      contents.push({ role: 'model', parts: [{ text: 'Understood.' }] });
    }
    contents.push({ role: 'user', parts: [{ text: userPrompt }] });

    const body = {
      contents,
      generationConfig: {
        temperature,
        ...(maxTokens ? { maxOutputTokens: maxTokens } : {})
      }
    };

    const url = `${this.apiUrl}?key=${this.apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      const error = new Error(errorData.error?.message || 'Gemini API request failed');
      error.status = res.status;
      throw error;
    }

    const data = await res.json();
    const candidate = data.candidates?.[0];
    let text = candidate?.content?.parts?.map(p => p.text).join('') || '';
    // Strip markdown code fences that Gemini may wrap JSON in
    text = text.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    return {
      content: text,
      finishReason: candidate?.finishReason || 'unknown',
      model: data.modelVersion || this.model,
      id: data.responseId || 'unknown',
      usage: {
        prompt_tokens: data.usageMetadata?.promptTokenCount ?? null,
        completion_tokens: data.usageMetadata?.candidatesTokenCount ?? null,
        total_tokens: data.usageMetadata?.totalTokenCount ?? null
      }
    };
  }

  // Sanitize input to prevent prompt injection
  sanitizePromptInput(input) {
    if (typeof input !== 'string') return '';
    
    // Remove potential injection patterns and malicious content
    return input
      // Remove code blocks and markdown
      .replace(/```[\s\S]*?```/g, '[code block removed]')
      .replace(/`([^`]*)`/g, '$1')
      
      // Remove role switching attempts
      .replace(/\n\s*(System|Assistant|Human|User|AI):\s*/gi, '\n')
      .replace(/^(System|Assistant|Human|User|AI):\s*/gi, '')
      
      // Remove instruction tags and control sequences
      .replace(/\[INST\][\s\S]*?\[\/INST\]/gi, '[instruction removed]')
      .replace(/\[\/INST\]/gi, '')
      .replace(/\[INST\]/gi, '')
      .replace(/<\|.*?\|>/g, '[control sequence removed]')
      
      // Remove potential jailbreak attempts
      .replace(/ignore\s+previous\s+instructions/gi, '[instruction attempt removed]')
      .replace(/forget\s+everything/gi, '[instruction attempt removed]')
      .replace(/new\s+instructions/gi, '[instruction attempt removed]')
      .replace(/override\s+instructions/gi, '[instruction attempt removed]')
      
      // Remove excessive whitespace and normalize
      .replace(/\n{3,}/g, '\n\n')
      .replace(/\s{3,}/g, ' ')
      .trim()
      
      // Limit length to prevent token exhaustion attacks
      .substring(0, 2000);
  }

  // Validate input for suspicious patterns
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

  // Validate that user names are not generic placeholders
  validateUserNames(names) {
    const genericPatterns = [
      /^user\s*\d*$/i,       // "User", "User 1", "User 2", etc.
      /^partner\s*\d*$/i,    // "Partner", "Partner 1", "Partner 2", etc.
      /^person\s*\d*$/i,     // "Person", "Person 1", "Person 2", etc.
      /^name\s*\d*$/i,       // "Name", "Name 1", etc.
      /^unknown$/i,          // "Unknown"
      /^anonymous$/i,        // "Anonymous"
      /^placeholder$/i,      // "Placeholder"
      /^test\s*user\s*\d*$/i // "Test User", "TestUser1", etc.
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

  // Queue OpenAI request for rate limiting and concurrency control
  async queueOpenAIRequest(requestData) {
    return new Promise((resolve, reject) => {
      this.requestQueue.push({ requestData, resolve, reject, timestamp: Date.now() });
      this.processQueue();
    });
  }

  // Process the request queue with rate limiting
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
      
      // Rate limiting - ensure minimum interval between requests
      const now = Date.now();
      const timeSinceLastRequest = now - this.lastRequestTime;
      
      if (timeSinceLastRequest < this.MIN_REQUEST_INTERVAL) {
        const waitTime = this.MIN_REQUEST_INTERVAL - timeSinceLastRequest;
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
      
      this.activeRequests++;
      this.lastRequestTime = Date.now();
      
      // Process request with metrics tracking
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
          // Continue processing queue
          setTimeout(() => this.processQueue(), 0);
        });
    }
    
    this.processing = false;
  }

  // Record performance metrics
  recordMetrics(duration, success, error) {
    this.metrics.totalRequests++;
    if (success) this.metrics.successfulRequests++;
    if (!success) this.metrics.failedRequests++;
    if (error?.status === 429) this.metrics.rateLimitErrors++;
    
    // Update average response time
    this.metrics.averageResponseTime = 
      (this.metrics.averageResponseTime * (this.metrics.totalRequests - 1) + duration) 
      / this.metrics.totalRequests;
  }

  // Get current metrics for monitoring
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

  // Generate couples therapy response for ongoing conversations
  // customPrompts.therapyResponsePrompt overrides the default chime-in prompt when provided
  async generateCouplesTherapyResponse(user1Name, user2Name, user1Messages, user2FirstMessage, customPrompts = null) {
    if (!this.apiKey) {
      throw new Error('LLM service is not configured - set OPENAI_API_KEY, ANTHROPIC_API_KEY, or GEMINI_API_KEY');
    }

    return this.queueOpenAIRequest({ 
      type: 'chime_in_response_1',
      user1Name, 
      user2Name, 
      user1Messages, 
      user2FirstMessage,
      customPrompts
    });
  }

  // Public interface - queue the request
  async generateChimeInPrompt(userName, conversationStarter, userMessages, customPrompts = null) {
    if (!this.apiKey) {
      throw new Error('LLM service is not configured - set OPENAI_API_KEY, ANTHROPIC_API_KEY, or GEMINI_API_KEY');
    }

    return this.queueOpenAIRequest({
      type: 'single_user_chime_in',
      userName,
      conversationStarter,
      userMessages,
      customPrompts
    });
  }

  // Public interface - queue the request
  // customPrompts.initialProgramPrompt overrides the default initial program prompt when provided
  async generateCouplesProgram(userName, partnerName, userInput, customPrompts = null) {
    if (!this.apiKey) {
      throw new Error('LLM service is not configured - set OPENAI_API_KEY, ANTHROPIC_API_KEY, or GEMINI_API_KEY');
    }

    return this.queueOpenAIRequest({ type: 'program', userName, partnerName, userInput, customPrompts });
  }

  // Public interface for next program generation - queue the request
  // customPrompts.nextProgramPrompt overrides the default next program prompt when provided
  async generateNextCouplesProgram(userName, partnerName, previousConversationStarters, userInput, customPrompts = null) {
    if (!this.apiKey) {
      throw new Error('LLM service is not configured - set OPENAI_API_KEY, ANTHROPIC_API_KEY, or GEMINI_API_KEY');
    }

    return this.queueOpenAIRequest({ 
      type: 'next_program', 
      userName, 
      partnerName, 
      previousConversationStarters,
      userInput,
      customPrompts
    });
  }

  // Process OpenAI request based on type
  async processOpenAIRequest(requestData, retryCount = 0) {
    if (requestData.type === 'chime_in_response_1') {
      return this.generateFirstChimeInPrompt(requestData, retryCount);
    } else if (requestData.type === 'single_user_chime_in') {
      return this.generateSingleUserChimeInPrompt(requestData, retryCount);
    } else if (requestData.type === 'chime_in_response_2') {
      return this.generateSecondChimeInPrompt(requestData, retryCount);
    } else if (requestData.type === 'next_program') {
      return this.generateNextProgram(requestData, retryCount);
    } else {
      return this.generateInitialProgram(requestData, retryCount);
    }
  }

  // Internal method that does the actual OpenAI call for programs
  async generateInitialProgram({ userName, userInput, customPrompts }, retryCount = 0, parseRetryCount = 0) {
    const MAX_RETRIES = 2;
    const BASE_DELAY = 1000; // 1 second
    const MAX_PARSE_RETRIES = 1;
    
    try {
      // Sanitize all inputs
      const sanitizedUserName = this.sanitizePromptInput(userName);
      const sanitizedUserInput = this.sanitizePromptInput(userInput);

      // Validate input safety
      if (![sanitizedUserInput, sanitizedUserName].every(input => this.validateInputSafety(input))) {
        throw new Error('Input contains potentially unsafe content');
      }

      // Validate that user name is not a generic placeholder
      const nameValidation = this.validateUserNames([sanitizedUserName]);
      if (!nameValidation.valid) {
        throw new Error(nameValidation.error);
      }

      // Additional validation - ensure names are reasonable
      if (sanitizedUserName.length < 1 || sanitizedUserName.length > 50) {
        throw new Error('User name must be between 1 and 50 characters');
      }
      if (sanitizedUserInput.length < 10 || sanitizedUserInput.length > 2000) {
        throw new Error('User input must be between 10 and 2000 characters');
      }

      // Resolve org-level values for prompt interpolation
      const orgName = (customPrompts && customPrompts.organizationName) || '';
      const orgCityState = (customPrompts && customPrompts.organizationCity && customPrompts.organizationState)
        ? `${customPrompts.organizationCity}, ${customPrompts.organizationState}`
        : '';

      const orgContext = orgName
        ? `The user attends ${orgName}${orgCityState ? ` in ${orgCityState}` : ''}. Wherever possible, draw on the values, beliefs, and teachings of that community to make each reflection feel rooted in their specific faith home.`
        : 'Ground each reflection in broadly shared Christian values and scripture.';

      const defaultPrompt = `You are a church pastor is very skilled at creating personalized 7-day reflection programs rooted in Christian values, scripture, and the teachings of ${orgName}${orgCityState ? ` in ${orgCityState}` : ''}.

${orgContext}

The user has shared the following goal:

"${sanitizedUserInput}"

Create a 7-day daily reflection program to help this person grow closer to God and make progress toward their goal. Each day should include one focused reflection question, a unifying theme, and a related Bible verse.

Guidelines:
- Each reflection question should be deeply personal and help the user examine their own heart, motivations, and relationship with God.
- On Day 1, focus the reflection on the user's specific goal. For Days 2–7, gradually shift toward broader, related themes — do not revisit the original topic directly. Each day should build on the previous one, moving the user toward more general self-reflection. Example: If the user's goal concerns their father's health, Day 1 addresses that directly. Days 2–7 should explore related but more general themes (e.g., caregiving, mortality, family roles) — not their father's health again.
- Each reflection should feel warm and pastoral in tone — like guidance from a trusted spiritual mentor.
- The theme should capture the spiritual focus for that day.
- The Bible verse should directly reinforce the reflection, not just be tangentially related.
- Write each reflection with no paragraph breaks.
- Do not reference any specific pastor or church leader by name.
- Together the 7 days should form a cohesive journey — not 7 independent prompts.

Respond only with a valid JSON object in exactly this structure:

{
  "program": {
    "title": "7-Day Reflection Program",
    "overview": "A single sentence describing the overall arc and goal of this program.",
    "days": [
      {
        "day": 1,
        "theme": "Theme name",
        "reflection": "The reflection text",
        "bible_verse": "The Bible verse"
      }
    ]
  }
}`;
      
      // Use org-code custom prompt when available, otherwise fall back to default
      const resolvedPrompt = (customPrompts && customPrompts.initialProgramPrompt)
        ? customPrompts.initialProgramPrompt
            .replace(/\{\{userName\}\}/g, sanitizedUserName)
            .replace(/\{\{userInput\}\}/g, sanitizedUserInput)
            .replace(/\{\{Church Name\}\}/g, orgName)
            .replace(/\{\{City, State\}\}/g, orgCityState)
            .replace(/\{\{User Input\}\}/g, sanitizedUserInput)
        : defaultPrompt;

      const llmResult = await this.callLLM(
        "You are a faith-based spiritual wellness program creator. Respond only with valid JSON in the exact format specified. Do not include any text, explanation, or markdown outside the JSON structure.",
        resolvedPrompt,
        { temperature: 0.7, jsonMode: true }
      );

      const response = llmResult.content;
      const finishReason = llmResult.finishReason;
      const responseMetadata = {
        model: llmResult.model,
        id: llmResult.id,
        finish_reason: finishReason,
        prompt_tokens: llmResult.usage?.prompt_tokens ?? llmResult.usage?.input_tokens ?? null,
        completion_tokens: llmResult.usage?.completion_tokens ?? llmResult.usage?.output_tokens ?? null,
        total_tokens: llmResult.usage?.total_tokens ?? null
      };
      console.log('DEBUG generateInitialProgram response (first 500 chars):', typeof response, response ? response.substring(0, 500) : 'NULL/EMPTY');
      console.log('DEBUG generateInitialProgram response metadata:', responseMetadata);
      
      // Validate and sanitize the AI response
      if (!this.validateAIResponse(response)) {
        console.warn('SECURITY: AI response failed validation checks');
        throw new Error('AI response contains potentially unsafe content');
      }
      
      // Parse and validate JSON response; retry once on partial/invalid output.
      try {
        const parsedResponse = JSON.parse(response);
        
        // Validate the structure and content of the parsed response
        if (!this.validateProgramStructure(parsedResponse)) {
          throw new Error('AI response does not match expected program structure');
        }
        
        return parsedResponse;
      } catch (parseError) {
        console.warn('Failed to parse/validate generateInitialProgram response:', {
          parse_retry_attempt: parseRetryCount + 1,
          max_parse_retries: MAX_PARSE_RETRIES,
          parse_error: parseError.message,
          response_preview: response ? response.substring(0, 300) : 'EMPTY',
          response_length: response ? response.length : 0,
          ...responseMetadata
        });

        if (parseRetryCount < MAX_PARSE_RETRIES) {
          const retryDelay = 500;
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          return this.generateInitialProgram(
            { userName, userInput, customPrompts },
            retryCount,
            parseRetryCount + 1
          );
        }

        throw new Error(
          `Invalid therapy response format after retry ` +
          `(finish_reason=${finishReason}, model=${responseMetadata.model}, ` +
          `response_length=${response ? response.length : 0}): ${parseError.message}`
        );
      }
    } catch (error) {
      // Implement exponential backoff for rate limiting
      if (error.status === 429 && retryCount < MAX_RETRIES) {
        const delay = BASE_DELAY * Math.pow(2, retryCount);
        console.log(`OpenAI rate limited, retrying in ${delay}ms (attempt ${retryCount + 1}/${MAX_RETRIES + 1})`);
        
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.generateInitialProgram({ userName, userInput, customPrompts }, retryCount + 1, parseRetryCount);
      }

      // Enhanced error logging for security monitoring
      if (error.message.includes('unsafe content') || error.message.includes('validation')) {
        console.error('SECURITY ERROR in ChatGPT service:', error.message);
      } else {
        // Log error without exposing sensitive information
        if (error.status === 401) {
          console.error('ChatGPT API Error: Invalid API key - check your OPENAI_API_KEY configuration');
        } else if (error.status === 429) {
          console.error(`ChatGPT API Error: Rate limit exceeded (attempt ${retryCount + 1}/${MAX_RETRIES + 1})`);
        } else if (error.status === 403) {
          console.error('ChatGPT API Error: Access forbidden - check API key permissions');
        } else {
          console.error('ChatGPT API Error:', error.message || 'Unknown error');
        }
      }
      
      throw new Error('Failed to generate couples therapy program');
    }
  }

  async generateNextProgram({ userName, userInput, customPrompts }, retryCount = 0, parseRetryCount = 0) {
    return this.generateInitialProgram({ userName, userInput, customPrompts }, retryCount, parseRetryCount);
  }

  isConfigured() {
    return !!this.apiKey;
  }

  // Validate AI response for potentially unsafe content
  validateAIResponse(response, minLength = 100) {
    if (typeof response !== 'string') return false;
    
    // Check for signs of prompt injection success
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

    // Check response length (too short might indicate refusal)
    if (response.length < minLength) {
      console.warn('SECURITY: AI response too short, possible refusal');
      return false;
    }

    return true;
  }

  // Validate the structure of the therapy program response
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

  // Internal method for generating a single-user follow-up reflection
  async generateSingleUserChimeInPrompt({ userName, conversationStarter, userMessages, customPrompts }, retryCount = 0) {
    const MAX_RETRIES = 2;
    const BASE_DELAY = 1000; // 1 second

    try {
      const sanitizedUserName = this.sanitizePromptInput(userName);
      const sanitizedConversationStarter = this.sanitizePromptInput(conversationStarter);
      const sanitizedUserMessages = Array.isArray(userMessages)
        ? this.sanitizePromptInput(userMessages.map(msg => this.sanitizePromptInput(msg)).join('\n'))
        : this.sanitizePromptInput(userMessages);

      if (!this.validateInputSafety(sanitizedUserName) ||
          !this.validateInputSafety(sanitizedConversationStarter) ||
          !this.validateInputSafety(sanitizedUserMessages)) {
        throw new Error('Input contains potentially unsafe content');
      }

      const nameValidation = this.validateUserNames([sanitizedUserName]);
      if (!nameValidation.valid) {
        throw new Error(nameValidation.error);
      }

      if (!sanitizedConversationStarter) {
        throw new Error('Conversation starter is required');
      }

      if (!sanitizedUserMessages) {
        throw new Error('At least one user message is required');
      }

      const orgName = (customPrompts && customPrompts.organizationName) || 'their local church';
      const orgCityState = (customPrompts && customPrompts.organizationCity && customPrompts.organizationState)
        ? `${customPrompts.organizationCity}, ${customPrompts.organizationState}`
        : 'their city';

      const defaultPrompt = `You are a top-tier faith-based spiritual wellness guide with deep expertise in research-based therapy methods. You are inspired by Christian theology and biblical wisdom. You go to ${orgName} in ${orgCityState}, and you are very aware of their statements of beliefs, wisdom, practices, teaching, and sermons.

A user comes into your therapy room.

Your first question to them is: "${sanitizedConversationStarter}"

${sanitizedUserName} says:

"${sanitizedUserMessages}"

Your goal, as their couples therapist, is to ask one follow-up question that enables the user to keep reflecting and journaling.`;

      const llmResult = await this.callLLM(
        "You are a faith-based spiritual wellness guide. Respond with exactly one warm follow-up reflection question and no extra explanation.",
        defaultPrompt,
        { maxTokens: 300, temperature: 0.7 }
      );

      const response = llmResult.content;

      if (!this.validateAIResponse(response, 20)) {
        console.warn('SECURITY: AI response failed validation checks');
        throw new Error('AI response contains potentially unsafe content');
      }

      return this.cleanMessageText(response);
    } catch (error) {
      if (error.status === 429 && retryCount < MAX_RETRIES) {
        const delay = BASE_DELAY * Math.pow(2, retryCount);
        console.log(`OpenAI rate limited, retrying in ${delay}ms (attempt ${retryCount + 1}/${MAX_RETRIES + 1})`);

        await new Promise(resolve => setTimeout(resolve, delay));
        return this.generateSingleUserChimeInPrompt({ userName, conversationStarter, userMessages, customPrompts }, retryCount + 1);
      }

      if (error.message.includes('unsafe content') || error.message.includes('validation')) {
        console.error('SECURITY ERROR in ChatGPT therapy service:', error.message);
      } else {
        if (error.status === 401) {
          console.error('ChatGPT API Error: Invalid API key - check your OPENAI_API_KEY configuration');
        } else if (error.status === 429) {
          console.error(`ChatGPT API Error: Rate limit exceeded (attempt ${retryCount + 1}/${MAX_RETRIES + 1})`);
        } else if (error.status === 403) {
          console.error('ChatGPT API Error: Access forbidden - check API key permissions');
        } else {
          console.error('ChatGPT API Error:', error.message || 'Unknown error');
        }
      }

      throw new Error('Failed to generate chime-in prompt');
    }
  }

  // Internal method for generating couples therapy responses
  async generateFirstChimeInPrompt({ user1Name, user2Name, user1Messages, user2FirstMessage, customPrompts }, retryCount = 0) {
    const MAX_RETRIES = 2;
    const BASE_DELAY = 1000; // 1 second
    
    try {
      // Sanitize all inputs
      const sanitizedUser1Name = this.sanitizePromptInput(user1Name);
      const sanitizedUser2Name = this.sanitizePromptInput(user2Name);
      const sanitizedUser1Messages = Array.isArray(user1Messages) 
        ? user1Messages.map(msg => this.sanitizePromptInput(msg)).join('\n\n')
        : this.sanitizePromptInput(user1Messages);
      const sanitizedUser2FirstMessage = this.sanitizePromptInput(user2FirstMessage);

      // Validate input safety
      if (!this.validateInputSafety(sanitizedUser1Name) || 
          !this.validateInputSafety(sanitizedUser2Name) ||
          !this.validateInputSafety(sanitizedUser1Messages) ||
          !this.validateInputSafety(sanitizedUser2FirstMessage)) {
        throw new Error('Input contains potentially unsafe content');
      }

      // Validate that user names are not generic placeholders
      const nameValidation = this.validateUserNames([sanitizedUser1Name, sanitizedUser2Name]);
      if (!nameValidation.valid) {
        throw new Error(nameValidation.error);
      }

      const defaultPrompt = `You're a top-tier couples therapist with deep expertise using Sue Johnson's Emotionally Focused Therapy method of couples therapy, as well as the Gottman Couples Therapy method.

Your advice to couples is anchored in Emotionally Focused Therapy, but utilizes Gottman Couples Therapy methods when the context of the couple merits it.

A couple comes into your therapy room.

Your first question to them is: "Hey ${sanitizedUser1Name}, do you remember the time we went on that spontaneous road trip to the coast? What was your favorite part of that trip?"

${sanitizedUser1Name} says:

"${sanitizedUser1Messages}"

Then, ${sanitizedUser2Name} says in response:

"${sanitizedUser2FirstMessage}"

Your goal, as their couples therapist, is to chime into this conversation and ask one follow-up question that enables the conversation to progress in the healthiest, most positive way possible.

When you create the follow-up conversation-starter for the couple, please do not assume that the couple is traveling or has been on a vacation or road trip unless they explicitly reference traveling, vacations, or road trips. Most commonly, the couple will be discussing a relationship dynamic. `;

      // Use org-code custom prompt when available, otherwise fall back to default
      const resolvedPrompt = (customPrompts && customPrompts.therapyResponsePrompt)
        ? customPrompts.therapyResponsePrompt
            .replace(/\{\{user1Name\}\}/g, sanitizedUser1Name)
            .replace(/\{\{user2Name\}\}/g, sanitizedUser2Name)
            .replace(/\{\{user1Messages\}\}/g, sanitizedUser1Messages)
            .replace(/\{\{user2FirstMessage\}\}/g, sanitizedUser2FirstMessage)
        : defaultPrompt;

      const llmResult = await this.callLLM(
        null,
        resolvedPrompt,
        { maxTokens: 2000, temperature: 0.7 }
      );

      const response = llmResult.content;
      
      // Validate and sanitize the AI response
      if (!this.validateAIResponse(response, 20)) {
        console.warn('SECURITY: AI response failed validation checks');
        throw new Error('AI response contains potentially unsafe content');
      }
      
      // Split response into up to 3 messages (split by double newlines or numbered sections)
      const messages = this.splitTherapyResponse(response);
      
      return messages;
    } catch (error) {
      // Implement exponential backoff for rate limiting
      if (error.status === 429 && retryCount < MAX_RETRIES) {
        const delay = BASE_DELAY * Math.pow(2, retryCount);
        console.log(`OpenAI rate limited, retrying in ${delay}ms (attempt ${retryCount + 1}/${MAX_RETRIES + 1})`);
        
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.generateFirstChimeInPrompt({ user1Name, user2Name, user1Messages, user2FirstMessage, customPrompts }, retryCount + 1);
      }

      // Enhanced error logging for security monitoring
      if (error.message.includes('unsafe content') || error.message.includes('validation')) {
        console.error('SECURITY ERROR in ChatGPT therapy service:', error.message);
      } else {
        // Log error without exposing sensitive information
        if (error.status === 401) {
          console.error('ChatGPT API Error: Invalid API key - check your OPENAI_API_KEY configuration');
        } else if (error.status === 429) {
          console.error(`ChatGPT API Error: Rate limit exceeded (attempt ${retryCount + 1}/${MAX_RETRIES + 1})`);
        } else if (error.status === 403) {
          console.error('ChatGPT API Error: Access forbidden - check API key permissions');
        } else {
          console.error('ChatGPT API Error:', error.message || 'Unknown error');
        }
      }
      
      throw new Error('Failed to generate couples therapy response');
    }
  }

  // Clean up individual message text by removing unwanted quotes and artifacts
  cleanMessageText(text) {
    if (!text || typeof text !== 'string') return text;
    
    const cleaned = text
      // Remove leading/trailing whitespace first
      .trim()
      // Clean up ". and '. patterns FIRST (before removing quotes)
      .replace(/\.\s*["']+\s*$/, '.')
      .replace(/"\.\s*$/, '.')
      // Remove leading quotes (single or double)
      .replace(/^["']+/, '')
      // Remove trailing quotes and quote-period combinations
      .replace(/["']+\.?\s*$/, '')
      // Clean up any remaining stray quotes at boundaries
      .replace(/^["']/, '')
      .replace(/["']$/, '')
      // Final trim
      .trim();
    
    // Return empty string if result is only punctuation (no actual content)
    if (cleaned.length > 0 && !/[a-zA-Z0-9]/.test(cleaned)) {
      return '';
    }
    
    return cleaned;
  }

  // Split therapy response into individual messages (up to 3)
  splitTherapyResponse(response) {
    if (!response || typeof response !== 'string') {
      return [response || ''];
    }

    // Try to split by numbered sections first (1., 2., 3.)
    const numberedSections = response.split(/(?=\d+\.\s)/);
    if (numberedSections.length > 1 && numberedSections.length <= 3) {
      return numberedSections
        .map(section => this.cleanMessageText(section.replace(/^\d+\.\s*/, '')))
        .filter(section => section.length > 0)
        .slice(0, 3);
    }

    // Try to split by double newlines
    const paragraphs = response.split(/\n\s*\n/);
    if (paragraphs.length > 1 && paragraphs.length <= 3) {
      return paragraphs
        .map(p => this.cleanMessageText(p))
        .filter(p => p.length > 0)
        .slice(0, 3);
    }

    // If response is too long, split into sentences and group into up to 3 messages
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

    // If no clear splits, return as single message
    return [this.cleanMessageText(response)];
  }
}

module.exports = PromptService;
