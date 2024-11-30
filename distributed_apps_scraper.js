const puppeteer = require('puppeteer-core');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const redisClient = require('./utils/redisClient');
require('dotenv').config();

// Get machine ID from env or hostname
const MACHINE_ID = process.env.MACHINE_ID || os.hostname().split('.')[0];

// Get the default Chrome path based on the operating system
function getDefaultChromePath() {
  switch (os.platform()) {
    case 'darwin': // macOS
      return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    case 'linux':
      return '/usr/bin/google-chrome';
    default:
      return process.env.CHROME_PATH || '/usr/bin/google-chrome';
  }
}

const CONFIG = {
  CHROME_PATH: process.env.CHROME_PATH || getDefaultChromePath(),
  CATEGORY_DIR: 'category_results',
  APPS_DIR: 'apps',
  TIMEOUT: 120000,
  LOAD_MORE_DELAY: 3000,
  DEBUG: true,
  MAX_RETRIES: 3
};

const debug = (...args) => {
  if (CONFIG.DEBUG) {
    console.log(`[${new Date().toISOString()}]`, ...args);
  }
};

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function setupPage(page) {
  debug('Setting up page configuration');
  
  await page.setRequestInterception(true);
  
  page.on('request', request => {
    const resourceType = request.resourceType();
    if (['document', 'xhr', 'fetch', 'script'].includes(resourceType)) {
      request.continue();
    } else {
      request.abort();
    }
  });

  await page.setDefaultTimeout(CONFIG.TIMEOUT);
  await page.setDefaultNavigationTimeout(CONFIG.TIMEOUT);
}


async function clickTriggerActionsTab(page) {
  debug('Looking for Triggers & Actions tab');
  try {
    // Wait for content to load
    await page.waitForSelector('.css-1vl3hh8-AppDetailsNav__nav', { timeout: 10000 });
    
    // Find and click the Triggers & Actions tab
    const clicked = await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('.css-1vl3hh8-AppDetailsNav__nav button'));
      const tab = tabs.find(t => t.textContent.includes('Triggers & Actions'));
      if (tab) {
        tab.click();
        return true;
      }
      return false;
    });
    
    if (clicked) {
      debug('Clicked Triggers & Actions tab');
      await delay(3000); // Wait longer for content to load
      return true;
    }
  } catch (e) {
    debug('Error with Triggers & Actions tab:', e.message);
  }
  return false;
}

async function loadAllContent(page) {
  debug('Loading all content');
  
  let hasMore = true;
  let attempts = 0;
  const maxAttempts = 15;
  
  while (hasMore && attempts < maxAttempts) {
    try {
      await page.waitForSelector('.css-1avj58e-BaseButton, .css-15o0hnq-TriggerActionList__listItem', { timeout: 5000 });
      
      const buttonVisible = await page.evaluate(() => {
        const button = document.querySelector('.css-1avj58e-BaseButton');
        if (!button) return false;
        
        const rect = button.getBoundingClientRect();
        const style = window.getComputedStyle(button);
        const isVisible = rect.width > 0 && 
                         rect.height > 0 && 
                         style.display !== 'none' && 
                         style.visibility !== 'hidden';
        
        if (isVisible) {
          button.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        return isVisible;
      });

      if (buttonVisible) {
        debug(`Clicking Load More button, attempt ${attempts + 1}`);
        await delay(1000); // Wait after scrolling
        await page.click('.css-1avj58e-BaseButton');
        await delay(2000); // Wait for content to load
        attempts++;
      } else {
        debug('No more Load More buttons found');
        hasMore = false;
      }
    } catch (e) {
      debug('Error loading more content:', e.message);
      hasMore = false;
    }
  }
}

async function scrapeApp(page, url, categoryName) {
    debug(`Scraping app: ${url}`);
    
    try {
      await page.goto(url, { waitUntil: 'networkidle0' });
      await delay(2000); // Wait for initial load
      
      // Click the Triggers & Actions tab first
      await clickTriggerActionsTab(page);
      
      // Load all content
      await loadAllContent(page);
  
      const appData = await page.evaluate(() => {
        const cleanText = text => text?.trim().replace(/\s+/g, ' ') || '';
  
        // Premium detection - look for multiple possible premium indicators
        const premiumIndicators = [
          '.css-16otba1',
          '[data-testid="explore-app-header_premium-badge"]',
          '.css-1th6yid-AppHeader__appNames span'
        ];
        
        const isPremium = premiumIndicators.some(selector => {
          const element = document.querySelector(selector);
          return element && element.innerText.includes('Premium');
        });
  
        // Get categories from header tags and badges section
        const categories = new Set();
        
        // Check header tags
        const headerTags = document.querySelector('[data-testid="explore-app-header_tags"]');
        if (headerTags) {
          Array.from(headerTags.querySelectorAll('span'))
            .map(span => cleanText(span.innerText))
            .filter(text => text && text !== 'Premium')
            .forEach(cat => categories.add(cat));
        }
        
        // Check badges section
        const badgesSection = document.querySelector('.css-16gdie2-AppDetails__badgesSection');
        if (badgesSection) {
          Array.from(badgesSection.querySelectorAll('span'))
            .map(span => cleanText(span.innerText))
            .filter(text => text && text !== 'Premium')
            .forEach(cat => categories.add(cat));
        }
  
        // Get triggers and actions with more flexible selectors
        const items = Array.from(document.querySelectorAll('.css-15o0hnq-TriggerActionList__listItem, [class*="TriggerActionList__listItem"]'));
        const triggers = [];
        const actions = [];
  
        items.forEach(item => {
          if (!item.innerText) return;
          
          // Get the main text content
          const summaryElement = item.querySelector('[class*="summaryText"], [class*="SummaryText"]');
          const fullText = summaryElement?.innerText?.trim() || '';
          
          // Split into title and description
          let name = '';
          let description = '';
          
          // Handle multiple text patterns
          if (fullText) {
            // Pattern 1: Name followed by description with clear action/verb separation
            const verbPattern = /^([^A-Z]+?[a-z])([A-Z].+)$/;
            // Pattern 2: Clean split between name and description (often with newlines)
            const splitPattern = /^(.+?)(?:\n+|\s{2,}|\.\s+|\s*Triggers\s+)(.+)$/;
            
            let matches = fullText.match(verbPattern);
            if (!matches) {
              matches = fullText.match(splitPattern);
            }
            
            if (matches) {
              name = matches[1].trim();
              description = matches[2].trim();
              
              // Clean up any remaining newlines in name
              name = name.replace(/\n/g, ' ').trim();
              
              // Handle cases where description starts with "Triggers"
              if (description.startsWith('Triggers') && !name.includes('Trigger')) {
                description = 'Triggers ' + description.substring(8).trim();
              }
              
              // Clean up cases where action verbs got split
              const actionVerbs = ['Finds', 'Creates', 'Updates', 'Adds', 'Removes', 'Triggers'];
              actionVerbs.forEach(verb => {
                if (description.startsWith(verb) && !name.includes(verb)) {
                  description = description.trim();
                  if (description.endsWith('.')) {
                    description = description.slice(0, -1);
                  }
                }
              });
              
            } else {
              // Fallback: use the full text as name if we can't split it
              name = fullText;
            }
          }

          // Determine if it's an action or trigger by checking for action-specific classes
          const isAction = Boolean(
            item.querySelector([
              '.css-14cz6vv-AppAction-AppAction',
              '[class*="AppAction"]',
              '[class*="actionBadge"]',
              '[data-testid*="action"]'
            ].join(', '))
          );

          const itemData = {
            name: name,
            description: description || null
          };

          if (isAction) {
            actions.push(itemData);
          } else {
            triggers.push(itemData);
          }
        });
  
        // Get about text from the specific class
        const aboutText = document.querySelector('.css-nuyo7l-AppDetails__appDescription')?.innerText || '';
  
        // Get help links - only from help.zapier.com
        const helpLinks = Array.from(document.querySelectorAll('a[href*="help.zapier.com"]'))
          .map(a => a.href)
          .filter(url => url.includes('help.zapier.com'))
          .filter((url, index, self) => self.indexOf(url) === index);
  
        return {
          title: cleanText(document.querySelector('.css-1th6yid-AppHeader__appNames')?.innerText),
          isPremium,
          about: cleanText(aboutText),
          logo: document.querySelector('[class*="logo"] img, [class*="Logo"] img')?.src,
          helpLinks,
          categories: Array.from(categories),
          triggers,
          actions
        };
      });
  
      return {
        ...appData,
        sourceCategory: categoryName,
        url,
        scrapedAt: new Date().toISOString()
      };
  
    } catch (error) {
      debug(`Error scraping ${url}:`, error.message);
      return null;
    }
  }

async function processApp(page, url, categoryName, retryCount = 0) {
  const appName = url.split('/apps/')[1].split('/')[0];
  const outputPath = path.join(CONFIG.APPS_DIR, `${appName}.json`);

  try {
    // Check if file already exists
    try {
      await fs.access(outputPath);
      debug(`Skipping ${appName} - already processed`);
      return false;
    } catch {
      // File doesn't exist, continue processing
    }

    const appData = await scrapeApp(page, url, categoryName);
    if (!appData && retryCount < CONFIG.MAX_RETRIES) {
      debug(`Retry ${retryCount + 1} for ${appName}`);
      await delay(CONFIG.LOAD_MORE_DELAY);
      return processApp(page, url, categoryName, retryCount + 1);
    }

    if (appData) {
      await fs.writeFile(outputPath, JSON.stringify(appData, null, 2));
      debug(`Saved data for ${appName}`);
      return true;
    }

    return false;
  } catch (error) {
    debug(`Error processing ${appName}:`, error.message);
    return false;
  }
}

async function processBatch(urls, categoryName, batchId) {
  debug(`Starting batch ${batchId} with ${urls.length} URLs`);
  
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: CONFIG.CHROME_PATH,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--window-size=1920x1080'
    ],
    defaultViewport: {
      width: 1920,
      height: 1080
    }
  });

  try {
    const page = await browser.newPage();
    await setupPage(page);
    
    let processed = 0;
    let skipped = 0;

    for (const url of urls) {
      const result = await processApp(page, url, categoryName);
      if (result) {
        processed++;
      } else {
        skipped++;
      }
      await delay(1000);
    }

    debug(`Batch ${batchId} completed: ${processed} processed, ${skipped} skipped`);
    return { processed, skipped };
  } finally {
    await browser.close();
  }
}

// Add machine status tracking
const machineStatus = {
  machine_id: MACHINE_ID,
  started_at: Date.now(),
  last_active: Date.now(),
  processed_count: 0,
  failed_count: 0,
  current_app: null,
  current_category: null
};

// Update machine status periodically
setInterval(async () => {
  try {
    await redisClient.updateMachineStatus(MACHINE_ID, machineStatus);
  } catch (error) {
    debug('Failed to update machine status:', error);
  }
}, 30000);

// Handle graceful shutdown
process.on('SIGINT', async () => {
  debug('Shutting down...');
  try {
    await redisClient.updateMachineStatus(MACHINE_ID, {
      ...machineStatus,
      status: 'stopped'
    });
  } catch (error) {
    debug('Error updating final status:', error);
  }
  process.exit();
});

async function main() {
  debug('Starting app scraping process');
  const BATCH_SIZE = 50;
  const CONCURRENT_BATCHES = 3;

  try {
    // Create apps directory if it doesn't exist
    try {
      await fs.access(CONFIG.APPS_DIR);
    } catch {
      await fs.mkdir(CONFIG.APPS_DIR);
      debug('Created apps directory');
    }

    // Read all category JSON files
    const files = await fs.readdir(CONFIG.CATEGORY_DIR);
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    debug(`Found ${jsonFiles.length} category files`);

    let totalProcessed = 0;
    let totalSkipped = 0;

    for (const file of jsonFiles) {
      const filePath = path.join(CONFIG.CATEGORY_DIR, file);
      const content = JSON.parse(await fs.readFile(filePath, 'utf8'));
      debug(`Processing category: ${content.category} (${content.urls.length} apps)`);

      // Split URLs into batches
      const batches = [];
      for (let i = 0; i < content.urls.length; i += BATCH_SIZE) {
        batches.push(content.urls.slice(i, i + BATCH_SIZE));
      }
      
      // Process batches in parallel
      for (let i = 0; i < batches.length; i += CONCURRENT_BATCHES) {
        const currentBatches = batches.slice(i, i + CONCURRENT_BATCHES);
        const results = await Promise.all(
          currentBatches.map((batch, index) => 
            processBatch(batch, content.category, `${content.category}-${i + index}`)
          )
        );
        
        // Aggregate results
        results.forEach(result => {
          totalProcessed += result.processed;
          totalSkipped += result.skipped;
        });

        debug(`Progress: ${totalProcessed} processed, ${totalSkipped} skipped`);
      }
    }

    debug(`Scraping completed: ${totalProcessed} processed, ${totalSkipped} skipped`);
  } catch (error) {
    debug('Fatal error:', error);
    process.exit(1);
  }
}

main().catch(console.error);