const jwt = require("jsonwebtoken")
const env = require("../env");

module.exports.createToken = async (data) => {
    const token = await jwt.sign(data, env.JWT_SECRET,{
        expiresIn: "1d"
    });

    return token;
}