// db.js
const { Client } = require('pg');
require("dotenv").config({ silent: true });

const con = new Client({
  host: "localhost",
  user: process.env.PG_USER,
  port: 5432,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DB
});

con.connect()
  .then(() => console.log("PostgreSQL connected"))
  .catch(err => console.error("Connection error", err.stack));

module.exports = con;
