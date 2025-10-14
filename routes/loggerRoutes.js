const router = require("express").Router();
const loggerController = require("../controllers/loggerController");
const { encodeLeadFromRequest } = require("../services/leadServices");

router.post("/log/add-new-log", loggerController.addNewLog);
router.get("/log/get-all-logs", loggerController.getAllLogs);
router.get("/tobeencoded-leads", loggerController.getAllTobeEncodedLeads);

router.post("/encode-lead", async (req, res) => {
  const { spreadsheetId, sheetName, lead } = req.body;

  const result = await encodeLeadFromRequest({
    spreadsheetId,
    sheetName,
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
    res.status(409).json({ message: "Duplicate lead email detected." });
  } else if (result.reason === "duplicate-lead+reply") {
    res.status(409).json({ message: "Duplicate lead+reply detected." });
  } else {
    res
      .status(500)
      .json({ message: "Failed to encode lead.", error: result.error });
  }
});

module.exports = router;
