// db.js
const { Client } = require('pg');
const postgres = require('postgres');
const env = require('../env');
const dns = require('dns').promises;

const isSupabase = env.DB_MODE === 'supabase';
let con;

if (isSupabase) {
  // --- Using Postgres.js with Supabase Transaction Pooler ---
  const connectionString =
    env.SUPABASE_URL ||
    process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('Missing SUPABASE_URL or DATABASE_URL for Supabase connection.');
  }

  const useSSL = env.SUPABASE_SSL === 'true';

  (async () => {
    try {
      // Force IPv4 resolution to avoid ENETUNREACH on IPv6-only addresses
      const url = new URL(connectionString);
      const host = url.hostname;
      const ipv4Addr = (await dns.lookup(host, { family: 4 })).address;
      url.hostname = ipv4Addr;

      const sql = postgres(url.toString(), {
        ssl: useSSL ? { rejectUnauthorized: false } : false,
      });

      console.log(`Connected to Supabase Transaction Pooler via postgres.js (IPv4: ${ipv4Addr})`);

      con = {
        query: async (text, params) => {
          const result = await sql.unsafe(text, params);
          return { rows: result };
        },
        release: async () => {
          await sql.end({ timeout: 5 });
          console.log('Supabase PostgreSQL connection released');
        },
        _clientType: 'postgres.js',
      };
    } catch (err) {
      console.error('Supabase connection error:', err.message);
    }
  })();
} else {
  // --- Using pg.Client for local PostgreSQL connection ---
  const connectionConfig = {
    host: env.PG_HOST,
    user: env.PG_USER,
    port: env.PG_PORT || 5432,
    password: env.PG_PASSWORD,
    database: env.PG_DB,
    ssl: env.PG_SSL === 'true' ? { rejectUnauthorized: false } : false,
    family: 4, // 👈 Force IPv4 locally too
  };

  const client = new Client(connectionConfig);

  (async () => {
    try {
      await client.connect();
      console.log('Connected to Local PostgreSQL via pg.Client');
    } catch (err) {
      console.error('Connection error', err.stack);
    }
  })();

  client.release = async () => {
    await client.end();
    console.log('Local PostgreSQL connection released');
  };

  client._clientType = 'pg';
  con = client;
}

module.exports = con;
