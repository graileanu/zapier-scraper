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

class CompetitorSegmentAnalyzer {
  constructor() {
    this.openAIService = openAIService;
  }

  async analyzeCompetitorAndSegment(app) {
    const prompt = `
      Analyze this Zapier app integration for two aspects:

      1. COMPETITOR SCORE (0-10):
      Score how much this app competes with Retently (Customer Experience Management platform focusing on NPS, CSAT, and CES surveys).
      
      Scoring guide:
      10: Direct competitors (exactly like Trustmary, AskNicely, Delighted, Pendo Feedback - platforms primarily focused on customer feedback/surveys)
      7-9: Strong overlap (platforms with significant survey/feedback features)
      5-6: Complementary tools (like ClientSuccess, Totango, Gainsight - platforms where NPS is a secondary feature)
      1-4: Minimal overlap (platforms that could use survey data but don't focus on it)
      0: No competition (completely different focus, like CRMs, email marketing tools)

      2. INTEGRATION SEGMENT:
      Determine which business segment would benefit from integrating this app with Retently:
      - ALL: Benefits any type of business
      - ECOMMERCE: Only benefits ecommerce businesses
      - B2B: Specifically for B2B software, tech, agency deals
      - B2C: For financial, hrtech, healthcare (excluding ecommerce)

      APP TO ANALYZE:
      Title: "${app.title}"
      Description: "${app.description}"

      RESPONSE FORMAT:
      Return only a JSON object with exactly these fields:
      {
        "competitorScore": number (0-10),
        "competitorReasoning": string (explaining the score),
        "integrationSegment": "ALL" | "ECOMMERCE" | "B2B" | "B2C",
        "segmentReasoning": string (explaining the segment choice)
      }
    `;

    try {
      const completion = await this.openAIService.openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: "You are an expert in SaaS competitive analysis and market segmentation. Respond only with valid JSON."
          },
          { role: "user", content: prompt }
        ],
        temperature: 0.1,
        response_format: { type: "json_object" },
        max_tokens: 1000
      });

      const content = completion.choices[0].message.content;
      return JSON.parse(content);
    } catch (error) {
      console.error(`Error analyzing ${app.title}:`, error);
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
      console.log(`Started analyzing ${app.title}`.gray);

      const analysis = await this.analyzeCompetitorAndSegment(app);
      
      // Update app with analysis results
      await App.findByIdAndUpdate(app._id, {
        competitorScore: analysis.competitorScore,
        integrationSegment: analysis.integrationSegment
      });

      // Mark as completed in Redis
      await redisService.markAppCompleted(appSlug, {
        competitor_score: analysis.competitorScore,
        integration_segment: analysis.integrationSegment,
        competitor_reasoning: analysis.competitorReasoning,
        segment_reasoning: analysis.segmentReasoning
      });

      // Update machine status
      machineStatus.processed_count++;

      // Print the detailed reasoning
      console.log('\nAnalysis for:', colors.cyan(app.title));
      console.log('Competitor Score:'.yellow, colors.white(analysis.competitorScore));
      console.log('Competitor Reasoning:'.yellow, colors.white(analysis.competitorReasoning));
      console.log('Integration Segment:'.yellow, colors.white(analysis.integrationSegment));
      console.log('Segment Reasoning:'.yellow, colors.white(analysis.segmentReasoning));
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

      // Find all relevant apps that haven't been analyzed yet
      const apps = await App.find({
        isRelevant: true,
        $or: [
          { competitorScore: null },
          { integrationSegment: null }
        ]
      });

      console.log(`Found ${apps.length} relevant apps to analyze`.yellow);

      for (const app of apps) {
        try {
          await this.processApp(app);
          // Add delay to respect rate limits
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
          console.error(`Error in main loop for ${app.title}:`.red, error);
          continue; // Continue with next app even if one fails
        }
      }

      console.log('Analysis complete'.green);
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
const analyzer = new CompetitorSegmentAnalyzer();
analyzer.processAllRelevantApps();