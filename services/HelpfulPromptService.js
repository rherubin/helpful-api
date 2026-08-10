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

  // Sit Session (prompt_sessions) content from completed prep(s).
  // partners: array of { name, prep } — one (single-device / solo) or two (paired).
  // Output is always couple-shaped; with one prep the model still writes for both
  // people in the room (pairing can happen later).
  // prep fields map to product copy in buildSitSessionPrepBlock().
  async generateSitSessionContent(partners) {
    if (!this.isConfigured()) {
      throw new Error('LLM service is not configured - set OPENAI_API_KEY');
    }
    if (!Array.isArray(partners) || partners.length < 1 || partners.length > 2) {
      throw new Error('Sit Session generation requires one or two partner preps');
    }

    return this.queueOpenAIRequest({
      type: 'sit_session',
      partners
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
    } else if (requestData.type === 'sit_session') {
      return this.generateSitSession(requestData, retryCount);
    } else {
      return this.generateInitialProgram(requestData, retryCount);
    }
  }

  // ── Sit Session generation (Bridge + Session from prep) ────────────────

  // Prep column → product line in the generation prompt. Field names are
  // API-stable storage keys; wording is the Sit Session product copy.
  //
  //   1. They're feeling {{selection}}              → gratitude
  //   2. Emotional tank (very full / somewhat full / empty) → energy_level
  //   3. Closeness (very close / somewhat close / distant)  → boundary
  //   4. Tone of the session                        → intention
  //   5. Topic                                      → curiosity
  //   6. Free-form text                             → bringing_text
  //   optional_focus is appended to free-form when present.
  static get SIT_SESSION_PREP_LINES() {
    return [
      { field: 'gratitude', template: (v) => `1. They're feeling ${v}` },
      { field: 'energy_level', template: (v) => `2. Their emotional tank is feeling ${v} right now` },
      { field: 'boundary', template: (v) => `3. They're feeling ${v} to their partner` },
      { field: 'intention', template: (v) => `4. They want the tone of the session to be ${v}` },
      { field: 'curiosity', template: (v) => `5. They want the topic to ${v}` },
      {
        field: 'bringing_text',
        template: (v, prep) => {
          let line = `6. In a free form text field, they've entered ${v}`;
          const focus = prep && prep.optional_focus != null && String(prep.optional_focus).trim() !== ''
            ? String(prep.optional_focus).trim()
            : null;
          if (focus) {
            line += ` (optional focus: ${focus})`;
          }
          return line;
        }
      }
    ];
  }

  // Build one partner's block:
  //   "{{Name}} says:\n\n1. ...\n2. ..."
  buildSitSessionPartnerBlock(name, prep) {
    const safeName = this.sanitizePromptInput(name) || 'Partner';
    const lines = HelpfulPromptService.SIT_SESSION_PREP_LINES.map(({ field, template }) => {
      const raw = prep && prep[field] != null ? String(prep[field]) : '';
      const value = this.sanitizePromptInput(raw) || '(not provided)';
      return template(value, prep);
    });
    return `${safeName} says:\n\n${lines.join('\n')}`;
  }

  // Full user-facing prep summary used as the core of generation_prompt.
  // partners: [{ name, prep }, ...]
  buildSitSessionPrepPrompt(partners) {
    if (!Array.isArray(partners) || partners.length === 0) {
      throw new Error('At least one partner prep is required for Sit Session generation');
    }
    return partners
      .map(({ name, prep }) => this.buildSitSessionPartnerBlock(name, prep || {}))
      .join('\n\n');
  }

  async generateSitSession({ partners }, retryCount = 0, parseRetryCount = 0) {
    const MAX_RETRIES = 2;
    const BASE_DELAY = 1000;
    const MAX_PARSE_RETRIES = 1;

    let prompt = null;
    let systemPrompt = null;

    try {
      if (!Array.isArray(partners) || partners.length < 1 || partners.length > 2) {
        throw new Error('Sit Session generation requires one or two partner preps');
      }

      const sanitizedPartners = partners.map(({ name, prep }) => {
        const sanitizedName = this.sanitizePromptInput(name);
        if (!this.validateInputSafety(sanitizedName)) {
          throw new Error('Input contains potentially unsafe content');
        }
        const nameValidation = this.validateUserNames([sanitizedName]);
        if (!nameValidation.valid) {
          throw new Error(nameValidation.error);
        }
        if (sanitizedName.length < 1 || sanitizedName.length > 50) {
          throw new Error('User name must be between 1 and 50 characters');
        }

        const sanitizedPrep = {};
        for (const field of [
          'bringing_text', 'energy_level', 'intention', 'curiosity',
          'boundary', 'gratitude', 'optional_focus'
        ]) {
          const raw = prep && prep[field] != null ? String(prep[field]) : '';
          const cleaned = this.sanitizePromptInput(raw);
          if (cleaned && !this.validateInputSafety(cleaned)) {
            throw new Error('Input contains potentially unsafe content');
          }
          sanitizedPrep[field] = cleaned;
        }

        return { name: sanitizedName, prep: sanitizedPrep };
      });

      const prepBlock = this.buildSitSessionPrepPrompt(sanitizedPartners);
      const isSingleDevice = sanitizedPartners.length === 1;
      const partnerA = sanitizedPartners[0];
      const partnerB = sanitizedPartners[1] || { name: 'Partner' };

      const comparisonInstructions = isSingleDevice
        ? `2. A quick comparison of how they are entering into the session. Only ${partnerA.name}'s prep answers are available (single-device / shared-phone flow — pairing may happen later). Still write: one sentence for Partner 1 (${partnerA.name}), one sentence for Partner 2 (their partner in the room — label partner as "${partnerB.name}"), and one insight sentence. Infer Partner 2 carefully from how ${partnerA.name} described closeness, tone, and topic; do not invent private facts about Partner 2.`
        : `2. A quick comparison of how the partner is entering into the session, based on what they said in their onboarding. The format should be: one sentence for Partner 1 (${partnerA.name}), one sentence for Partner 2 (${partnerB.name}), and one sentence for the insight. For the insight, analyze what they say and pull out something interesting, either a commonality or difference.`;

      const reflectionInstructions = isSingleDevice
        ? `3. Two reflections — one for ${partnerA.name} and one for their partner (${partnerB.name}). Return each as a structured question the app can pull in. Partner 2's reflection should invite the other person in based on ${partnerA.name}'s prep, without assuming unstated details.`
        : `3. Two reflections, one for each person. Return this as a structured question that I can pull into an app.`;

      const availabilityNote = isSingleDevice
        ? `\nNote: This is a single-device Sit Session. Only one prep block is provided below, but both people are (or will be) together in person for the session. Create a full couple experience anyway.\n`
        : '';

      prompt = `You're a relationship expert, trained in a number of methodologies from experts like John Gottman and Sue Johnson (but not limited to them), and a couple sits with you in order to make progress today. They come to you a few times a week, and each time, they leave feeling better than when they arrived.

Your job is to take in information from the couple, bridge their perspectives and how they're healing, and then create then an app-based session they can do together in person.
${availabilityNote}
Here's the session content:

1. A few short paragraphs of psychoeducation, with references to studies and science (can be others besides Gottman and Johnson, but you can also use them if it fits best). Also return a structured references array the app can render separately (citation + optional note) — do not only name-drop studies inline.

${comparisonInstructions}

${reflectionInstructions}

4. One conversation-starter for the couple. Return this as a structured question that I can pull into an app. Ensure that the conversation-starter builds on the reflection questions they just did together, and start immediately with the conversation-starter text.

5. One challenge or activity for the couple. Since the couple will be together in person, feel free to creatively give them things they can do in person together. The format should be in steps, which each step called out as 1, 2, 3, etc. And each step should have a title, a body, and any optional bullets (if there are steps within the step). Return this as a structured exercise that I can pull into an app.

Here's what each person has said:

${prepBlock}

Now, create the session and keep in mind that I want the experience to feel really novel and interesting and helpful. The couple should think "wow, this is unique," and after they take it, they should say, "we feel better."

Respond with ONLY a JSON object. No markdown. No extra top-level keys. Use exactly this shape and these field names:

{
  "bridge": {
    "psychoeducation": {
      "body": "string (a few short paragraphs)",
      "references": [
        { "citation": "string", "note": "string (optional)" }
      ]
    },
    "comparison": {
      "partner_1": "string (one sentence about ${partnerA.name})",
      "partner_2": "string (one sentence about ${partnerB.name})",
      "insight": "string (one sentence commonality or difference)"
    }
  },
  "session": {
    "reflections": [
      { "partner": "${partnerA.name}", "question": "string" },
      { "partner": "${partnerB.name}", "question": "string" }
    ],
    "conversation_starter": { "question": "string (start immediately with the conversation-starter text)" },
    "challenge": {
      "title": "string",
      "steps": [
        {
          "number": 1,
          "title": "string",
          "body": "string",
          "bullets": ["string"]
        }
      ]
    }
  }
}`;

      systemPrompt = 'You are a relationship expert facilitating an in-person couples Sit Session. Respond only with valid JSON matching the exact schema requested. Required: bridge.psychoeducation.body (string), bridge.psychoeducation.references (non-empty array of {citation, optional note}), bridge.comparison.partner_1/partner_2/insight (strings), session.reflections (exactly two {partner, question}), session.conversation_starter.question (string that starts with the starter text), session.challenge.title (string), session.challenge.steps (non-empty array of {number, title, body, optional bullets}). Do not include markdown, commentary, or extra top-level keys.';

      const llmResult = await this.callLLM(
        systemPrompt,
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
      console.log('DEBUG HelpfulPromptService.generateSitSession response (first 500 chars):', typeof response, response ? response.substring(0, 500) : 'NULL/EMPTY');
      console.log('DEBUG HelpfulPromptService.generateSitSession response metadata:', responseMetadata);

      if (!this.validateAIResponse(response, 50)) {
        console.warn('SECURITY: AI response failed validation checks');
        throw new Error('AI response contains potentially unsafe content');
      }

      try {
        const parsedResponse = JSON.parse(response);
        const normalized = this.normalizeSitSessionResponse(parsedResponse);

        if (!normalized) {
          throw new Error('AI response does not match expected Sit Session structure');
        }

        return this.attachPromptToResponse(normalized, prompt);
      } catch (parseError) {
        console.warn('Failed to parse/validate HelpfulPromptService.generateSitSession response:', {
          parse_retry_attempt: parseRetryCount + 1,
          max_parse_retries: MAX_PARSE_RETRIES,
          parse_error: parseError.message,
          response_preview: response ? response.substring(0, 300) : 'EMPTY',
          response_length: response ? response.length : 0,
          ...responseMetadata
        });

        if (parseRetryCount < MAX_PARSE_RETRIES) {
          await new Promise(resolve => setTimeout(resolve, 500));
          return this.generateSitSession({ partners }, retryCount, parseRetryCount + 1);
        }

        throw new Error(
          `Invalid Sit Session response format after retry ` +
          `(finish_reason=${finishReason}, model=${responseMetadata.model}, ` +
          `response_length=${response ? response.length : 0}): ${parseError.message}`
        );
      }
    } catch (error) {
      if (error.status === 429 && retryCount < MAX_RETRIES) {
        const delay = BASE_DELAY * Math.pow(2, retryCount);
        console.log(`LLM rate limited, retrying in ${delay}ms (attempt ${retryCount + 1}/${MAX_RETRIES + 1})`);

        await new Promise(resolve => setTimeout(resolve, delay));
        return this.generateSitSession({ partners }, retryCount + 1, parseRetryCount);
      }

      if (error.message.includes('unsafe content') || error.message.includes('validation')) {
        console.error('SECURITY ERROR in HelpfulPromptService Sit Session:', error.message);
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

      const wrappedError = new Error('Failed to generate Sit Session content');
      throw this.attachPromptToError(wrappedError, prompt);
    }
  }

  // Minimum lengths for required string fields after trim.
  static get SIT_SESSION_MIN_LENGTHS() {
    return {
      psychoeducationBody: 40,
      citation: 8,
      comparisonSentence: 15,
      partner: 1,
      question: 15,
      challengeTitle: 5,
      stepTitle: 3,
      stepBody: 15
    };
  }

  // True when raw LLM JSON matches the strict Sit Session contract.
  validateSitSessionStructure(parsed) {
    return this.normalizeSitSessionResponse(parsed) !== null;
  }

  // Validate + normalize LLM output into the canonical API/DB shape.
  // Drops unknown keys. Returns null if required fields are missing/invalid.
  //
  // Canonical shape:
  // {
  //   bridge: {
  //     psychoeducation: { body, references: [{ citation, note? }] },
  //     comparison: { partner_1, partner_2, insight }
  //   },
  //   session: {
  //     reflections: [{ partner, question }, { partner, question }],
  //     conversation_starter: { question },
  //     challenge: { title, steps: [{ number, title, body, bullets? }] }
  //   }
  // }
  normalizeSitSessionResponse(parsed) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    if (!parsed.bridge || typeof parsed.bridge !== 'object' || Array.isArray(parsed.bridge)) return null;
    if (!parsed.session || typeof parsed.session !== 'object' || Array.isArray(parsed.session)) return null;

    const mins = HelpfulPromptService.SIT_SESSION_MIN_LENGTHS;
    const psycho = parsed.bridge.psychoeducation;
    const comparison = parsed.bridge.comparison;
    if (!psycho || typeof psycho !== 'object' || Array.isArray(psycho)) return null;
    if (!comparison || typeof comparison !== 'object' || Array.isArray(comparison)) return null;

    const body = typeof psycho.body === 'string' ? psycho.body.trim() : '';
    if (body.length < mins.psychoeducationBody) return null;
    if (!Array.isArray(psycho.references) || psycho.references.length < 1) return null;

    const references = [];
    for (const ref of psycho.references) {
      if (!ref || typeof ref !== 'object' || Array.isArray(ref)) return null;
      const citation = typeof ref.citation === 'string' ? ref.citation.trim() : '';
      if (citation.length < mins.citation) return null;
      const note = typeof ref.note === 'string' ? ref.note.trim() : '';
      const normalizedRef = { citation };
      if (note) normalizedRef.note = note;
      references.push(normalizedRef);
    }

    const partner1 = typeof comparison.partner_1 === 'string' ? comparison.partner_1.trim() : '';
    const partner2 = typeof comparison.partner_2 === 'string' ? comparison.partner_2.trim() : '';
    const insight = typeof comparison.insight === 'string' ? comparison.insight.trim() : '';
    if (partner1.length < mins.comparisonSentence) return null;
    if (partner2.length < mins.comparisonSentence) return null;
    if (insight.length < mins.comparisonSentence) return null;

    if (!Array.isArray(parsed.session.reflections) || parsed.session.reflections.length !== 2) {
      return null;
    }
    const reflections = [];
    for (const reflection of parsed.session.reflections) {
      if (!reflection || typeof reflection !== 'object' || Array.isArray(reflection)) return null;
      const partner = typeof reflection.partner === 'string' ? reflection.partner.trim() : '';
      const question = typeof reflection.question === 'string' ? reflection.question.trim() : '';
      if (partner.length < mins.partner) return null;
      if (question.length < mins.question) return null;
      reflections.push({ partner, question });
    }

    const starter = parsed.session.conversation_starter;
    if (!starter || typeof starter !== 'object' || Array.isArray(starter)) return null;
    const starterQuestion = typeof starter.question === 'string' ? starter.question.trim() : '';
    if (starterQuestion.length < mins.question) return null;

    const challenge = parsed.session.challenge;
    if (!challenge || typeof challenge !== 'object' || Array.isArray(challenge)) return null;
    const challengeTitle = typeof challenge.title === 'string' ? challenge.title.trim() : '';
    if (challengeTitle.length < mins.challengeTitle) return null;
    if (!Array.isArray(challenge.steps) || challenge.steps.length < 1) return null;

    const steps = [];
    for (let i = 0; i < challenge.steps.length; i++) {
      const step = challenge.steps[i];
      if (!step || typeof step !== 'object' || Array.isArray(step)) return null;
      const title = typeof step.title === 'string' ? step.title.trim() : '';
      const stepBody = typeof step.body === 'string' ? step.body.trim() : '';
      if (title.length < mins.stepTitle) return null;
      if (stepBody.length < mins.stepBody) return null;

      const normalizedStep = {
        number: i + 1,
        title,
        body: stepBody
      };

      if (Array.isArray(step.bullets)) {
        const bullets = [];
        for (const bullet of step.bullets) {
          if (typeof bullet !== 'string') return null;
          const b = bullet.trim();
          if (!b) continue;
          bullets.push(b);
        }
        if (bullets.length > 0) {
          normalizedStep.bullets = bullets;
        }
      } else if (step.bullets != null) {
        return null;
      }

      steps.push(normalizedStep);
    }

    return {
      bridge: {
        psychoeducation: { body, references },
        comparison: {
          partner_1: partner1,
          partner_2: partner2,
          insight
        }
      },
      session: {
        reflections,
        conversation_starter: { question: starterQuestion },
        challenge: {
          title: challengeTitle,
          steps
        }
      }
    };
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

    // Hoisted so the outer catch can attach the prompt to thrown errors,
    // allowing the route layer to persist it in generation_prompt even when
    // generation fails.
    let prompt = null;
    let systemPrompt = null;

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

      prompt = `You're a top-tier couples therapist with deep expertise using Sue Johnson's Emotionally Focused Therapy method of couples therapy, as well as the Gottman Couples Therapy method.

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

      systemPrompt = "You are a professional couples therapist. You must respond only with valid JSON in the specified format. Do not include any text outside the JSON structure. Focus only on therapeutic content.";

      const llmResult = await this.callLLM(
        systemPrompt,
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

        return this.attachPromptToResponse(parsedResponse, prompt);
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

      const wrappedError = new Error('Failed to generate couples therapy program');
      throw this.attachPromptToError(wrappedError, prompt);
    }
  }

  async generateNextProgram({ userName, partnerName, previousConversationStarters, userInput }, retryCount = 0, parseRetryCount = 0) {
    const MAX_RETRIES = 2;
    const BASE_DELAY = 1000;
    const MAX_PARSE_RETRIES = 1;

    // Hoisted so the outer catch can attach the prompt to thrown errors.
    let prompt = null;
    let systemPrompt = null;

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

      prompt = `You're a top-tier couples therapist with deep expertise using Sue Johnson's Emotionally Focused Therapy method of couples therapy, as well as the Gottman Couples Therapy method.

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

      systemPrompt = "You are a professional couples therapist. You must respond only with valid JSON in the specified format. Do not include any text outside the JSON structure. Focus only on therapeutic content.";

      const llmResult = await this.callLLM(
        systemPrompt,
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

        return this.attachPromptToResponse(parsedResponse, prompt);
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

      const wrappedError = new Error('Failed to generate next couples therapy program');
      throw this.attachPromptToError(wrappedError, prompt);
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
