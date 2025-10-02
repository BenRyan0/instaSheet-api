const router = require('express').Router();
const loggerController = require("../controllers/loggerController")


router.post('/log/add-new-log', loggerController.addNewLog)
router.get('/log/get-all-logs', loggerController.getAllLogs)

module.exports = router;