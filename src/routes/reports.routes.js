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

  res.json({
    data: {
      kpis: { activeClients, deadlines7, pendingReviews, overdueTasks, revenue: Number(revRow.total), avgCompletion: Math.round(Number(compRow.avg)) },
      clientMix, revenueByCategory, auditProgress, compliance, deadlines, feed, unread,
    },
  });
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
