const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

class OthobaElectronicsScraper {
    constructor() {
        this.baseUrl = 'https://othoba.com/electronics-appliances';
        this.products = [];
        this.logMessages = [];
        this.maxRetries = 3;
        this.delay = 2000;
    }

    log(message) {
        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] ${message}`;
        console.log(logEntry);
        this.logMessages.push(logEntry);
    }

    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async initBrowser() {
        try {
            this.log('Initializing browser...');
            this.browser = await puppeteer.launch({
                headless: 'new',
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--single-process',
                    '--disable-gpu'
                ]
            });
            this.page = await this.browser.newPage();
            await this.page.setViewport({ width: 1920, height: 1080 });
            await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
            this.log('Browser initialized successfully');
        } catch (error) {
            this.log(`Error initializing browser: ${error.message}`);
            throw error;
        }
    }

    async navigateToPage(url, retryCount = 0) {
        try {
            this.log(`Navigating to: ${url}`);
            await this.page.goto(url, { 
                waitUntil: 'networkidle2', 
                timeout: 30000 
            });
            await this.delay(3000);
            this.log('Page loaded successfully');
            return true;
        } catch (error) {
            this.log(`Error navigating to page (attempt ${retryCount + 1}): ${error.message}`);
            if (retryCount < this.maxRetries) {
                await this.delay(5000);
                return this.navigateToPage(url, retryCount + 1);
            }
            throw error;
        }
    }

    async scrollAndLoadMore() {
        try {
            this.log('Scrolling to load more products...');
            let previousHeight = 0;
            let currentHeight = await this.page.evaluate('document.body.scrollHeight');
            
            while (previousHeight !== currentHeight) {
                previousHeight = currentHeight;
                await this.page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
                await this.delay(3000);
                currentHeight = await this.page.evaluate('document.body.scrollHeight');
                
                // Try to click "Load More" button if exists
                try {
                    await this.page.click('button[class*="load"], .load-more, .show-more', { timeout: 2000 });
                    await this.delay(3000);
                } catch (e) {
                    // No load more button found, continue
                }
            }
            this.log('Finished loading all products');
        } catch (error) {
            this.log(`Error during scrolling: ${error.message}`);
        }
    }

    extractColors(text) {
        const colorKeywords = [
            'black', 'white', 'red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'brown',
            'gray', 'grey', 'silver', 'gold', 'rose gold', 'space gray', 'midnight', 'starlight',
            'deep purple', 'sierra blue', 'graphite', 'alpine green', 'product red'
        ];
        
        const foundColors = [];
        const lowerText = text.toLowerCase();
        
        colorKeywords.forEach(color => {
            if (lowerText.includes(color)) {
                foundColors.push(color);
            }
        });
        
        return [...new Set(foundColors)];
    }

    async extractProductData() {
        try {
            this.log('Extracting product data...');
            
            const html = await this.page.content();
            const $ = cheerio.load(html);
            
            // Multiple selectors to catch different product layouts
            const productSelectors = [
                '.product-item',
                '.product-card',
                '.product',
                '[class*="product"]',
                '.item',
                '[data-product]'
            ];
            
            let productElements = $();
            for (const selector of productSelectors) {
                const elements = $(selector);
                if (elements.length > 0) {
                    productElements = elements;
                    this.log(`Found ${elements.length} products using selector: ${selector}`);
                    break;
                }
            }
            
            if (productElements.length === 0) {
                // Fallback: try to find any elements with product-like structure
                productElements = $('div').filter((i, el) => {
                    const $el = $(el);
                    return $el.find('img').length > 0 && 
                           ($el.text().includes('৳') || $el.text().includes('Tk') || $el.text().includes('Price'));
                });
                this.log(`Fallback found ${productElements.length} potential products`);
            }

            productElements.each((index, element) => {
                try {
                    const $product = $(element);
                    
                    // Extract product name
                    const nameSelectors = [
                        '.product-name', '.product-title', '.title', 'h3', 'h4', 'h5',
                        '[class*="name"]', '[class*="title"]', 'a[title]'
                    ];
                    
                    let productName = '';
                    for (const selector of nameSelectors) {
                        const nameEl = $product.find(selector).first();
                        if (nameEl.length && nameEl.text().trim()) {
                            productName = nameEl.text().trim();
                            break;
                        }
                    }
                    
                    if (!productName) {
                        productName = $product.find('a').attr('title') || 
                                     $product.find('img').attr('alt') || 
                                     'Unknown Product';
                    }

                    // Extract images
                    const images = [];
                    $product.find('img').each((i, img) => {
                        const src = $(img).attr('src') || $(img).attr('data-src') || $(img).attr('data-lazy');
                        if (src) {
                            const fullUrl = src.startsWith('http') ? src : `https://othoba.com${src}`;
                            images.push(fullUrl);
                        }
                    });

                    // Extract description/details
                    const descriptionSelectors = [
                        '.product-description', '.description', '.details', '.product-details',
                        '[class*="desc"]', 'p'
                    ];
                    
                    let description = '';
                    for (const selector of descriptionSelectors) {
                        const descEl = $product.find(selector).first();
                        if (descEl.length && descEl.text().trim()) {
                            description = descEl.text().trim();
                            break;
                        }
                    }

                    // Extract price
                    const priceSelectors = [
                        '.price', '.product-price', '[class*="price"]', '.amount'
                    ];
                    
                    let price = '';
                    for (const selector of priceSelectors) {
                        const priceEl = $product.find(selector).first();
                        if (priceEl.length && priceEl.text().trim()) {
                            price = priceEl.text().trim();
                            break;
                        }
                    }

                    // Extract colors from name and description
                    const allText = `${productName} ${description}`;
                    const colors = this.extractColors(allText);

                    // Extract category
                    let category = 'Electronics';
                    const categorySelectors = ['.category', '.breadcrumb', '[class*="category"]'];
                    for (const selector of categorySelectors) {
                        const catEl = $product.find(selector).first();
                        if (catEl.length && catEl.text().trim()) {
                            category = catEl.text().trim();
                            break;
                        }
                    }

                    // Only add products with valid data
                    if (productName && productName !== 'Unknown Product' && images.length > 0) {
                        const product = {
                            id: `product_${index + 1}`,
                            name: productName,
                            description: description || `${productName} - Electronics item from Othoba.com`,
                            colors: colors.length > 0 ? colors : ['Not specified'],
                            images: images,
                            price: price || 'Price not available',
                            category: category,
                            source: 'othoba.com',
                            scraped_at: new Date().toISOString()
                        };
                        
                        this.products.push(product);
                    }
                } catch (error) {
                    this.log(`Error extracting product ${index}: ${error.message}`);
                }
            });

            this.log(`Successfully extracted ${this.products.length} products`);
        } catch (error) {
            this.log(`Error in extractProductData: ${error.message}`);
            throw error;
        }
    }

    async generatePackageJson() {
        try {
            this.log('Generating package.json with scraped data...');
            
            const packageData = {
                name: "othoba-electronics-products",
                version: "1.0.0",
                description: "Electronics products scraped from Othoba.com",
                main: "index.js",
                scripts: {
                    test: "echo \"Error: no test specified\" && exit 1"
                },
                keywords: ["electronics", "othoba", "products", "ecommerce"],
                author: "BlackBox AI Scraper",
                license: "MIT",
                data: {
                    source_url: this.baseUrl,
                    scraped_at: new Date().toISOString(),
                    total_products: this.products.length,
                    categories: [...new Set(this.products.map(p => p.category))],
                    electronics_products: this.products
                },
                repository: {
                    type: "git",
                    url: "https://github.com/zahidSkywalker/zahid-aistudio-generator.git"
                }
            };

            const jsonContent = JSON.stringify(packageData, null, 2);
            fs.writeFileSync('package.json', jsonContent);
            this.log(`package.json created successfully with ${this.products.length} products`);
            
            // Also create a summary file
            const summary = {
                scraping_summary: {
                    total_products: this.products.length,
                    successful_extractions: this.products.length,
                    categories_found: [...new Set(this.products.map(p => p.category))],
                    colors_found: [...new Set(this.products.flatMap(p => p.colors))],
                    average_images_per_product: (this.products.reduce((sum, p) => sum + p.images.length, 0) / this.products.length).toFixed(2),
                    scraping_date: new Date().toISOString(),
                    source_url: this.baseUrl
                }
            };
            
            fs.writeFileSync('scraping-summary.json', JSON.stringify(summary, null, 2));
            this.log('Scraping summary created');
            
        } catch (error) {
            this.log(`Error generating package.json: ${error.message}`);
            throw error;
        }
    }

    async saveLog() {
        try {
            const logContent = this.logMessages.join('\n');
            fs.writeFileSync('scraping-log.txt', logContent);
            this.log('Log file saved successfully');
        } catch (error) {
            console.error(`Error saving log: ${error.message}`);
        }
    }

    async closeBrowser() {
        if (this.browser) {
            await this.browser.close();
            this.log('Browser closed');
        }
    }

    async scrape() {
        try {
            this.log('Starting Othoba Electronics Scraping Process...');
            
            await this.initBrowser();
            await this.navigateToPage(this.baseUrl);
            await this.scrollAndLoadMore();
            await this.extractProductData();
            await this.generatePackageJson();
            
            this.log(`Scraping completed successfully! Found ${this.products.length} electronics products.`);
            
        } catch (error) {
            this.log(`Scraping failed: ${error.message}`);
            throw error;
        } finally {
            await this.saveLog();
            await this.closeBrowser();
        }
    }
}

// Execute the scraper
async function main() {
    const scraper = new OthobaElectronicsScraper();
    try {
        await scraper.scrape();
        console.log('\n✅ Scraping completed successfully!');
        console.log('📁 Files created:');
        console.log('   - package.json (main product data)');
        console.log('   - scraping-summary.json (summary statistics)');
        console.log('   - scraping-log.txt (detailed logs)');
    } catch (error) {
        console.error('\n❌ Scraping failed:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = OthobaElectronicsScraper;