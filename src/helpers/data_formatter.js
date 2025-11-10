onst { logger } = require('./error_handler');

/**
 * Parse a human-readable number string used on YouTube like:
 * "27.2M subscribers", "7,569,331,655 views", "424", "1.4K" etc.
 * Returns a JavaScript number or null if it cannot be parsed.
 */
function parseHumanNumber(input) {
  if (input == null) return null;

  const str = String(input).trim();
  if (!str) return null;

  // Remove words like "views", "subscribers" etc.
  const cleaned = str
    .replace(/views?/gi, '')
    .replace(/subscribers?/gi, '')
    .replace(/[^\d.,KMGBkmb]/g, '')
    .replace(/,/g, '')
    .trim();

  if (!cleaned) return null;

  const match = cleaned.match(/^([\d.]+)\s*([KMB])?$/i);
  if (!match) {
    const asInt = parseInt(cleaned, 10);
    return Number.isNaN(asInt) ? null : asInt;
  }

  let value = parseFloat(match[1]);
  const unit = match[2] ? match[2].toUpperCase() : null;

  if (unit === 'K') value *= 1e3;
  if (unit === 'M') value *= 1e6;
  if (unit === 'B') value *= 1e9;

  return Math.round(value);
}

/**
 * Normalize a possibly empty string value.
 */
function normalizeString(value) {
  if (value == null) return null;
  const str = String(value).trim();
  return str || null;
}

/**
 * Convert raw scraped data into the public JSON format.
 */
function formatVideoObject(raw) {
  if (!raw || !raw.videoUrl) {
    throw new Error('Invalid raw video data – "videoUrl" is required.');
  }

  const video = {
    title: normalizeString(raw.title),
    author: normalizeString(raw.author),
    videoUrl: normalizeString(raw.videoUrl),
    coverImage: normalizeString(raw.coverImage),
    subscriberCount:
      raw.subscriberCount != null
        ? raw.subscriberCount
        : parseHumanNumber(raw.subscriberCountText),
    likeCount:
      raw.likeCount != null
        ? raw.likeCount
        : parseHumanNumber(raw.likeCountText),
    description: normalizeString(raw.description),
    viewCount:
      raw.viewCount != null
        ? raw.viewCount
        : parseHumanNumber(raw.viewCountText),
    commentCount:
      raw.commentCount != null
        ? raw.commentCount
        : parseHumanNumber(raw.commentCountText),
    publishedAt: normalizeString(raw.publishedAt),
    id: normalizeString(raw.id),
    amountOfVideos:
      typeof raw.amountOfVideos === 'number' ? raw.amountOfVideos : null,
    profilePicture: normalizeString(raw.profilePicture) || null,
    transcript: normalizeString(raw.transcript) || null,
    channelInfo: null,
  };

  if (raw.channelInfo) {
    const info = raw.channelInfo;

    const channelInfo = {
      activeFrom: normalizeString(info.activeFrom),
      viewCounter: normalizeString(info.viewCounter),
      channelDescription: normalizeString(info.channelDescription),
      country: normalizeString(info.country),
      links: {},
    };

    if (info.links && typeof info.links === 'object') {
      Object.entries(info.links).forEach(([label, href]) => {
        if (!href) return;
        channelInfo.links[label] = String(href);
      });
    }

    video.channelInfo = channelInfo;
  }

  logger.debug
    ? logger.debug(`Formatted video: ${video.title || video.videoUrl}`)
    : null;

  return video;
}

module.exports = {
  parseHumanNumber,
  formatVideoObject,
};