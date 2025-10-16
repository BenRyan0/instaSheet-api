const router = require("express").Router();
const loggerController = require("../controllers/loggerController");
const { encodeLeadFromRequest,markToBeApprovedLead } = require("../services/leadServices");

router.post("/log/add-new-log", loggerController.addNewLog);
router.get("/log/get-all-logs", loggerController.getAllLogs);
router.get("/tobeencoded-leads", loggerController.getAllTobeEncodedLeads);


router.post("/lead/deny", markToBeApprovedLead);

router.post("/lead/approve", async (req, res) => {
  const { lead } = req.body;
  console.log("req.body");
  console.log(req.body);

  const result = await encodeLeadFromRequest({
    spreadsheetId : lead.sheet_id,
    sheetName : lead.sheet_name,
    leadData: lead,
    context: {
      extracted: req.body.extracted || {},
      payload: req.body.payload || {},
      salesPerson: req.body.salesPerson,
      salesPersonEmail: req.body.salesPersonEmail,
      firstName: req.body.firstName,
      lastName: req.body.lastName,
      leadEmail: req.body.leadEmail,
      phone1: req.body.phone1,
      phone2: req.body.phone2,
      phoneFromEmail: req.body.phoneFromEmail,
      emailSignature: req.body.emailSignature,
      lead: req.body.lead,
    },
  });
  if (result.success) {
    res.json({ message: "Lead encoded successfully." });
  } else if (result.reason === "duplicate-lead-email") {
    res.status(409).json({ error: "Duplicate lead email detected." });
  } else if (result.reason === "duplicate-lead+reply") {
    res.status(409).json({ error: "Duplicate lead+reply detected." });
  } else {
    res
      .status(500)
      .json({ error: "Failed to encode lead.", error: result.error });
  }
});

module.exports = router;
