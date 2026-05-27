'use strict';
/**
 * Seeds the database ONLY if it is empty (no users yet).
 * Safe to run on every deploy: it creates the initial admin + sample data on the
 * very first deploy, and does nothing on subsequent deploys (so real data is
 * never wiped). Used by the cloud build command:  npm run seed:ifempty
 */
const fs = require('fs');
const path = require('path');
const { q, exec } = require('../src/config');

(async () => {
  try {
    let n = 0;
    try {
      const r = await q('SELECT COUNT(*)::int AS n FROM users');
      n = r[0].n;
    } catch (e) {
      console.error('✗ Cannot read the users table — run migrations first. (' + e.message + ')');
      process.exit(1);
    }
    if (n > 0) {
      console.log('• Database already has ' + n + ' user(s) — skipping seed (data preserved).');
      process.exit(0);
    }
    const sql = fs.readFileSync(path.join(__dirname, '..', 'database', 'postgres', 'seed.sql'), 'utf8');
    await exec(sql);
    console.log('✓ Initial data seeded. Admin login: info@cassian.co.tz');
    process.exit(0);
  } catch (e) {
    console.error('✗ seed:ifempty failed:', e.message);
    process.exit(1);
  }
})();
