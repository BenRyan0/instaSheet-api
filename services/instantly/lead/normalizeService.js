require("dotenv").config({ silent: true });

async function normalizeRow(emailRow) {
  return {
    "Column 1": process.env.AGENT_NAME || "instaSheet agent x1",
    "For scheduling": "",
    "sales person": emailRow["sales person"] || "",
    "sales person email": emailRow["sales person email"] || "",
    company: emailRow["company"] || "N/A",
    "company phone#":
      emailRow["company phone#"] ||
      emailRow["phone 1"] ||
      emailRow["phone2"] ||
      "none",
    "phone#from email": emailRow["phone#from email"] || "none",
    "lead first name": emailRow["lead first name"] || "",
    "lead last name": emailRow["lead last name"] || "",
    "lead email": emailRow["lead email"] || "",
    "Column 2": emailRow["lead email"] || "",
    "email reply": emailRow["email reply"] || "",
    "phone 1": emailRow["phone 1"] || "",
    "#": emailRow["phone 1"] || "",
    phone2: emailRow.phone2 || "",
    address: emailRow.address || "",
    city: emailRow.city || "",
    state: emailRow.state || "",
    zip: emailRow.zip || "",
    details: emailRow.details || "",
    "Email Signature": emailRow["Email Signature"] || "",
    "linkedin link": "none",
    "2nd contact person linked": "none",
    "status after the call": "",
    "number of calls spoken with the leads ": "",
    "@dropdown": "",
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
