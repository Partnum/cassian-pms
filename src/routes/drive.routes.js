'use strict';
/** Google Drive endpoints. Mounted at /api/v1/drive (requireAuth applied upstream). */
const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const { env, q, one } = require('../config');
const { requirePermission, scopeClientIds, canAccessClient, logActivity, asyncHandler } = require('../auth');
const drive = require('../services/drive.service');
const syncJob = require('../jobs/drive-sync.job');

function staffOnly(req, res, next) {
  if (!['Admin', 'Partner'].includes(req.user.role)) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Admin/Partner only' } });
  return next();
}

// Connection status (current user + firm) + latest sync state
router.get('/status', asyncHandler(async (req, res) => {
  const conn = await drive.getConnection(req.user.id);
  const firmConn = conn || await drive.firmConnection(req.user.firmId);
  const sync = await one(
    `SELECT s.status, s.last_synced_at, s.last_error, s.stats
       FROM drive_sync_state s JOIN drive_connections c ON c.id=s.connection_id
      WHERE c.firm_id=? ORDER BY s.updated_at DESC LIMIT 1`, [req.user.firmId]
  );
  res.json({ data: { mode: drive.mode, connected: !!conn, firmConnected: !!firmConn, account: firmConn ? { email: firmConn.google_email, connected_at: firmConn.connected_at } : null, sync: sync || null } });
}));

// Begin OAuth — returns the Google consent URL (state carries the signed user id)
router.get('/connect', asyncHandler(async (req, res) => {
  if (drive.mode !== 'google') return res.status(400).json({ error: { code: 'LOCAL_MODE', message: 'DRIVE_MODE is local. Set DRIVE_MODE=google with Google credentials in .env to connect Google Drive.' } });
  const state = jwt.sign({ sub: req.user.id, firmId: req.user.firmId, t: 'drive' }, env.jwt.accessSecret, { expiresIn: '10m' });
  res.json({ data: { url: drive.generateAuthUrl(state) } });
}));

router.post('/disconnect', asyncHandler(async (req, res) => {
  await drive.disconnect(req.user.id);
  await logActivity(req, 'disconnect', 'drive', null);
  res.json({ data: { ok: true } });
}));

router.get('/connections', staffOnly, asyncHandler(async (req, res) => {
  res.json({ data: await drive.listConnections(req.user.firmId) });
}));

// Trigger a sync now
router.post('/sync', requirePermission('document.upload'), asyncHandler(async (req, res) => {
  const result = await syncJob.runSyncForFirm(req.user.firmId);
  await logActivity(req, 'sync', 'drive', null, result);
  res.json({ data: result });
}));

router.get('/sync/status', asyncHandler(async (req, res) => {
  const rows = await q(
    `SELECT s.status, s.last_synced_at, s.last_error, s.stats, c.google_email
       FROM drive_sync_state s JOIN drive_connections c ON c.id=s.connection_id
      WHERE c.firm_id=? ORDER BY s.updated_at DESC`, [req.user.firmId]
  );
  res.json({ data: rows });
}));

// Provision the full audit folder tree for a client/year
router.post('/clients/:id/provision', requirePermission('client.update'), asyncHandler(async (req, res) => {
  if (!(await canAccessClient(req.user, req.params.id))) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'No access' } });
  const client = await one('SELECT * FROM clients WHERE id=? AND firm_id=?', [req.params.id, req.user.firmId]);
  if (!client) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Client not found' } });
  try {
    const r = await drive.ensureFolderTree(client, req.body.year || new Date().getFullYear(), { userId: req.user.id });
    await logActivity(req, 'provision', 'client', client.id);
    res.json({ data: { ok: true, mode: r.mode, subfolders: Object.keys(r.subfolders || {}) } });
  } catch (e) { res.status(502).json({ error: { code: 'DRIVE_ERROR', message: e.message } }); }
}));

// Link an existing Drive folder to a client
router.post('/clients/:id/link', requirePermission('client.update'), asyncHandler(async (req, res) => {
  if (!req.body.folderId) return res.status(400).json({ error: { code: 'BAD_INPUT', message: 'folderId is required' } });
  if (!(await canAccessClient(req.user, req.params.id))) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'No access' } });
  const client = await one('SELECT * FROM clients WHERE id=? AND firm_id=?', [req.params.id, req.user.firmId]);
  if (!client) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Client not found' } });
  try {
    const r = await drive.linkExistingFolder(client, req.body.folderId, { userId: req.user.id });
    await logActivity(req, 'link-folder', 'client', client.id, { folderId: req.body.folderId });
    res.json({ data: r });
  } catch (e) { res.status(502).json({ error: { code: 'DRIVE_ERROR', message: e.message } }); }
}));

// Folder explorer
router.get('/clients/:id/folder-tree', requirePermission('document.read'), asyncHandler(async (req, res) => {
  if (!(await canAccessClient(req.user, req.params.id))) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'No access' } });
  const client = await one('SELECT * FROM clients WHERE id=? AND firm_id=?', [req.params.id, req.user.firmId]);
  if (!client) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Client not found' } });
  try {
    const tree = await drive.listChildren(client, req.query.folderId, { userId: req.user.id });
    res.json({ data: tree });
  } catch (e) { res.status(502).json({ error: { code: 'DRIVE_ERROR', message: e.message } }); }
}));

// Missing-documents tracker (requirements vs present documents)
router.get('/clients/:id/missing-documents', requirePermission('document.read'), asyncHandler(async (req, res) => {
  if (!(await canAccessClient(req.user, req.params.id))) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'No access' } });
  const client = await one('SELECT id, category FROM clients WHERE id=? AND firm_id=?', [req.params.id, req.user.firmId]);
  if (!client) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Client not found' } });
  const reqs = await q('SELECT doc_type, label, sort FROM document_requirements WHERE category=? AND (firm_id IS NULL OR firm_id=?) ORDER BY sort', [client.category, req.user.firmId]);
  const present = req.query.year
    ? await q('SELECT DISTINCT doc_type, detected_type FROM documents WHERE client_id=? AND deleted_at IS NULL AND year=?', [client.id, req.query.year])
    : await q('SELECT DISTINCT doc_type, detected_type FROM documents WHERE client_id=? AND deleted_at IS NULL', [client.id]);
  const have = new Set();
  present.forEach((p) => { if (p.doc_type) have.add(p.doc_type); if (p.detected_type) have.add(p.detected_type); });
  const items = reqs.map((r) => ({ label: r.label, doc_type: r.doc_type, satisfied: have.has(r.doc_type) }));
  res.json({ data: { items, missing: items.filter((i) => !i.satisfied).length, total: items.length } });
}));

// File activity timeline (scoped)
router.get('/activity', requirePermission('document.read'), asyncHandler(async (req, res) => {
  const ids = await scopeClientIds(req.user);
  let where = 'd.firm_id=?'; const params = [req.user.firmId];
  if (ids !== '*') {
    if (!ids.length) return res.json({ data: [] });
    where += ` AND d.client_id IN (${ids.map(() => '?').join(',')})`;
    params.push(...ids);
  }
  const rows = await q(
    `SELECT al.action, al.created_at, d.name AS document_name, c.name AS client_name, u.full_name AS user_name
       FROM document_access_logs al
       JOIN documents d ON d.id=al.document_id
       JOIN clients c ON c.id=d.client_id
       LEFT JOIN users u ON u.id=al.user_id
      WHERE ${where} ORDER BY al.created_at DESC LIMIT 60`, params
  );
  res.json({ data: rows });
}));

module.exports = router;
