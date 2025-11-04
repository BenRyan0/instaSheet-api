const router = require("express").Router();
const spreadSheetsController = require("../controllers/spreadSheetsController")



router.get('/sheets/:spreadsheetId', spreadSheetsController.getAllSheets)
router.post('/sheets/:spreadsheetId/addSheet', spreadSheetsController.AddNewSheetAndColumns)
router.post('/sheets/append-row', spreadSheetsController.AppendRow)






module.exports = router;