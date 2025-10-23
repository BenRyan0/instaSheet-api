// utils/filters.js
function isInterestedReply(email, aiThreshold) {
  if (!email) return false;
  if (email.i_status === 1) return true;
  if (email.ai_interest_value >= aiThreshold) return true;
  return email.email_type === "received" || email.ue_type === 2;
}

module.exports = { isInterestedReply };
