'use strict';
/** Time tracking / timesheets + client profitability. Mounted at /api/v1/timesheets. */
const express = require('express');
const router = express.Router();
const { q, one, uuid } = require('../config');
const { logActivity, asyncHandler } = require('../auth');

const bad = (res, m) => res.status(400).json({ error: { code: 'BAD_INPUT', message: m } });
const isManagerUp = (req) => ['Admin', 'Partner', 'Manager'].includes(req.user.role);
function managerGuard(req, res, next) {
  if (!isManagerUp(req)) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Manager, Partner or Admin only' } });
  return next();
}

// Log my own time.
router.post('/', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const hours = Number(b.hours || 0);
  if (!b.work_date) return bad(res, 'work_date is required');
  if (!(hours > 0 && hours <= 24)) return bad(res, 'hours must be between 0 and 24');
  if (b.client_id) {
    const c = await one('SELECT id FROM clients WHERE id=? AND firm_id=?', [b.client_id, req.user.firmId]);
    if (!c) return bad(res, 'Client not found');
  }
  const id = uuid();
  await q(
    `INSERT INTO time_entries (id, firm_id, user_id, client_id, task_id, work_date, hours, billable, description)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [id, req.user.firmId, req.user.id, b.client_id || null, b.task_id || null, b.work_date, hours,
      b.billable === 0 || b.billable === false ? 0 : 1, b.description || null]);
  await logActivity(req, 'log_time', 'time_entry', id, { hours });
  res.status(201).json({ data: { id } });
}));

// My entries.
router.get('/mine', asyncHandler(async (req, res) => {
  let where = 't.firm_id=? AND t.user_id=?'; const p = [req.user.firmId, req.user.id];
  if (req.query.from) { where += ' AND t.work_date>=?'; p.push(req.query.from); }
  if (req.query.to) { where += ' AND t.work_date<=?'; p.push(req.query.to); }
  const rows = await q(
    `SELECT t.id, t.work_date, t.hours, t.billable, t.description, c.name AS client_name
       FROM time_entries t LEFT JOIN clients c ON c.id=t.client_id
      WHERE ${where} ORDER BY t.work_date DESC, t.created_at DESC`, p);
  res.json({ data: rows });
}));

// All firm entries (managers).
router.get('/', managerGuard, asyncHandler(async (req, res) => {
  let where = 't.firm_id=?'; const p = [req.user.firmId];
  if (req.query.from) { where += ' AND t.work_date>=?'; p.push(req.query.from); }
  if (req.query.to) { where += ' AND t.work_date<=?'; p.push(req.query.to); }
  if (req.query.user_id) { where += ' AND t.user_id=?'; p.push(req.query.user_id); }
  if (req.query.client_id) { where += ' AND t.client_id=?'; p.push(req.query.client_id); }
  const rows = await q(
    `SELECT t.id, t.work_date, t.hours, t.billable, t.description,
            u.full_name AS staff, c.name AS client_name
       FROM time_entries t JOIN users u ON u.id=t.user_id LEFT JOIN clients c ON c.id=t.client_id
      WHERE ${where} ORDER BY t.work_date DESC LIMIT 500`, p);
  res.json({ data: rows });
}));

// Summary + client profitability (managers).
router.get('/summary', managerGuard, asyncHandler(async (req, res) => {
  const f = [req.user.firmId];
  const byUser = await q(
    `SELECT u.full_name AS staff,
            COALESCE(SUM(t.hours),0) AS hours,
            COALESCE(SUM(t.hours) FILTER (WHERE t.billable=1),0) AS billable_hours
       FROM time_entries t JOIN users u ON u.id=t.user_id
      WHERE t.firm_id=? GROUP BY u.full_name ORDER BY hours DESC`, f);
  // Per-client: logged hours vs invoiced revenue = profitability view.
  const byClient = await q(
    `SELECT c.name AS client,
            COALESCE(SUM(t.hours),0) AS hours,
            COALESCE(SUM(t.hours) FILTER (WHERE t.billable=1),0) AS billable_hours,
            COALESCE((SELECT SUM(i.total) FROM invoices i
                       WHERE i.client_id=c.id AND i.firm_id=? AND i.status IN ('open','paid')),0) AS invoiced
       FROM clients c LEFT JOIN time_entries t ON t.client_id=c.id AND t.firm_id=?
      WHERE c.firm_id=? AND c.deleted_at IS NULL
      GROUP BY c.id, c.name
      HAVING COALESCE(SUM(t.hours),0) > 0
          OR COALESCE((SELECT SUM(i.total) FROM invoices i WHERE i.client_id=c.id AND i.firm_id=? AND i.status IN ('open','paid')),0) > 0
      ORDER BY invoiced DESC`, [req.user.firmId, req.user.firmId, req.user.firmId, req.user.firmId]);
  const totals = await one(
    `SELECT COALESCE(SUM(hours),0) AS hours, COALESCE(SUM(hours) FILTER (WHERE billable=1),0) AS billable_hours
       FROM time_entries WHERE firm_id=?`, f);
  res.json({ data: { byUser, byClient, totals } });
}));

// Delete own entry (Admin/Partner may delete any).
router.delete('/:id', asyncHandler(async (req, res) => {
  const t = await one('SELECT * FROM time_entries WHERE id=? AND firm_id=?', [req.params.id, req.user.firmId]);
  if (!t) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Entry not found' } });
  if (t.user_id !== req.user.id && !['Admin', 'Partner'].includes(req.user.role)) {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You can only delete your own entries' } });
  }
  await q('DELETE FROM time_entries WHERE id=?', [req.params.id]);
  res.json({ data: { ok: true } });
}));

module.exports = router;
