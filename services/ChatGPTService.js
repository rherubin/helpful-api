const OpenAI = require('openai');

class ChatGPTService {
  constructor() {
    // Validate API key format and security
    this.validateApiKey();
    
    // Only initialize OpenAI if API key is configured
    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY
      });
    } else {
      this.openai = null;
    }
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

  // Generate couples therapy program using ChatGPT
  async generateCouplesProgram(userName, partnerName, userInput) {
    if (!this.openai) {
      throw new Error('ChatGPT service is not configured - OPENAI_API_KEY is required');
    }
    
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

      const prompt = `You're a top-tier couples therapist with deep expertise using Sue Johnson's Emotionally Focused Therapy method of couples therapy, as well as the Gottman Couples Therapy method.

Your advice to couples is anchored in Emotionally Focused Therapy, but utilizes Gottman Couples Therapy methods when the context of the couple merits it.

A couple comes into your therapy room. Their names are ${sanitizedUserName} and ${sanitizedPartnerName}.

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

Now, craft me the 14 conversation-starters, provide a theme for each one, and explain the science and research behind each question. Note that when you explain the science and research, act like you're talking directly to the couple and say it in a very accessible way. Label this science and research section: "The Science Behind It"

Note: Don't ever reference Emotionally Focused Therapy or Gottman Couples Therapy. Instead of that, you can refer to it as a research-based couples therapy approach, or a therapy method that is scientifically backed.

Please format your response as a JSON object with the following structure:
{
  "program": {
    "title": "14-Day Emotional Connection Program for [UserName] and [PartnerName]",
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

      const completion = await this.openai.chat.completions.create({
        model: "gpt-3.5-turbo",
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
        temperature: 0.7
      });

      const response = completion.choices[0].message.content;
      
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
      // Enhanced error logging for security monitoring
      if (error.message.includes('unsafe content') || error.message.includes('validation')) {
        console.error('SECURITY ERROR in ChatGPT service:', error.message);
      } else {
        // Log error without exposing sensitive information
        if (error.status === 401) {
          console.error('ChatGPT API Error: Invalid API key - check your OPENAI_API_KEY configuration');
        } else if (error.status === 429) {
          console.error('ChatGPT API Error: Rate limit exceeded or quota reached');
        } else if (error.status === 403) {
          console.error('ChatGPT API Error: Access forbidden - check API key permissions');
        } else {
          console.error('ChatGPT API Error:', error.message || 'Unknown error');
        }
      }
      
      throw new Error('Failed to generate couples therapy program');
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
        
        // Validate content length (ensure substantial content)
        if (day.theme.length < 5 || day.theme.length > 200) return false;
        if (day.conversation_starter.length < 20 || day.conversation_starter.length > 1000) return false;
        if (day.science_behind_it.length < 50 || day.science_behind_it.length > 2000) return false;
        
        // Additional content validation - ensure therapeutic content
        const therapeuticKeywords = [
          /relationship/i, /couple/i, /partner/i, /communication/i, 
          /emotion/i, /feeling/i, /connect/i, /bond/i, /love/i, /trust/i
        ];
        
        const hasTherapeuticContent = therapeuticKeywords.some(keyword => 
          keyword.test(day.conversation_starter) || keyword.test(day.science_behind_it)
        );
        
        if (!hasTherapeuticContent) {
          console.warn(`SECURITY: Day ${day.day} lacks therapeutic content`);
          return false;
        }
      }
      
      return true;
    } catch (error) {
      console.error('Error validating program structure:', error.message);
      return false;
    }
  }
}

module.exports = ChatGPTService;
