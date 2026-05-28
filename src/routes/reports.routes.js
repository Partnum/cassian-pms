'use strict';
/** Dashboard & analytics (PostgreSQL). Mounted at /api/v1/reports. */
const express = require('express');
const router = express.Router();
const { q, one } = require('../config');
const { requirePermission, scopeClientIds, asyncHandler } = require('../auth');

function inClause(field, ids) {
  if (ids === '*') return { sql: `${field} IN (SELECT id FROM clients WHERE deleted_at IS NULL)`, params: [] };
  if (!ids.length) return { sql: '1=0', params: [] };
  return { sql: `${field} IN (${ids.map(() => '?').join(',')})`, params: ids };
}

router.get('/dashboard', asyncHandler(async (req, res) => {
  const firmId = req.user.firmId;
  const ids = await scopeClientIds(req.user);
  const cc = inClause('c.id', ids);
  const ec = inClause('e.client_id', ids);
  const oc = inClause('o.client_id', ids);

  const activeClients = (await one(`SELECT COUNT(*)::int n FROM clients c WHERE c.firm_id=? AND c.deleted_at IS NULL AND c.is_active=1 AND ${cc.sql}`, [firmId, ...cc.params])).n;
  const deadlines7 = (await one(`SELECT COUNT(*)::int n FROM statutory_deadlines o WHERE o.firm_id=? AND o.status NOT IN ('filed','exempt') AND o.due_date BETWEEN CURRENT_DATE AND (CURRENT_DATE + INTERVAL '7 days') AND ${oc.sql}`, [firmId, ...oc.params])).n;
  const pendingReviews = (await one(`SELECT COUNT(*)::int n FROM audit_engagements e WHERE e.firm_id=? AND e.current_stage IN ('Manager Review','Partner Review') AND ${ec.sql}`, [firmId, ...ec.params])).n;

  let overdueTasks;
  if (ids === '*') {
    overdueTasks = (await one("SELECT COUNT(*)::int n FROM tasks WHERE firm_id=? AND status IN ('open','in_progress') AND due_date < NOW()", [firmId])).n;
  } else {
    const tc = inClause('client_id', ids);
    overdueTasks = (await one(`SELECT COUNT(*)::int n FROM tasks WHERE firm_id=? AND status IN ('open','in_progress') AND due_date < NOW() AND (assignee_id=? OR ${tc.sql})`, [firmId, req.user.id, ...tc.params])).n;
  }

  const revRow = await one(`SELECT COALESCE(SUM(e.fee_amount),0) total FROM audit_engagements e WHERE e.firm_id=? AND ${ec.sql}`, [firmId, ...ec.params]);
  const compRow = await one(`SELECT COALESCE(AVG(e.progress_pct),0) avg FROM audit_engagements e WHERE e.firm_id=? AND e.type='Audit' AND ${ec.sql}`, [firmId, ...ec.params]);

  const clientMix = await q(`SELECT c.category, COUNT(*)::int n FROM clients c WHERE c.firm_id=? AND c.deleted_at IS NULL AND ${cc.sql} GROUP BY c.category`, [firmId, ...cc.params]);
  const revenueByCategory = await q(
    `SELECT c.category, COALESCE(SUM(c2.fee),0) total
       FROM clients c
       LEFT JOIN (SELECT e.client_id, SUM(e.fee_amount) fee FROM audit_engagements e GROUP BY e.client_id) c2 ON c2.client_id=c.id
      WHERE c.firm_id=? AND ${cc.sql} GROUP BY c.category`, [firmId, ...cc.params]
  );
  const auditProgress = await q(
    `SELECT e.id, e.current_stage, e.progress_pct, c.name AS client_name, mu.full_name AS manager_name
       FROM audit_engagements e JOIN clients c ON c.id=e.client_id LEFT JOIN users mu ON mu.id=e.manager_id
      WHERE e.firm_id=? AND e.type='Audit' AND ${ec.sql} ORDER BY e.progress_pct DESC LIMIT 8`,
    [firmId, ...ec.params]
  );
  const compliance = await q(`SELECT o.status, COUNT(*)::int n FROM statutory_deadlines o WHERE o.firm_id=? AND ${oc.sql} GROUP BY o.status`, [firmId, ...oc.params]);
  const deadlines = await q(
    `SELECT o.type, o.authority, o.due_date, o.status, c.name AS client_name
       FROM statutory_deadlines o JOIN clients c ON c.id=o.client_id
      WHERE o.firm_id=? AND o.status NOT IN ('filed','exempt') AND ${oc.sql}
      ORDER BY o.due_date LIMIT 8`,
    [firmId, ...oc.params]
  );
  const feed = await q(
    `SELECT a.action, a.entity_type, a.created_at, u.full_name AS user_name
       FROM activity_log a LEFT JOIN users u ON u.id=a.user_id
      WHERE a.firm_id=? ORDER BY a.created_at DESC LIMIT 8`,
    [firmId]
  );
  const unread = (await one('SELECT COUNT(*)::int n FROM notifications WHERE user_id=? AND is_read=0', [req.user.id])).n;

  // ---- Personalised "my work" section (per logged-in user) ----
  const myOpenTasks = (await one(
    "SELECT COUNT(*)::int n FROM tasks WHERE firm_id=? AND assignee_id=? AND status IN ('open','in_progress')",
    [firmId, req.user.id])).n;
  const myOverdueTasks = (await one(
    "SELECT COUNT(*)::int n FROM tasks WHERE firm_id=? AND assignee_id=? AND status IN ('open','in_progress') AND due_date < NOW()",
    [firmId, req.user.id])).n;
  const myReviews = (await one(
    "SELECT COUNT(*)::int n FROM tasks WHERE firm_id=? AND reviewer_id=? AND status IN ('open','in_progress')",
    [firmId, req.user.id])).n;
  const myClients = (await one(
    `SELECT COUNT(DISTINCT cid)::int n FROM (
       SELECT id AS cid FROM clients WHERE firm_id=? AND deleted_at IS NULL AND (manager_id=? OR engagement_partner_id=?)
       UNION
       SELECT client_id AS cid FROM user_client_access WHERE user_id=?
     ) x`,
    [firmId, req.user.id, req.user.id, req.user.id])).n;
  const myTasks = await q(
    `SELECT t.id, t.title, t.priority, t.status, t.due_date, c.name AS client_name
       FROM tasks t LEFT JOIN clients c ON c.id=t.client_id
      WHERE t.firm_id=? AND t.assignee_id=? AND t.status IN ('open','in_progress')
      ORDER BY (t.due_date IS NULL)::int, t.due_date LIMIT 6`,
    [firmId, req.user.id]);

  res.json({
    data: {
      user: { name: req.user.fullName, role: req.user.role },
      kpis: { activeClients, deadlines7, pendingReviews, overdueTasks, revenue: Number(revRow.total), avgCompletion: Math.round(Number(compRow.avg)) },
      myWork: { myOpenTasks, myOverdueTasks, myReviews, myClients, myTasks },
      clientMix, revenueByCategory, auditProgress, compliance, deadlines, feed, unread,
    },
  });
}));

// Activity log feed (paginated, filterable). Admin / Partner / Manager only.
router.get('/activity', asyncHandler(async (req, res) => {
  if (!['Admin', 'Partner', 'Manager'].includes(req.user.role)) {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Manager+ required' } });
  }
  const limit = Math.min(Math.max(parseInt(req.query.limit || '50', 10), 1), 200);
  const offset = Math.max(parseInt(req.query.offset || '0', 10), 0);
  let where = 'a.firm_id=?';
  const params = [req.user.firmId];
  if (req.query.user_id) { where += ' AND a.user_id=?'; params.push(req.query.user_id); }
  if (req.query.entity_type) { where += ' AND a.entity_type=?'; params.push(req.query.entity_type); }
  if (req.query.action) { where += ' AND a.action=?'; params.push(req.query.action); }
  if (req.query.from) { where += ' AND a.created_at::date >= ?'; params.push(req.query.from); }
  if (req.query.to) { where += ' AND a.created_at::date <= ?'; params.push(req.query.to); }
  const rows = await q(
    `SELECT a.id, a.action, a.entity_type, a.entity_id, a.detail, a.ip_address, a.created_at,
            u.full_name AS user_name, u.role AS user_role
       FROM activity_log a LEFT JOIN users u ON u.id=a.user_id
      WHERE ${where} ORDER BY a.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    params
  );
  const total = (await one(`SELECT COUNT(*)::int n FROM activity_log a WHERE ${where}`, params)).n;
  res.json({ data: rows, meta: { total, limit, offset } });
}));

router.get('/productivity', requirePermission('report.read'), asyncHandler(async (req, res) => {
  const rows = await q(
    `SELECT u.full_name, u.role,
            COUNT(t.id) FILTER (WHERE t.status IN ('open','in_progress'))::int AS active_tasks,
            COUNT(t.id) FILTER (WHERE t.status='done')::int AS completed_tasks
       FROM users u LEFT JOIN tasks t ON t.assignee_id=u.id
      WHERE u.firm_id=? AND u.deleted_at IS NULL
      GROUP BY u.id, u.full_name, u.role ORDER BY active_tasks DESC`,
    [req.user.firmId]
  );
  res.json({ data: rows });
}));

module.exports = router;
