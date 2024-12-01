// src/services/openaiService.js
const OpenAI = require('openai');

class OpenAIService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
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
}

module.exports = new OpenAIService();