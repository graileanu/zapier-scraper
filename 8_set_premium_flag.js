require('dotenv').config();
const { connectDB } = require('./src/utils/mongoUtils');
const App = require('./src/models/App');
const colors = require('colors');

const premiumApps = [
  'Webhooks by Zapier', 'Salesforce', 'QuickBooks Online', 'AI by Zapier', 'Zendesk',
  'Facebook Lead Ads', 'Shopify', 'Zoho CRM', 'Xero', 'LinkedIn Ads',
  'Facebook Lead Ads (for Business Admins)', 'PayPal', 'MySQL', 'Facebook Custom Audiences',
  'Microsoft Dynamics 365 CRM', 'Pardot', 'Amazon S3', 'Google BigQuery', 'Pinterest',
  'GoTo Webinar', 'Quickbase', 'AWS Lambda', 'Magento 2.X', 'SugarCRM', 'Amazon SNS',
  'Azure Active Directory', 'Amazon SQS', 'SQL Server', 'BambooHR', 'Marketo',
  'Google Workspace Admin', 'BigCommerce', 'Amazon Seller Central', 'Google Groups',
  'Snowflake', 'Amazon SES', 'Chargify', 'Greenhouse', 'NetSuite', 'ServiceNow',
  'Expensify', 'Amazon Redshift', 'Amazon EC2', 'Solve CRM', 'Amazon CloudWatch',
  'Azure OpenAI', 'Amazon CloudFront', 'Magento', 'Moodle', 'Salesloft', 'WHMCS',
  'Looker', 'Tableau', 'Sage Intacct', 'Amazon Polly', 'Snapchat Lead Generation',
  'Microsoft SharePoint', 'PostgreSQL', 'Amazon Simple Notification Service (SNS)',
  'Amazon Simple Queue Service (SQS)', 'Amazon Web Services (AWS)', 'HubSpot', 'Zoom'
];

async function setPremiumFlags() {
  try {
    // Connect to MongoDB
    await connectDB();
    console.log('MongoDB connected successfully'.green);

    // Update all premium apps
    const result = await App.updateMany(
      { title: { $in: premiumApps } },
      { $set: { isPremium: true } }
    );

    console.log(`Successfully updated ${result.modifiedCount} apps`.green);
    console.log('Update summary:'.cyan);
    console.log('Modified count:', result.modifiedCount);
    console.log('Matched count:', result.matchedCount);

    // Log some sample updated apps
    const sampleUpdated = await App.find(
      { isPremium: true }
    ).limit(5);

    if (sampleUpdated.length > 0) {
      console.log('\nSample premium apps:'.yellow);
      sampleUpdated.forEach(app => {
        console.log(`- ${app.title}`.gray);
      });
    }

    process.exit(0);

  } catch (error) {
    console.error('Error setting premium flags:'.red, error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nGracefully shutting down...'.yellow);
  process.exit(0);
});

// Run the update
setPremiumFlags(); 