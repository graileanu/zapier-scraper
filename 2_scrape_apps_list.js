const puppeteer = require('puppeteer-core');
const fs = require('fs');

const CONFIG = {
  // Maximum time (in milliseconds) to wait for page operations before timing out
  TIMEOUT: 120000,  // 2 minutes
  
  // Base delay (in milliseconds) between scraping operations
  DELAY: 2000,
  
  // Delay (in milliseconds) after clicking "Load More" button
  LOAD_MORE_DELAY: 3000,
  
  // Path to Chrome executable for Puppeteer
  CHROME_PATH: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  
  // Directory where category results will be saved
  OUTPUT_DIR: 'category_results',
  
  // Enable/disable debug logging
  DEBUG: true,
  
  // Maximum time (in milliseconds) to wait for specific elements or conditions
  MAX_WAIT_TIME: 30000,
  
  // Interval (in milliseconds) between scroll attempts
  SCROLL_INTERVAL: 1000,
  
  // Interval (in milliseconds) to check if page has finished loading
  PAGE_LOAD_CHECK_INTERVAL: 500,
  
  // Maximum number of attempts to load more content
  MAX_ATTEMPTS: 50,
  
  // Maximum consecutive attempts with no new content before stopping
  NO_NEW_CONTENT_MAX_ATTEMPTS: 5,
  
  // Minimum number of new items expected per load operation
  MIN_NEW_ITEMS_PER_LOAD: 15
};

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const debug = (...args) => {
  if (CONFIG.DEBUG) {
    console.log(`[${new Date().toISOString()}]`, ...args);
  }
};

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
    headless: false,
    executablePath: CONFIG.CHROME_PATH,
    args: ['--no-sandbox'],
    defaultViewport: null
  });
  
  const page = await browser.newPage();
  await setupPage(page);

  for (const category of categories) {
    const filename = `${CONFIG.OUTPUT_DIR}/${category.name.replace(/[^a-z0-9]/gi, '_')}.json`;
    if (fs.existsSync(filename)) {
      debug(`Skipping ${category.name} - already processed`);
      continue;
    }

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
        
        debug(`Saved ${apps.length} apps for ${category.name}`);
      }
      
      await delay(CONFIG.DELAY);
    } catch (error) {
      console.error(`Error scraping ${category.name}:`, error);
    }
  }

  await browser.close();
  debug('Scraping process completed');
}

main().catch(console.error);