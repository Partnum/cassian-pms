'use strict';
/**
 * PostgreSQL migration runner (supports both database modes).
 *   • pglite — applies migrations to the in-process PGlite data folder (no server).
 *   • pg     — creates the database if needed (local), then applies migrations
 *              to the PostgreSQL server / managed database (Supabase, Neon…).
 * Either way every file in database/postgres/migrations is applied in order and
 * tracked in schema_migrations.
 *
 *   npm run migrate
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
require('dotenv').config();

const dbMode = (process.env.DB_MODE
  ? process.env.DB_MODE.toLowerCase()
  : (process.env.DATABASE_URL ? 'pg' : 'pglite'));
const PGLITE_DIR = process.env.PGLITE_DIR
  ? path.resolve(process.env.PGLITE_DIR)
  : path.join(__dirname, '..', 'data', 'pglite');
const MIG_DIR = path.join(__dirname, '..', 'database', 'postgres', 'migrations');

const usingUrl = !!process.env.DATABASE_URL;
const base = {
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5432', 10),
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
};
const dbName = process.env.PGDATABASE || 'cassian_pms';
function needsSSL(url) {
  if (process.env.PGSSL === 'true') return true;
  if (process.env.PGSSL === 'false') return false;
  return /sslmode=require|neon\.tech|supabase\.|render\.com|railway|amazonaws\.com/.test(url || '');
}
const targetCfg = usingUrl
  ? { connectionString: process.env.DATABASE_URL, ssl: needsSSL(process.env.DATABASE_URL) ? { rejectUnauthorized: false } : undefined }
  : { ...base, database: dbName };

async function ensureDatabase() {
  if (usingUrl) return; // assume the managed database already exists
  const admin = new Client({ ...base, database: 'postgres' });
  await admin.connect();
  const r = await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [dbName]);
  if (!r.rowCount) {
    await admin.query(`CREATE DATABASE "${dbName}"`);
    console.log('✓ Created database "%s"', dbName);
  }
  await admin.end();
}

// ---- PGlite mode: in-process PostgreSQL, no server, no connection string ----
async function runPglite() {
  const { PGlite } = await import('@electric-sql/pglite');
  const { citext } = await import('@electric-sql/pglite/contrib/citext');
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  fs.mkdirSync(PGLITE_DIR, { recursive: true }); // PGlite mkdir is non-recursive
  const db = await new PGlite({ dataDir: PGLITE_DIR, extensions: { citext, pgcrypto } });
  try {
    await db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now())');
    const files = fs.readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files) {
      const done = await db.query('SELECT 1 FROM schema_migrations WHERE filename=$1', [f]);
      if (done.rows.length) { console.log('• skip  ', f); continue; }
      const sql = fs.readFileSync(path.join(MIG_DIR, f), 'utf8');
      try {
        await db.exec(sql);
        await db.query('INSERT INTO schema_migrations(filename) VALUES($1)', [f]);
        console.log('✓ applied', f);
      } catch (e) {
        console.error('✗ FAILED ', f, '-', e.message);
        process.exitCode = 1;
        break;
      }
    }
    console.log('Migration run complete (PGlite — data folder: %s).', PGLITE_DIR);
  } finally {
    await db.close();
  }
}

(async () => {
  if (dbMode === 'pglite') {
    await runPglite();
    return;
  }

  try {
    await ensureDatabase();
  } catch (e) {
    console.error('✗ Could not create database:', e.message);
    console.error('  Create it manually:  createdb', dbName);
  }

  const client = new Client(targetCfg);
  await client.connect();
  try {
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now())');
    const dir = path.join(__dirname, '..', 'database', 'postgres', 'migrations');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files) {
      const done = await client.query('SELECT 1 FROM schema_migrations WHERE filename=$1', [f]);
      if (done.rowCount) { console.log('• skip  ', f); continue; }
      const sql = fs.readFileSync(path.join(dir, f), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(filename) VALUES($1)', [f]);
        await client.query('COMMIT');
        console.log('✓ applied', f);
      } catch (e) {
        await client.query('ROLLBACK');
        console.error('✗ FAILED ', f, '-', e.message);
        process.exitCode = 1;
        break;
      }
    }
    console.log('Migration run complete.');
  } finally {
    await client.end();
  }
})();
