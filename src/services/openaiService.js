// src/services/openaiService.js
const OpenAI = require('openai');

class OpenAIService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });

    // Define Retently's triggers and actions as class properties
    this.retentlyTriggers = [
      {
        "name": "New Survey Response",
        "description": "Triggers when a customer submits an NPS, CSAT, or CES survey response"
      },
      {
        "name": "Score Updated",
        "description": "Triggers when a customer's NPS/CSAT/CES score is updated"
      },
      {
        "name": "Customer Unsubscribed",
        "description": "Triggers when a customer opts out of surveys"
      },
      {
        "name": "New Customer Created",
        "description": "Triggers when a new customer profile is created in Retently"
      }
    ];

    this.retentlyActions = [
      {
        "name": "Send NPS Survey",
        "description": "Sends an NPS survey to a specified customer"
      },
      {
        "name": "Send CSAT Survey",
        "description": "Sends a CSAT survey to a specified customer"
      },
      {
        "name": "Create/Update Customer",
        "description": "Creates or updates a customer profile in Retently"
      },
      {
        "name": "Add Tag to Response",
        "description": "Adds a tag to a survey response"
      },
      {
        "name": "Opt-out Customer",
        "description": "Marks a customer as opted-out from surveys"
      }
    ];
  }

  async normalizeAppData(appData) {
    const prompt = `
      You are tasked with normalizing Zapier app integration data. Please transform the provided JSON data according to these specific rules:

      1. Title Normalization:
         - Remove suffixes like "Integrations", "Integration", "API", etc.
         - Example: "Shopify Integrations" → "Shopify"

      2. Description Requirements:
         - Maximum 255 characters
         - Must be neutral and factual (remove marketing language)
         - Include core functionality and main purpose
         - Enhance with additional relevant information if needed
         - Avoid mentioning market position (e.g., "leading", "best", etc.)

      3. Logo URL Cleanup:
         - Remove all query parameters after '?'
         - Field name should be changed from 'logo' to 'logo_url'
         - Example: 
           Input: "https://zapier-images.imgix.net/storage/services/4da9d3e3f93cd522f85e1b0695341f89.png?auto=format&ixlib=react-9.8.1"
           Output: "https://zapier-images.imgix.net/storage/services/4da9d3e3f93cd522f85e1b0695341f89.png"

      4. Help Links Processing:
         - Only include specific article URLs
         - Exclude generic help center links (e.g., "https://help.zapier.com/hc/en-us")
         - Format each valid link as an object:
           {
             "type": "help",
             "url": "[specific article url]"
           }

        5. Interactions Array:
        - Process exisintg 'actions' data into a single 'interactions' array
        - Although each item is in the 'actions' array, the item can be either a trigger or an action
        - Each interaction MUST include THREE fields: name, description, and type (this is mandatory)
        - Type Detection Rules:
                * EVERY interaction must be classified as either "trigger" or "action" (lowercase)
                * Set type as "trigger" if:
                - The interaction represents an event that happens in this app that can be monitored and sent to other apps
                - The interaction is about data or state changes within this app that other apps might want to react to
                a) Examples for Shopify:
                    > "New Order" is a trigger because it's an event in Shopify that other apps might want to know about
                    > "Customer Account Enabled" is a trigger because it's a state change in Shopify that other apps might need to react to
                * Set type as "action" if:
                - The interaction represents something this app can do in response to events from other apps
                - The interaction involves creating, updating, or modifying data within this app
                - Examples for Shopify:
                    > "Create Order" is an action because it's something other apps might want Shopify to do
                    > "Update Product" is an action because it's a modification other apps can request Shopify to perform
                b) Example for Retently:
                Triggers (events that happen in Retently):
                - "New Survey Response" (trigger: it's an event in Retently)
                - "Company Score Updated" (trigger: it's a state change in Retently)
                - "Customer Unsubscribed" (trigger: it's an event in Retently)
                Actions (things other apps can make Retently do):
                - "Send an Email Survey" (action: other apps can request this)
                - "Create or Update Customer" (action: it's a modification requested by other apps)
                - "Apply Tag to Response" (action: it's a modification)

                * Type Classification Guidelines:
                SET AS "trigger" IF:
                - Represents an event notification from this app
                - Indicates a state change or update that happened
                - Uses words like "when", "triggers when", "is updated"
                - Examples: "New...", "Updated...", "...Changed", "...Received"

                SET AS "action" IF:
                - Creates, modifies, or updates data in this app
                - Performs a search or lookup
                - Represents a command or request to do something
                - Examples: "Create...", "Update...", "Find...", "Send...", "Apply..."
                
                

        - Description Detection and Cleanup:
            * If description is null or incomplete, analyze the name field:
            - Look for patterns where description is embedded in name:
                > Split at capital letters followed by lowercase (camelCase points)
                > Split when the same verb appears twice (e.g., "Create OrderCreates")
                > Split at obvious sentence boundaries (periods, common verbs)
            Examples:
                1) From: 
                       "Create Draft OrderCreates a new draft order." 
                   To: 
                        name: "Create Draft Order", 
                        description: "Creates a new draft order.",
                        type: "action"  
                2) From: 
                       "Find ProductFinds a product by title"
                To: 
                        name: "Find Product", 
                        description: "Finds a product by title",
                        type: "trigger"
            * For descriptions that don't form complete sentences:
                - Identify the key action or event
                - Restructure into a clear, complete sentence
                - Add necessary context about what the interaction does
            * Ensure consistency in tense and structure:
                - Triggers should be described in present tense ("Triggers when...", "Occurs when...")
            - Actions should describe what they do ("Creates...", "Updates...")
            * Shorten names when possible, example:
                        From: "name" : "Assign Candidate to Job Opening/Talent Pool",
                        To: "name" : "Assign Candidate to Job Opening",
        
            - Quality Requirements:
                * STRICT ENFORCEMENT: Every interaction MUST have all three fields:
                {
                    "name": "string",
                    "description": "string",
                    "type": "trigger" or "action" (lowercase only)
                }
                * NO EXCEPTIONS: Interactions without all three fields should be flagged as errors
                * Type field is MANDATORY and must be explicitly set

      6. Category:
         - Map 'sourceCategory' to 'category'
         - If empty, use "Uncategorized"
         - Remove 'All' prefix from category names (e.g., "All Human Resources" → "Human Resources")
         - Replace "___" with " & " (e.g., "Video___Audio" → "Video & Audio")
         - Fix common category name formatting:
            * "Ads___Conversion" → "Ads & Conversion"
            * "Content___Files" → "Content & Files"
            * "Website___App_Building" → "Website & App Building"
            * "File_Management___Storage" → "File Management & Storage"
            * "Forms___Surveys" → "Forms & Surveys"
            * "Images___Design" → "Images & Design"
            * "Security___Identity_Tools" → "Security & Identity Tools"
            * Replace underscores with spaces
         - Ensure consistent capitalization (each word should be capitalized)

      7. Timestamps:
         - Preserve original 'scrapedAt'
         - Add 'updatedAt' with current timestamp

      Input JSON:
      ${JSON.stringify(appData, null, 2)}

      Please return a single, valid JSON object containing only the following fields:
      {
        "title": string,
        "description": string,
        "logo_url": string,
        "links": array,
        "interactions": array,
        "category": string,
        "scrapedAt": string (ISO date),
        "updatedAt": string (ISO date)
      }

      The response must be a valid JSON object that can be parsed. Do not include any explanations or markdown formatting in the response.
    `;


    try {
      const completion = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { 
            role: "system", 
            content: "You are a helpful assistant that normalizes JSON data. Respond only with valid JSON." 
          },
          { role: "user", content: prompt }
        ],
        response_format: { type: "json_object" },
        max_tokens: 8192
      });

      return JSON.parse(completion.choices[0].message.content);
    } catch (error) {
      console.error('OpenAI API error:', error);
      throw error;
    }
  }

  async processInteractions(appData) {
    const prompt = `
      You are tasked with processing Zapier app interaction data. For each interaction in the provided data:
      
      1. Determine the correct type (trigger or action)
      2. Ensure all three required fields are present
      
      Rules for processing:
      
      1. Type Classification:
         - "trigger": Events or state changes that happen in the app (e.g., "New Order", "Updated Customer")
         - "action": Operations the app can perform (e.g., "Create Order", "Update Product")
      
      2. Required Fields:
         Each interaction must have exactly these fields:
         {
           "name": "string",
           "description": "string",
           "type": "trigger" or "action" (lowercase only)
         }
      
      Input JSON:
      ${JSON.stringify(appData, null, 2)}
      
      Return a JSON array containing only the processed interactions with the three required fields.
      The response must be a valid JSON array that can be parsed.
    `;

    try {
      const completion = await this.openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: "You are a helpful assistant that processes interaction data. Respond only with valid JSON array."
          },
          { role: "user", content: prompt }
        ],
        response_format: { type: "json_object" },
        max_tokens: 8192
      });

      const processedData = JSON.parse(completion.choices[0].message.content);
      
      // Validate the processed data
      if (!Array.isArray(processedData.interactions)) {
        throw new Error('Processed data must be an array of interactions');
      }

      // Verify each interaction has required fields
      processedData.interactions.forEach((interaction, index) => {
        if (!interaction.name || !interaction.description || !interaction.type) {
          throw new Error(`Interaction at index ${index} is missing required fields`);
        }
        if (!['trigger', 'action'].includes(interaction.type)) {
          throw new Error(`Invalid type "${interaction.type}" for interaction "${interaction.name}"`);
        }
      });

      return processedData.interactions;
    } catch (error) {
      console.error('OpenAI API error:', error);
      throw error;
    }
  }

  async analyzeAppRelevancy(appTitle, appDescription) {
    // Early check for Retently itself - edge case
    if (appTitle.toLowerCase().includes('retently')) {
      return {
        isRelevant: false,
        relevancyReasoning: "This is Retently itself - integration with itself is not applicable",
        potentialUseCase: null
      };
    }

    const prompt = `
      You are tasked with analyzing the business relevancy of integrating a specific application with Retently (a Customer Experience Management platform focusing on NPS, CSAT, and CES surveys).

      APPLICATION TO ANALYZE:
      Title: "${appTitle}"
      Description: "${appDescription}"

      Retently's Key Features and Integration Points:

      Triggers (events that happen in Retently):
      ${JSON.stringify(this.retentlyTriggers, null, 2)}

      Actions (things other apps can make Retently do):
      ${JSON.stringify(this.retentlyActions, null, 2)}

      Task: Analyze if there's meaningful business value in integrating this application with Retently.

      IMPORTANT EVALUATION CRITERIA:
      1. The app being analyzed must be DIFFERENT from Retently itself - integrating Retently with Retently is automatically not relevant
      2. There must be a clear, direct business need for the integration, not just a theoretical possibility
      3. The integration should serve a specific customer experience management purpose

      Consider these specific integration scenarios:
      1. Customer Journey Triggers:
         - Does the app have meaningful customer interaction points (purchases, support tickets, account changes) that would make sense to trigger NPS/CSAT surveys?
         Example: Shopify (Relevant) - Sending surveys after purchases
         Example: Calculator App (Not Relevant) - No meaningful customer interaction points

      2. Customer Data Syncing:
         - Does the app manage customer profiles that would benefit from being synced with Retently?
         Example: CRM System (Relevant) - Keeping customer contact info and preferences in sync
         Example: Weather App (Not Relevant) - No customer profiles to sync

      3. Feedback Loop Utilization:
         - Could the app meaningfully use Retently's survey responses or score updates?
         Example: Analytics Platform (Relevant) - Incorporating NPS scores into dashboards
         Example: File Converter (Not Relevant) - No use for customer feedback data

      EXAMPLE OF GOOD ANALYSIS:
      For Shopify:
      {
        "isRelevant": true,
        "relevancyReasoning": "Shopify manages e-commerce transactions and customer data, providing clear trigger points for customer feedback collection and data synchronization needs",
        "potentialUseCase": "Trigger automated NPS/CSAT surveys after purchases, sync customer purchase history and contact details, use feedback scores to inform customer service and marketing strategies"
      }

      EXAMPLE OF BAD ANALYSIS:
      For Calculator App:
      {
        "isRelevant": false,
        "relevancyReasoning": "Calculator apps don't manage customer relationships or have meaningful interaction points that would benefit from NPS/CSAT feedback",
        "potentialUseCase": null
      }

      REQUIRED OUTPUT FORMAT:
      Analyze the given application and provide a JSON response with this structure:
      {
        "isRelevant": boolean,
        "relevancyReasoning": "Clear, specific explanation focused on this app's actual use case",
        "potentialUseCase": "If relevant, describe the specific, practical integration scenario" || null
      }

      Rules:
      - BE SPECIFIC to this application, avoid generic statements
      - Focus on PRACTICAL use cases, not theoretical possibilities
      - If not relevant, potentialUseCase must be null
      - Keep reasoning concise and focused on actual business value
      - Return ONLY the JSON object, no other text or formatting
    `;

    try {
      const completion = await this.openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: "You are a JSON-only response bot. Always return a valid JSON object with exactly these fields: isRelevant (boolean), relevancyReasoning (string), and potentialUseCase (string or null). No additional text or formatting."
          },
          { role: "user", content: prompt }
        ],
        temperature: 0.1,
        max_tokens: 1000
      });

      const content = completion.choices[0].message.content;
      try {
        // Clean any potential markdown or extra formatting
        const cleanedContent = content.replace(/```json\n|\n```|```/g, '').trim();
        return JSON.parse(cleanedContent);
      } catch (parseError) {
        console.error('Failed to parse OpenAI response:', content);
        throw new Error('Invalid JSON response from OpenAI');
      }
    } catch (error) {
      console.error('OpenAI API error during relevancy analysis:', error);
      throw error;
    }
  }
}

module.exports = new OpenAIService();