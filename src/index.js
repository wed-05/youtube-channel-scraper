onst defaults = require('./config/defaults.json');
const { scrapeYoutube: runScraper } = require('./scraper/youtube_parser');

/**
* Public API to run the YouTube Channel Scraper programmatically.
*
* @param {object} config - Scraper configuration override.
* @returns {Promise<object[]>} - List of scraped video objects.
*/
async function scrapeYoutube(config = {}) {
const merged = {
...defaults,
...config,
};

return runScraper(merged);
}

module.exports = {
scrapeYoutube,
};