onst url = require('url');
const fetch = require('node-fetch');
const { parseStringPromise } = require('xml2js');

const { createBrowser, createPage, autoScroll, waitForNetworkIdle } = require('./puppeteer_utils');
const { logger, ScraperError } = require('../helpers/error_handler');
const { formatVideoObject } = require('../helpers/data_formatter');
const defaults = require('../config/defaults.json');

/**
* Extract YouTube video ID from a watch or shorts URL.
*/
function extractVideoId(videoUrl) {
try {
const parsed = new url.URL(videoUrl);
if (parsed.searchParams.has('v')) {
return parsed.searchParams.get('v');
}

const segments = parsed.pathname.split('/').filter(Boolean);
// /shorts/VIDEOID or /embed/VIDEOID
if (segments.length >= 2 && (segments[0] === 'shorts' || segments[0] === 'embed')) {
return segments[1];
}

// /watch/VIDEOID style – uncommon but safe fallback
if (segments.length >= 1) {
return segments[segments.length - 1];
}
} catch (err) {
logger.warn(`Failed to parse video ID from URL "${videoUrl}": ${err.message}`);
}

return null;
}

/**
* Fetch transcript using the public timedtext endpoint.
* This is best-effort; failures are logged and result in null.
*/
async function fetchTranscript(videoId, language = 'en') {
if (!videoId) return null;

const apiUrl = `https://www.youtube.com/api/timedtext?lang=${encodeURIComponent(
language
)}&v=${encodeURIComponent(videoId)}`;

try {
const res = await fetch(apiUrl, { timeout: 15000 });
if (!res.ok) {
logger.warn(`Transcript not available for video ${videoId} (status ${res.status})`);
return null;
}

const xml = await res.text();
const parsed = await parseStringPromise(xml, { explicitArray: false, trim: true });

if (!parsed || !parsed.transcript || !parsed.transcript.text) {
return null;
}

const texts = Array.isArray(parsed.transcript.text)
? parsed.transcript.text
: [parsed.transcript.text];

return texts
.map((t) => (typeof t === 'string' ? t : t._ || ''))
.filter(Boolean)
.join(' ')
.replace(/\s+/g, ' ')
.trim();
} catch (err) {
logger.warn(`Failed to fetch transcript for video ${videoId}: ${err.message}`);
return null;
}
}

/**
* Scrape video metadata from the watch page.
*/
async function scrapeVideoFromPage(browser, videoUrl, options, sharedChannelMeta) {
const page = await createPage(browser);

try {
logger.info(`Scraping video: ${videoUrl}`);
await page.goto(videoUrl, {
waitUntil: 'networkidle2',
timeout: 60000,
});

await waitForNetworkIdle(page, 8000);
await page.waitForTimeout(2000);

const videoData = await page.evaluate(() => {
const safeText = (selector) => {
const el = document.querySelector(selector);
return el ? el.textContent.trim() : null;
};

const safeAttr = (selector, attr) => {
const el = document.querySelector(selector);
return el ? el.getAttribute(attr) || null : null;
};

const title =
safeText('h1.ytd-watch-metadata') ||
safeText('h1.title') ||
document.title ||
null;

const author =
safeText('#channel-name a') ||
safeText('#channel-name') ||
safeText('ytd-channel-name') ||
null;

const description =
safeText('#description') ||
safeText('#description-inner') ||
safeText('#meta-contents #description') ||
null;

const viewCountText =
safeText('span.view-count') ||
safeText('ytd-watch-metadata #info span') ||
null;

const likeButton =
document.querySelector('ytd-toggle-button-renderer[is-icon-button] #text') ||
document.querySelector('#segmented-like-button button #text') ||
null;
const likeCountText = likeButton ? likeButton.textContent.trim() : null;

const commentCountText =
safeText('#count .count-text') ||
safeText('#count #count') ||
null;

let publishedAt =
safeText('#info-strings yt-formatted-string') ||
safeText('meta[itemprop="uploadDate"]') ||
null;

const publishedMeta =
document.querySelector('meta[itemprop="uploadDate"]') ||
document.querySelector('meta[itemprop="datePublished"]');

if (publishedMeta) {
const content = publishedMeta.getAttribute('content');
if (content) {
publishedAt = content;
}
}

const subscriberCountText =
safeText('#owner-sub-count') ||
safeText('yt-formatted-string.ytd-subscribe-button-renderer') ||
null;

const profilePicture =
safeAttr('#avatar img', 'src') ||
safeAttr('#avatar-link img', 'src') ||
null;

return {
title,
description,
author,
viewCountText,
likeCountText,
commentCountText,
publishedAt,
subscriberCountText,
profilePicture,
};
});

const videoId = extractVideoId(videoUrl);
const coverImage = videoId
? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
: null;

let transcript = null;
if (options.includeTranscript) {
transcript = await fetchTranscript(videoId, options.language || 'en');
}

const channelInfo = sharedChannelMeta || null;

const raw = {
id: videoId,
videoUrl,
coverImage,
transcript,
amountOfVideos: null, // Will be filled by caller if known.
channelInfo,
...videoData,
subscriberCountText:
(channelInfo && channelInfo.subscriberCountText) || videoData.subscriberCountText,
};

return raw;
} finally {
await page.close();
}
}

/**
* Scrape channel-level information from the "About" tab.
*/
async function scrapeChannelInfo(browser, channelUrl) {
const page = await createPage(browser);

try {
const aboutUrl = channelUrl.replace(/\/+$/, '') + '/about';
logger.info(`Scraping channel info: ${aboutUrl}`);

await page.goto(aboutUrl, {
waitUntil: 'networkidle2',
timeout: 60000,
});

await waitForNetworkIdle(page, 8000);
await page.waitForTimeout(2000);

const meta = await page.evaluate(() => {
const safeText = (selector) => {
const el = document.querySelector(selector);
return el ? el.textContent.trim() : null;
};

const description =
safeText('#description-container') ||
safeText('#description') ||
null;

const stats = Array.from(
document.querySelectorAll('#right-column yt-formatted-string, #stats-container yt-formatted-string')
).map((el) => el.textContent.trim());

let activeFrom = null;
let viewCounter = null;
let country = null;

stats.forEach((s) => {
if (/Joined/i.test(s)) {
activeFrom = s.replace(/Joined\s*/i, '').trim();
} else if (/views/i.test(s)) {
viewCounter = s;
} else if (!country && /^[A-Za-z\s]+$/.test(s) && s.length < 40) {
country = s;
}
});

const linksNodes = Array.from(
document.querySelectorAll(
'#link-list-container a.yt-simple-endpoint, #channel-links-container a.yt-simple-endpoint'
)
);
const links = {};

linksNodes.forEach((anchor) => {
const label = anchor.textContent.trim() || 'Link';
const href = anchor.href;
if (!links[label]) {
links[label] = href;
}
});

const subscriberCountText =
safeText('#subscriber-count') ||
safeText('#owner-sub-count') ||
null;

return {
activeFrom,
viewCounter,
channelDescription: description,
country,
links,
subscriberCountText,
};
});

return meta;
} catch (err) {
logger.warn(`Failed to scrape channel info: ${err.message}`);
return null;
} finally {
await page.close();
}
}

/**
* Scrape list of video links from a channel's /videos page.
*/
async function getChannelVideoLinks(page, channelUrl, maxVideos) {
const videosUrl = channelUrl.replace(/\/+$/, '') + '/videos';
logger.info(`Loading channel videos page: ${videosUrl}`);

await page.goto(videosUrl, {
waitUntil: 'networkidle2',
timeout: 60000,
});

await waitForNetworkIdle(page, 8000);
await autoScroll(page, 15);

const links = await page.$$eval(
'a#video-title-link, a#video-title',
(anchors) =>
anchors
.map((a) => ({
url: a.href,
title: a.textContent.trim(),
}))
.filter((v) => v.url && v.url.includes('watch'))
);

const uniqueUrls = [];
const seen = new Set();

for (const item of links) {
if (!seen.has(item.url)) {
seen.add(item.url);
uniqueUrls.push(item);
}

if (uniqueUrls.length >= maxVideos) break;
}

return uniqueUrls;
}

/**
* Scrape video links from YouTube search results by keyword.
*/
async function getSearchVideoLinks(page, keyword, maxVideos) {
const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(
keyword
)}`;
logger.info(`Loading search results page: ${searchUrl}`);

await page.goto(searchUrl, {
waitUntil: 'networkidle2',
timeout: 60000,
});

await waitForNetworkIdle(page, 8000);
await autoScroll(page, 15);

const links = await page.$$eval(
'ytd-video-renderer a#video-title',
(anchors) =>
anchors
.map((a) => ({
url: a.href,
title: a.textContent.trim(),
}))
.filter((v) => v.url && v.url.includes('watch'))
);

const uniqueUrls = [];
const seen = new Set();

for (const item of links) {
if (!seen.has(item.url)) {
seen.add(item.url);
uniqueUrls.push(item);
}

if (uniqueUrls.length >= maxVideos) break;
}

return uniqueUrls;
}

/**
* Scrape videos starting from a channel URL.
*/
async function scrapeByChannel(config) {
const browser = await createBrowser({ headless: config.headless });
const page = await createPage(browser);

try {
const maxVideos = config.maxVideos || defaults.maxVideos || 10;

const [links, channelInfo] = await Promise.all([
getChannelVideoLinks(page, config.channelUrl, maxVideos),
scrapeChannelInfo(browser, config.channelUrl),
]);

logger.info(`Found ${links.length} video links for channel.`);

const results = [];
for (const link of links) {
/* eslint-disable no-await-in-loop */
const raw = await scrapeVideoFromPage(browser, link.url, config, channelInfo);
raw.amountOfVideos = links.length;
const formatted = formatVideoObject(raw);
results.push(formatted);
}

return results;
} finally {
await page.close();
await browser.close();
}
}

/**
* Scrape videos using keyword search.
*/
async function scrapeByKeyword(config) {
const browser = await createBrowser({ headless: config.headless });
const page = await createPage(browser);

try {
const maxVideos = config.maxVideos || defaults.maxVideos || 10;
const links = await getSearchVideoLinks(page, config.keyword, maxVideos);

logger.info(`Found ${links.length} video links for keyword search.`);

const results = [];
for (const link of links) {
/* eslint-disable no-await-in-loop */
const raw = await scrapeVideoFromPage(browser, link.url, config, null);
raw.amountOfVideos = links.length;
const formatted = formatVideoObject(raw);
results.push(formatted);
}

return results;
} finally {
await page.close();
await browser.close();
}
}

/**
* Public entry point – merges defaults with given config and runs the appropriate mode.
*/
async function scrapeYoutube(userConfig = {}) {
const config = {
...defaults,
...userConfig,
};

if (!['channel', 'keyword'].includes(config.mode)) {
throw new ScraperError(
`Invalid scrape mode "${config.mode}". Use "channel" or "keyword".`,
'INVALID_MODE'
);
}

if (config.mode === 'channel' && !config.channelUrl) {
throw new ScraperError(
'channelUrl must be provided when mode is "channel".',
'MISSING_CHANNEL_URL'
);
}

if (config.mode === 'keyword' && !config.keyword) {
throw new ScraperError(
'keyword must be provided when mode is "keyword".',
'MISSING_KEYWORD'
);
}

if (!config.maxVideos || config.maxVideos <= 0) {
config.maxVideos = defaults.maxVideos || 10;
}

if (config.maxVideos > 100) {
logger.warn(
`Requested maxVideos=${config.maxVideos} – this may be slow. Capping at 100 for safety.`
);
config.maxVideos = 100;
}

logger.info(
`Starting scrape in "${config.mode}" mode with maxVideos=${config.maxVideos}, includeTranscript=${config.includeTranscript}`
);

if (config.mode === 'channel') {
return scrapeByChannel(config);
}

return scrapeByKeyword(config);
}

module.exports = {
scrapeYoutube,
};