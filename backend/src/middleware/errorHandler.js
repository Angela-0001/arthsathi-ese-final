/**
 * ArthSathi — Global Express error handler
 *
 * Catches any error thrown or passed via next(err) in route handlers.
 * Returns structured JSON so the frontend can handle errors consistently.
 */

const errorHandler = (err, req, res, next) => {  // eslint-disable-line no-unused-vars
  const status = err.status || err.statusCode || 500;
  const message = process.env.NODE_ENV === 'production'
    ? (status < 500 ? err.message : 'Internal server error')
    : err.message;

  // Log 500-level errors for debugging
  if (status >= 500) {
    console.error('[ERROR]', err.stack || err.message);
  }

  res.status(status).json({
    success: false,
    error: {
      code:    err.code    || 'INTERNAL_ERROR',
      message: message,
    },
  });
};

module.exports = errorHandler;
