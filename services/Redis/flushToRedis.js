 
 
 async function flushLocalCacheToRedis(redisClient, redisKey, processedSet) {
    if (!redisClient) throw new Error("redisClient is required");
    if (!redisKey) throw new Error("redisKey is required");
    if (!processedSet || !(processedSet instanceof Set))
      throw new Error("processedSet must be a Set");

    const total = processedSet.size;
    if (total === 0) {
      console.log("No local items to flush.");
      return;
    }

  
    let added = 0;

    for (const emailKey of processedSet) {
      try {
        const result = await redisClient.sAdd(redisKey, emailKey);
        if (result === 1) {
        //   console.log(`Added permanently: ${emailKey}`);
          added++;
        } else {
        //   console.log(`Already exists in Redis: ${emailKey}`);
        }
      } catch (err) {
        // console.error(`Failed to add "${emailKey}":`, err.message);
      }
    }

    console.log(
      `\nFlush complete — ${added} new items added (of ${total} total).`
    );
  }

module.exports = {
 flushLocalCacheToRedis
};
