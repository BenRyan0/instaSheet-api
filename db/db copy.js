// db.js
const { Client } = require('pg');
const postgres = require('postgres');
const env = require('../env');

const isSupabase = env.DB_MODE === 'supabase';

let con;

if (isSupabase) {
  // --- Using Postgres.js for Supabase connection ---
  const connectionString = env.SUPABASE_URL || process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('Missing SUPABASE_URL or DATABASE_URL for Supabase connection.');
  }

  const useSSL = env.SUPABASE_SSL === 'true';

  const sql = postgres(connectionString, {
    ssl: useSSL ? { rejectUnauthorized: false } : false,
  });

  console.log('Connected to Supabase PostgreSQL via postgres.js');

  con = {
    query: async (text, params) => {
      // Use safe query execution with postgres.js
      // NOTE: postgres.js does not use $1, $2 syntax — we replace it for compatibility.
      const formatted = text.replace(/\$(\d+)/g, (_, i) => `$${i}`);
      const result = await sql.unsafe(formatted, params);
      return { rows: result };
    },
    release: async () => {
      await sql.end({ timeout: 5 });
      console.log('Supabase PostgreSQL connection released');
    },
    _clientType: 'postgres.js',
  };

} else {
  // --- Using pg.Client for local PostgreSQL connection ---
  const connectionConfig = {
    host: env.PG_HOST,
    user: env.PG_USER,
    port: env.PG_PORT || 5432,
    password: env.PG_PASSWORD,
    database: env.PG_DB,
     family: 4 // 👈 forces IPv4
  };

  const client = new Client(connectionConfig);

  client.connect()
    .then(() => console.log('Connected to Local PostgreSQL via pg.Client'))
    .catch(err => console.error('Connection error', err.stack));

  client.release = async () => {
    await client.end();
    console.log('Local PostgreSQL connection released');
  };

  client._clientType = 'pg';
  con = client;
}



module.exports = con;
