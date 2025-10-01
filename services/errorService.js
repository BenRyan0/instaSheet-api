// services/errorService.js

const { responseReturn } = require('../utils/response')

/**
 * Custom error type carrying an HTTP status code.
 */
class HttpError extends Error {
  /**
   * @param {number} statusCode  HTTP status code (e.g. 400, 404, 500)
   * @param {string} message     Error message to send in response
   */
  constructor(statusCode, message) {
    super(message)
    this.statusCode = statusCode
  }
}

/**
 * Logs the error and sends a standardized JSON response.
 *
 * @param {Error} err     Thrown error (or HttpError)
 * @param {object} res    Express response object
 * @returns {object}      The return value of responseReturn
 */
function handleError(err, res) {
  // Determine status
  const status =
    err instanceof HttpError && Number.isInteger(err.statusCode)
      ? err.statusCode
      : 500

  // Build payload
  const payload = {
    error: err.message || 'Internal server error',
  }

  // Include stack trace in non-production for debugging
  if (process.env.NODE_ENV !== 'production') {
    payload.detail = err.stack
  }

  // Log full error server-side
  console.error('[handleError]', {
    message: err.message,
    status,
    stack: err.stack,
  })

  // Send structured response
  return responseReturn(res, status, payload)
}

module.exports = {
  HttpError,
  handleError,
}
