const router = require("express").Router();
const instantlyAiController = require("../controllers/instantlyAiController");


router.get('/campaign/get-all-campaigns', instantlyAiController.getAllCampaigns)
router.post('/campaign/get-all-campaigns-replies', instantlyAiController.getInterestedRepliesOnly_)
router.post('/agent/start-agent-encoding', instantlyAiController.getInterestedRepliesOnly_)


router.get('/insta-sheet/test', instantlyAiController.testRun)
router.get('/insta-sheet/test-socket', instantlyAiController.simulateSampleProgress)









module.exports = router;