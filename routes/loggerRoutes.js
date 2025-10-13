const router = require('express').Router();
const loggerController = require("../controllers/loggerController")


router.post('/log/add-new-log', loggerController.addNewLog)
router.get('/log/get-all-logs', loggerController.getAllLogs)
router.get('/tobeencoded-leads', loggerController.getAllLogs)

module.exports = router;