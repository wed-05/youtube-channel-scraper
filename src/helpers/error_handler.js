onst winston = require('winston');

const logger = winston.createLogger({
level: process.env.LOG_LEVEL || 'info',
format: winston.format.combine(
winston.format.timestamp(),
winston.format.printf((info) => {
const { timestamp, level, message, ...rest } = info;
const restStr = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : '';
return `${timestamp} [${level.toUpperCase()}] ${message}${restStr}`;
})
),
transports: [new winston.transports.Console()],
});

class ScraperError extends Error {
constructor(message, code = 'SCRAPER_ERROR', meta = {}) {
super(message);
this.name = 'ScraperError';
this.code = code;
this.meta = meta;

if (Error.captureStackTrace) {
Error.captureStackTrace(this, ScraperError);
}
}
}

/**
* Generic error handler – logs gracefully without crashing the process by itself.
*/
function handleError(error, contextMessage = 'Unhandled error') {
if (error instanceof ScraperError) {
logger.error(`${contextMessage}: ${error.code} - ${error.message}`, {
meta: error.meta,
stack: error.stack,
});
} else {
logger.error(`${contextMessage}: ${error.message}`, {
stack: error.stack,
});
}
}

module.exports = {
logger,
ScraperError,
handleError,
};