// db.js
const { Client } = require('pg');

const con = new Client({
  host: "localhost",
  user: "postgres",
  port: 5432,
  password: "root",
  database: "insta-sheet-db"
});

con.connect()
  .then(() => console.log("PostgreSQL connected"))
  .catch(err => console.error("Connection error", err.stack));

module.exports = con;
