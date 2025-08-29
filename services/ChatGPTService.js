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

  // Generate couples therapy program using ChatGPT
  async generateCouplesProgram(userName, partnerName, userInput) {
    if (!this.openai) {
      throw new Error('ChatGPT service is not configured - OPENAI_API_KEY is required');
    }
    
    try {
      const prompt = `You're a top-tier couples therapist with deep expertise using Sue Johnson's Emotionally Focused Therapy method of couples therapy, as well as the Gottman Couples Therapy method.

Your advice to couples is anchored in Emotionally Focused Therapy, but utilizes Gottman Couples Therapy methods when the context of the couple merits it.

A couple comes into your therapy room. Their names are ${userName} and ${partnerName}.

${userName} says the following to you: 

"${userInput}"

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
        model: "gpt-4",
        messages: [
          {
            role: "user",
            content: prompt
          }
        ],
        max_tokens: 4000,
        temperature: 0.7,
        response_format: { type: "json_object" }
      });

      const response = completion.choices[0].message.content;
      
      // Try to parse JSON response, fallback to raw text if parsing fails
      try {
        const parsedResponse = JSON.parse(response);
        return parsedResponse;
      } catch (parseError) {
        console.warn('Failed to parse ChatGPT JSON response, returning raw text:', parseError.message);
        return response;
      }
    } catch (error) {
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
      
      throw new Error('Failed to generate couples therapy program');
    }
  }

  // Check if OpenAI API key is configured
  isConfigured() {
    return !!process.env.OPENAI_API_KEY;
  }
}

module.exports = ChatGPTService;
