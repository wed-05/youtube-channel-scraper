onst fs = require('fs');
const path = require('path');
const yargs = require('yargs');
const { hideBin } = require('yargs/helpers');

const { scrapeYoutube } = require('./index');
const defaults = require('./config/defaults.json');
const { logger, handleError } = require('./helpers/error_handler');

/**
* Resolve CLI options and optional JSON input file into a single config object.
*/
function buildConfig(argv) {
let fileConfig = {};

if (argv.input) {
const inputPath = path.resolve(argv.input);
if (!fs.existsSync(inputPath)) {
throw new Error(`Input config file not found at: ${inputPath}`);
}

const raw = fs.readFileSync(inputPath, 'utf8');
try {
fileConfig = JSON.parse(raw);
} catch (e) {
throw new Error(`Failed to parse JSON from input file: ${e.message}`);
}
}

const cliConfig = {
mode: argv.mode,
channelUrl: argv.channelUrl,
keyword: argv.keyword,
maxVideos: argv.maxVideos,
includeTranscript: argv.includeTranscript,
headless: argv.headless,
language: argv.language,
};

// Remove undefined values so defaults/fileConfig can take over.
Object.keys(cliConfig).forEach((key) => {
if (cliConfig[key] === undefined) {
delete cliConfig[key];
}
});

const merged = {
...defaults,
...fileConfig,
...cliConfig,
};

if (!['channel', 'keyword'].includes(merged.mode)) {
throw new Error(`Invalid mode "${merged.mode}". Use "channel" or "keyword".`);
}

if (merged.mode === 'channel' && !merged.channelUrl) {
throw new Error('In "channel" mode you must provide --channelUrl or set it in the input JSON.');
}

if (merged.mode === 'keyword' && !merged.keyword) {
throw new Error('In "keyword" mode you must provide --keyword or set it in the input JSON.');
}

return merged;
}

/**
* Write output JSON either to stdout or to a file.
*/
function writeOutput(data, outputPath) {
const json = JSON.stringify(data, null, 2);

if (outputPath) {
const resolved = path.resolve(outputPath);
fs.writeFileSync(resolved, json, 'utf8');
logger.info(`Scraped data written to ${resolved}`);
} else {
// Print to stdout so it can be piped.
process.stdout.write(json + '\n');
}
}

async function main() {
const argv = yargs(hideBin(process.argv))
.usage('Usage: $0 [options]')
.option('mode', {
alias: 'm',
choices: ['channel', 'keyword'],
describe: 'Scraping mode: "channel" for channel URL, "keyword" for search query',
})
.option('channelUrl', {
alias: 'c',
type: 'string',
describe: 'YouTube channel URL (used in channel mode)',
})
.option('keyword', {
alias: 'k',
type: 'string',
describe: 'Keyword to search on YouTube (used in keyword mode)',
})
.option('maxVideos', {
alias: 'n',
type: 'number',
describe: 'Maximum number of videos to scrape',
})
.option('includeTranscript', {
alias: 't',
type: 'boolean',
describe: 'Whether to include transcript when available',
})
.option('headless', {
alias: 'H',
type: 'boolean',
describe: 'Run browser in headless mode',
})
.option('language', {
alias: 'l',
type: 'string',
describe: 'Transcript language code (e.g. "en")',
})
.option('input', {
alias: 'i',
type: 'string',
describe: 'Path to JSON file with scraper configuration',
})
.option('output', {
alias: 'o',
type: 'string',
describe: 'Path to output JSON file. If omitted, prints to stdout.',
})
.help('h')
.alias('h', 'help').argv;

try {
const config = buildConfig(argv);
logger.info(`Starting YouTube scraping in "${config.mode}" mode...`);

const results = await scrapeYoutube(config);
writeOutput(results, argv.output);

logger.info('Scraping completed successfully.');
process.exit(0);
} catch (err) {
handleError(err, 'Failed to run YouTube Channel Scraper');
process.exit(1);
}
}

if (require.main === module) {
main();
}