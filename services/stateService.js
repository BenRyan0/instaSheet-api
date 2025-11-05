const crypto = require("crypto");

// services/stateService.js
function initState({
  initialSeenCount = 0,
  maxEmails,
  maxPages,
  aiInterestThreshold,
  runId,
}) {
  return {
    // Quantities we’ll mutate
    pagesFetched: 0,
    processedLeads: 0,
    totalEmailsCollected: 0,
    unProcessedLeads: 0,
    // Collections to report
    rows: [],
    // Mirrors Redis set size; distinct leads we’ve checked
    distinctLeadsChecked: 0,
    // How many leads yielded ≥1 interested reply
    interestedLeadCount: 0,
    // Did we bail early (hit maxEmails or maxPages)?
    stoppedEarly: false,
    // Caps & thresholds
    maxEmails,
    maxEmailsCap: maxEmails,
    maxPages,
    maxPagesCap: maxPages,
    aiInterestThreshold,
    totalEncoded: 0,
    totalInterestedLLM: 0,
    totalToBeApproved: 0,
    runId: runId,

    setRunId(val) {
      this.runId = val;
    },

    addTotalEnterestedLLM(val) {
      this.totalInterestedLLM += val;
    },
    addTotalUnProcessedLeads(val) {
      this.unProcessedLeads += val;
    },

    addTotalFetchedLeads(count) {
      // simpler: increment directly
      this.totalEmailsCollected += count;

      console.log(`Total Emails Collected: ${this.totalEmailsCollected}`);
    },

    // Call this once per page fetched.
    nextPage() {
      this.pagesFetched++;
    },

    // Call this each time you finish fetching replies for one lead.
    nextLead() {
      this.processedLeads++;
      this.distinctLeadsChecked++;
    },

    /**
     * Call this when you successfully add an email row.
     *
     * @param {object} row       Mapped sheet row
     * @param {boolean} hadNewInterest  true if lead wasn’t previously “interested”
     */
    collect(row, hadNewInterest) {
      this.rows.push(row);
      this.totalEmailsCollected++;
      if (hadNewInterest) this.interestedLeadCount++;
    },

    /**
     * Flip this flag when you hit a cap and want to break your loop.
     */
    stop() {
      this.stoppedEarly = true;
    },
  };
}

/**
 * Should we keep looping?
 */
function shouldContinue(state) {
  return (
    !state.stoppedEarly &&
    state.totalEmailsCollected < state.maxEmails &&
    state.pagesFetched < state.maxPages
  );
}

/**
 * Build the payload for your final response.
 */
const activeRunContexts = new Map();

function generateRunId() {
  // Example: run-1730798620123-7f3a1c
  return `run-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
}

/**
 * Create a runtime context for a specific encoding run
 * Tracks progress, error states, and metrics.
 */
function createRunContext({
  runId = null,
  maxEmails = 0,
  maxPages = 0,
  aiInterestThreshold = 1,
}) {
  const finalRunId = runId || generateRunId();

  const ctx = {
    runId: finalRunId,
    unProcessedLeads: 0,
    totalEncoded: 0,
    totalToBeApproved: 0,
    ctxTotalInterestedLLM: 0,
    errorOccurred: false,
    errorContext: "",
    pagesFetched: 0,
    totalEmailsCollected: 0,
    processedLeads: 0,
    distinctLeadsChecked: 0,
    stoppedEarly: false,
    maxEmails,
    maxEmailsCap: maxEmails,
    maxPages,
    maxPagesCap: maxPages,
    aiInterestThreshold,

    addTotalUnProcessedLeads(val) {
      this.unProcessedLeads += val;
    },

    nextLead() {
      this.processedLeads++;
      this.distinctLeadsChecked++;
    },

    addTotalFetchedLeads(count) {
      // simpler: increment directly
      this.totalEmailsCollected += count;

      console.log(`Total Emails Collected: ${this.totalEmailsCollected}`);
    },

    nextPage() {
      this.pagesFetched++;
    },

    addToTotalEncoded(val) {
      this.totalEncoded += val;
    },

    addTotalToBeApproved(val) {
      this.totalToBeApproved += val;
    },

    addTotalEnterestedLLM(val) {
      this.ctxTotalInterestedLLM += val;
    },

    setErrorOccurred(val) {
      this.errorOccurred = val;
    },

    setErrorContext(val) {
      this.errorContext = val;
    },
  };

  activeRunContexts.set(runId, ctx);
  return ctx;
}

/**
 * Retrieve an existing run context by ID
 */
function getRunContext(runId = "default") {
  return activeRunContexts.get(runId);
}

/**
 * Clear a run context when finished
 */
function clearRunContext(runId = "default") {
  activeRunContexts.delete(runId);
}

/**
 * Generate a summarized state snapshot for logging or reporting
 */
function summarizeState(state, runCtx = {}) {
  return {
    total: state?.rows?.length || 0,
    rows: state?.rows || [],
    pagesFetched: state?.pagesFetched || 0,
    processedLeads: state?.processedLeads || 0,
    distinctLeadsChecked: state?.distinctLeadsChecked || 0,
    interestedLeadCount: state?.interestedLeadCount || 0,
    stoppedEarly: state?.stoppedEarly || false,
    maxEmailsCap: state?.maxEmails || 0,
    maxPagesCap: state?.maxPages || 0,
    aiInterestThreshold: state?.aiInterestThreshold || 0,
    totalEncoded: runCtx.totalEncoded || 0,
    totalToBeApproved: runCtx.totalToBeApproved || 0,
    totalEnterestedLLM: runCtx.totalEnterestedLLM || 0,
    errorContext: runCtx.errorContext || "",
  };
}

module.exports = {
  initState,
  shouldContinue,
  summarizeState,
  createRunContext,
  getRunContext,
  clearRunContext,
  activeRunContexts,
};
