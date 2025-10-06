const router = require("express").Router();
// const instantlyAiController = require("../controllers/instantlyAiController");
const authController =  require("../controllers/authController");


router.post('/auth/login', authController.login)
router.post('/auth/signup', authController.signup)
router.get('/auth/signout', authController.logout)
// router.post('/campaign/get-all-campaigns-replies', instantlyAiController.getInterestedRepliesOnly_)
// router.post('/agent/start-agent-encoding', instantlyAiController.getInterestedRepliesOnly_)









module.exports = router;