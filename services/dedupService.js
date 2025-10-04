// services/dedupService.js

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
  console.log("filterNewLeads")
  console.log(leads)
  console.log("PROCESSED")
  console.log(processed)
  console.log("filterNewLeads")
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
