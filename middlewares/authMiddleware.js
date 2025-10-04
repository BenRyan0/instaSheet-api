const jwt = require("jsonwebtoken");
require('dotenv').config()

module.exports.authMiddleware = (req, res, next) => {
  const { authorization } = req.headers;
  
  if(!authorization || !authorization.startsWith('Bearer ')){
    return res.status(401).json({error:  "Authorization header is missing or invalid"})

  }

  const token = authorization.split(' ')[1]

  if(!token){
    return res.status(401).json({error :"Please Login First"})

  }


  try {
    const decodedToken= jwt.verify(token, process.env.SECRET)
    req.role = decodedToken.role;
    req.id= decodedToken.id;
    next();
  } catch (error) {
    return res.status(401).json({error : "Invalid Token. Please Login"})
  }
};
