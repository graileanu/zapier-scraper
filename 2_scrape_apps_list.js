const puppeteer = require('puppeteer-core');
const fs = require('fs');
const os = require('os');
const colors = require('colors');

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
  // Maximum time (in milliseconds) to wait for page operations before timing out
  TIMEOUT: 60000,  // Reduced to 1 minute
  
  // Base delay (in milliseconds) between scraping operations
  DELAY: 1000,  // Reduced delay
  
  // Delay (in milliseconds) after clicking "Load More" button
  LOAD_MORE_DELAY: 1500,  // Reduced delay
  
  // Path to Chrome executable for Puppeteer
  CHROME_PATH: process.env.CHROME_PATH || getDefaultChromePath(),
  
  // Directory where category results will be saved
  OUTPUT_DIR: 'category_results',
  
  // Enable/disable debug logging
  DEBUG: true,
  
  // Maximum time (in milliseconds) to wait for specific elements or conditions
  MAX_WAIT_TIME: 15000,  // Reduced timeout
  
  // Interval (in milliseconds) between scroll attempts
  SCROLL_INTERVAL: 500,  // Reduced interval
  
  // Interval (in milliseconds) to check if page has finished loading
  PAGE_LOAD_CHECK_INTERVAL: 500,  // Reduced interval
  
  // Maximum number of attempts to load more content
  MAX_ATTEMPTS: 100,
  
  // Maximum consecutive attempts with no new content before stopping
  NO_NEW_CONTENT_MAX_ATTEMPTS: 3,  // Reduced attempts
  
  // Minimum number of new items expected per load operation
  MIN_NEW_ITEMS_PER_LOAD: 10,  // Reduced minimum
  
  // Number of categories to process in parallel
  CONCURRENT_CATEGORIES: 1,
  
  // Browser instance settings
  BROWSER_OPTIONS: {
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--window-size=1920x1080'
    ],
    defaultViewport: { width: 1920, height: 1080 }
  }
};

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const debug = (...args) => {
  if (CONFIG.DEBUG) {
    console.log(`[${new Date().toISOString()}]`, ...args);
  }
};

/**
 * Determines if the script is running on macOS
 * @returns {boolean} True if running on macOS, false otherwise
 */
function isMacOS() {
  return os.platform() === 'darwin';
}

/**
 * Gets the appropriate Puppeteer launch options based on the operating system
 * @returns {Object} Puppeteer launch configuration options
 */
function getLaunchOptions() {
  const baseOptions = {
    executablePath: CONFIG.CHROME_PATH,
    args: ['--no-sandbox'],
    defaultViewport: null
  };

  if (isMacOS()) {
    return {
      ...baseOptions,
      headless: false
    };
  }

  return {
    ...baseOptions,
    headless: 'new'
  };
}

/**
 * Configures a Puppeteer page instance with request interception and timeout settings.
 * - Sets up request filtering to only allow essential resource types (document, xhr, fetch, script)
 * - Blocks other resource types to improve performance (images, stylesheets, etc.)
 * - Configures default timeouts for page operations and navigation
 * - Handles request interception errors gracefully
 * 
 * @param {import('puppeteer-core').Page} page - The Puppeteer page instance to configure
 * @returns {Promise<void>}
 */
async function setupPage(page) {
  debug('Setting up page interceptors and configurations');
  
  // Remove existing listeners to prevent double-handling
  await page.removeAllListeners('request');
  
  // Set up request interception
  await page.setRequestInterception(true);
  
  // Single request handler
  page.on('request', request => {
    try {
      const resourceType = request.resourceType();
      if (['document', 'xhr', 'fetch', 'script'].includes(resourceType)) {
        debug(`Allowing ${resourceType} request: ${request.url()}`);
        request.continue();
      } else {
        debug(`Blocking ${resourceType} request: ${request.url()}`);
        request.abort();
      }
    } catch (e) {
      debug('Error handling request:', e.message);
      // If request is already handled, just ignore the error
      if (!e.message.includes('Request is already handled')) {
        throw e;
      }
    }
  });

  // Configure page timeouts
  await page.setDefaultTimeout(CONFIG.TIMEOUT);
  await page.setDefaultNavigationTimeout(CONFIG.TIMEOUT);
}

/**
 * Searches for and returns a "Load More" button on the page using multiple strategies:
 * 1. First tries CSS class-based selectors targeting common load more button patterns
 * 2. Then checks attribute-based selectors (aria-label, data-testid)
 * 3. Finally falls back to text content search for buttons containing "Load more"
 * 
 * For each found button, verifies:
 * - Button is visible (has offsetParent)
 * - Button text contains "load more" (case insensitive)
 * - Button is actually clickable
 * 
 * Returns:
 * - ElementHandle of the found button if successful
 * - null if no valid load more button is found
 * 
 * Includes detailed debug logging of the search process and button properties
 * for troubleshooting.
 * 
 * @param {import('puppeteer-core').Page} page - Puppeteer page to search
 * @returns {Promise<ElementHandle | null>} The found button element or null
 */
async function findLoadMoreButton(page) {
  debug('Starting button detection...');
  
  const buttonSelectors = [
    // CSS class-based selectors that work
    '[class*="loadMore"]',
    '[class*="LoadMore"]',
    '[class*="load-more"]',
    '.load-more-button',
    
    // Attribute-based selectors
    'button[aria-label*="load more"]',
    'button[aria-label*="show more"]',
    '[data-testid*="load-more"]',
    
    // Text content-based selectors using evaluate
    'button:contains("Load more")',
    'button:contains("Show more")',
    '[role="button"]:contains("Load more")'
  ];

  // Try class and attribute based selectors first (faster)
  for (const selector of buttonSelectors.slice(0, 7)) {
    try {
      debug(`Trying selector: ${selector}`);
      const button = await page.$(selector);
      if (button) {
        const buttonInfo = await page.evaluate(el => ({
          text: el.innerText,
          isVisible: !!el.offsetParent,
          attributes: Array.from(el.attributes).map(attr => `${attr.name}="${attr.value}"`).join(', ')
        }), button);
        
        if (buttonInfo.isVisible && buttonInfo.text.toLowerCase().includes('load more')) {
          debug(`Found button with selector ${selector}:`, buttonInfo);
          return button;
        }
      }
    } catch (e) {
      debug(`Error with selector ${selector}:`, e.message);
    }
  }

  // If no button found, try text content based search
  try {
    const button = await page.evaluateHandle(() => {
      const elements = [...document.querySelectorAll('button, [role="button"]')];
      return elements.find(el => 
        el.innerText.toLowerCase().includes('load more') && 
        el.offsetParent !== null
      );
    });

    if (button.asElement()) {
      const buttonInfo = await page.evaluate(el => ({
        text: el.innerText,
        isVisible: !!el.offsetParent,
        attributes: Array.from(el.attributes).map(attr => `${attr.name}="${attr.value}"`).join(', ')
      }), button.asElement());
      
      debug('Found button using text content search:', buttonInfo);
      return button.asElement();
    }
  } catch (e) {
    debug('Error during text content search:', e.message);
  }

  debug('No load more button found');
  return null;
}

/**
 * Loads all available apps from a Zapier category page by repeatedly clicking the "Load More" button
 * until all content is loaded or stopping conditions are met.
 * 
 * Key features:
 * - Tracks the number of loaded items to detect when no new content is being added
 * - Uses multiple scroll positions to find hidden "Load More" buttons
 * - Implements retry logic with configurable maximum attempts
 * - Provides detailed progress logging
 * - Handles loading failures gracefully
 * 
 * Stopping conditions:
 * - Reached maximum number of attempts (CONFIG.MAX_ATTEMPTS)
 * - No new content loaded for several consecutive attempts (CONFIG.NO_NEW_CONTENT_MAX_ATTEMPTS)
 * - No "Load More" button found after multiple scroll attempts
 * 
 * @param {import('puppeteer-core').Page} page - Puppeteer page instance to load content from
 * @returns {Promise<number>} Total number of apps loaded
 */
async function loadAllApps(page) {
  let hasMore = true;
  let attempts = 0;
  let noNewContentAttempts = 0;
  let totalLoaded = 0;
  let previousCount = 0;
  const maxAttempts = CONFIG.MAX_ATTEMPTS;
  const maxNoNewContentAttempts = CONFIG.NO_NEW_CONTENT_MAX_ATTEMPTS;

  debug('Starting enhanced content loading process');
  
  // Get initial count of items
  const startingCount = await page.evaluate(() => 
    document.querySelectorAll('a[href*="/apps/"][href*="/integrations"]').length
  );
  debug(`Starting with ${startingCount} items`);

  while (hasMore && attempts < maxAttempts && noNewContentAttempts < maxNoNewContentAttempts) {
    try {
      debug(`Load more attempt ${attempts + 1}/${maxAttempts} (Previous total: ${previousCount})`);
      
      const initialCount = await page.evaluate(() => 
        document.querySelectorAll('a[href*="/apps/"][href*="/integrations"]').length
      );

      // Force scroll to ensure button is in view
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight - 1000);
      });
      await delay(1000);
      
      const button = await findLoadMoreButton(page);
      
      if (!button) {
        debug('No load more button visible - doing deep scroll check');
        // Try multiple scroll positions
        for (let scrollPosition = 0.5; scrollPosition <= 1; scrollPosition += 0.1) {
          await page.evaluate((pos) => {
            window.scrollTo(0, document.body.scrollHeight * pos);
          }, scrollPosition);
          await delay(500);
          const retryButton = await findLoadMoreButton(page);
          if (retryButton) {
            debug(`Found button after scrolling to ${scrollPosition * 100}% of page`);
            await retryButton.click();
            break;
          }
        }
        await delay(CONFIG.LOAD_MORE_DELAY);
        
        const newCount = await page.evaluate(() => 
          document.querySelectorAll('a[href*="/apps/"][href*="/integrations"]').length
        );
        
        if (newCount <= initialCount + CONFIG.MIN_NEW_ITEMS_PER_LOAD) {
          noNewContentAttempts++;
          debug(`No significant new content. Attempt ${noNewContentAttempts}/${maxNoNewContentAttempts}`);
        } else {
          totalLoaded += newCount - initialCount;
          noNewContentAttempts = 0;
          previousCount = newCount;
          debug(`Loaded ${newCount - initialCount} new items. Total: ${newCount}`);
        }
      } else {
        debug('Found Load More button, clicking...');
        await Promise.all([
          button.click(),
          page.waitForFunction(
            (prevCount, minNew) => 
              document.querySelectorAll('a[href*="/apps/"][href*="/integrations"]').length >= prevCount + minNew,
            { timeout: CONFIG.TIMEOUT },
            initialCount,
            CONFIG.MIN_NEW_ITEMS_PER_LOAD
          ).catch(() => debug('Timeout waiting for new content'))
        ]);
        
        await delay(CONFIG.LOAD_MORE_DELAY);
        
        const newCount = await page.evaluate(() => 
          document.querySelectorAll('a[href*="/apps/"][href*="/integrations"]').length
        );

        if (newCount >= initialCount + CONFIG.MIN_NEW_ITEMS_PER_LOAD) {
          totalLoaded += newCount - initialCount;
          noNewContentAttempts = 0;
          previousCount = newCount;
          debug(`Successfully loaded ${newCount - initialCount} new items. Total: ${newCount}`);
        } else {
          noNewContentAttempts++;
          debug(`Insufficient new content. Attempt ${noNewContentAttempts}/${maxNoNewContentAttempts}`);
        }
      }
      
      attempts++;
    } catch (e) {
      attempts++;
      debug(`Error during load attempt ${attempts}:`, e.message);
      await delay(CONFIG.LOAD_MORE_DELAY * 2);
    }

    // Progress check every 5 attempts
    if (attempts % 5 === 0) {
      const currentCount = await page.evaluate(() => 
        document.querySelectorAll('a[href*="/apps/"][href*="/integrations"]').length
      );
      debug(`Progress check: ${currentCount} total items loaded (${currentCount - startingCount} new)`);
    }
  }

  const finalCount = await page.evaluate(() => 
    document.querySelectorAll('a[href*="/apps/"][href*="/integrations"]').length
  );
  debug(`Finished loading. Total items: ${finalCount}, New items: ${finalCount - startingCount}`);
  return finalCount;
}

/**
 * Scrapes all app URLs from a given Zapier category page.
 * 
 * Key functionality:
 * - Navigates to the category URL with JavaScript enabled
 * - Uses loadAllApps() to load all content by clicking "Load More" buttons
 * - Extracts all app integration URLs matching pattern: https://zapier.com/apps/{app}}/integrations
 * - Performs URL extraction twice (with and without JavaScript) to ensure completeness
 * - Deduplicates URLs before returning
 * 
 * Process:
 * 1. Loads page with JavaScript enabled to handle dynamic content
 * 2. Loads all available apps using loadAllApps()
 * 3. Extracts URLs from loaded content
 * 4. Disables JavaScript and re-extracts URLs as backup
 * 5. Combines and deduplicates URLs from both extractions
 * 
 * @param {import('puppeteer-core').Page} page - Puppeteer page instance to scrape
 * @param {Object} category - Category object containing name and URL
 * @param {string} category.name - Name of the category
 * @param {string} category.url - URL of the category page
 * @returns {Promise<string[]>} Array of unique app integration URLs
 * @throws Logs but doesn't throw errors, returns empty array on failure
 */
async function scrapeCategory(page, category) {
  debug(`Processing category: ${category.name}`);
  
  try {
    // First load with JavaScript enabled to handle "Load more" clicks
    await page.setJavaScriptEnabled(true);
    await page.goto(category.url, { waitUntil: 'networkidle0', timeout: CONFIG.TIMEOUT });
    
    // Load all content first
    await loadAllApps(page);
    debug('All content loaded, preparing to extract URLs');
    
    // Extract URLs while content is still loaded
    const urls = await page.evaluate(() => {
      const pattern = /https:\/\/zapier\.com\/apps\/[^\/]+\/integrations/;
      const links = Array.from(document.querySelectorAll('a[href*="/apps/"][href*="/integrations"]'));
      return links
        .map(a => a.href)
        .filter(url => pattern.test(url))
        .filter((url, index, self) => self.indexOf(url) === index);
    });

    debug(`Found ${urls.length} unique app URLs before cleanup`);

    // Now disable JavaScript but don't reload
    await page.setJavaScriptEnabled(false);
    
    // Double-check our URLs are still valid
    const finalUrls = await page.evaluate(() => {
      const pattern = /https:\/\/zapier\.com\/apps\/[^\/]+\/integrations/;
      const links = Array.from(document.querySelectorAll('a[href*="/apps/"][href*="/integrations"]'));
      return links
        .map(a => a.href)
        .filter(url => pattern.test(url))
        .filter((url, index, self) => self.indexOf(url) === index);
    });

    // Take the larger set of URLs
    const allUrls = [...new Set([...urls, ...finalUrls])];
    debug(`Final count: ${allUrls.length} unique app URLs`);
    
    return allUrls;
  } catch (error) {
    console.error(`Error processing ${category.name}:`, error);
    return [];
  }
}

async function processCategory(browser, category) {
  const page = await browser.newPage();
  await setupPage(page);
  
  const filename = `${CONFIG.OUTPUT_DIR}/${category.name.replace(/[^a-z0-9]/gi, '_')}.json`;
  if (fs.existsSync(filename)) {
    debug(`Skipping ${category.name} - already processed`);
    await page.close();
    return;
  }

  debug(`Processing category: ${category.name.green}`);

  try {
    const apps = await scrapeCategory(page, category);
    
    if (apps.length > 0) {
      fs.writeFileSync(filename, JSON.stringify({
        category: category.name,
        url: category.url,
        scrapedAt: new Date().toISOString(),
        totalUrls: apps.length,
        urls: apps
      }, null, 2));
      
      debug(`✓ Completed ${category.name.green} with ${String(apps.length).yellow} apps`);
    }
  } catch (error) {
    console.error(`Error scraping ${category.name.red}:`, error);
  } finally {
    await page.close();
  }
}

// Add this function after the debug function
async function getRandomUnprocessedCategory(categories) {
  const unprocessedCategories = categories.filter(category => {
    const filename = `${CONFIG.OUTPUT_DIR}/${category.name.replace(/[^a-z0-9]/gi, '_')}.json`;
    return !fs.existsSync(filename);
  });

  if (unprocessedCategories.length === 0) {
    return null;
  }

  const randomIndex = Math.floor(Math.random() * unprocessedCategories.length);
  return unprocessedCategories[randomIndex];
}

/**
 * Main execution function that orchestrates the scraping process for Zapier app categories.
 * 
 * Key responsibilities:
 * - Creates output directory if it doesn't exist
 * - Loads category data from categories.json
 * - Initializes Puppeteer browser with custom configuration
 * - Sets up page interceptors and configurations
 * - Iterates through categories and scrapes each one:
 *   - Skips already processed categories (based on existing JSON files)
 *   - Calls scrapeCategory() for each unprocessed category
 *   - Saves results to JSON files in the output directory
 *   - Implements delay between category scrapes
 * - Handles errors gracefully at both category and global levels
 * - Provides detailed logging throughout the process
 * 
 * The function references the following configuration:
 * - OUTPUT_DIR: Directory for saving category results
 * - CHROME_PATH: Path to Chrome executable
 * - DELAY: Delay between processing categories
 * 
 * Output files are named based on sanitized category names and contain:
 * - Category name and URL
 * - Timestamp of scraping
 * - Total number of URLs found
 * - Array of all app URLs
 * 
 * @returns {Promise<void>}
 * @throws Will log but not throw errors from individual category processing
 */
async function main() {
  debug('Starting scraping process');
  
  if (!fs.existsSync(CONFIG.OUTPUT_DIR)) {
    fs.mkdirSync(CONFIG.OUTPUT_DIR);
    debug('Created output directory');
  }

  const categories = JSON.parse(fs.readFileSync('categories.json'));
  debug(`Loaded ${categories.length} categories`);

  const browser = await puppeteer.launch({
    ...getLaunchOptions(),
    ...CONFIG.BROWSER_OPTIONS
  });

  try {
    while (true) {
      const category = await getRandomUnprocessedCategory(categories);
      
      if (!category) {
        debug('No more categories to process');
        break;
      }

      debug(`Processing category: ${category.name}`);
      await processCategory(browser, category);
      await delay(CONFIG.DELAY); // Add delay between categories
    }
  } finally {
    await browser.close();
  }
  
  debug('Scraping process completed');
}

main().catch(console.error);