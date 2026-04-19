const BasePromptService = require('./BasePromptService');

/**
 * HopefulPromptService
 *
 * Faith-based spiritual-wellness prompt service for users associated with
 * an organization / church (org_code). Produces 7-day reflection programs
 * grounded in Christian values, scripture, and (when provided) the values
 * and teachings of the user's specific faith home.
 *
 * Selected by routes when the user has an org_code (or custom org fields)
 * associated with their account.
 */
class HopefulPromptService extends BasePromptService {
  // ── Public API ──────────────────────────────────────────────────────────

  async generateCouplesTherapyResponse(user1Name, user2Name, user1Messages, user2FirstMessage, customPrompts = null) {
    if (!this.isConfigured()) {
      throw new Error('LLM service is not configured - set OPENAI_API_KEY');
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

  async generateChimeInPrompt(userName, conversationStarter, userMessages, customPrompts = null) {
    if (!this.isConfigured()) {
      throw new Error('LLM service is not configured - set OPENAI_API_KEY');
    }

    return this.queueOpenAIRequest({
      type: 'single_user_chime_in',
      userName,
      conversationStarter,
      userMessages,
      customPrompts
    });
  }

  async generateCouplesProgram(userName, partnerName, userInput, customPrompts = null) {
    if (!this.isConfigured()) {
      throw new Error('LLM service is not configured - set OPENAI_API_KEY');
    }

    return this.queueOpenAIRequest({ type: 'program', userName, partnerName, userInput, customPrompts });
  }

  async generateNextCouplesProgram(userName, partnerName, previousConversationStarters, userInput, customPrompts = null) {
    if (!this.isConfigured()) {
      throw new Error('LLM service is not configured - set OPENAI_API_KEY');
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

  // ── Queue dispatcher ────────────────────────────────────────────────────

  async processOpenAIRequest(requestData, retryCount = 0) {
    if (requestData.type === 'chime_in_response_1') {
      return this.generateFirstChimeInPrompt(requestData, retryCount);
    } else if (requestData.type === 'single_user_chime_in') {
      return this.generateSingleUserChimeInPrompt(requestData, retryCount);
    } else if (requestData.type === 'next_program') {
      return this.generateNextProgram(requestData, retryCount);
    } else {
      return this.generateInitialProgram(requestData, retryCount);
    }
  }

  // ── Program generation (faith-based 7-day reflection) ──────────────────

  async generateInitialProgram({ userName, userInput, customPrompts }, retryCount = 0, parseRetryCount = 0) {
    const MAX_RETRIES = 2;
    const BASE_DELAY = 1000;
    const MAX_PARSE_RETRIES = 1;

    // Hoisted so the outer catch can attach the prompt to thrown errors,
    // allowing the route layer to persist it in generation_prompt even when
    // generation fails.
    let resolvedPrompt = null;
    let systemPrompt = null;

    try {
      const sanitizedUserName = this.sanitizePromptInput(userName);
      const sanitizedUserInput = this.sanitizePromptInput(userInput);

      if (![sanitizedUserInput, sanitizedUserName].every(input => this.validateInputSafety(input))) {
        throw new Error('Input contains potentially unsafe content');
      }

      const nameValidation = this.validateUserNames([sanitizedUserName]);
      if (!nameValidation.valid) {
        throw new Error(nameValidation.error);
      }

      if (sanitizedUserName.length < 1 || sanitizedUserName.length > 50) {
        throw new Error('User name must be between 1 and 50 characters');
      }
      if (sanitizedUserInput.length < 10 || sanitizedUserInput.length > 2000) {
        throw new Error('User input must be between 10 and 2000 characters');
      }

      const orgName = (customPrompts && customPrompts.organizationName) || '';
      const orgCityState = (customPrompts && customPrompts.organizationCity && customPrompts.organizationState)
        ? `${customPrompts.organizationCity}, ${customPrompts.organizationState}`
        : '';
      const orgCustomInitialProgramPrompt = (customPrompts && customPrompts.initialProgramPrompt) || '';

      const orgContext = orgName
        ? `The user attends ${orgName}${orgCityState ? ` in ${orgCityState}` : ''}. Wherever possible, draw on the values, beliefs, and teachings of that community to make each reflection feel rooted in their specific faith home.`
        : 'Ground each reflection in broadly shared Christian values and scripture.';

      const defaultPrompt = `You are a church pastor that is very skilled at creating personalized 7-day reflection programs rooted in Christian values, scripture, and the teachings of ${orgName}${orgCityState ? ` in ${orgCityState}` : ''}.

${orgContext}

The user has shared the following goal:

"${sanitizedUserInput}"

Create a 7-day daily reflection program to help this person grow closer to God and make progress toward their goal. Each day should include one focused reflection question, a unifying theme, and a related Bible verse.

Guidelines:
- Each reflection question should be deeply personal and help the user examine their own heart, motivations, and relationship with God.
- When you form the question, know that the user will be writing a journal entry in response to the question. Therefore, optimize for asking a question that a user can reflect upon and for which they can write a significant journal entry.
- Focus on the user's goal for Day 1, but with Days 2 through 7, move the user onward toward other topics that build off of that one.
- Each reflection should feel warm and pastoral in tone — like guidance from a trusted spiritual mentor.
- The theme should capture the spiritual focus for that day.
- The Bible verse should directly reinforce the reflection, not just be tangentially related.
- Write each reflection with no paragraph breaks.
- Do not reference any specific pastor or church leader by name.
- Together the 7 days should form a cohesive journey — not 7 independent prompts.

${orgCustomInitialProgramPrompt || ''}

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

      resolvedPrompt = (customPrompts && customPrompts.initialProgramPrompt)
        ? customPrompts.initialProgramPrompt
            .replace(/\{\{userName\}\}/g, sanitizedUserName)
            .replace(/\{\{userInput\}\}/g, sanitizedUserInput)
            .replace(/\{\{Church Name\}\}/g, orgName)
            .replace(/\{\{City, State\}\}/g, orgCityState)
            .replace(/\{\{User Input\}\}/g, sanitizedUserInput)
        : defaultPrompt;

      systemPrompt = "You are a faith-based spiritual wellness program creator. Respond only with valid JSON in the exact format specified. Do not include any text, explanation, or markdown outside the JSON structure.";

      const llmResult = await this.callLLM(
        systemPrompt,
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
      console.log('DEBUG HopefulPromptService.generateInitialProgram response (first 500 chars):', typeof response, response ? response.substring(0, 500) : 'NULL/EMPTY');
      console.log('DEBUG HopefulPromptService.generateInitialProgram response metadata:', responseMetadata);

      if (!this.validateAIResponse(response)) {
        console.warn('SECURITY: AI response failed validation checks');
        throw new Error('AI response contains potentially unsafe content');
      }

      try {
        const parsedResponse = JSON.parse(response);

        if (!this.validateProgramStructure(parsedResponse)) {
          throw new Error('AI response does not match expected program structure');
        }

        return this.attachPromptToResponse(parsedResponse, resolvedPrompt);
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
      if (error.status === 429 && retryCount < MAX_RETRIES) {
        const delay = BASE_DELAY * Math.pow(2, retryCount);
        console.log(`LLM rate limited, retrying in ${delay}ms (attempt ${retryCount + 1}/${MAX_RETRIES + 1})`);

        await new Promise(resolve => setTimeout(resolve, delay));
        return this.generateInitialProgram({ userName, userInput, customPrompts }, retryCount + 1, parseRetryCount);
      }

      if (error.message.includes('unsafe content') || error.message.includes('validation')) {
        console.error('SECURITY ERROR in HopefulPromptService:', error.message);
      } else {
        if (error.status === 401) {
          console.error('LLM API Error: Invalid API key');
        } else if (error.status === 429) {
          console.error(`LLM API Error: Rate limit exceeded (attempt ${retryCount + 1}/${MAX_RETRIES + 1})`);
        } else if (error.status === 403) {
          console.error('LLM API Error: Access forbidden');
        } else {
          console.error('LLM API Error:', error.message || 'Unknown error');
        }
      }

      const wrappedError = new Error('Failed to generate reflection program');
      throw this.attachPromptToError(wrappedError, resolvedPrompt);
    }
  }

  async generateNextProgram({ userName, userInput, customPrompts }, retryCount = 0, parseRetryCount = 0) {
    return this.generateInitialProgram({ userName, userInput, customPrompts }, retryCount, parseRetryCount);
  }

  // ── Chime-in / follow-up reflections ───────────────────────────────────

  async generateSingleUserChimeInPrompt({ userName, conversationStarter, userMessages, customPrompts }, retryCount = 0) {
    const MAX_RETRIES = 2;
    const BASE_DELAY = 1000;

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
        console.log(`LLM rate limited, retrying in ${delay}ms (attempt ${retryCount + 1}/${MAX_RETRIES + 1})`);

        await new Promise(resolve => setTimeout(resolve, delay));
        return this.generateSingleUserChimeInPrompt({ userName, conversationStarter, userMessages, customPrompts }, retryCount + 1);
      }

      if (error.message.includes('unsafe content') || error.message.includes('validation')) {
        console.error('SECURITY ERROR in HopefulPromptService chime-in:', error.message);
      } else {
        if (error.status === 401) {
          console.error('LLM API Error: Invalid API key');
        } else if (error.status === 429) {
          console.error(`LLM API Error: Rate limit exceeded (attempt ${retryCount + 1}/${MAX_RETRIES + 1})`);
        } else if (error.status === 403) {
          console.error('LLM API Error: Access forbidden');
        } else {
          console.error('LLM API Error:', error.message || 'Unknown error');
        }
      }

      throw new Error('Failed to generate chime-in prompt');
    }
  }

  async generateFirstChimeInPrompt({ user1Name, user2Name, user1Messages, user2FirstMessage, customPrompts }, retryCount = 0) {
    const MAX_RETRIES = 2;
    const BASE_DELAY = 1000;

    try {
      const sanitizedUser1Name = this.sanitizePromptInput(user1Name);
      const sanitizedUser2Name = this.sanitizePromptInput(user2Name);
      const sanitizedUser1Messages = Array.isArray(user1Messages)
        ? user1Messages.map(msg => this.sanitizePromptInput(msg)).join('\n\n')
        : this.sanitizePromptInput(user1Messages);
      const sanitizedUser2FirstMessage = this.sanitizePromptInput(user2FirstMessage);

      if (!this.validateInputSafety(sanitizedUser1Name) ||
          !this.validateInputSafety(sanitizedUser2Name) ||
          !this.validateInputSafety(sanitizedUser1Messages) ||
          !this.validateInputSafety(sanitizedUser2FirstMessage)) {
        throw new Error('Input contains potentially unsafe content');
      }

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

      if (!this.validateAIResponse(response, 20)) {
        console.warn('SECURITY: AI response failed validation checks');
        throw new Error('AI response contains potentially unsafe content');
      }

      const messages = this.splitTherapyResponse(response);

      return messages;
    } catch (error) {
      if (error.status === 429 && retryCount < MAX_RETRIES) {
        const delay = BASE_DELAY * Math.pow(2, retryCount);
        console.log(`LLM rate limited, retrying in ${delay}ms (attempt ${retryCount + 1}/${MAX_RETRIES + 1})`);

        await new Promise(resolve => setTimeout(resolve, delay));
        return this.generateFirstChimeInPrompt({ user1Name, user2Name, user1Messages, user2FirstMessage, customPrompts }, retryCount + 1);
      }

      if (error.message.includes('unsafe content') || error.message.includes('validation')) {
        console.error('SECURITY ERROR in HopefulPromptService therapy response:', error.message);
      } else {
        if (error.status === 401) {
          console.error('LLM API Error: Invalid API key');
        } else if (error.status === 429) {
          console.error(`LLM API Error: Rate limit exceeded (attempt ${retryCount + 1}/${MAX_RETRIES + 1})`);
        } else if (error.status === 403) {
          console.error('LLM API Error: Access forbidden');
        } else {
          console.error('LLM API Error:', error.message || 'Unknown error');
        }
      }

      throw new Error('Failed to generate couples therapy response');
    }
  }
}

module.exports = HopefulPromptService;
