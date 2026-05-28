'use strict';
/** Tax compliance / statutory obligations. Mounted at /api/v1/tax. */
const express = require('express');
const router = express.Router();
const { q, uuid } = require('../config');
const { requirePermission, scopeClientIds, logActivity, asyncHandler } = require('../auth');
const { OBLIGATION_TYPES, AUTHORITIES } = require('../constants');
const { runReminderScan } = require('../services/notifications.service');

async function scopeClause(req, alias = 'o') {
  const ids = await scopeClientIds(req.user);
  if (ids === '*') return { clause: `${alias}.firm_id=? AND ${alias}.client_id IN (SELECT id FROM clients WHERE deleted_at IS NULL)`, params: [req.user.firmId], empty: false };
  if (ids.length === 0) return { clause: '1=0', params: [], empty: true };
  return { clause: `${alias}.firm_id=? AND ${alias}.client_id IN (${ids.map(() => '?').join(',')})`, params: [req.user.firmId, ...ids], empty: false };
}

// List obligations
router.get('/obligations', requirePermission('tax.read'), asyncHandler(async (req, res) => {
  const { clause, params, empty } = await scopeClause(req);
  if (empty) return res.json({ data: [] });
  let where = clause; const p = [...params];
  if (req.query.status) { where += ' AND o.status=?'; p.push(req.query.status); }
  if (req.query.type) { where += ' AND o.type=?'; p.push(req.query.type); }
  const rows = await q(
    `SELECT o.*, c.name AS client_name FROM statutory_deadlines o JOIN clients c ON c.id=o.client_id
      WHERE ${where} ORDER BY o.due_date`, p
  );
  res.json({ data: rows });
}));

// Summary counts (tax dashboard)
router.get('/summary', requirePermission('tax.read'), asyncHandler(async (req, res) => {
  const { clause, params, empty } = await scopeClause(req);
  if (empty) return res.json({ data: { byStatus: [], byType: [] } });
  const byStatus = await q(`SELECT o.status, COUNT(*)::int AS n FROM statutory_deadlines o WHERE ${clause} GROUP BY o.status`, params);
  const byType = await q(`SELECT o.type, COUNT(*)::int AS n, COUNT(*) FILTER (WHERE o.status='overdue')::int AS overdue FROM statutory_deadlines o WHERE ${clause} GROUP BY o.type`, params);
  res.json({ data: { byStatus, byType } });
}));

// Create obligation
router.post('/obligations', requirePermission('tax.update'), asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!b.client_id || !b.type || !b.due_date) return res.status(400).json({ error: { code: 'BAD_INPUT', message: 'client_id, type and due_date are required' } });
  if (!OBLIGATION_TYPES.includes(b.type)) return res.status(400).json({ error: { code: 'BAD_INPUT', message: 'Invalid obligation type' } });
  const id = uuid();
  await q(
    `INSERT INTO statutory_deadlines (id, firm_id, client_id, type, authority, period, due_date, status, amount)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [id, req.user.firmId, b.client_id, b.type, AUTHORITIES.includes(b.authority) ? b.authority : 'TRA',
      b.period || null, b.due_date, b.status || 'upcoming', b.amount || null]
  );
  await logActivity(req, 'create', 'obligation', id, { type: b.type });
  res.status(201).json({ data: { id } });
}));

// Update / mark filed
router.patch('/obligations/:id', requirePermission('tax.update'), asyncHandler(async (req, res) => {
  const b = req.body || {};
  const sets = []; const params = [];
  ['status', 'period', 'due_date', 'reference_no', 'amount'].forEach((k) => { if (k in b) { sets.push(`${k}=?`); params.push(b[k]); } });
  if (b.status === 'filed') { sets.push('filed_at=NOW()'); }
  if (!sets.length) return res.status(400).json({ error: { code: 'BAD_INPUT', message: 'No updatable fields' } });
  params.push(req.params.id, req.user.firmId);
  await q(`UPDATE statutory_deadlines SET ${sets.join(', ')} WHERE id=? AND firm_id=?`, params);
  await logActivity(req, 'update', 'obligation', req.params.id, b);
  res.json({ data: { ok: true } });
}));

// Bulk-generate standard Tanzanian monthly statutory obligations for every active client.
// Body: { period?: 'YYYY-MM', client_id?: <uuid> }   (defaults: next month, all firm clients)
// Creates PAYE/SDL/NSSF/WCF for every client, plus VAT for VRN-registered clients.
router.post('/obligations/generate-monthly', requirePermission('tax.update'), asyncHandler(async (req, res) => {
  const b = req.body || {};
  let period = b.period;
  if (!period) {
    const d = new Date(); d.setMonth(d.getMonth() + 1);
    period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) return res.status(400).json({ error: { code: 'BAD_INPUT', message: 'period must look like YYYY-MM' } });
  const year = Number(m[1]), monthIdx = Number(m[2]) - 1;
  const due = (day) => new Date(year, monthIdx + 1, day).toISOString().slice(0, 10);
  const lastDayNext = new Date(year, monthIdx + 2, 0).toISOString().slice(0, 10);

  const clauseSel = b.client_id
    ? { sql: 'firm_id=? AND deleted_at IS NULL AND id=?', params: [req.user.firmId, b.client_id] }
    : { sql: 'firm_id=? AND deleted_at IS NULL AND is_active=1', params: [req.user.firmId] };
  const clients = await q(`SELECT id, name, vrn FROM clients WHERE ${clauseSel.sql}`, clauseSel.params);

  const plan = (c) => {
    const items = [
      { type: 'PAYE', authority: 'TRA', due: due(7) },
      { type: 'SDL', authority: 'TRA', due: due(7) },
      { type: 'NSSF', authority: 'NSSF', due: lastDayNext },
      { type: 'WCF', authority: 'WCF', due: lastDayNext },
    ];
    if (c.vrn) items.push({ type: 'VAT', authority: 'TRA', due: due(20) });
    return items;
  };

  let created = 0, skipped = 0;
  for (const c of clients) {
    for (const it of plan(c)) {
      const ex = await q(
        'SELECT id FROM statutory_deadlines WHERE firm_id=? AND client_id=? AND type=? AND period=?',
        [req.user.firmId, c.id, it.type, period]
      );
      if (ex.length) { skipped += 1; continue; }
      await q(
        `INSERT INTO statutory_deadlines (id, firm_id, client_id, type, authority, period, due_date, status)
         VALUES (?,?,?,?,?,?,?,?)`,
        [uuid(), req.user.firmId, c.id, it.type, it.authority, period, it.due, 'upcoming']
      );
      created += 1;
    }
  }
  await logActivity(req, 'generate', 'obligations', null, { period, clients: clients.length, created, skipped });
  res.json({ data: { period, clients: clients.length, created, skipped } });
}));

// Manually run the reminder scan (Admin / Partner)
router.post('/scan', asyncHandler(async (req, res) => {
  if (!['Admin', 'Partner'].includes(req.user.role)) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Admin/Partner only' } });
  const summary = await runReminderScan();
  await logActivity(req, 'run', 'reminder_scan', null, summary);
  res.json({ data: summary });
}));

module.exports = router;
