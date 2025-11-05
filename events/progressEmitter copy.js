const { getIO,getSocketByClientId } = require("../socket");
const { colorize } = require("../utils/colorLogger");
// const { getSocketByClientId } = require(""); // adjust path
      
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
  totalToBeApproved = 0,
  totalInterestedLLM = 0,
}) {
 // Avoid divide-by-zero
 const percentComplete = (() => {
  const emailRatio = totalEmailsCollected / (maxEmailsCap || 1);
  const pageRatio = pagesFetched / (maxPagesCap || 1);

  // If the loop has naturally ended or caps are reached, force 100%
  if (
    pagesFetched >= maxPagesCap ||
    totalEmailsCollected >= maxEmailsCap ||
    stoppedEarly
  ) {
    return 100;
  }

  // Otherwise compute blended progress
  const blended = Math.min(1, (emailRatio + pageRatio) / 2);
  return Math.round(blended * 100);
})();



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
    totalToBeApproved,
    totalInterestedLLM,
    percentComplete,
    timestamp: Date.now(),
  };
}

const io = getIO();

function emitProgress({ctx,show}) {
const showConsole = show ?? true;
  const state = buildProgressState(ctx);
  // 1) Broadcast internally via EventEmitter
  io.emit("progress", state);
  // 2) (Optional) Log to console for debugging
  if(showConsole) console.log(colorize("[ProgressEmitted]","magenta"))
 
  // console.log("[emitProgress]", state);
}

function onProgress(listener) {
  io.on("progress", listener);
}

module.exports = {
  emitProgress,
  onProgress,
  buildProgressState,
};
