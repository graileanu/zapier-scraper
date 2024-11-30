const puppeteer = require('puppeteer-core');
const fs = require('fs');

const CONFIG = {
  TIMEOUT: 60000,
  CHROME_PATH: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
};

const debugLog = (message) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] DEBUG: ${message}`);
};

const errorLog = (message, error) => {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] ERROR: ${message}`);
  if (error?.message) console.error(`Error details: ${error.message}`);
  if (error?.stack) console.error(`Stack trace: ${error.stack}`);
};

async function scrapeCategory(page, category) {
  debugLog(`Starting to scrape category: ${category.name}`);
  
  try {
    debugLog('Setting up request interception');
    await page.setRequestInterception(true);
    
    page.on('request', request => {
      const url = request.url();
      debugLog(`Intercepted request to: ${url}`);
      
      if (url.includes('graphql')) {
        debugLog('Found GraphQL request, modifying...');
        const slug = category.url.split('/').pop();
        debugLog(`Using slug: ${slug}`);
        
        request.continue({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          postData: JSON.stringify({
            query: `
              query CategoryApps($slug: String!) {
                category(slug: $slug) {
                  apps {
                    name
                    description
                    isPremium
                    logoUrl
                  }
                }
              }
            `,
            variables: { slug }
          })
        });
      } else {
        request.continue();
      }
    });

    page.on('response', response => {
      debugLog(`Received response from: ${response.url()}`);
      if (response.url().includes('graphql')) {
        debugLog('Processing GraphQL response...');
      }
    });

    debugLog(`Navigating to: ${category.url}`);
    const response = await page.goto(category.url, {
      waitUntil: 'networkidle0',
      timeout: CONFIG.TIMEOUT
    });
    
    debugLog('Parsing response...');
    const data = await response.json().catch(e => {
      debugLog('Failed to parse JSON response');
      throw e;
    });
    
    debugLog(`Found ${data?.category?.apps?.length || 0} apps`);
    return data?.category?.apps || [];
  } catch (error) {
    errorLog(`Failed to scrape category: ${category.name}`, error);
    throw error;
  }
}

async function main() {
  debugLog('Starting scraper...');
  
  if (!fs.existsSync('apps')) {
    debugLog('Creating apps directory');
    fs.mkdirSync('apps');
  }

  debugLog('Loading categories from file');
  const categories = JSON.parse(fs.readFileSync('categories.json'));
  debugLog(`Found ${categories.length} categories`);

  debugLog('Launching browser');
  const browser = await puppeteer.launch({
    headless: false, // Changed to false for visibility
    executablePath: CONFIG.CHROME_PATH,
    defaultViewport: null
  });
  
  const page = await browser.newPage();
  const results = {};

  for (const category of categories) {
    debugLog(`Processing category: ${category.name}`);
    try {
      const apps = await scrapeCategory(page, category);
      results[category.name] = apps;
      
      const filename = `apps/${category.name.replace(/[^a-z0-9]/gi, '_')}.json`;
      debugLog(`Saving results to ${filename}`);
      fs.writeFileSync(filename, JSON.stringify(apps, null, 2));
      
    } catch (error) {
      errorLog(`Failed to process category: ${category.name}`, error);
    }
  }

  debugLog('Saving combined results');
  fs.writeFileSync('all_apps.json', JSON.stringify(results, null, 2));
  
  debugLog('Closing browser');
  await browser.close();
  debugLog('Scraping completed');
}

main().catch(error => {
  errorLog('Script failed', error);
  process.exit(1);
});