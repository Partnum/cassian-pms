'use strict';
/** Tasks + calendar. Mounted at /api/v1 (requireAuth applied upstream). */
const express = require('express');
const router = express.Router();
const { q, one, uuid } = require('../config');
const { requirePermission, scopeClientIds, logActivity, asyncHandler } = require('../auth');
const { ALL_CLIENT_ROLES } = require('../constants');

const TASK_SELECT = `
  SELECT t.*, c.name AS client_name, u.full_name AS assignee_name
    FROM tasks t LEFT JOIN clients c ON c.id=t.client_id LEFT JOIN users u ON u.id=t.assignee_id`;

// Build a scope clause for tasks based on the user's client access.
async function taskScope(req) {
  if (ALL_CLIENT_ROLES.includes(req.user.role)) return { clause: 't.firm_id=?', params: [req.user.firmId] };
  const ids = await scopeClientIds(req.user);
  const parts = ['t.assignee_id=?', 't.created_by=?'];
  const params = [req.user.id, req.user.id];
  if (ids !== '*' && ids.length) { parts.push(`t.client_id IN (${ids.map(() => '?').join(',')})`); params.push(...ids); }
  return { clause: `t.firm_id=? AND (${parts.join(' OR ')})`, params: [req.user.firmId, ...params] };
}

// List tasks
router.get('/tasks', requirePermission('task.read'), asyncHandler(async (req, res) => {
  const { clause, params } = await taskScope(req);
  let where = clause + ' AND (t.client_id IS NULL OR c.deleted_at IS NULL)'; const p = [...params];
  if (req.query.status) { where += ' AND t.status=?'; p.push(req.query.status); }
  if (req.query.mine === '1') { where += ' AND t.assignee_id=?'; p.push(req.user.id); }
  const rows = await q(`${TASK_SELECT} WHERE ${where} ORDER BY (t.status='done')::int, (t.due_date IS NULL)::int, t.due_date`, p);
  res.json({ data: rows });
}));

router.get('/tasks/:id', requirePermission('task.read'), asyncHandler(async (req, res) => {
  const row = await one(`${TASK_SELECT} WHERE t.id=? AND t.firm_id=?`, [req.params.id, req.user.firmId]);
  if (!row) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Task not found' } });
  res.json({ data: row });
}));

router.post('/tasks', requirePermission('task.create'), asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!b.title) return res.status(400).json({ error: { code: 'BAD_INPUT', message: 'title is required' } });
  const id = uuid();
  await q(
    `INSERT INTO tasks (id, firm_id, title, description, client_id, engagement_id, assignee_id, created_by, priority, status, due_date)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [id, req.user.firmId, b.title, b.description || null, b.client_id || null, b.engagement_id || null,
      b.assignee_id || null, req.user.id, b.priority || 'normal', b.status || 'open', b.due_date || null]
  );
  await logActivity(req, 'create', 'task', id, { title: b.title });
  res.status(201).json({ data: { id } });
}));

router.patch('/tasks/:id', requirePermission('task.update'), asyncHandler(async (req, res) => {
  const allowed = ['title', 'description', 'client_id', 'engagement_id', 'assignee_id', 'priority', 'status', 'due_date'];
  const sets = []; const params = [];
  for (const k of allowed) if (k in (req.body || {})) { sets.push(`${k}=?`); params.push(req.body[k]); }
  if ('status' in (req.body || {})) { sets.push('completed_at=' + (req.body.status === 'done' ? 'NOW()' : 'NULL')); }
  if (!sets.length) return res.status(400).json({ error: { code: 'BAD_INPUT', message: 'No updatable fields' } });
  params.push(req.params.id, req.user.firmId);
  await q(`UPDATE tasks SET ${sets.join(', ')} WHERE id=? AND firm_id=?`, params);
  await logActivity(req, 'update', 'task', req.params.id, req.body);
  res.json({ data: { ok: true } });
}));

router.delete('/tasks/:id', requirePermission('task.delete'), asyncHandler(async (req, res) => {
  await q('DELETE FROM tasks WHERE id=? AND firm_id=?', [req.params.id, req.user.firmId]);
  await logActivity(req, 'delete', 'task', req.params.id);
  res.json({ data: { ok: true } });
}));

// Calendar — merged tasks, statutory obligations and events within a range
router.get('/calendar', requirePermission('task.read'), asyncHandler(async (req, res) => {
  const from = req.query.from || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const to = req.query.to || new Date(new Date().getFullYear(), new Date().getMonth() + 2, 0).toISOString().slice(0, 10);
  const { clause, params } = await taskScope(req);
  const tasks = await q(
    `${TASK_SELECT} WHERE ${clause} AND t.due_date BETWEEN ? AND ? AND t.status<>'done'`,
    [...params, `${from} 00:00:00`, `${to} 23:59:59`]
  );
  const obligations = await q(
    `SELECT o.*, c.name AS client_name FROM statutory_deadlines o JOIN clients c ON c.id=o.client_id
       WHERE o.firm_id=? AND o.due_date BETWEEN ? AND ?`,
    [req.user.firmId, from, to]
  );
  const events = await q('SELECT * FROM calendar_events WHERE firm_id=? AND start_at::date BETWEEN ? AND ?', [req.user.firmId, from, to]);
  const items = [
    ...tasks.map((t) => ({ kind: 'task', id: t.id, title: t.title, date: (t.due_date || '').slice(0, 10), status: t.status, priority: t.priority, client: t.client_name })),
    ...obligations.map((o) => ({ kind: 'obligation', id: o.id, title: `${o.type} — ${o.client_name}`, date: o.due_date, status: o.status, authority: o.authority })),
    ...events.map((e) => ({ kind: 'event', id: e.id, title: e.title, date: (e.start_at || '').slice(0, 10), color: e.color })),
  ].sort((a, b) => (a.date < b.date ? -1 : 1));
  res.json({ data: items });
}));

module.exports = router;
