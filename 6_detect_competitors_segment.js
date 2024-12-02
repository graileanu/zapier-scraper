require('dotenv').config();
const { connectDB } = require('./src/utils/mongoUtils');
const App = require('./src/models/App');
const openAIService = require('./src/services/openaiService');

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
        model: "gpt-4",
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

  async processAllRelevantApps() {
    try {
      // Connect to MongoDB
      await connectDB();
      console.log('MongoDB connected successfully');

      // Find all relevant apps that haven't been analyzed yet
      const apps = await App.find({
        isRelevant: true,
        $or: [
          { competitorScore: null },
          { integrationSegment: null }
        ]
      });

      console.log(`Found ${apps.length} relevant apps to analyze`);

      for (const app of apps) {
        try {
          console.log(`Analyzing ${app.title}...`);
          
          const analysis = await this.analyzeCompetitorAndSegment(app);
          
          // Update app with analysis results
          await App.findByIdAndUpdate(app._id, {
            competitorScore: analysis.competitorScore,
            integrationSegment: analysis.integrationSegment
          });

          // Print the detailed reasoning
          console.log('\nAnalysis for:', app.title.cyan);
          console.log('Competitor Score:'.yellow, analysis.competitorScore);
          console.log('Competitor Reasoning:'.yellow, analysis.competitorReasoning);
          console.log('Integration Segment:'.yellow, analysis.integrationSegment);
          console.log('Segment Reasoning:'.yellow, analysis.segmentReasoning);
          console.log('-'.repeat(80), '\n');

          // Add delay to respect rate limits
          await new Promise(resolve => setTimeout(resolve, 1000));

        } catch (error) {
          console.error(`Error processing ${app.title}:`, error);
          continue; // Continue with next app even if one fails
        }
      }

      console.log('Analysis complete');
      process.exit(0);

    } catch (error) {
      console.error('Main process error:', error);
      process.exit(1);
    }
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nGracefully shutting down...');
  process.exit(0);
});

// Run the analysis
const analyzer = new CompetitorSegmentAnalyzer();
analyzer.processAllRelevantApps();