const BasePromptService = require('./BasePromptService');

/**
 * HelpfulPromptService
 *
 * Secular couples-therapy prompt service for users NOT associated with an
 * organization / church. Grounded in Sue Johnson's Emotionally Focused
 * Therapy (EFT) and the Gottman Couples Therapy method. Produces 14-day
 * conversation-starter programs designed for two paired partners.
 *
 * Ported from the pre-org-code services/ChatGPTService.js, modernized to
 * route through BasePromptService.callLLM for multi-provider support and
 * to use jsonMode + parse retries for stability.
 *
 * Selected by routes when the user has NO org_code or custom org fields.
 */
class HelpfulPromptService extends BasePromptService {
  // ── Public API ──────────────────────────────────────────────────────────

  async generateCouplesTherapyResponse(user1Name, user2Name, user1Messages, user2FirstMessage, _customPrompts = null) {
    if (!this.isConfigured()) {
      throw new Error('LLM service is not configured - set OPENAI_API_KEY');
    }

    return this.queueOpenAIRequest({
      type: 'chime_in_response_1',
      user1Name,
      user2Name,
      user1Messages,
      user2FirstMessage
    });
  }

  async generateChimeInPrompt(userName, conversationStarter, userMessages, _customPrompts = null) {
    if (!this.isConfigured()) {
      throw new Error('LLM service is not configured - set OPENAI_API_KEY');
    }

    return this.queueOpenAIRequest({
      type: 'single_user_chime_in',
      userName,
      conversationStarter,
      userMessages
    });
  }

  async generateCouplesProgram(userName, partnerName, userInput, _customPrompts = null) {
    if (!this.isConfigured()) {
      throw new Error('LLM service is not configured - set OPENAI_API_KEY');
    }

    return this.queueOpenAIRequest({ type: 'program', userName, partnerName, userInput });
  }

  async generateNextCouplesProgram(userName, partnerName, previousConversationStarters, userInput, _customPrompts = null) {
    if (!this.isConfigured()) {
      throw new Error('LLM service is not configured - set OPENAI_API_KEY');
    }

    return this.queueOpenAIRequest({
      type: 'next_program',
      userName,
      partnerName,
      previousConversationStarters,
      userInput
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

  // ── Program generation (couples 14-day EFT/Gottman) ────────────────────

  // Accepts { userName, partnerName, userInput, customPrompts? } so callers
  // can use the same shape they use with HopefulPromptService. customPrompts
  // is accepted for signature parity but ignored here (couples flow never
  // applies org-specific overrides).
  async generateInitialProgram({ userName, partnerName, userInput }, retryCount = 0, parseRetryCount = 0) {
    const MAX_RETRIES = 2;
    const BASE_DELAY = 1000;
    const MAX_PARSE_RETRIES = 1;

    try {
      const sanitizedUserName = this.sanitizePromptInput(userName);
      const sanitizedPartnerName = this.sanitizePromptInput(partnerName);
      const sanitizedUserInput = this.sanitizePromptInput(userInput);

      if (!this.validateInputSafety(sanitizedUserInput) ||
          !this.validateInputSafety(sanitizedUserName) ||
          !this.validateInputSafety(sanitizedPartnerName)) {
        throw new Error('Input contains potentially unsafe content');
      }

      const nameValidation = this.validateUserNames([sanitizedUserName, sanitizedPartnerName]);
      if (!nameValidation.valid) {
        throw new Error(nameValidation.error);
      }

      if (sanitizedUserName.length < 1 || sanitizedUserName.length > 50) {
        throw new Error('User name must be between 1 and 50 characters');
      }
      if (sanitizedPartnerName.length < 1 || sanitizedPartnerName.length > 50) {
        throw new Error('Partner name must be between 1 and 50 characters');
      }
      if (sanitizedUserInput.length < 10 || sanitizedUserInput.length > 2000) {
        throw new Error('User input must be between 10 and 2000 characters');
      }

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
- The first conversation-starter should use both of their names, but the remainder of the conversation-starters should not, unless you're asking each person a different question and you need to.
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

      const llmResult = await this.callLLM(
        "You are a professional couples therapist. You must respond only with valid JSON in the specified format. Do not include any text outside the JSON structure. Focus only on therapeutic content.",
        prompt,
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
      console.log('DEBUG HelpfulPromptService.generateInitialProgram response (first 500 chars):', typeof response, response ? response.substring(0, 500) : 'NULL/EMPTY');
      console.log('DEBUG HelpfulPromptService.generateInitialProgram response metadata:', responseMetadata);

      if (!this.validateAIResponse(response)) {
        console.warn('SECURITY: AI response failed validation checks');
        throw new Error('AI response contains potentially unsafe content');
      }

      try {
        const parsedResponse = JSON.parse(response);

        if (!this.validateProgramStructure(parsedResponse)) {
          throw new Error('AI response does not match expected program structure');
        }

        return parsedResponse;
      } catch (parseError) {
        console.warn('Failed to parse/validate HelpfulPromptService.generateInitialProgram response:', {
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
            { userName, partnerName, userInput },
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
        return this.generateInitialProgram({ userName, partnerName, userInput }, retryCount + 1, parseRetryCount);
      }

      if (error.message.includes('unsafe content') || error.message.includes('validation')) {
        console.error('SECURITY ERROR in HelpfulPromptService:', error.message);
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

      throw new Error('Failed to generate couples therapy program');
    }
  }

  async generateNextProgram({ userName, partnerName, previousConversationStarters, userInput }, retryCount = 0, parseRetryCount = 0) {
    const MAX_RETRIES = 2;
    const BASE_DELAY = 1000;
    const MAX_PARSE_RETRIES = 1;

    try {
      const sanitizedUserName = this.sanitizePromptInput(userName);
      const sanitizedPartnerName = this.sanitizePromptInput(partnerName);
      const sanitizedUserInput = this.sanitizePromptInput(userInput);

      const sanitizedConversationStarters = Array.isArray(previousConversationStarters)
        ? previousConversationStarters.map(starter => this.sanitizePromptInput(starter))
        : [];

      if (!this.validateInputSafety(sanitizedUserInput) ||
          !this.validateInputSafety(sanitizedUserName) ||
          !this.validateInputSafety(sanitizedPartnerName)) {
        throw new Error('Input contains potentially unsafe content');
      }

      const nameValidation = this.validateUserNames([sanitizedUserName, sanitizedPartnerName]);
      if (!nameValidation.valid) {
        throw new Error(nameValidation.error);
      }

      if (sanitizedUserName.length < 1 || sanitizedUserName.length > 50) {
        throw new Error('User name must be between 1 and 50 characters');
      }
      if (sanitizedPartnerName.length < 1 || sanitizedPartnerName.length > 50) {
        throw new Error('Partner name must be between 1 and 50 characters');
      }
      if (sanitizedUserInput.length < 10 || sanitizedUserInput.length > 2000) {
        throw new Error('User input must be between 10 and 2000 characters');
      }

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

      const llmResult = await this.callLLM(
        "You are a professional couples therapist. You must respond only with valid JSON in the specified format. Do not include any text outside the JSON structure. Focus only on therapeutic content.",
        prompt,
        { maxTokens: 4000, temperature: 0.7, jsonMode: true }
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
      console.log('DEBUG HelpfulPromptService.generateNextProgram response (first 500 chars):', typeof response, response ? response.substring(0, 500) : 'NULL/EMPTY');
      console.log('DEBUG HelpfulPromptService.generateNextProgram response metadata:', responseMetadata);

      if (!this.validateAIResponse(response)) {
        console.warn('SECURITY: AI response failed validation checks');
        throw new Error('AI response contains potentially unsafe content');
      }

      try {
        const parsedResponse = JSON.parse(response);

        if (!this.validateProgramStructure(parsedResponse)) {
          throw new Error('AI response does not match expected program structure');
        }

        return parsedResponse;
      } catch (parseError) {
        console.warn('Failed to parse/validate HelpfulPromptService.generateNextProgram response:', {
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
          return this.generateNextProgram(
            { userName, partnerName, previousConversationStarters, userInput },
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
        return this.generateNextProgram({ userName, partnerName, previousConversationStarters, userInput }, retryCount + 1, parseRetryCount);
      }

      if (error.message.includes('unsafe content') || error.message.includes('validation')) {
        console.error('SECURITY ERROR in HelpfulPromptService:', error.message);
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

      throw new Error('Failed to generate next couples therapy program');
    }
  }

  // ── Chime-in / follow-up (couples + secular single-user) ───────────────

  async generateSingleUserChimeInPrompt({ userName, conversationStarter, userMessages }, retryCount = 0) {
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

      const prompt = `You're a top-tier couples therapist with deep expertise using Sue Johnson's Emotionally Focused Therapy method of couples therapy, as well as the Gottman Couples Therapy method.

Your advice to couples is anchored in Emotionally Focused Therapy, but utilizes Gottman Couples Therapy methods when the context of the couple merits it.

A user comes into your therapy room.

Your first question to them is: "${sanitizedConversationStarter}"

${sanitizedUserName} says:

"${sanitizedUserMessages}"

Your goal, as their couples therapist, is to ask one follow-up question that enables ${sanitizedUserName} to keep reflecting on their relationship.

Do not reference Emotionally Focused Therapy or Gottman Couples Therapy by name.`;

      const llmResult = await this.callLLM(
        "You are a research-based couples therapist. Respond with exactly one warm follow-up reflection question and no extra explanation.",
        prompt,
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
        return this.generateSingleUserChimeInPrompt({ userName, conversationStarter, userMessages }, retryCount + 1);
      }

      if (error.message.includes('unsafe content') || error.message.includes('validation')) {
        console.error('SECURITY ERROR in HelpfulPromptService chime-in:', error.message);
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

  async generateFirstChimeInPrompt({ user1Name, user2Name, user1Messages, user2FirstMessage }, retryCount = 0) {
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

      const prompt = `You're a top-tier couples therapist with deep expertise using Sue Johnson's Emotionally Focused Therapy method of couples therapy, as well as the Gottman Couples Therapy method.

Your advice to couples is anchored in Emotionally Focused Therapy, but utilizes Gottman Couples Therapy methods when the context of the couple merits it.

A couple comes into your therapy room.

Your first question to them is: "Hey ${sanitizedUser1Name}, do you remember the time we went on that spontaneous road trip to the coast? What was your favorite part of that trip?"

${sanitizedUser1Name} says:

"${sanitizedUser1Messages}"

Then, ${sanitizedUser2Name} says in response:

"${sanitizedUser2FirstMessage}"

Your goal, as their couples therapist, is to chime into this conversation and ask one follow-up question that enables the conversation to progress in the healthiest, most positive way possible.

When you create the follow-up conversation-starter for the couple, please do not assume that the couple is traveling or has been on a vacation or road trip unless they explicitly reference traveling, vacations, or road trips. Most commonly, the couple will be discussing a relationship dynamic. `;

      const llmResult = await this.callLLM(
        null,
        prompt,
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
        return this.generateFirstChimeInPrompt({ user1Name, user2Name, user1Messages, user2FirstMessage }, retryCount + 1);
      }

      if (error.message.includes('unsafe content') || error.message.includes('validation')) {
        console.error('SECURITY ERROR in HelpfulPromptService therapy response:', error.message);
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

module.exports = HelpfulPromptService;
