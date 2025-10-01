// utils/validators.js
function validateOpts(opts = {}) {
  const {
    pageLimit,
    emailsPerLead,
    concurrency,
    maxEmails,
    maxPages,
    aiInterestThreshold,
  } = opts;

  // Helper to validate positive integer
  function assertPositiveInteger(val, name) {
    if (typeof val !== "number" || !Number.isInteger(val) || val <= 0) {
      throw new Error(`opts.${name} must be a positive integer; got ${val}`);
    }
  }

  // Validate each integer field
  assertPositiveInteger(pageLimit, "pageLimit");
  assertPositiveInteger(emailsPerLead, "emailsPerLead");
  assertPositiveInteger(concurrency, "concurrency");
  assertPositiveInteger(maxEmails, "maxEmails");
  assertPositiveInteger(maxPages, "maxPages");

  // Validate AI threshold: number between 0 and 1 (inclusive)
  if (
    typeof aiInterestThreshold !== "number" ||
    aiInterestThreshold < 0 ||
    aiInterestThreshold > 1
  ) {
    throw new Error(
      `opts.aiInterestThreshold must be a number between 0 and 1; got ${aiInterestThreshold}`
    );
  }

  // All checks passed – return a clean copy
  return {
    pageLimit,
    emailsPerLead,
    concurrency,
    maxEmails,
    maxPages,
    aiInterestThreshold,
  };
}

module.exports = { validateOpts };
