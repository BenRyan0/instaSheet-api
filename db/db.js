// db.js
const { Client } = require('pg');
const env = require("../env");

const con = new Client({
  host: env.PG_HOST,
  user: env.PG_USER,
  port: env.PG_PORT,
  password: env.PG_PASSWORD,
  database: env.PG_DB
});

con.connect()
  .then(() => console.log("PostgreSQL connected"))
  .catch(err => console.error("Connection error", err.stack));

// Simulated release (closes connection)
con.release = async () => {
  await con.end();
  console.log("PostgreSQL connection released");
};

module.exports = con;
