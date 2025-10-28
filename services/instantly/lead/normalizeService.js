const { fetchLeadsPage, getNextCursor, fetchLeadsPageWebhook } = require("./fetchService");

const env = require("../../../env");

async function normalizeRow(emailRow) {
  console.log("EMAIL ROW")
  console.log(emailRow)
  return {
    "Column 1": env.AGENT_NAME || "instaSheet agent x1",
    "For scheduling": "",
    "sales person": emailRow["sales person"] || "none",
    "sales person email": emailRow["sales person email"] || "none",
    company: emailRow["company"] || "N/A",
    "company phone#":
      emailRow["company phone#"] ||
      emailRow["phone 1"] ||
      emailRow["phone2"] ||
      "none",
    "phone#from email": emailRow["phone#from email"] || "none",
    "lead first name": emailRow["lead first name"] || "none",
    "lead last name": emailRow["lead last name"] || "none",
    "lead email": emailRow["lead email"] || "none",
    "Column 2": emailRow["lead email"] || "none",
    "email reply": emailRow["email reply"] || "",
    "phone 1": emailRow["phone 1"] || "none",
    "#": emailRow["phone 1"] || "none",
    phone2: emailRow.phone2 || "none",
    address: emailRow.address || "none",
    city: emailRow.city || "none",
    state: emailRow.state || "none",
    zip: !emailRow?.zip || emailRow.zip === "NULL" ? "none" : emailRow.zip,
    details: emailRow.details || "none",
    // details: "none",
    "Email Signature": emailRow["Email Signature"] || "none",
    "Email Signature": "none",
    "linkedin link": "none",
    "status after the call": "none",
  };
}

function normalizeLeadsArray(resp) {
  return (
    resp?.items ||
    resp?.data?.items ||
    resp?.data ||
    resp?.results ||
    resp ||
    []
  );
}

async function fetchAndNormalizeLeads({
  cursor,
  opts,
  authHeaders,
  setErrorOccurred,
  setErrorContext,
}) {
  const page = await fetchLeadsPage({
    cursor,
    pageLimit: opts.pageLimit,
    aiThreshold: opts.aiInterestThreshold,
    authHeaders,
    setErrorOccurred,
    setErrorContext,
  });

  return {
    leads: normalizeLeadsArray(page),
    nextCursor: getNextCursor(page),
  };
}

async function fetchAndNormalizeLeadsWebhook({
  opts,
  authHeaders,
  runContext,
}) {
  try { 
    const page = await fetchLeadsPageWebhook({
      pageLimit: opts.pageLimit,
      authHeaders,
      setErrorOccurred: (val) => (runContext.errorOccurred = val),
      setErrorContext: (ctx) => (runContext.errorContext = ctx),
    });
    return normalizeLeadsArray(page);
  } catch (err) {
    console.error("fetchAndNormalizeLeadsWebhook failed:", err.message);
    runContext.errorOccurred = true;
    runContext.errorContext = err.message;
    return [];
  }
}


module.exports = {
  normalizeRow,
  normalizeLeadsArray,
  fetchAndNormalizeLeads,
  fetchAndNormalizeLeadsWebhook
};
