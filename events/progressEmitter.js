const { getIO } = require("../socket");
      
function buildProgressState({
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
  totalEncoded = 0,
  totalInterestedLLM = 0,
}) {
  const percentComplete = Math.min(
    100,
    Math.round((totalEmailsCollected / maxEmailsCap) * 100)
  );

  return {
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
    percentComplete,
    timestamp: Date.now(),
  };
}

const io = getIO();

function emitProgress(ctx) {
  const state = buildProgressState(ctx);
  // 1) Broadcast internally via EventEmitter
  io.emit("progress", state);
  // 2) (Optional) Log to console for debugging
  console.log("[emitProgress]", state);
}

function onProgress(listener) {
  io.on("progress", listener);
}

module.exports = {
  emitProgress,
  onProgress,
  buildProgressState,
};
