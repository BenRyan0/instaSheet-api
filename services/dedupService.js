// services/dedupService.js

const { colorize } = require("../utils/colorLogger")

function normalizeKey(email) {
  if (!email || typeof email !== 'string') return null
  return email.toLowerCase().trim()
}
async function isProcessed(emailKey, redisClient, redisKey) {
  if (!emailKey) return false
  return await redisClient.sIsMember(redisKey, emailKey)
}
async function markProcessed(emailKey, redisClient, redisKey, processedSet) {
  if (!emailKey) return false

  // Already in our local cache?
  if (processedSet.has(emailKey)) {
    console.log(colorize("[dedup]", "bgLightBlue"),`skipping, already in-memory: ${emailKey}`);
    return false
  }

  // Add to Redis; sAdd returns 1 if added, 0 if it was already there
  const added = await redisClient.sAdd(redisKey, emailKey)

  if (added === 1) {
    console.log(colorize("[dedup]", "bgLightBlue"),`newly added to Redis: ${emailKey}`);
    processedSet.add(emailKey)
    return true
  } else {
     console.log(colorize("[dedup]", "bgLightBlue"),` already in Redis: ${emailKey}`);
    // Keep in local set so subsequent checks skip it too
    processedSet.add(emailKey)
    return false
  }
}
function filterNewLeads(leads, processed) {
  return leads.filter(lead => {
    const key = lead.email?.toLowerCase().trim();
    if (!key) return true;
    if (processed.has(key)) {
      console.log(colorize("[dedup]", "bgLightBlue"), `already processed for email=${key}`);
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
