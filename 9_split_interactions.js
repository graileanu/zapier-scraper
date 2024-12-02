require('dotenv').config();
const { connectDB } = require('./src/utils/mongoUtils');
const App = require('./src/models/App');
const openAIService = require('./src/services/openaiService');
const RedisService = require('./src/services/redisService');
const os = require('os');
const colors = require('colors');

// Get machine ID from env or hostname
const MACHINE_ID = process.env.MACHINE_ID || os.hostname().split('.')[0];

// Initialize Redis Service
const redisService = new RedisService(MACHINE_ID);

// Add machine status tracking
const machineStatus = {
  machine_id: MACHINE_ID,
  started_at: Date.now(),
  last_active: Date.now(),
  processed_count: 0,
  failed_count: 0,
  current_app: null
};

class InteractionAnalyzer {
  constructor() {
    this.openAIService = openAIService;
  }

  async analyzeInteractions(app) {
    const prompt = `
        You are an expert system tasked with analyzing Zapier app interactions for integration with Retently, a Customer Experience Management platform. Your analysis must be precise and follow specific rules.

        BACKGROUND ON RETENTLY:
        Retently is a Customer Experience Management platform that:
        - Sends NPS (Net Promoter Score), CSAT (Customer Satisfaction), and CES (Customer Effort Score) surveys
        - Tracks customer feedback and satisfaction metrics
        - Manages customer profiles and survey responses
        - Analyzes customer sentiment and feedback trends

        ANALYSIS RULES:

        1. TYPE CLASSIFICATION (Mandatory)
        Each interaction must be classified as either "trigger" or "action" (lowercase only)

        Classification Guidelines:
        SET AS "trigger" IF:
        - It's an event that happens in the app (e.g., "New Order Created")
        - It's a state change notification (e.g., "Status Updated")
        - It monitors for changes or new data
        - It notifies about updates or modifications
        Examples of triggers:
        - "New Customer Added" (trigger: it's an event notification)
        - "Order Status Changed" (trigger: it's a state change)
        - "Project Completed" (trigger: it's an event notification)
        - "Task Assigned" (trigger: it's a state change)

        SET AS "action" IF:
        - It creates or modifies data in the app
        - It performs an operation or task
        - It's something the app does when requested
        - It involves searching or retrieving data
        Examples of actions:
        - "Create Customer" (action: it creates data)
        - "Update Order Status" (action: it modifies data)
        - "Send Email" (action: it performs an operation)
        - "Find User" (action: it retrieves data)

        2. RELEVANCY ANALYSIS
        Determine if each interaction is relevant for Retently integration (isRelevant: true/false)

        Evaluation Criteria:
        SET isRelevant = true IF:
        a) For Triggers:
        - Creates opportunity for timely customer feedback (e.g., after purchase, service usage)
        - Indicates significant customer lifecycle events
        - Represents customer interaction points
        - Provides valuable context for survey timing
        Examples:
        - "Order Completed" (Relevant: good time for CSAT survey)
        - "Support Ticket Closed" (Relevant: perfect for CES survey)
        - "Subscription Renewed" (Relevant: appropriate for NPS survey)

        b) For Actions:
        - Can utilize Retently's survey data or scores
        - Helps sync customer data between systems
        - Enables automated responses to feedback
        - Enhances customer experience tracking
        Examples:
        - "Update Customer Profile" (Relevant: can sync with Retently data)
        - "Create Support Ticket" (Relevant: can be triggered by negative feedback)
        - "Add User Tag" (Relevant: can be based on NPS score)

        SET isRelevant = false IF:
        - Internal system operations unrelated to customer experience
        - Technical operations without customer context
        - Administrative tasks without customer impact
        Examples:
        - "Update System Settings" (Not Relevant: internal operation)
        - "Backup Database" (Not Relevant: technical task)
        - "Generate Report" (Not Relevant: administrative task)

        3. SEGMENT CLASSIFICATION
        Classify each interaction's business segment (relevancySegment: ALL|ECOMMERCE|B2B|B2C)

        Segment Guidelines:
        ALL: 
        - Universal customer experience touchpoints
        - General customer data management
        - Basic feedback collection points
        Examples:
        - "Customer Support Ticket Closed" (ALL: applies to any business)
        - "User Account Created" (ALL: universal process)

        ECOMMERCE:
        - Online shopping specific
        - Order/product related
        - Shopping cart operations
        Examples:
        - "Order Shipped" (ECOMMERCE: specific to online retail)
        - "Cart Abandoned" (ECOMMERCE: online shopping specific)

        B2B:
        - Enterprise/business customer focused
        - Project/contract related
        - Service agreement touchpoints
        Examples:
        - "Project Milestone Completed" (B2B: business project specific)
        - "Contract Renewed" (B2B: business relationship specific)

        B2C:
        - Individual consumer focused (non-ecommerce)
        - Personal service related
        - Individual account management
        Examples:
        - "Appointment Completed" (B2C: individual service)
        - "Personal Plan Updated" (B2C: individual account)

        APP CONTEXT:
        Title: "${app.title}"
        Description: "${app.description}"
        Integration Segment: "${app.integrationSegment}"
        Potential Integration with Retently Use Case: "${app.potentialUseCase}"

        RETENTLY INTEGRATION CAPABILITIES:
        Available Triggers from Retently:
        ${JSON.stringify(this.openAIService.retentlyTriggers, null, 2)}

        Available Actions in Retently:
        ${JSON.stringify(this.openAIService.retentlyActions, null, 2)}

        INTERACTIONS TO ANALYZE:
        ${JSON.stringify(app.interactions, null, 2)}

        EXAMPLE ANALYSES:

        For a CRM App:
        Input:
        {
        "name": "New Deal Created",
        "description": "Triggers when a new deal is created in the CRM"
        }
        Output:
        {
        "name": "New Deal Created",
        "description": "Triggers when a new deal is created in the CRM",
        "type": "trigger",
        "isRelevant": true,
        "relevancySegment": "B2B"
        }
        Reasoning: It's a trigger (new event), relevant (good time for CSAT), B2B (deal creation is business-focused)

        For an Ecommerce Platform:
        Input:
        {
        "name": "Update Order Status",
        "description": "Updates the status of an existing order"
        }
        Output:
        {
        "name": "Update Order Status",
        "description": "Updates the status of an existing order",
        "type": "action",
        "isRelevant": true,
        "relevancySegment": "ECOMMERCE"
        }
        Reasoning: It's an action (modifies data), relevant (can be triggered by feedback), ECOMMERCE (order-specific)

        REQUIRED OUTPUT FORMAT:
        Return a JSON object with this exact structure:
        {
          "interactions": [
            {
              "name": string (original name),
              "description": string (original description),
              "type": "trigger" | "action",
              "isRelevant": boolean,
              "relevancySegment": "ALL" | "ECOMMERCE" | "B2B" | "B2C"
            }
          ]
        }

        QUALITY REQUIREMENTS:
        1. Response MUST be a JSON object with an "interactions" array
        2. EVERY interaction in the array must have ALL five fields
        3. 'type' must be lowercase "trigger" or "action" only
        4. 'relevancySegment' must be uppercase "ALL", "ECOMMERCE", "B2B", or "B2C" only
        5. Maintain original name and description exactly
        6. Return valid JSON only, no explanations or comments

        Now analyze the provided interactions following these guidelines.`;

    try {
      const completion = await this.openAIService.openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: "You are an expert in analyzing app integrations. Return a JSON object with an 'interactions' array containing the analyzed interactions."
          },
          { role: "user", content: prompt }
        ],
        temperature: 0.1,
        response_format: { type: "json_object" },
        max_tokens: 8000
      });

      const content = completion.choices[0].message.content;
      const parsed = JSON.parse(content);
      
      if (!parsed || !parsed.interactions || !Array.isArray(parsed.interactions)) {
        console.error(`Invalid response structure for ${app.title}:`, content);
        throw new Error('Invalid response format from OpenAI');
      }

      // Validate each interaction
      parsed.interactions.forEach((interaction, index) => {
        if (!interaction.name || !interaction.description || !interaction.type || 
            !interaction.hasOwnProperty('isRelevant') || !interaction.relevancySegment) {
          console.error(`Invalid interaction at index ${index} for ${app.title}:`, interaction);
          throw new Error(`Interaction at index ${index} is missing required fields`);
        }
      });

      return parsed.interactions;
    } catch (error) {
      console.error(`Error analyzing interactions for ${app.title}:`, error);
      if (error.response) {
        console.error('OpenAI API error details:', error.response.data);
      }
      throw error;
    }
  }

  async processApp(app) {
    const appSlug = app.slug;
    machineStatus.current_app = app.title;

    try {
      // Check if app is being processed by another machine
      const { isProcessing, isCompleted } = await redisService.checkAppStatus(appSlug);
      
      if (isProcessing) {
        console.log(`${app.title} is being analyzed by another machine, skipping...`.yellow);
        return;
      }

      if (isCompleted) {
        console.log(`${app.title} already analyzed, skipping...`.cyan);
        return;
      }

      // Mark as processing
      await redisService.markAppProcessing(appSlug);
      console.log(`Started analyzing interactions for ${app.title}`.gray);

      const analyzedInteractions = await this.analyzeInteractions(app);
      
      if (!analyzedInteractions) {
        throw new Error('No analyzed interactions returned');
      }

      // Calculate counts
      const triggersCount = Array.isArray(analyzedInteractions) ? 
        analyzedInteractions.filter(i => i && i.type === 'trigger').length : 0;
      const actionsCount = Array.isArray(analyzedInteractions) ? 
        analyzedInteractions.filter(i => i && i.type === 'action').length : 0;

      // Update app with analyzed interactions and counts
      await App.findByIdAndUpdate(app._id, {
        interactions: analyzedInteractions,
        triggersCount,
        actionsCount,
        updatedAt: new Date()
      });

      // Mark as completed in Redis
      await redisService.markAppCompleted(appSlug, {
        interactions_count: analyzedInteractions.length,
        relevant_interactions: analyzedInteractions.filter(i => i.isRelevant).length,
        analyzed_at: new Date().toISOString()
      });

      // Update machine status
      machineStatus.processed_count++;

      // Print analysis summary
      console.log('\nInteraction Analysis for:', colors.cyan(app.title));
      console.log('Total Interactions:'.yellow, colors.white(analyzedInteractions.length));
      console.log('Relevant Interactions:'.yellow, colors.white(analyzedInteractions.filter(i => i.isRelevant).length));
      console.log(colors.gray('-'.repeat(80)), '\n');

    } catch (error) {
      console.error(`Error processing ${app.title}:`.red, error);
      machineStatus.failed_count++;
      // Remove processing flag on error
      await redisService.client.del(`app:processing:${appSlug}`);
      throw error;
    } finally {
      machineStatus.current_app = null;
    }
  }

  async processAllRelevantApps() {
    try {
      // Check Redis connection
      if (!await redisService.isConnected()) {
        console.error('Redis connection failed. Exiting...'.red);
        process.exit(1);
      }

      // Connect to MongoDB
      await connectDB();
      console.log('MongoDB connected successfully'.green);

      // Find all relevant apps that need interaction analysis
      const apps = await App.find({
        isRelevant: true,
        $or: [
          { interactions: { $exists: false } },
          { interactions: { $size: 0 } },
          { 'interactions.type': { $exists: false } },
          { 'interactions.isRelevant': { $exists: false } },
          { 'interactions.relevancySegment': { $exists: false } }
        ]
      });

      console.log(`Found ${apps.length} apps needing interaction analysis`.yellow);

      const BATCH_SIZE = 10;
      for (let i = 0; i < apps.length; i += BATCH_SIZE) {
        const batch = apps.slice(i, i + BATCH_SIZE);
        console.log(`\nProcessing batch ${Math.floor(i/BATCH_SIZE) + 1} of ${Math.ceil(apps.length/BATCH_SIZE)}`.cyan);
        
        for (const app of batch) {
          try {
            await this.processApp(app);
            await new Promise(resolve => setTimeout(resolve, 1000));
          } catch (error) {
            console.error(`Error in main loop for ${app.title}:`.red, error);
            continue;
          }
        }
      }

      console.log('Interaction analysis complete'.green);
      process.exit(0);

    } catch (error) {
      console.error('Main process error:'.red, error);
      process.exit(1);
    }
  }
}

// Update machine status periodically
setInterval(async () => {
  try {
    await redisService.updateMachineStatus(machineStatus);
  } catch (error) {
    console.error('Failed to update machine status:'.red, error);
  }
}, 30000);

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nGracefully shutting down...'.yellow);
  try {
    await redisService.updateMachineStatus({
      ...machineStatus,
      status: 'stopped'
    });
  } catch (error) {
    console.error('Error updating final status:'.red, error);
  }
  process.exit(0);
});

// Run the analysis
const analyzer = new InteractionAnalyzer();
analyzer.processAllRelevantApps();