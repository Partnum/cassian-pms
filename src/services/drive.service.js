'use strict';
/**
 * Google Drive service — Drive API v3, multi-user OAuth 2.0.
 *
 *  DRIVE_MODE=google -> real Drive (per-user OAuth tokens in drive_connections)
 *  DRIVE_MODE=local  -> files saved under ./uploads/<client>/<year>/<subfolder>
 *
 * This module owns Drive API access, OAuth tokens, folder automation and the
 * incremental Changes-API sync. Document records / classification / workflow
 * hooks live in ingest.service.js so this file stays Drive-focused.
 *
 * Folder tree:  <ROOT>/<Category>/<Client Name>/<Year>/<Subfolder>
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const { google } = require('googleapis');
const { env, q, one, uuid } = require('../config');
const { CATEGORY_SUBFOLDERS } = require('../drive.config');

const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
const SCOPES = ['https://www.googleapis.com/auth/drive'];
const ENC_KEY = process.env.TOKEN_ENC_KEY || '';

// ---------- token encryption (AES-256-GCM, optional) ----------
function key32() { return crypto.createHash('sha256').update(ENC_KEY).digest(); }
function encJson(obj) {
  if (!ENC_KEY) return obj; // dev: store plain
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key32(), iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return { v: 1, iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), ct: ct.toString('base64') };
}
function decJson(stored) {
  if (!stored) return null;
  if (!(stored.v === 1 && stored.ct)) return stored; // plain
  const d = crypto.createDecipheriv('aes-256-gcm', key32(), Buffer.from(stored.iv, 'base64'));
  d.setAuthTag(Buffer.from(stored.tag, 'base64'));
  const pt = Buffer.concat([d.update(Buffer.from(stored.ct, 'base64')), d.final()]);
  return JSON.parse(pt.toString('utf8'));
}

function oauthClient() {
  return new google.auth.OAuth2(env.drive.clientId, env.drive.clientSecret, env.drive.redirectUri);
}

function generateAuthUrl(state) {
  return oauthClient().generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES, state });
}

// ---------- connections (drive_connections) ----------
async function getConnection(userId) {
  return one('SELECT * FROM drive_connections WHERE user_id=? AND status=?', [userId, 'connected']);
}
async function firmConnection(firmId) {
  return one("SELECT * FROM drive_connections WHERE firm_id=? AND status='connected' ORDER BY updated_at DESC LIMIT 1", [firmId]);
}
async function listConnections(firmId) {
  return q('SELECT id, user_id, google_email, status, connected_at FROM drive_connections WHERE firm_id=?', [firmId]);
}

async function exchangeCodeForUser(code, userId, firmId) {
  const c = oauthClient();
  const { tokens } = await c.getToken(code);
  c.setCredentials(tokens);
  let email = null;
  try { const about = await google.drive({ version: 'v3', auth: c }).about.get({ fields: 'user(emailAddress)' }); email = about.data.user.emailAddress; } catch (e) { /* ignore */ }
  const payload = JSON.stringify(encJson(tokens));
  const existing = await one('SELECT id FROM drive_connections WHERE user_id=?', [userId]);
  if (existing) {
    await q("UPDATE drive_connections SET token=?, google_email=?, scopes=?, status='connected' WHERE id=?",
      [payload, email, SCOPES.join(' '), existing.id]);
  } else {
    await q('INSERT INTO drive_connections (id, firm_id, user_id, google_email, token, scopes) VALUES (?,?,?,?,?,?)',
      [uuid(), firmId, userId, email, payload, SCOPES.join(' ')]);
  }
  return { email };
}

async function disconnect(userId) {
  await q("UPDATE drive_connections SET status='revoked' WHERE user_id=?", [userId]);
}

/** Build an authenticated Drive client from a connection row (auto-persists refreshed tokens). */
function driveForConnection(conn) {
  const c = oauthClient();
  c.setCredentials(decJson(conn.token));
  c.on('tokens', (t) => {
    const merged = { ...decJson(conn.token), ...t };
    q('UPDATE drive_connections SET token=? WHERE id=?', [JSON.stringify(encJson(merged)), conn.id]).catch(() => {});
  });
  return google.drive({ version: 'v3', auth: c });
}

async function driveForUser(userId) {
  const conn = await getConnection(userId);
  return conn ? { drive: driveForConnection(conn), conn } : null;
}
async function driveForFirm(firmId) {
  const conn = await firmConnection(firmId);
  return conn ? { drive: driveForConnection(conn), conn } : null;
}

/** Resolve a Drive client: prefer the user's own connection, fall back to any firm connection. */
async function resolveDrive(userId, firmId) {
  return (userId && await driveForUser(userId)) || (firmId && await driveForFirm(firmId)) || null;
}

async function isConnected({ userId, firmId } = {}) {
  if (env.drive.mode !== 'google') return true; // local mode always "available"
  if (userId && await getConnection(userId)) return true;
  if (firmId && await firmConnection(firmId)) return true;
  return false;
}

// ---------- folder automation ----------
async function findOrCreateFolder(drive, name, parentId) {
  const safe = String(name).replace(/'/g, "\\'");
  const where = [
    "mimeType='application/vnd.google-apps.folder'", `name='${safe}'`, 'trashed=false',
    parentId ? `'${parentId}' in parents` : "'root' in parents",
  ].join(' and ');
  const r = await drive.files.list({ q: where, fields: 'files(id,name)', spaces: 'drive' });
  if (r.data.files && r.data.files.length) return r.data.files[0].id;
  const meta = { name, mimeType: 'application/vnd.google-apps.folder' };
  if (parentId) meta.parents = [parentId];
  const created = await drive.files.create({ requestBody: meta, fields: 'id, webViewLink' });
  return created.data.id;
}

async function saveLink(clientId, label, folderId, year, webLink) {
  const existing = await one('SELECT id FROM client_drive_links WHERE client_id=? AND label=?', [clientId, label]);
  if (existing) await q('UPDATE client_drive_links SET drive_folder_id=?, web_link=?, year=? WHERE id=?', [folderId, webLink || null, year || null, existing.id]);
  else await q('INSERT INTO client_drive_links (id, client_id, label, drive_folder_id, web_link, year) VALUES (?,?,?,?,?,?)', [uuid(), clientId, label, folderId, webLink || null, year || null]);
}

/** Provision <ROOT>/<Category>/<Client>/<Year>/<subfolders>. Returns folder ids. */
async function ensureFolderTree(client, year, { userId } = {}) {
  if (env.drive.mode !== 'google') {
    return { mode: 'local', yearFolder: null, subfolders: {} };
  }
  const ctx = await resolveDrive(userId, client.firm_id);
  if (!ctx) throw new Error('Google Drive not connected');
  const { drive } = ctx;
  const root = await findOrCreateFolder(drive, env.drive.rootFolder, null);
  const catFolder = await findOrCreateFolder(drive, client.category, root);
  const clientFolder = await findOrCreateFolder(drive, client.name, catFolder);
  await saveLink(client.id, 'root', clientFolder, null);
  const yr = String(year || new Date().getFullYear());
  const yearFolder = await findOrCreateFolder(drive, yr, clientFolder);
  await saveLink(client.id, yr, yearFolder, parseInt(yr, 10));
  const subfolders = {};
  for (const sub of (CATEGORY_SUBFOLDERS[client.category] || [])) {
    const id = await findOrCreateFolder(drive, sub, yearFolder);
    subfolders[sub] = id;
    await saveLink(client.id, `${yr}/${sub}`, id, parseInt(yr, 10));
  }
  // persist root folder id on the client
  await q('UPDATE clients SET drive_folder_id=? WHERE id=?', [clientFolder, client.id]);
  return { mode: 'google', drive, root, clientFolder, yearFolder, subfolders };
}

/** Manually link an existing Drive folder to a client. */
async function linkExistingFolder(client, folderId, { userId } = {}) {
  if (env.drive.mode === 'google') {
    const ctx = await resolveDrive(userId, client.firm_id);
    if (!ctx) throw new Error('Google Drive not connected');
    const meta = await ctx.drive.files.get({ fileId: folderId, fields: 'id,name,mimeType,webViewLink' });
    if (meta.data.mimeType !== 'application/vnd.google-apps.folder') throw new Error('Provided ID is not a folder');
    await saveLink(client.id, 'root', folderId, null, meta.data.webViewLink);
  }
  await q('UPDATE clients SET drive_folder_id=? WHERE id=?', [folderId, client.id]);
  return { ok: true, folderId };
}

/** Folder explorer: returns child folders + files of a folder (or the client root). */
async function listChildren(client, folderId, { userId } = {}) {
  if (env.drive.mode !== 'google') return { folders: [], files: [] };
  const ctx = await resolveDrive(userId, client.firm_id);
  if (!ctx) throw new Error('Google Drive not connected');
  const parent = folderId || client.drive_folder_id;
  if (!parent) return { folders: [], files: [] };
  const r = await ctx.drive.files.list({
    q: `'${parent}' in parents and trashed=false`,
    fields: 'files(id,name,mimeType,size,modifiedTime,webViewLink,iconLink)', pageSize: 200,
  });
  const folders = []; const files = [];
  for (const f of (r.data.files || [])) {
    if (f.mimeType === 'application/vnd.google-apps.folder') folders.push(f); else files.push(f);
  }
  return { folders, files, parent };
}

// ---------- upload / download ----------
function slug(name) { return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

/**
 * Upload a file to Drive (or local). `file` = { originalname, mimetype, buffer }.
 * Returns storage metadata for the documents table.
 */
async function uploadToDrive({ client, year, subfolder, file, userId }) {
  const md5 = crypto.createHash('md5').update(file.buffer).digest('hex');
  if (env.drive.mode === 'google') {
    const tree = await ensureFolderTree(client, year, { userId });
    const parent = (subfolder && tree.subfolders[subfolder]) || tree.yearFolder;
    const res = await tree.drive.files.create({
      requestBody: { name: file.originalname, parents: [parent] },
      media: { mimeType: file.mimetype, body: Readable.from(file.buffer) },
      fields: 'id, webViewLink, size, md5Checksum, modifiedTime, parents',
    });
    return {
      storage: 'google', driveFileId: res.data.id, webLink: res.data.webViewLink, localPath: null,
      size: Number(res.data.size || file.buffer.length), md5: res.data.md5Checksum || md5,
      modifiedTime: res.data.modifiedTime, parentId: (res.data.parents || [])[0] || parent, subfolder: subfolder || null,
    };
  }
  const dir = path.join(UPLOAD_DIR, slug(client.name || 'misc'), String(year || new Date().getFullYear()), subfolder ? slug(subfolder) : '');
  fs.mkdirSync(dir, { recursive: true });
  const fname = `${Date.now()}_${file.originalname.replace(/[^\w.\-]+/g, '_')}`;
  const full = path.join(dir, fname);
  fs.writeFileSync(full, file.buffer);
  return { storage: 'local', driveFileId: null, webLink: null, localPath: path.relative(process.cwd(), full), size: file.buffer.length, md5, modifiedTime: new Date().toISOString(), parentId: null, subfolder: subfolder || null };
}

async function getDownloadStream(doc, { userId } = {}) {
  if (doc.storage === 'google' && doc.drive_file_id) {
    const ctx = await resolveDrive(userId, doc.firm_id);
    if (!ctx) throw new Error('Google Drive not connected');
    const r = await ctx.drive.files.get({ fileId: doc.drive_file_id, alt: 'media' }, { responseType: 'stream' });
    return { stream: r.data, mime: doc.mime_type || 'application/octet-stream' };
  }
  const full = path.resolve(process.cwd(), doc.local_path || '');
  if (!doc.local_path || !fs.existsSync(full)) throw new Error('File not found on disk');
  return { stream: fs.createReadStream(full), mime: doc.mime_type || 'application/octet-stream' };
}

/** Fetch a file's bytes (Buffer) — used by the OCR/extraction pipeline. */
async function getFileBuffer(doc, { userId } = {}) {
  const { stream } = await getDownloadStream(doc, { userId });
  const chunks = [];
  return new Promise((resolve, reject) => {
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

// ---------- incremental sync (Changes API) ----------
async function ensureSyncState(conn) {
  let state = await one('SELECT * FROM drive_sync_state WHERE connection_id=?', [conn.id]);
  if (!state) {
    const drive = driveForConnection(conn);
    const tok = await drive.changes.getStartPageToken();
    await q('INSERT INTO drive_sync_state (id, firm_id, connection_id, start_page_token, status) VALUES (?,?,?,?,?)',
      [uuid(), conn.firm_id, conn.id, tok.data.startPageToken, 'idle']);
    state = await one('SELECT * FROM drive_sync_state WHERE connection_id=?', [conn.id]);
  }
  return state;
}

/** Map provisioned folder ids -> {clientId, year, subfolder} for the firm. */
async function folderLookup(firmId) {
  const rows = await q(
    `SELECT l.drive_folder_id, l.label, l.year, l.client_id, c.firm_id
       FROM client_drive_links l JOIN clients c ON c.id=l.client_id WHERE c.firm_id=?`, [firmId]
  );
  const map = {};
  for (const r of rows) {
    const sub = r.label && r.label.includes('/') ? r.label.split('/')[1] : null;
    map[r.drive_folder_id] = { clientId: r.client_id, firmId: r.firm_id, year: r.year, subfolder: sub };
  }
  return map;
}

/**
 * Pull Drive changes since the last token. Returns
 * { changes: [{ file, clientId, year, subfolder }], newToken, raw }.
 * The caller (drive-sync job) persists documents + runs classification/hooks.
 */
async function fetchChanges(conn) {
  const drive = driveForConnection(conn);
  const state = await ensureSyncState(conn);
  const lookup = await folderLookup(conn.firm_id);
  let pageToken = state.start_page_token;
  const changes = [];
  let newToken = pageToken;
  for (let guard = 0; guard < 50; guard += 1) {
    const r = await drive.changes.list({
      pageToken, includeRemoved: true, pageSize: 100, spaces: 'drive',
      fields: 'newStartPageToken, nextPageToken, changes(removed, fileId, file(id,name,mimeType,size,md5Checksum,modifiedTime,parents,trashed,webViewLink))',
    });
    for (const ch of (r.data.changes || [])) {
      const f = ch.file;
      if (ch.removed || !f || f.trashed || f.mimeType === 'application/vnd.google-apps.folder') continue;
      const parent = (f.parents || []).find((p) => lookup[p]);
      if (!parent) continue; // not under a known client folder
      const meta = lookup[parent];
      changes.push({ file: f, clientId: meta.clientId, year: meta.year, subfolder: meta.subfolder });
    }
    if (r.data.nextPageToken) { pageToken = r.data.nextPageToken; continue; }
    newToken = r.data.newStartPageToken || pageToken;
    break;
  }
  return { changes, newToken, stateId: state.id };
}

async function saveSyncResult(stateId, newToken, stats, error) {
  await q("UPDATE drive_sync_state SET start_page_token=?, last_synced_at=now(), status=?, last_error=?, stats=? WHERE id=?",
    [newToken, error ? 'error' : 'idle', error || null, JSON.stringify(stats || {}), stateId]);
}

module.exports = {
  mode: env.drive.mode,
  SCOPES,
  generateAuthUrl, exchangeCodeForUser, disconnect, isConnected,
  getConnection, firmConnection, listConnections, resolveDrive,
  ensureFolderTree, linkExistingFolder, listChildren,
  uploadToDrive, getDownloadStream, getFileBuffer,
  ensureSyncState, fetchChanges, saveSyncResult, folderLookup,
};
