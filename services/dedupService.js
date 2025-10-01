// services/dedupService.js

/**
 * Normalize an email into a canonical key.
 *
 * @param {string} email
 * @returns {string|null}
 */
function normalizeKey(email) {
  if (!email || typeof email !== 'string') return null
  return email.toLowerCase().trim()
}

/**
 * Check if a normalized email key is already in Redis.
 *
 * @param {string} emailKey
 * @param {object} redisClient
 * @param {string} redisKey
 * @returns {Promise<boolean>}
 */
async function isProcessed(emailKey, redisClient, redisKey) {
  if (!emailKey) return false
  return await redisClient.sIsMember(redisKey, emailKey)
}

/**
 * Mark an email key as processed:
 *  - Adds to Redis set
 *  - Adds to in-memory Set
 *  - Logs whether it was new or duplicate
 *
 * @param {string} emailKey           Canonical email key
 * @param {object} redisClient        Redis client instance
 * @param {string} redisKey           Redis set key
 * @param {Set<string>} processedSet  In-memory Set of seen keys
 * @returns {Promise<boolean>}        True if newly added, false if already existed
 */
async function markProcessed(emailKey, redisClient, redisKey, processedSet) {
  console.log(emailKey)
  console.log("emailKey")
  if (!emailKey) return false

  // Already in our local cache?
  if (processedSet.has(emailKey)) {
    console.log(`[dedup] skipping, already in-memory: ${emailKey}`)
    return false
  }

  // Add to Redis; sAdd returns 1 if added, 0 if it was already there
  const added = await redisClient.sAdd(redisKey, emailKey)

  if (added === 1) {
    console.log(`[dedup] newly added to Redis: ${emailKey}`)
    processedSet.add(emailKey)
    return true
  } else {
    console.log(`[dedup] already in Redis: ${emailKey}`)
    // Keep in local set so subsequent checks skip it too
    processedSet.add(emailKey)
    return false
  }
}

function filterNewLeads(leads, processed) {
  return leads.filter(lead => {
    if (!lead.id) return false;
    // only skip if you’ve fetched replies for this lead before
    if (processed.has(lead.id)) {
      console.log(`[skip] already fetched replies for leadId=${lead.id}`);
      return false;
    }
    return true;
  });
}


module.exports = {
  normalizeKey,
  isProcessed,
  markProcessed,
  filterNewLeads
}
