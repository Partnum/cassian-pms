'use strict';
/** Client management. Mounted at /api/v1/clients (requireAuth applied upstream). */
const express = require('express');
const router = express.Router();
const { q, one, uuid } = require('../config');
const { requirePermission, scopeClientIds, canAccessClient, logActivity, asyncHandler } = require('../auth');
const { CLIENT_CATEGORIES, WORKFLOW_STAGES } = require('../constants');

/**
 * Auto-create a kickoff engagement so a freshly added client appears immediately
 * in the Workflow page (this was the user-reported gap: "added client but they
 * don't show up in audit work"). Only fires for engagement-driven categories.
 */
async function autoCreateEngagement(req, clientId, category, partnerId, managerId) {
  if (!['Audit', 'Tax', 'Accounting'].includes(category)) return null;
  const id = uuid();
  const yr = new Date().getFullYear();
  await q(
    `INSERT INTO audit_engagements (id, firm_id, client_id, type, financial_year, period_start, period_end,
       partner_id, manager_id, status, current_stage, progress_pct, fee_currency)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, req.user.firmId, clientId, category, yr, `${yr}-01-01`, `${yr}-12-31`,
      partnerId || null, managerId || null, 'In progress', 'Planning', 0, 'TZS']
  );
  for (let i = 0; i < WORKFLOW_STAGES.length; i++) {
    await q(
      'INSERT INTO audit_stages (id, engagement_id, sequence, name, status, progress_pct) VALUES (?,?,?,?,?,?)',
      [uuid(), id, i + 1, WORKFLOW_STAGES[i], i === 0 ? 'in_progress' : 'not_started', 0]
    );
  }
  await q('INSERT INTO audit_workflow_history (id, engagement_id, to_stage, action, changed_by) VALUES (?,?,?,?,?)',
    [uuid(), id, 'Planning', 'create', req.user.id]);
  return id;
}

const SELECT = `
  SELECT c.*, pu.full_name AS partner_name, mu.full_name AS manager_name
    FROM clients c
    LEFT JOIN users pu ON pu.id=c.engagement_partner_id
    LEFT JOIN users mu ON mu.id=c.manager_id`;

// List (scoped + optional filters)
router.get('/', requirePermission('client.read'), asyncHandler(async (req, res) => {
  const ids = await scopeClientIds(req.user);
  let where = 'c.deleted_at IS NULL AND c.firm_id=?';
  const params = [req.user.firmId];
  if (ids !== '*') {
    if (ids.length === 0) return res.json({ data: [] });
    where += ` AND c.id IN (${ids.map(() => '?').join(',')})`;
    params.push(...ids);
  }
  if (req.query.category) { where += ' AND c.category=?'; params.push(req.query.category); }
  if (req.query.search) { where += ' AND (c.name ILIKE ? OR c.tin ILIKE ? OR c.vrn ILIKE ?)'; const s = `%${req.query.search}%`; params.push(s, s, s); }
  const rows = await q(`${SELECT} WHERE ${where} ORDER BY c.name`, params);
  res.json({ data: rows });
}));

// Soft-deleted clients (for the Restore view) — Admin/Partner only.
router.get('/deleted', requirePermission('client.delete'), asyncHandler(async (req, res) => {
  const rows = await q(
    `SELECT id, name, category, tin, vrn, deleted_at FROM clients
      WHERE firm_id=? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC`,
    [req.user.firmId]
  );
  res.json({ data: rows });
}));

// Staff options for team-assignment dropdowns (firm staff, excluding clients).
router.get('/staff-options', requirePermission('client.update'), asyncHandler(async (req, res) => {
  const rows = await q(
    "SELECT id, full_name, role FROM users WHERE firm_id=? AND deleted_at IS NULL AND status='active' AND role <> 'Client' ORDER BY full_name",
    [req.user.firmId]);
  res.json({ data: rows });
}));

// Single client + contacts
router.get('/:id', requirePermission('client.read'), asyncHandler(async (req, res) => {
  if (!(await canAccessClient(req.user, req.params.id))) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'No access to this client' } });
  const client = await one(`${SELECT} WHERE c.id=? AND c.firm_id=? AND c.deleted_at IS NULL`, [req.params.id, req.user.firmId]);
  if (!client) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Client not found' } });
  client.contacts = await q('SELECT * FROM client_contacts WHERE client_id=?', [req.params.id]);
  res.json({ data: client });
}));

// Create
router.post('/', requirePermission('client.create'), asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.category) return res.status(400).json({ error: { code: 'BAD_INPUT', message: 'name and category are required' } });
  if (!CLIENT_CATEGORIES.includes(b.category)) return res.status(400).json({ error: { code: 'BAD_INPUT', message: 'Invalid category' } });
  const id = uuid();
  await q(
    `INSERT INTO clients (id, firm_id, name, category, tin, vrn, sector, contact_name, contact_email,
       contact_phone, physical_address, financial_year_end, base_currency, engagement_partner_id, manager_id, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, req.user.firmId, b.name, b.category, b.tin || null, b.vrn || null, b.sector || null,
      b.contact_name || null, b.contact_email || null, b.contact_phone || null, b.physical_address || null,
      b.financial_year_end || null, b.base_currency || 'TZS', b.engagement_partner_id || null,
      b.manager_id || null, b.status || 'Active']
  );
  await logActivity(req, 'create', 'client', id, { name: b.name });
  // Auto-create kickoff engagement so the client shows in the Workflow page right away.
  let engagement_id = null;
  try { engagement_id = await autoCreateEngagement(req, id, b.category, b.engagement_partner_id, b.manager_id); } catch (e) { /* non-fatal */ }
  res.status(201).json({ data: { id, engagement_id } });
}));

// Update
router.patch('/:id', requirePermission('client.update'), asyncHandler(async (req, res) => {
  if (!(await canAccessClient(req.user, req.params.id))) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'No access to this client' } });
  const allowed = ['name', 'category', 'tin', 'vrn', 'sector', 'contact_name', 'contact_email',
    'contact_phone', 'physical_address', 'financial_year_end', 'base_currency',
    'engagement_partner_id', 'manager_id', 'status', 'drive_folder_id', 'is_active'];
  const sets = []; const params = [];
  for (const k of allowed) if (k in (req.body || {})) { sets.push(`${k}=?`); params.push(req.body[k]); }
  if (!sets.length) return res.status(400).json({ error: { code: 'BAD_INPUT', message: 'No updatable fields provided' } });
  params.push(req.params.id, req.user.firmId);
  await q(`UPDATE clients SET ${sets.join(', ')} WHERE id=? AND firm_id=?`, params);
  await logActivity(req, 'update', 'client', req.params.id, req.body);
  res.json({ data: { ok: true } });
}));

// Soft delete (related files, tasks and records are preserved and hidden).
router.delete('/:id', requirePermission('client.delete'), asyncHandler(async (req, res) => {
  await q('UPDATE clients SET deleted_at=NOW(), is_active=0 WHERE id=? AND firm_id=?', [req.params.id, req.user.firmId]);
  await logActivity(req, 'delete', 'client', req.params.id);
  res.json({ data: { ok: true } });
}));

// Restore a soft-deleted client — Admin/Partner only.
router.post('/:id/restore', requirePermission('client.delete'), asyncHandler(async (req, res) => {
  const c = await one('SELECT id FROM clients WHERE id=? AND firm_id=? AND deleted_at IS NOT NULL', [req.params.id, req.user.firmId]);
  if (!c) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No deleted client with that id' } });
  await q('UPDATE clients SET deleted_at=NULL, is_active=1 WHERE id=? AND firm_id=?', [req.params.id, req.user.firmId]);
  await logActivity(req, 'restore', 'client', req.params.id);
  res.json({ data: { ok: true } });
}));

// Related collections
router.get('/:id/engagements', requirePermission('client.read'), asyncHandler(async (req, res) => {
  if (!(await canAccessClient(req.user, req.params.id))) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'No access' } });
  res.json({ data: await q('SELECT * FROM audit_engagements WHERE client_id=? ORDER BY financial_year DESC', [req.params.id]) });
}));

router.get('/:id/documents', requirePermission('client.read'), asyncHandler(async (req, res) => {
  if (!(await canAccessClient(req.user, req.params.id))) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'No access' } });
  res.json({ data: await q('SELECT * FROM documents WHERE client_id=? AND deleted_at IS NULL ORDER BY year DESC, name', [req.params.id]) });
}));

router.get('/:id/obligations', requirePermission('client.read'), asyncHandler(async (req, res) => {
  if (!(await canAccessClient(req.user, req.params.id))) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'No access' } });
  res.json({ data: await q('SELECT * FROM statutory_deadlines WHERE client_id=? ORDER BY due_date', [req.params.id]) });
}));

// ---- Client team (assigned staff) ----
router.get('/:id/team', requirePermission('client.read'), asyncHandler(async (req, res) => {
  if (!(await canAccessClient(req.user, req.params.id))) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'No access' } });
  const rows = await q(
    `SELECT u.id, u.full_name, u.role, u.email, u.phone, u.status, a.access_level
       FROM user_client_access a JOIN users u ON u.id=a.user_id
      WHERE a.client_id=? AND u.deleted_at IS NULL ORDER BY u.full_name`, [req.params.id]);
  res.json({ data: rows });
}));

router.post('/:id/team', requirePermission('client.update'), asyncHandler(async (req, res) => {
  if (!(await canAccessClient(req.user, req.params.id))) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'No access' } });
  const b = req.body || {};
  if (!b.user_id) return res.status(400).json({ error: { code: 'BAD_INPUT', message: 'user_id is required' } });
  const lvl = ['owner', 'editor', 'viewer'].includes(b.access_level) ? b.access_level : 'editor';
  const ex = await one('SELECT id FROM user_client_access WHERE user_id=? AND client_id=?', [b.user_id, req.params.id]);
  if (ex) await q('UPDATE user_client_access SET access_level=? WHERE id=?', [lvl, ex.id]);
  else await q('INSERT INTO user_client_access (id, user_id, client_id, access_level) VALUES (?,?,?,?)', [uuid(), b.user_id, req.params.id, lvl]);
  await logActivity(req, 'assign', 'client', req.params.id, { user_id: b.user_id, access_level: lvl });
  res.json({ data: { ok: true } });
}));

router.delete('/:id/team/:userId', requirePermission('client.update'), asyncHandler(async (req, res) => {
  if (!(await canAccessClient(req.user, req.params.id))) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'No access' } });
  await q('DELETE FROM user_client_access WHERE client_id=? AND user_id=?', [req.params.id, req.params.userId]);
  await logActivity(req, 'unassign', 'client', req.params.id, { user_id: req.params.userId });
  res.json({ data: { ok: true } });
}));

module.exports = router;
