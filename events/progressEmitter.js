const { getIO, getSocketByClientId } = require("../socket");
const { colorize } = require("../utils/colorLogger");

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
  totalEncoded,
  totalToBeApproved,
  totalInterestedLLM,
   runId,
   unProcessedLeads
}) {
  const percentComplete = (() => {
    const emailRatio = totalEmailsCollected / (maxEmailsCap || 1);
    const pageRatio = pagesFetched / (maxPagesCap || 1);

    if (
      pagesFetched >= maxPagesCap ||
      totalEmailsCollected >= maxEmailsCap ||
      stoppedEarly
    ) {
      return 100;
    }

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
    runId,
    unProcessedLeads
  };
}

const io = getIO();

/**
 * Emit progress to a specific client
 * @param {Object} param
 * @param {Object} param.ctx - The current state/context
 * @param {string} [param.clientId] - The clientId to target
 * @param {boolean} [param.show=true] - Whether to show in console
 */
// Emits progress updates to the specific client or broadcasts to all
const EMIT_INTERVAL_MS = 2000; // Throttle interval (2 seconds)
const lastEmits = new Map(); // Track last emit per clientId + runId

function emitProgress({ ctx, clientId, runId = null, show = true }) {
  const state = buildProgressState(ctx);

  // Include runId in the emitted payload
  const payload = {
    ...state,
    runId: runId || ctx?.runId || "unknown",
  };

  // Throttling logic — one emit every 2s per client/run
  const key = `${clientId || "broadcast"}:${payload.runId}`;
  const now = Date.now();
  const lastEmitTime = lastEmits.get(key) || 0;

  if (now - lastEmitTime < EMIT_INTERVAL_MS) {
    // Skip emit if too soon
    return;
  }
  lastEmits.set(key, now);

  if (clientId) {
    const socket = getSocketByClientId(clientId);
    if (socket) {
      socket.emit("progress", payload);
      if (show) {
        console.log(
          colorize(
            `[ProgressEmitted] Client ${clientId}, Run ${payload.runId}: ${state.percentComplete || 0}%`,
            "magenta"
          )
        );
      }
    } else {
      console.log(
        colorize(`[ProgressSkipped] No socket found for clientId ${clientId}`, "yellow")
      );
    }
  } else {
    // fallback: broadcast to all
    io.emit("progress", payload);
    if (show)
      console.log(
        colorize(
          `[ProgressBroadcasted] Run ${payload.runId}: ${state.percentComplete || 0}%`,
          "magenta"
        )
      );
  }
}


function onProgress(listener) {
  io.on("progress", listener);
}

module.exports = {
  emitProgress,
  onProgress,
  buildProgressState,
};
