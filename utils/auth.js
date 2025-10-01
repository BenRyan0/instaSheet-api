function getAuthHeaders(apiKey) {
  if (!apiKey || typeof apiKey !== 'string') {
    throw new Error('apiKey is required and must be a non-empty string');
  }

  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

module.exports = { getAuthHeaders };
