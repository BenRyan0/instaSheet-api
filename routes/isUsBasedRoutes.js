const router = require("express").Router();
const isUsBasedController = require("../controllers/isUsBasedController");


router.post('/is-us-based', isUsBasedController.checkIfUSBased)







module.exports = router;