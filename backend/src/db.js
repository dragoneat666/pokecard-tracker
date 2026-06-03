// db.js — PostgreSQL connection pool
//
// A "pool" is a set of pre-opened database connections that get reused.
// Without a pool, every API request would open a new connection to Postgres,
// use it, and close it — slow and wasteful. With a pool, connections are
// kept open and handed out to requests as needed, then returned.
//
// pg.Pool manages all of this automatically. We just import `pool` anywhere
// we need to query the database and call pool.query().

import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  host:     process.env.DB_HOST,      // "db" — resolved by Docker's internal DNS
  port:     parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,

  // Pool sizing — for a personal app, small values are fine
  max: 10,              // Maximum simultaneous connections
  idleTimeoutMillis: 30000,   // Close idle connections after 30s
  connectionTimeoutMillis: 2000, // Fail fast if can't connect in 2s
});

// Test the connection on startup and log the result.
// This runs once when the module is first imported (i.e., when server starts).
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Failed to connect to PostgreSQL:', err.message);
    console.error('   Check DB_HOST, DB_USER, DB_PASSWORD in your .env');
  } else {
    console.log('✅ PostgreSQL connected');
    release(); // Return the test connection back to the pool
  }
});

// Helper function used throughout the app.
// Instead of calling pool.query() directly everywhere, we wrap it so we can
// add logging, error handling, or timing in one place later if needed.
//
// Usage: const { rows } = await query('SELECT * FROM sets WHERE id = $1', [id]);
// The $1, $2 syntax is parameterized queries — NEVER use string interpolation
// for user input. pg handles escaping automatically when you use $1 syntax,
// protecting against SQL injection.
export async function query(text, params) {
  const start = Date.now();
  const result = await pool.query(text, params);
  const duration = Date.now() - start;

  // Log slow queries (over 500ms) so you can spot performance issues
  if (duration > 500) {
    console.warn(`⚠️  Slow query (${duration}ms):`, text);
  }

  return result;
}

export default pool;
