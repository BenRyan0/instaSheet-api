// services/errorService.js

const { responseReturn } = require('../utils/response')

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message)
    this.statusCode = statusCode
  }
}

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
