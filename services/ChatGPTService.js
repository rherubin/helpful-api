class ChatGPTService {
  constructor() {
    // Validate API key format and security
    this.validateApiKey();
    
    // Store API key for direct fetch calls
    this.apiKey = process.env.OPENAI_API_KEY || null;

    // Request queue management for production scalability
    this.requestQueue = [];
    this.processing = false;
    this.lastRequestTime = 0;
    this.MIN_REQUEST_INTERVAL = 200; // 200ms between requests (5 req/sec max)
    this.MAX_CONCURRENT = 3; // Max 3 concurrent requests
    this.activeRequests = 0;
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      rateLimitErrors: 0,
      averageResponseTime: 0
    };
  }

  // Validate API key without logging the actual key
  validateApiKey() {
    const apiKey = process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      console.warn('OPENAI_API_KEY not configured - ChatGPT features will be disabled');
      return;
    }

    // Basic format validation without exposing the key format
    if (apiKey.length < 20 || apiKey.length > 200) {
      console.error('OPENAI_API_KEY appears to have invalid length - check your configuration');
      return;
    }

    // Check for common mistakes without revealing expected format
    if (apiKey.includes(' ') || apiKey.includes('\n') || apiKey.includes('\t')) {
      console.error('OPENAI_API_KEY contains whitespace - check for copy/paste errors');
      return;
    }

    // Log successful configuration with minimal information
    const maskedKey = `***${apiKey.slice(-4)}`;
    console.log(`OpenAI API key configured successfully: ${maskedKey}`);
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
      
      // Check if request has been waiting too long (30 seconds timeout)
      if (Date.now() - timestamp > 30000) {
        reject(new Error('Request timeout - OpenAI queue processing took too long'));
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
  async generateCouplesTherapyResponse(user1Name, user2Name, user1Messages, user2FirstMessage) {
    if (!this.apiKey) {
      throw new Error('ChatGPT service is not configured - OPENAI_API_KEY is required');
    }

    return this.queueOpenAIRequest({ 
      type: 'chime_in_response_1',
      user1Name, 
      user2Name, 
      user1Messages, 
      user2FirstMessage 
    });
  }

  // Public interface - queue the request
  async generateCouplesProgram(userName, partnerName, userInput) {
    if (!this.apiKey) {
      throw new Error('ChatGPT service is not configured - OPENAI_API_KEY is required');
    }

    return this.queueOpenAIRequest({ type: 'program', userName, partnerName, userInput });
  }

  // Public interface for next program generation - queue the request
  async generateNextCouplesProgram(userName, partnerName, previousConversationStarters, userInput) {
    if (!this.apiKey) {
      throw new Error('ChatGPT service is not configured - OPENAI_API_KEY is required');
    }

    return this.queueOpenAIRequest({ 
      type: 'next_program', 
      userName, 
      partnerName, 
      previousConversationStarters,
      userInput 
    });
  }

  // Process OpenAI request based on type
  async processOpenAIRequest(requestData, retryCount = 0) {
    if (requestData.type === 'chime_in_response_1') {
      return this.generateFirstChimeInPrompt(requestData, retryCount);
    } else if (requestData.type === 'chime_in_response_2') {
      return this.generateSecondChimeInPrompt(requestData, retryCount);
    } else if (requestData.type === 'next_program') {
      return this.generateNextProgram(requestData, retryCount);
    } else {
      return this.generateInitialProgram(requestData, retryCount);
    }
  }

  // Internal method that does the actual OpenAI call for programs
  async generateInitialProgram({ userName, partnerName, userInput }, retryCount = 0) {
    const MAX_RETRIES = 2;
    const BASE_DELAY = 1000; // 1 second
    
    try {
      // Sanitize all inputs
      const sanitizedUserName = this.sanitizePromptInput(userName);
      const sanitizedPartnerName = this.sanitizePromptInput(partnerName);
      const sanitizedUserInput = this.sanitizePromptInput(userInput);

      // Validate input safety
      if (!this.validateInputSafety(sanitizedUserInput) || 
          !this.validateInputSafety(sanitizedUserName) || 
          !this.validateInputSafety(sanitizedPartnerName)) {
        throw new Error('Input contains potentially unsafe content');
      }

      // Additional validation - ensure names are reasonable
      if (sanitizedUserName.length < 1 || sanitizedUserName.length > 50) {
        throw new Error('User name must be between 1 and 50 characters');
      }
      if (sanitizedPartnerName.length < 1 || sanitizedPartnerName.length > 50) {
        throw new Error('Partner name must be between 1 and 50 characters');
      }
      if (sanitizedUserInput.length < 10 || sanitizedUserInput.length > 2000) {
        throw new Error('User input must be between 10 and 2000 characters');
      }

      const prompt_new = `You're a top-tier couples therapist with deep expertise using Sue Johnson's Emotionally Focused Therapy method of couples therapy, as well as the Gottman Couples Therapy method.
      
      Your advice to couples is anchored in Emotionally Focused Therapy, but utilizes Gottman Couples Therapy methods when the context of the couple merits it.
      
      A couple comes into your therapy room. Their names are ${sanitizedUserName} and ${sanitizedPartnerName}.

      ${sanitizedUserName} says the following to you:

      “${sanitizedUserInput}”

      Your goal, as their couples therapist, is to help them talk every day for 14 consecutive days in order to solve their primary issue and enable them to experience greater emotional connection together.
      
      Specifically, your task is to provide 1 conversation-starter per day for 14 consecutive days. Each conversation starter should have the following attributes:

      - Each conversation should build upon the one before it. They should all move towards a unified goal of helping the couple experience emotional connection together.
      - Each conversation-starter should have a theme, which I'd like you to specifically identify as a separate data element.
      - Each conversation-starter should help each person unpack what they're feeling; they should be designed so that each person is able to articulate their perspective.
      - Each conversation-starter should feel very personalized. Please mention specifics about the couple throughout the program.
      - The conversation-starters should use both of their names, when appropriate.
      - The conversation-starters should feel like they're coming from a therapist. Ask the questions like a friendly therapist would ask them to their couples therapy clients.
      - Stylistically, have the entire conversation-starter in one line, with no paragraph breaks.

      Together, all of the conversation-starters make up a two-week program, which should feel comprehensive.

      Now, craft me the 14 conversation-starters, provide a theme for each one, and explain the science and research behind each question. Note that when you explain the science and research, act like you're talking directly to the couple and say it in a very accessible way. Label this science and research section: "The Science Behind It"

      Lastly, give the entire two-week program a name as well.

      Note: Don't ever reference Emotionally Focused Therapy or Gottman Couples Therapy. Instead of that, you can refer to it as a research-based couples therapy approach, or a therapy method that is scientifically backed.
      
      Please format your response as a JSON object with the following structure:

      {
        "program": {
          "title": "14-Day Emotional Connection Program for ${sanitizedUserName} and ${sanitizedPartnerName}",
          "overview": "Brief description of the program goals, which should be a single sentence that captures the overall goal of the program.",
          "days": [
            {
              "day": 1,
              "theme": "Theme name",
              "conversation_starter": "The conversation starter text",
              "science_behind_it": "Explanation of the research and science"
            }
          ]
        }
      }`;
      
      const prompt = `You're a top-tier couples therapist with deep expertise using Sue Johnson's Emotionally Focused Therapy method of couples therapy, as well as the Gottman Couples Therapy method.

      Your advice to couples is anchored in Emotionally Focused Therapy, but utilizes Gottman Couples Therapy methods when the context of the couple merits it.

      A couple comes into your therapy room. Their names are ${sanitizedUserName} and ${sanitizedPartnerName}.

      ${sanitizedUserName} says the following to you:

      "${sanitizedUserInput}"

      Your goal, as their couples therapist, is to help them talk every day for 14 consecutive days in order to solve their primary issue and enable them to experience greater emotional connection together.

      Specifically, your task is to provide 1 conversation-starter per day for 14 consecutive days. Each conversation starter should have the following attributes:

      - Each conversation should build upon the one before it. They should all move towards a unified goal of helping the couple experience emotional connection together.
      - Each conversation-starter should have a theme, which I'd like you to specifically identify as a separate data element.
      - Each conversation-starter should help each person unpack what they're feeling; they should be designed so that each person is able to articulate their perspective.
      - Each conversation-starter should feel very personalized. Please mention specifics about the couple throughout the program.
      - The conversation-starters should use both of their names, when appropriate.
      - The conversation-starters should feel like they're coming from a therapist. Ask the questions like a friendly therapist would ask them to their couples therapy clients.
      - Stylistically, have the entire conversation-starter in one line, with no paragraph breaks.

      Together, all of the conversation-starters make up a two-week program, which should feel comprehensive.

      Now, craft me the 14 conversation-starters, provide a theme for each one, and explain the science and research behind each question. Note that when you explain the science and research, act like you're talking directly to the couple and say it in a very accessible way. Label this science and research section: "The Science Behind It"

      Lastly, give the entire two-week program a name as well.

      Note: Don't ever reference Emotionally Focused Therapy or Gottman Couples Therapy. Instead of that, you can refer to it as a research-based couples therapy approach, or a therapy method that is scientifically backed.

      Please format your response as a JSON object with the following structure:

      {
        "program": {
          "title": "14-Day Emotional Connection Program for ${sanitizedUserName} and ${sanitizedPartnerName}",
          "overview": "Brief description of the program goals, which should be a single sentence that captures the overall goal of the program.",
          "days": [
            {
              "day": 1,
              "theme": "Theme name",
              "conversation_starter": "The conversation starter text",
              "science_behind_it": "Explanation of the research and science"
            }
          ]
        }
      }`;

      const completion = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [
            {
              role: "system",
              content: "You are a professional couples therapist. You must respond only with valid JSON in the specified format. Do not include any text outside the JSON structure. Focus only on therapeutic content."
            },
            {
              role: "user",
              content: prompt_new
            }
          ],
          temperature: 0.7,
          response_format: { type: "json_object" }
        })
      });

      if (!completion.ok) {
        const errorData = await completion.json().catch(() => ({}));
        const error = new Error(errorData.error?.message || 'OpenAI API request failed');
        error.status = completion.status;
        throw error;
      }

      const completionData = await completion.json();
      const response = completionData.choices[0].message.content;
      
      // Validate and sanitize the AI response
      if (!this.validateAIResponse(response)) {
        console.warn('SECURITY: AI response failed validation checks');
        throw new Error('AI response contains potentially unsafe content');
      }
      
      // Try to parse JSON response, fallback to raw text if parsing fails
      try {
        const parsedResponse = JSON.parse(response);
        
        // Validate the structure and content of the parsed response
        if (!this.validateProgramStructure(parsedResponse)) {
          throw new Error('AI response does not match expected program structure');
        }
        
        return parsedResponse;
      } catch (parseError) {
        console.warn('Failed to parse ChatGPT JSON response, returning raw text:', parseError.message);
        return response;
      }
    } catch (error) {
      // Implement exponential backoff for rate limiting
      if (error.status === 429 && retryCount < MAX_RETRIES) {
        const delay = BASE_DELAY * Math.pow(2, retryCount);
        console.log(`OpenAI rate limited, retrying in ${delay}ms (attempt ${retryCount + 1}/${MAX_RETRIES + 1})`);
        
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.generateInitialProgram({ userName, partnerName, userInput }, retryCount + 1);
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

  // Internal method for generating next program based on previous conversation starters
  async generateNextProgram({ userName, partnerName, previousConversationStarters, userInput }, retryCount = 0) {
    const MAX_RETRIES = 2;
    const BASE_DELAY = 1000; // 1 second
    
    try {
      // Sanitize all inputs
      const sanitizedUserName = this.sanitizePromptInput(userName);
      const sanitizedPartnerName = this.sanitizePromptInput(partnerName);
      const sanitizedUserInput = this.sanitizePromptInput(userInput);
      
      // Sanitize conversation starters array
      const sanitizedConversationStarters = Array.isArray(previousConversationStarters)
        ? previousConversationStarters.map(starter => this.sanitizePromptInput(starter))
        : [];

      // Validate input safety
      if (!this.validateInputSafety(sanitizedUserInput) || 
          !this.validateInputSafety(sanitizedUserName) || 
          !this.validateInputSafety(sanitizedPartnerName)) {
        throw new Error('Input contains potentially unsafe content');
      }

      // Additional validation - ensure names are reasonable
      if (sanitizedUserName.length < 1 || sanitizedUserName.length > 50) {
        throw new Error('User name must be between 1 and 50 characters');
      }
      if (sanitizedPartnerName.length < 1 || sanitizedPartnerName.length > 50) {
        throw new Error('Partner name must be between 1 and 50 characters');
      }
      if (sanitizedUserInput.length < 10 || sanitizedUserInput.length > 2000) {
        throw new Error('User input must be between 10 and 2000 characters');
      }

      // Build the list of previous questions
      let previousQuestionsText = '';
      if (sanitizedConversationStarters.length > 0) {
        previousQuestionsText = sanitizedConversationStarters
          .map((starter, index) => `${index + 1}. "${starter}"`)
          .join('\n');
      }

      const prompt = `You're a top-tier couples therapist with deep expertise using Sue Johnson's Emotionally Focused Therapy method of couples therapy, as well as the Gottman Couples Therapy method.

Your advice to couples is anchored in Emotionally Focused Therapy, but utilizes Gottman Couples Therapy methods when the context of the couple merits it.

You've been working with a couple, whose names are ${sanitizedUserName} and ${sanitizedPartnerName}.

${sanitizedUserName} and ${sanitizedPartnerName} have answered the following questions in your therapy room already:

${previousQuestionsText}

Having completed those questions together, they are ready to make more progress together with you as their therapist.

${sanitizedUserName} says the following to you:

"${sanitizedUserInput}"

Your goal, as their couples therapist, is to help them talk every day for 14 consecutive days in order to solve their primary issue and enable them to experience greater emotional connection together.

Specifically, your task is to provide 1 conversation-starter per day for 14 consecutive days. Each conversation starter should have the following attributes:

- Each conversation should build upon the one before it. They should all move towards a unified goal of helping the couple experience emotional connection together.  
- Each conversation-starter should have a theme, which I'd like you to specifically identify as a separate data element.
- Each conversation-starter should help each person unpack what they're feeling; they should be designed so that each person is able to articulate their perspective. We should never have a scenario where one person is talking more than the other.
- Each conversation-starter should be designed so that it brings the couple closer together during that day and makes them feel like more of a team.
- The conversation-starters should use both of their names, when appropriate.
- The conversation-starters should reference details from their relationship, when appropriate. This is optional.
- The conversation-starters should feel a little lighter, not as serious. Make them very conversational in tone, as if you were a friend to the couple.

Together, all of the conversation-starters make up a two-week program, which should feel comprehensive.

You should not use any of the conversation-starters that they've already answered.

Now, craft me the 14 conversation-starters, provide a theme for each one, and explain the science and research behind each question. Note that when you explain the science and research, act like you're talking directly to the couple and say it in a very accessible way. Label this science and research section: "The Science Behind It"

Note: Don't ever reference Emotionally Focused Therapy or Gottman Couples Therapy. Instead of that, you can refer to it as a research-based couples therapy approach, or a therapy method that is scientifically backed.

Please format your response as a JSON object with the following structure:
{
  "program": {
    "title": "14-Day Emotional Connection Program for ${sanitizedUserName} and ${sanitizedPartnerName}",
    "overview": "Brief description of the program goals",
    "days": [
      {
        "day": 1,
        "theme": "Theme name",
        "conversation_starter": "The conversation starter text",
        "science_behind_it": "Explanation of the research and science"
      }
    ]
  }
}`;

      const completion = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [
            {
              role: "system",
              content: "You are a professional couples therapist. You must respond only with valid JSON in the specified format. Do not include any text outside the JSON structure. Focus only on therapeutic content."
            },
            {
              role: "user",
              content: prompt
            }
          ],
          max_tokens: 4000,
          temperature: 0.7,
          response_format: { type: "json_object" }
        })
      });

      if (!completion.ok) {
        const errorData = await completion.json().catch(() => ({}));
        const error = new Error(errorData.error?.message || 'OpenAI API request failed');
        error.status = completion.status;
        throw error;
      }

      const completionData = await completion.json();
      const response = completionData.choices[0].message.content;
      
      // Validate and sanitize the AI response
      if (!this.validateAIResponse(response)) {
        console.warn('SECURITY: AI response failed validation checks');
        throw new Error('AI response contains potentially unsafe content');
      }
      
      // Try to parse JSON response, fallback to raw text if parsing fails
      try {
        const parsedResponse = JSON.parse(response);
        
        // Validate the structure and content of the parsed response
        if (!this.validateProgramStructure(parsedResponse)) {
          throw new Error('AI response does not match expected program structure');
        }
        
        return parsedResponse;
      } catch (parseError) {
        console.warn('Failed to parse ChatGPT JSON response, returning raw text:', parseError.message);
        return response;
      }
    } catch (error) {
      // Implement exponential backoff for rate limiting
      if (error.status === 429 && retryCount < MAX_RETRIES) {
        const delay = BASE_DELAY * Math.pow(2, retryCount);
        console.log(`OpenAI rate limited, retrying in ${delay}ms (attempt ${retryCount + 1}/${MAX_RETRIES + 1})`);
        
        await new Promise(resolve => setTimeout(resolve, delay));
        
        return this.generateNextProgram({ userName, partnerName, previousConversationStarters, userInput }, retryCount + 1);
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
      
      throw new Error('Failed to generate next couples therapy program');
    }
  }

  // Check if OpenAI API key is configured
  isConfigured() {
    return !!process.env.OPENAI_API_KEY;
  }

  // Validate AI response for potentially unsafe content
  validateAIResponse(response) {
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
    if (response.length < 100) {
      console.warn('SECURITY: AI response too short, possible refusal');
      return false;
    }

    return true;
  }

  // Validate the structure of the therapy program response
  validateProgramStructure(programData) {
    try {
      // Check top-level structure
      if (!programData || typeof programData !== 'object') return false;
      if (!programData.program || typeof programData.program !== 'object') return false;
      
      const program = programData.program;
      
      // Check required fields
      if (!program.title || typeof program.title !== 'string') return false;
      if (!program.days || !Array.isArray(program.days)) return false;
      
      // Validate days array
      if (program.days.length !== 14) return false;
      
      for (let i = 0; i < program.days.length; i++) {
        const day = program.days[i];
        
        // Check required day fields
        if (typeof day !== 'object') return false;
        if (day.day !== (i + 1)) return false;
        if (!day.theme || typeof day.theme !== 'string') return false;
        if (!day.conversation_starter || typeof day.conversation_starter !== 'string') return false;
        if (!day.science_behind_it || typeof day.science_behind_it !== 'string') return false;
        
        // Validate content length (ensure substantial content, but be more lenient)
        if (day.theme.length < 3 || day.theme.length > 300) {
          console.warn(`Day ${day.day} theme length out of range: ${day.theme.length}`);
          return false;
        }
        if (day.conversation_starter.length < 10 || day.conversation_starter.length > 2000) {
          console.warn(`Day ${day.day} conversation_starter length out of range: ${day.conversation_starter.length}`);
          return false;
        }
        if (day.science_behind_it.length < 20 || day.science_behind_it.length > 5000) {
          console.warn(`Day ${day.day} science_behind_it length out of range: ${day.science_behind_it.length}`);
          return false;
        }
        
        // Additional content validation - ensure therapeutic content
        // Check for broader therapeutic keywords to be more lenient
        const therapeuticKeywords = [
          /relationship/i, /couple/i, /partner/i, /communication/i, 
          /emotion/i, /feeling/i, /connect/i, /bond/i, /love/i, /trust/i,
          /together/i, /share/i, /understand/i, /listen/i, /support/i,
          /care/i, /respect/i, /intimacy/i, /attachment/i, /secure/i
        ];
        
        const hasTherapeuticContent = therapeuticKeywords.some(keyword => 
          keyword.test(day.conversation_starter) || 
          keyword.test(day.science_behind_it) || 
          keyword.test(day.theme)
        );
        
        // Only warn but don't fail validation - GPT-5 might use different therapeutic language
        if (!hasTherapeuticContent) {
          console.warn(`SECURITY: Day ${day.day} lacks common therapeutic keywords (but may still be valid)`);
        }
      }
      
      return true;
    } catch (error) {
      console.error('Error validating program structure:', error.message);
      return false;
    }
  }

  // Internal method for generating couples therapy responses
  async generateFirstChimeInPrompt({ user1Name, user2Name, user1Messages, user2FirstMessage }, retryCount = 0) {
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

      const prompt = `You're a top-tier couples therapist with deep expertise using Sue Johnson's Emotionally Focused Therapy method of couples therapy, as well as the Gottman Couples Therapy method.

Your advice to couples is anchored in Emotionally Focused Therapy, but utilizes Gottman Couples Therapy methods when the context of the couple merits it.

A couple comes into your therapy room.

Your first question to them is: "Hey ${sanitizedUser1Name}, do you remember the time we went on that spontaneous road trip to the coast? What was your favorite part of that trip?"

${sanitizedUser1Name} says:

"${sanitizedUser1Messages}"

Then, ${sanitizedUser2Name} says in response:

"${sanitizedUser2FirstMessage}"

Your goal, as their couples therapist, is to chime into this conversation and ask one follow-up question that enables the conversation to progress in the healthiest, most positive way possible.`;

      const completion = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [
            {
              role: "user",
              content: prompt
            }
          ],
          max_tokens: 2000,
          temperature: 0.7
        })
      });

      if (!completion.ok) {
        const errorData = await completion.json().catch(() => ({}));
        const error = new Error(errorData.error?.message || 'OpenAI API request failed');
        error.status = completion.status;
        throw error;
      }

      const completionData = await completion.json();
      const response = completionData.choices[0].message.content;
      
      // Validate and sanitize the AI response
      if (!this.validateAIResponse(response)) {
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
        return this.generateFirstChimeInPrompt({ user1Name, user2Name, user1Messages, user2FirstMessage }, retryCount + 1);
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

  // Split therapy response into individual messages (up to 3)
  splitTherapyResponse(response) {
    if (!response || typeof response !== 'string') {
      return [response || ''];
    }

    // Try to split by numbered sections first (1., 2., 3.)
    const numberedSections = response.split(/(?=\d+\.\s)/);
    if (numberedSections.length > 1 && numberedSections.length <= 3) {
      return numberedSections
        .map(section => section.replace(/^\d+\.\s*/, '').trim())
        .filter(section => section.length > 0)
        .slice(0, 3);
    }

    // Try to split by double newlines
    const paragraphs = response.split(/\n\s*\n/);
    if (paragraphs.length > 1 && paragraphs.length <= 3) {
      return paragraphs
        .map(p => p.trim())
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
          groups.push(group + (group.endsWith('.') ? '' : '.'));
        }
      }
      return groups.slice(0, 3);
    }

    // If no clear splits, return as single message
    return [response.trim()];
  }
}

module.exports = ChatGPTService;
