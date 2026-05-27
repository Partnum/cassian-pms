'use strict';
/**
 * Loads sample data by executing database/postgres/seed.sql
 * (idempotent — the script truncates first). Passwords are hashed in-SQL
 * via pgcrypto and are bcrypt-compatible with the app's bcryptjs.
 *
 *   npm run seed
 *
 * Default login: info@cassian.co.tz / Password123!
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
const SEED_SQL = path.join(__dirname, '..', 'database', 'postgres', 'seed.sql');

const sslOn = process.env.PGSSL === 'true'
  || (process.env.PGSSL !== 'false' && /sslmode=require|neon\.tech|supabase\.|render\.com|railway|amazonaws\.com/.test(process.env.DATABASE_URL || ''));
const cfg = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL, ssl: sslOn ? { rejectUnauthorized: false } : undefined }
  : {
      host: process.env.PGHOST || 'localhost',
      port: parseInt(process.env.PGPORT || '5432', 10),
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || 'postgres',
      database: process.env.PGDATABASE || 'cassian_pms',
    };

function loginBanner() {
  console.log('✓ Seed complete.');
  console.log('  Login: info@cassian.co.tz / %s   (Admin)', process.env.SEED_PASSWORD || 'Password123!');
  console.log('  Other users: emmanuel@, grace@, amani@, neema@, juma@, fatma@, david@cassian.co.tz');
}

async function seedPglite() {
  const { PGlite } = await import('@electric-sql/pglite');
  const { citext } = await import('@electric-sql/pglite/contrib/citext');
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  fs.mkdirSync(PGLITE_DIR, { recursive: true }); // PGlite mkdir is non-recursive
  const db = await new PGlite({ dataDir: PGLITE_DIR, extensions: { citext, pgcrypto } });
  try {
    await db.exec(fs.readFileSync(SEED_SQL, 'utf8'));
    loginBanner();
  } catch (e) {
    console.error('✗ Seed failed:', e.message);
    console.error('  Did you run "npm run migrate" first?');
    process.exitCode = 1;
  } finally {
    await db.close();
  }
}

async function seedPg() {
  const sql = fs.readFileSync(SEED_SQL, 'utf8');
  const client = new Client(cfg);
  await client.connect();
  try {
    await client.query(sql);
    loginBanner();
  } catch (e) {
    console.error('✗ Seed failed:', e.message);
    console.error('  Did you run "npm run migrate" first?');
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

(async () => {
  if (dbMode === 'pglite') await seedPglite();
  else await seedPg();
})();
