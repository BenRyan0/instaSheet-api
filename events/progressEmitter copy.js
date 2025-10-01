// src/events/progressEmitter.js
const { getIO } = require("../socket"); // or wherever you init Socket.IO

/**
 * Emit a standardized "progress" event over Socket.IO.
 *
 * @param {Object} stats
 * @param {number} stats.pagesFetched
 * @param {number} stats.processedLeads
 * @param {number} stats.totalEmailsCollected
 * @param {number} stats.rowsSoFar
 * @param {number} stats.distinctLeadsChecked
 * @param {number} stats.interestedLeadCount
 * @param {boolean} stats.stoppedEarly
 * @param {number} stats.maxEmailsCap
 * @param {number} stats.maxPagesCap
 * @param {number} stats.aiInterestThreshold
 * @param {number} stats.totalEncoded
 * @param {number} stats.totalInterestedLLM
 */
function emitProgress({
  pagesFetched,
  processedLeads,
  totalEmailsCollected,
  rowsSoFar,
  distinctLeadsChecked,
  interestedLeadCount,
  stoppedEarly,
  maxEmailsCap,
  maxPagesCap,
  aiInterestThreshold,
  totalEncoded,
  totalInterestedLLM,
}) {
  const io = getIO();
  if (!io) return;

  const now = new Date();
  const date =
    now.getHours().toString().padStart(2, "0") +
    ":" +
    now.getMinutes().toString().padStart(2, "0") +
    ":" +
    now.getSeconds().toString().padStart(2, "0");

  const percentComplete = Math.min(
    100,
    Math.round((totalEmailsCollected / maxEmailsCap) * 100)
  );

  io.emit("progress", {
    pagesFetched,
    processedLeads,
    totalEmailsCollected,
    rowsSoFar,
    distinctLeadsChecked,
    interestedLeadCount,
    stoppedEarly,
    maxEmailsCap,
    maxPagesCap,
    aiInterestThreshold,
    percentComplete,
    date,
    totalEncoded,
    isInterestedLLM: totalInterestedLLM,
  });
}

module.exports = { emitProgress };
