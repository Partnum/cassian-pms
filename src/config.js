'use strict';
/**
 * Central configuration: environment variables + database access + query helpers.
 *
 * Two database modes (DB_MODE):
 *   • pglite — in-process PostgreSQL (WebAssembly). ZERO setup: no server, no
 *              connection string. Data is stored in a local folder (PGLITE_DIR).
 *              This is the default when no DATABASE_URL is configured.
 *   • pg     — a real PostgreSQL server (local install, Supabase, Neon, Render…)
 *              via DATABASE_URL or PG* variables. The default when DATABASE_URL is set.
 *
 * Both run genuine PostgreSQL, so the SQL/migrations are identical. The q()/one()
 * helpers accept MySQL-style "?" placeholders and rebind them to "$1, $2, ..." so
 * route code stays dialect-neutral.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool, types } = require('pg');
const crypto = require('crypto');

// Return date/time columns as strings (stable for the API & frontend; avoids
// implicit timezone conversion). DATE=1082, TIMESTAMP=1114, TIMESTAMPTZ=1184.
types.setTypeParser(1082, (v) => v);
types.setTypeParser(1114, (v) => v);
types.setTypeParser(1184, (v) => v);

const env = {
  port: parseInt(process.env.PORT || '4000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:4000')
    .split(',').map((s) => s.trim()).filter(Boolean),

  db: {
    connectionString: process.env.DATABASE_URL || '',
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432', 10),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'postgres',
    database: process.env.PGDATABASE || 'cassian_pms',
  },

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || 'dev_access_secret',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev_refresh_secret',
    accessTtl: process.env.ACCESS_TOKEN_TTL || '15m',
    refreshTtlDays: parseInt(process.env.REFRESH_TOKEN_TTL_DAYS || '7', 10),
  },

  seedPassword: process.env.SEED_PASSWORD || 'Password123!',

  drive: {
    mode: process.env.DRIVE_MODE || 'local',
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:4000/api/v1/drive/callback',
    rootFolder: process.env.DRIVE_ROOT_FOLDER || 'Cassian Clients',
  },

  ai: {
    mode: process.env.AI_MODE || 'mock',
    baseUrl: process.env.AI_BASE_URL || 'https://api.openai.com/v1',
    apiKey: process.env.AI_API_KEY || '',
    model: process.env.AI_MODEL || 'gpt-4o-mini',
  },

  mail: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || 'Cassian PMS <no-reply@cassian.co.tz>',
  },

  scheduler: {
    enabled: (process.env.ENABLE_SCHEDULER || 'true') === 'true',
    cron: process.env.REMINDER_CRON || '0 7 * * *',
    warnDays: parseInt(process.env.DEADLINE_WARN_DAYS || '7', 10),
  },
};

// Database mode. Default to pglite (zero-setup, in-process) unless a DATABASE_URL
// is configured, in which case default to a real PostgreSQL server.
const dbMode = (process.env.DB_MODE
  ? process.env.DB_MODE.toLowerCase()
  : (process.env.DATABASE_URL ? 'pg' : 'pglite'));

// Folder where PGlite persists its data (created automatically). Survives restarts.
const PGLITE_DIR = process.env.PGLITE_DIR
  ? path.resolve(process.env.PGLITE_DIR)
  : path.join(__dirname, '..', 'data', 'pglite');

// Enable SSL automatically for hosted databases (Neon, Supabase, Render, Railway,
// or any URL with sslmode=require). Set PGSSL=false to force-disable.
function needsSSL(url) {
  if (process.env.PGSSL === 'true') return true;
  if (process.env.PGSSL === 'false') return false;
  return /sslmode=require|neon\.tech|supabase\.|render\.com|railway|amazonaws\.com/.test(url || '');
}

let pool = null;     // pg.Pool       (pg mode)
let pglite = null;   // PGlite        (pglite mode)
let _initPromise = null;

async function init() {
  if (dbMode === 'pglite') {
    // PGlite ships as ES modules; load via dynamic import from CommonJS.
    const { PGlite } = await import('@electric-sql/pglite');
    const { citext } = await import('@electric-sql/pglite/contrib/citext');
    const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
    // PGlite's mkdir is non-recursive; ensure the data folder tree exists first.
    fs.mkdirSync(PGLITE_DIR, { recursive: true });
    pglite = await new PGlite({
      dataDir: PGLITE_DIR,
      extensions: { citext, pgcrypto },
      // Keep date/time columns as strings, matching the pg driver config above.
      parsers: { 1082: (v) => v, 1114: (v) => v, 1184: (v) => v },
    });
    return;
  }
  pool = new Pool(
    env.db.connectionString
      ? { connectionString: env.db.connectionString, ssl: needsSSL(env.db.connectionString) ? { rejectUnauthorized: false } : undefined, max: 10 }
      : { host: env.db.host, port: env.db.port, user: env.db.user, password: env.db.password, database: env.db.database, max: 10 }
  );
  pool.on('error', (e) => console.error('Postgres pool error:', e.message));
}

/** Resolve once the chosen database backend is ready. */
function ready() {
  if (!_initPromise) _initPromise = init();
  return _initPromise;
}

/** Convert MySQL-style "?" placeholders to PostgreSQL "$1, $2, ...". */
function rebind(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

/** Run a parameterized query; returns the rows array. */
async function q(sql, params = []) {
  await ready();
  const text = rebind(sql);
  const result = dbMode === 'pglite'
    ? await pglite.query(text, params)
    : await pool.query(text, params);
  return result.rows;
}

/** Run a query; returns the first row or null. */
async function one(sql, params = []) {
  const rows = await q(sql, params);
  return rows[0] || null;
}

/** Execute raw SQL (possibly multiple statements). Used by migrate/seed. */
async function exec(sql) {
  await ready();
  return dbMode === 'pglite' ? pglite.exec(sql) : pool.query(sql);
}

/** Lightweight connectivity check used at server startup. */
async function ping() {
  await ready();
  return dbMode === 'pglite' ? pglite.query('SELECT 1') : pool.query('SELECT 1');
}

function uuid() {
  return crypto.randomUUID();
}

module.exports = {
  env,
  dbMode,
  pgliteDir: PGLITE_DIR,
  ready,
  ping,
  exec,
  q,
  one,
  uuid,
  rebind,
  // Backwards-compatible accessor; null until ready() resolves, and only in pg mode.
  get pool() { return pool; },
};
