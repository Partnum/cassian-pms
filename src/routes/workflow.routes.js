'use strict';
/**
 * Engagements + audit workflow engine (PostgreSQL). Mounted at /api/v1/engagements.
 * Status flow: Planning -> Engagement Letter -> Fieldwork -> Manager Review
 *  -> Partner Review -> Draft Financial Report -> Client Sign-off -> ROI Submission -> Completed
 * Completing Manager Review needs workflow.manager_review; completing Partner
 * Review (and Completion) needs workflow.partner_review.
 */
const express = require('express');
const router = express.Router();
const { q, one, uuid } = require('../config');
const { requirePermission, scopeClientIds, canAccessClient, logActivity, asyncHandler } = require('../auth');
const { WORKFLOW_STAGES, STAGE_GATES, stageIndex, hasPermission } = require('../constants');

const ENG_SELECT = `
  SELECT e.*, c.name AS client_name, c.category AS client_category,
         mu.full_name AS manager_name, pu.full_name AS partner_name
    FROM audit_engagements e
    JOIN clients c ON c.id=e.client_id
    LEFT JOIN users mu ON mu.id=e.manager_id
    LEFT JOIN users pu ON pu.id=e.partner_id`;

async function loadAccessible(req, id) {
  const eng = await one(`${ENG_SELECT} WHERE e.id=? AND e.firm_id=?`, [id, req.user.firmId]);
  if (!eng) return { error: 404 };
  if (!(await canAccessClient(req.user, eng.client_id))) return { error: 403 };
  return { eng };
}

function progressFor(index) {
  return Math.round((index / (WORKFLOW_STAGES.length - 1)) * 100);
}

router.get('/', requirePermission('engagement.read'), asyncHandler(async (req, res) => {
  const ids = await scopeClientIds(req.user);
  let where = 'e.firm_id=? AND c.deleted_at IS NULL'; const params = [req.user.firmId];
  if (ids !== '*') {
    if (ids.length === 0) return res.json({ data: [] });
    where += ` AND e.client_id IN (${ids.map(() => '?').join(',')})`;
    params.push(...ids);
  }
  if (req.query.client_id) { where += ' AND e.client_id=?'; params.push(req.query.client_id); }
  const rows = await q(`${ENG_SELECT} WHERE ${where} ORDER BY e.target_completion`, params);
  res.json({ data: rows });
}));

router.get('/meta/stages', requirePermission('engagement.read'), (req, res) => {
  res.json({ data: { stages: WORKFLOW_STAGES, gates: STAGE_GATES } });
});

router.get('/:id', requirePermission('engagement.read'), asyncHandler(async (req, res) => {
  const { eng, error } = await loadAccessible(req, req.params.id);
  if (error) return res.status(error).json({ error: { code: 'NO_ACCESS', message: 'Not found or no access' } });
  eng.stages = await q('SELECT * FROM audit_stages WHERE engagement_id=? ORDER BY sequence', [req.params.id]);
  eng.history = await q(
    `SELECT h.*, u.full_name AS changed_by_name FROM audit_workflow_history h
       LEFT JOIN users u ON u.id=h.changed_by WHERE engagement_id=? ORDER BY created_at DESC`,
    [req.params.id]
  );
  res.json({ data: eng });
}));

router.post('/', requirePermission('engagement.update'), asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!b.client_id) return res.status(400).json({ error: { code: 'BAD_INPUT', message: 'client_id is required' } });
  if (!(await canAccessClient(req.user, b.client_id))) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'No access to this client' } });
  const id = uuid();
  await q(
    `INSERT INTO audit_engagements (id, firm_id, client_id, type, financial_year, period_start, period_end,
       partner_id, manager_id, status, current_stage, progress_pct, fee_amount, fee_currency, planned_start, target_completion)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, req.user.firmId, b.client_id, b.type || 'Audit', b.financial_year || null, b.period_start || null,
      b.period_end || null, b.partner_id || null, b.manager_id || null, 'In progress', 'Planning', 0,
      b.fee_amount || null, b.fee_currency || 'TZS', b.planned_start || null, b.target_completion || null]
  );
  for (let i = 0; i < WORKFLOW_STAGES.length; i++) {
    await q(
      'INSERT INTO audit_stages (id, engagement_id, sequence, name, status, progress_pct) VALUES (?,?,?,?,?,?)',
      [uuid(), id, i + 1, WORKFLOW_STAGES[i], i === 0 ? 'in_progress' : 'not_started', 0]
    );
  }
  await q('INSERT INTO audit_workflow_history (id, engagement_id, to_stage, action, changed_by) VALUES (?,?,?,?,?)',
    [uuid(), id, 'Planning', 'create', req.user.id]);
  await logActivity(req, 'create', 'engagement', id, { client_id: b.client_id });
  res.status(201).json({ data: { id } });
}));

router.patch('/:id', requirePermission('engagement.update'), asyncHandler(async (req, res) => {
  const { eng, error } = await loadAccessible(req, req.params.id);
  if (error) return res.status(error).json({ error: { code: 'NO_ACCESS', message: 'Not found or no access' } });
  const allowed = ['status', 'manager_id', 'partner_id', 'progress_pct', 'target_completion', 'fee_amount'];
  const sets = []; const params = [];
  for (const k of allowed) if (k in (req.body || {})) { sets.push(`${k}=?`); params.push(req.body[k]); }
  if (!sets.length) return res.status(400).json({ error: { code: 'BAD_INPUT', message: 'No updatable fields' } });
  params.push(eng.id);
  await q(`UPDATE audit_engagements SET ${sets.join(', ')} WHERE id=?`, params);
  res.json({ data: { ok: true } });
}));

router.patch('/:id/stages/:stageId', requirePermission('engagement.update'), asyncHandler(async (req, res) => {
  const { error } = await loadAccessible(req, req.params.id);
  if (error) return res.status(error).json({ error: { code: 'NO_ACCESS', message: 'Not found or no access' } });
  const allowed = ['status', 'progress_pct', 'responsible_user_id', 'notes', 'due_date'];
  const sets = []; const params = [];
  for (const k of allowed) if (k in (req.body || {})) { sets.push(`${k}=?`); params.push(req.body[k]); }
  if (!sets.length) return res.status(400).json({ error: { code: 'BAD_INPUT', message: 'No updatable fields' } });
  params.push(req.params.stageId, req.params.id);
  await q(`UPDATE audit_stages SET ${sets.join(', ')} WHERE id=? AND engagement_id=?`, params);
  res.json({ data: { ok: true } });
}));

router.post('/:id/advance', requirePermission('workflow.advance'), asyncHandler(async (req, res) => {
  const { eng, error } = await loadAccessible(req, req.params.id);
  if (error) return res.status(error).json({ error: { code: 'NO_ACCESS', message: 'Not found or no access' } });
  const ci = Math.max(0, stageIndex(eng.current_stage));
  if (ci >= WORKFLOW_STAGES.length - 1) return res.status(400).json({ error: { code: 'AT_END', message: 'Engagement is already at the final stage' } });
  const target = WORKFLOW_STAGES[ci + 1];
  const perm = STAGE_GATES[target] || 'workflow.advance';
  if (!hasPermission(req.user.role, perm)) {
    return res.status(403).json({ error: { code: 'GATE', message: `Advancing to "${target}" requires permission: ${perm}` } });
  }
  await q("UPDATE audit_stages SET status='completed', progress_pct=100, completed_at=NOW() WHERE engagement_id=? AND name=?", [eng.id, eng.current_stage]);
  await q("UPDATE audit_stages SET status='in_progress', started_at=COALESCE(started_at, NOW()) WHERE engagement_id=? AND name=?", [eng.id, target]);
  const newProg = progressFor(ci + 1);
  const newStatus = target === 'Completed' ? 'Completed' : (eng.status || 'In progress');
  if (target === 'Completed') await q("UPDATE audit_stages SET status='completed', progress_pct=100, completed_at=NOW() WHERE engagement_id=? AND name='Completed'", [eng.id]);
  await q('UPDATE audit_engagements SET current_stage=?, progress_pct=?, status=? WHERE id=?', [target, newProg, newStatus, eng.id]);
  await q('INSERT INTO audit_workflow_history (id, engagement_id, from_stage, to_stage, action, changed_by, note) VALUES (?,?,?,?,?,?,?)',
    [uuid(), eng.id, eng.current_stage, target, 'advance', req.user.id, (req.body && req.body.note) || null]);
  await logActivity(req, 'advance', 'engagement', eng.id, { from: eng.current_stage, to: target });
  res.json({ data: { current_stage: target, progress_pct: newProg } });
}));

router.post('/:id/revert', requirePermission('workflow.advance'), asyncHandler(async (req, res) => {
  const { eng, error } = await loadAccessible(req, req.params.id);
  if (error) return res.status(error).json({ error: { code: 'NO_ACCESS', message: 'Not found or no access' } });
  const ci = stageIndex(eng.current_stage);
  if (ci <= 0) return res.status(400).json({ error: { code: 'AT_START', message: 'Already at the first stage' } });
  const target = WORKFLOW_STAGES[ci - 1];
  await q("UPDATE audit_stages SET status='not_started', progress_pct=0, completed_at=NULL WHERE engagement_id=? AND name=?", [eng.id, eng.current_stage]);
  await q("UPDATE audit_stages SET status='in_progress', completed_at=NULL WHERE engagement_id=? AND name=?", [eng.id, target]);
  const newProg = progressFor(ci - 1);
  await q("UPDATE audit_engagements SET current_stage=?, progress_pct=?, status='In progress' WHERE id=?", [target, newProg, eng.id]);
  await q('INSERT INTO audit_workflow_history (id, engagement_id, from_stage, to_stage, action, changed_by, note) VALUES (?,?,?,?,?,?,?)',
    [uuid(), eng.id, eng.current_stage, target, 'revert', req.user.id, (req.body && req.body.note) || null]);
  await logActivity(req, 'revert', 'engagement', eng.id, { from: eng.current_stage, to: target });
  res.json({ data: { current_stage: target, progress_pct: newProg } });
}));

module.exports = router;
