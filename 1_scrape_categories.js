const puppeteer = require('puppeteer-core');
const fs = require('fs');

async function scrapeCategories() {
  console.log('Starting category scraper...');
  
  const browser = await puppeteer.launch({ 
    headless: false,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--disable-javascript']
  });

  try {
    console.log('Creating page...');
    const page = await browser.newPage();
    
    console.log('Setting up request interception...');
    await page.setRequestInterception(true);
    page.on('request', request => {
      const type = request.resourceType();
      console.log(`Intercepted request: ${type} - ${request.url()}`);
      if (['script', 'stylesheet', 'image'].includes(type)) {
        request.abort();
      } else {
        request.continue();
      }
    });

    console.log('Navigating to categories page...');
    await page.goto('https://zapier.com/apps/categories', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    console.log('Waiting 5 seconds for page load...');
    await new Promise(r => setTimeout(r, 5000));

    console.log('Extracting categories...');
    const categories = await page.evaluate(() => {
      const links = document.querySelectorAll('a[href*="/categories/"]');
      console.log(`Found ${links.length} potential category links`);
      
      return Array.from(links).map(link => {
        console.log(`Processing link: ${link.href}`);
        return {
          name: link.textContent.trim(),
          url: link.href
        };
      }).filter(cat => cat.name && cat.url);
    });

    console.log('Categories found:', categories);
    
    if (categories.length > 0) {
      fs.writeFileSync('categories.json', JSON.stringify(categories, null, 2));
      console.log(`Saved ${categories.length} categories to categories.json`);
    } else {
      console.log('No categories found!');
    }

    // Debug page content
    const html = await page.content();
    console.log('Page HTML:', html.substring(0, 500));

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await browser.close();
    console.log('Browser closed');
  }
}

scrapeCategories();