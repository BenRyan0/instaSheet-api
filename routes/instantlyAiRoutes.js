const router = require("express").Router();
const instantlyAiController = require("../controllers/instantlyAiController");


router.get('/campaign/get-all-campaigns', instantlyAiController.getAllCampaigns)
router.post('/campaign/get-all-campaigns-replies', instantlyAiController.getInterestedRepliesOnly_)
router.post('/agent/start-agent-encoding', instantlyAiController.getInterestedRepliesOnly_)

// Stopping the encoding run
router.post('/agent/stop-current-run', instantlyAiController.stopIncodingRun)









module.exports = router;