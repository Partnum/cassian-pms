'use strict';
/** Audit working papers / lead schedules. Mounted at /api/v1/workpapers. */
const express = require('express');
const router = express.Router();
const { q, one, uuid } = require('../config');
const { requirePermission, canAccessClient, logActivity, asyncHandler } = require('../auth');

const bad = (res, m) => res.status(400).json({ error: { code: 'BAD_INPUT', message: m } });
const deny = (res) => res.status(403).json({ error: { code: 'FORBIDDEN', message: 'No access to this engagement' } });
const canReview = (req) => ['Admin', 'Partner', 'Manager'].includes(req.user.role);

// Standard audit index (lead schedules).
const STANDARD_INDEX = [
  ['P', 'Planning & risk assessment', 'Planning'],
  ['A', 'Cash and bank', 'Balance sheet'],
  ['B', 'Trade receivables', 'Balance sheet'],
  ['C', 'Inventory', 'Balance sheet'],
  ['D', 'Property, plant & equipment', 'Balance sheet'],
  ['E', 'Investments', 'Balance sheet'],
  ['F', 'Trade payables', 'Balance sheet'],
  ['G', 'Borrowings', 'Balance sheet'],
  ['H', 'Equity', 'Balance sheet'],
  ['J', 'Revenue', 'Profit or loss'],
  ['K', 'Cost of sales', 'Profit or loss'],
  ['L', 'Operating expenses', 'Profit or loss'],
  ['M', 'Payroll', 'Profit or loss'],
  ['N', 'Taxation', 'Profit or loss'],
  ['X', 'Completion & review', 'Completion'],
];

async function loadEngagement(req, engId) {
  if (!engId) return null;
  const eng = await one('SELECT id, client_id FROM audit_engagements WHERE id=? AND firm_id=?', [engId, req.user.firmId]);
  if (!eng) return null;
  if (eng.client_id && !(await canAccessClient(req.user, eng.client_id))) return null;
  return eng;
}

// List working papers for an engagement.
router.get('/', requirePermission('engagement.read'), asyncHandler(async (req, res) => {
  const eng = await loadEngagement(req, req.query.engagement_id);
  if (!eng) return deny(res);
  const rows = await q(
    `SELECT w.id, w.reference, w.title, w.section, w.status, w.conclusion, w.notes,
            w.prepared_at, w.reviewed_at, pu.full_name AS prepared_by, ru.full_name AS reviewed_by
       FROM working_papers w
       LEFT JOIN users pu ON pu.id=w.prepared_by
       LEFT JOIN users ru ON ru.id=w.reviewed_by
      WHERE w.engagement_id=? ORDER BY w.reference`, [eng.id]);
  res.json({ data: rows });
}));

// Create a working paper.
router.post('/', requirePermission('engagement.update'), asyncHandler(async (req, res) => {
  const b = req.body || {};
  const eng = await loadEngagement(req, b.engagement_id);
  if (!eng) return deny(res);
  if (!b.reference || !b.title) return bad(res, 'reference and title are required');
  const id = uuid();
  await q(
    `INSERT INTO working_papers (id, firm_id, engagement_id, reference, title, section)
     VALUES (?,?,?,?,?,?)`,
    [id, req.user.firmId, eng.id, String(b.reference).toUpperCase(), b.title, b.section || null]);
  await logActivity(req, 'create', 'working_paper', id, { reference: b.reference });
  res.status(201).json({ data: { id } });
}));

// Generate the standard index (skips references that already exist).
router.post('/generate', requirePermission('engagement.update'), asyncHandler(async (req, res) => {
  const eng = await loadEngagement(req, (req.body || {}).engagement_id || req.query.engagement_id);
  if (!eng) return deny(res);
  const existing = (await q('SELECT reference FROM working_papers WHERE engagement_id=?', [eng.id])).map((r) => r.reference);
  let created = 0;
  for (const [ref, title, section] of STANDARD_INDEX) {
    if (existing.includes(ref)) continue;
    await q(`INSERT INTO working_papers (id, firm_id, engagement_id, reference, title, section) VALUES (?,?,?,?,?,?)`,
      [uuid(), req.user.firmId, eng.id, ref, title, section]);
    created += 1;
  }
  await logActivity(req, 'generate', 'working_paper', eng.id, { created });
  res.json({ data: { created } });
}));

// Update a working paper (status / conclusion / notes). Sign-off rules enforced.
router.patch('/:id', requirePermission('engagement.update'), asyncHandler(async (req, res) => {
  const wp = await one('SELECT * FROM working_papers WHERE id=? AND firm_id=?', [req.params.id, req.user.firmId]);
  if (!wp) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Working paper not found' } });
  const eng = await loadEngagement(req, wp.engagement_id);
  if (!eng) return deny(res);
  const b = req.body || {};
  const sets = []; const params = [];
  if (b.title != null) { sets.push('title=?'); params.push(b.title); }
  if ('conclusion' in b) { sets.push('conclusion=?'); params.push(b.conclusion); }
  if ('notes' in b) { sets.push('notes=?'); params.push(b.notes); }
  if (b.status) {
    if (!['not_started', 'in_progress', 'prepared', 'reviewed'].includes(b.status)) return bad(res, 'Invalid status');
    if (b.status === 'reviewed' && !canReview(req)) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only Manager/Partner can review' } });
    sets.push('status=?'); params.push(b.status);
    if (b.status === 'prepared') { sets.push('prepared_by=?', 'prepared_at=NOW()'); params.push(req.user.id); }
    if (b.status === 'reviewed') { sets.push('reviewed_by=?', 'reviewed_at=NOW()'); params.push(req.user.id); }
  }
  if (!sets.length) return bad(res, 'No updatable fields');
  params.push(req.params.id);
  await q(`UPDATE working_papers SET ${sets.join(', ')} WHERE id=?`, params);
  await logActivity(req, 'update', 'working_paper', req.params.id, { status: b.status });
  res.json({ data: { ok: true } });
}));

router.delete('/:id', requirePermission('engagement.update'), asyncHandler(async (req, res) => {
  const wp = await one('SELECT engagement_id FROM working_papers WHERE id=? AND firm_id=?', [req.params.id, req.user.firmId]);
  if (!wp) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Working paper not found' } });
  const eng = await loadEngagement(req, wp.engagement_id);
  if (!eng) return deny(res);
  await q('DELETE FROM working_papers WHERE id=?', [req.params.id]);
  res.json({ data: { ok: true } });
}));

module.exports = router;
