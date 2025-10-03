// utils/filters.js

/**
 * Determines whether an email counts as an “interested” reply.
 *
 * Logic:
 * 1. Manually marked interested (i_status === 1)
 * 2. AI interest score ≥ provided threshold
 * 3. Fallback: any received email or ue_type === 2
 *
 * @param {object}  email         Raw email object from API
 * @param {number}  aiThreshold   AI interest cutoff (0–1)
 * @returns {boolean}             True if email qualifies as “interested”
 */
function isInterestedReply(email, aiThreshold) {
  console.log("isInterestedReply");
  console.log(email);
  console.log(aiThreshold);
  console.log("isInterestedReply");
  if (!email) return false;
  if (email.i_status === 1) return true;
  if (email.ai_interest_value >= aiThreshold) return true;
  return email.email_type === "received" || email.ue_type === 2;
}

module.exports = { isInterestedReply };
