// services/stateService.js

/**
 * Initialize your crawling state.
 *
 * @param {object} params
 * @param {number} params.initialSeenCount      Size of your Redis “seen” set
 * @param {number} params.maxEmails             Cap on total emails to collect
 * @param {number} params.maxPages              Cap on total pages to fetch
 * @param {number} params.aiInterestThreshold   AI cutoff for interest
 */
function initState({
  initialSeenCount = 0,
  maxEmails,
  maxPages,
  aiInterestThreshold,

}) {

  console.log(maxPages)
  console.log(maxEmails)
  console.log("Datas")
  return {
    // Quantities we’ll mutate
    pagesFetched: 0,
    processedLeads: 0,
    totalEmailsCollected: 0,
    // Collections to report
    rows: [],
    // Mirrors Redis set size; distinct leads we’ve checked
    distinctLeadsChecked: initialSeenCount,
    // How many leads yielded ≥1 interested reply
    interestedLeadCount: 0,
    // Did we bail early (hit maxEmails or maxPages)?
    stoppedEarly: false,
    // Caps & thresholds
    maxEmails,
    maxEmailsCap : maxEmails,
    maxPages,
    maxPagesCap: maxPages,
    aiInterestThreshold,

    /**
     * Call this once per page fetched.
     */
    nextPage() {
      this.pagesFetched++
    },

    /**
     * Call this each time you finish fetching replies for one lead.
     */
    nextLead() {
      this.processedLeads++
      this.distinctLeadsChecked++
    },

    /**
     * Call this when you successfully add an email row.
     *
     * @param {object} row       Mapped sheet row
     * @param {boolean} hadNewInterest  true if lead wasn’t previously “interested”
     */
    collect(row, hadNewInterest) {
      this.rows.push(row)
      this.totalEmailsCollected++
      if (hadNewInterest) this.interestedLeadCount++
    },

    /**
     * Flip this flag when you hit a cap and want to break your loop.
     */
    stop() {
      this.stoppedEarly = true
    },
  }
}

/**
 * Should we keep looping?
 */
function shouldContinue(state) {
  return (
    !state.stoppedEarly &&
    state.totalEmailsCollected < state.maxEmails &&
    state.pagesFetched < state.maxPages
  )
}

/**
 * Build the payload for your final response.
 */
function summarizeState(state) {
  return {
    total: state.rows.length,
    rows: state.rows,
    pagesFetched: state.pagesFetched,
    processedLeads: state.processedLeads,
    distinctLeadsChecked: state.distinctLeadsChecked,
    interestedLeadCount: state.interestedLeadCount,
    stoppedEarly: state.stoppedEarly,
    maxEmailsCap: state.maxEmails,
    maxPagesCap: state.maxPages,
    aiInterestThreshold: state.aiInterestThreshold,
  }
}

module.exports = {
  initState,
  shouldContinue,
  summarizeState,
}
