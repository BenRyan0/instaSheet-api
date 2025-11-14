const router = require("express").Router();
const instantlyAiController = require("../controllers/instantly/instantlyAiController");
const campaignController = require("../controllers/instantly/campaignController");


router.get('/campaign/get-all-campaigns', campaignController.getAllCampaigns)
router.post('/campaign/get-all-campaigns-replies', instantlyAiController.getInterestedRepliesOnly_)
router.post('/agent/start-agent-encoding', instantlyAiController.getInterestedRepliesOnly_)
router.post('/agent/get-lead-details', instantlyAiController.getLeadDetails)

// Stopping the encoding run
router.post('/agent/stop-current-run', instantlyAiController.stopEncodingRun)


module.exports = router;