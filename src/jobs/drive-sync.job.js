'use strict';
/**
 * Background Drive sync. Pulls Drive changes per connection, ingests new/updated
 * files (classify + workflow hooks), and records sync state. Runs on a cron
 * schedule and on demand (POST /api/v1/drive/sync).
 */
const cron = require('node-cron');
const { env, q } = require('../config');
const drive = require('../services/drive.service');
const ingest = require('../services/ingest.service');

async function runSyncForConnection(conn) {
  try {
    await q("UPDATE drive_sync_state SET status='running' WHERE connection_id=?", [conn.id]).catch(() => {});
    const { changes, newToken, stateId } = await drive.fetchChanges(conn);
    let created = 0; let updated = 0;
    for (const ch of changes) {
      const r = await ingest.ingestFromDrive({ file: ch.file, clientId: ch.clientId, year: ch.year, subfolder: ch.subfolder, userId: conn.user_id });
      if (r.created) created += 1; else if (r.updated) updated += 1;
    }
    await drive.saveSyncResult(stateId, newToken, { scanned: changes.length, created, updated, at: new Date().toISOString() });
    return { scanned: changes.length, created, updated };
  } catch (e) {
    await q("UPDATE drive_sync_state SET status='error', last_error=? WHERE connection_id=?", [e.message, conn.id]).catch(() => {});
    return { error: e.message };
  }
}

async function runSyncForFirm(firmId) {
  if (env.drive.mode !== 'google') return { mode: 'local' };
  const conn = await drive.firmConnection(firmId);
  if (!conn) return { connected: false };
  return runSyncForConnection(conn);
}

async function runAllSyncs() {
  if (env.drive.mode !== 'google') return;
  const conns = await q("SELECT * FROM drive_connections WHERE status='connected'");
  for (const c of conns) { await runSyncForConnection(c); } // eslint-disable-line no-await-in-loop
}

function startSyncScheduler() {
  if (env.drive.mode !== 'google') { console.log('• Drive sync scheduler idle (DRIVE_MODE=local)'); return; }
  const expr = process.env.DRIVE_SYNC_CRON || '*/10 * * * *';
  if (!cron.validate(expr)) { console.warn('• Invalid DRIVE_SYNC_CRON; sync scheduler not started'); return; }
  cron.schedule(expr, () => { runAllSyncs().catch((e) => console.error('Drive sync error:', e.message)); });
  console.log(`• Drive sync scheduler started (cron "${expr}")`);
}

module.exports = { runSyncForConnection, runSyncForFirm, runAllSyncs, startSyncScheduler };
