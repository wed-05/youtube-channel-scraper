onst puppeteer = require('puppeteer');
const { logger, ScraperError } = require('../helpers/error_handler');

/**
* Launch a Puppeteer browser instance.
*/
async function createBrowser(options = {}) {
const { headless = true } = options;

try {
const browser = await puppeteer.launch({
headless,
args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

logger.info(`Browser started (headless=${headless})`);
return browser;
} catch (err) {
throw new ScraperError(`Failed to launch browser: ${err.message}`, 'BROWSER_LAUNCH_FAILED');
}
}

/**
* Create a new page with some sensible defaults (user agent, viewport, etc.).
*/
async function createPage(browser) {
try {
const page = await browser.newPage();
await page.setViewport({ width: 1366, height: 768 });

await page.setUserAgent(
'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
'AppleWebKit/537.36 (KHTML, like Gecko) ' +
'Chrome/119.0.0.0 Safari/537.36'
);

page.on('console', (msg) => {
const type = msg.type();
if (type === 'warning') {
logger.warn(`Page console warning: ${msg.text()}`);
} else if (type === 'error') {
logger.error(`Page console error: ${msg.text()}`);
}
});

return page;
} catch (err) {
throw new ScraperError(`Failed to create a new page: ${err.message}`, 'PAGE_CREATION_FAILED');
}
}

/**
* Scrolls the page down multiple times to trigger lazy loading of content.
*/
async function autoScroll(page, maxScrolls = 10, scrollStep = 1000, delayMs = 500) {
try {
for (let i = 0; i < maxScrolls; i += 1) {
/* eslint-disable no-await-in-loop */
await page.evaluate(
(step) => {
window.scrollBy(0, step);
},
scrollStep
);
await page.waitForTimeout(delayMs);
}
} catch (err) {
logger.warn(`autoScroll error (non-fatal): ${err.message}`);
}
}

/**
* Wait for network to be "idle enough" – a simplified heuristic.
*/
async function waitForNetworkIdle(page, timeout = 10000, maxInflightRequests = 2) {
let inflight = 0;
let fulfill;
const promise = new Promise((resolve) => {
fulfill = resolve;
});

const onRequestStarted = () => {
inflight += 1;
};
const onRequestFinished = () => {
inflight -= 1;
if (inflight <= maxInflightRequests) {
fulfill();
}
};

page.on('request', onRequestStarted);
page.on('requestfinished', onRequestFinished);
page.on('requestfailed', onRequestFinished);

try {
await Promise.race([
promise,
new Promise((resolve) => setTimeout(resolve, timeout)),
]);
} finally {
page.off('request', onRequestStarted);
page.off('requestfinished', onRequestFinished);
page.off('requestfailed', onRequestFinished);
}
}

module.exports = {
createBrowser,
createPage,
autoScroll,
waitForNetworkIdle,
};