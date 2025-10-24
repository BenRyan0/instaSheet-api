require("dotenv").config({ silent: true });

async function normalizeRow(emailRow) {
  return {
    "Column 1": process.env.AGENT_NAME || "instaSheet agent x1",
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
   zip: (!emailRow?.zip || emailRow.zip === "NULL") ? "none" : emailRow.zip,
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

module.exports = {
  normalizeRow,
  normalizeLeadsArray,
};
