const con = require("../db/db");
const bcrypt = require("bcrypt");
require("dotenv").config();
var jwt = require("jsonwebtoken");
const { createToken } = require("../utils/tokenCreate");
const { responseReturn } = require("../utils/response");

class authController {
  login = async (req, res) => {
    const { identifier, password } = req.body;

    try {
      // 1. Find user
      const result = await con.query(
        `SELECT id, username, email, password_hash, role, is_active 
       FROM users 
       WHERE username = $1 OR email = $1
       LIMIT 1`,
        [identifier]
      );

      if (result.rows.length === 0) {
        return res.status(400).json({ error: "Invalid credentials" });
      }

      const user = result.rows[0];

      // 2. Check if account is active
      if (!user.is_active) {
        return res.status(403).json({ error: "Account is disabled" });
      }

      // 3. Compare password
      const isMatch = await bcrypt.compare(password, user.password_hash);
      if (!isMatch) {
        return res.status(400).json({ error: "Invalid credentials" });
      }

      const token = await createToken({
        id: user.id,
        username: user.username,
        role: user.role,
      });

      res.cookie("accessToken", token, {
        expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      console.log("OK")
      responseReturn(res, 200, {
        token,
        message: "Login Success",
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
        },
      });

    } catch (err) {
      console.error("Login error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  };

  signup = async (req, res) => {
    const { username, email, password, first_name, last_name } = req.body;

    try {
      // 1. Check if user already exists
      const existingUser = await con.query(
        "SELECT id FROM users WHERE username = $1 OR email = $2",
        [username, email]
      );

      if (existingUser.rows.length > 0) {
        return res
          .status(400)
          .json({ error: "Username or email already taken" });
      }

      // 2. Hash password
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      // 3. Insert user
      const result = await con.query(
        `INSERT INTO users (username, email, password_hash, first_name, last_name)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, username, email, role, created_at`,
        [username, email, hashedPassword, first_name, last_name]
      );

      const newUser = result.rows[0];

      // 4. Send response (no password returned)
      res.status(201).json({
        message: "User registered successfully",
        user: newUser,
      });
    } catch (err) {
      console.error("Signup error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  };

  logout = async(req, res) =>{
    try {
      res.cookie('accessToken', null, {
        expires: new Date(Date.now()),
        httpOnly: true
      })

      responseReturn(res, 200, {
        message : "Logged out Successfully"
      })
    } catch (error) {
      console.log(error)
      responseReturn(res, 500, {
        error: error.message
      })
      
    }
  }
}

module.exports = new authController();
