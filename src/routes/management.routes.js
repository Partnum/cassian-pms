'use strict';
/** Executive / management KPIs. Mounted at /api/v1/management. */
const express = require('express');
const router = express.Router();
const { q, one } = require('../config');
const { asyncHandler } = require('../auth');

const guard = (req, res, next) => {
  if (!['Admin', 'Partner', 'Manager'].includes(req.user.role)) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Manager/Partner/Admin only' } });
  return next();
};

router.get('/kpis', guard, asyncHandler(async (req, res) => {
  const f = [req.user.firmId];
  const rev = await one(
    `SELECT COALESCE(SUM(total) FILTER (WHERE status IN ('open','paid')),0) AS invoiced,
            COALESCE(SUM(total) FILTER (WHERE status='paid'),0) AS paid,
            COALESCE(SUM(total) FILTER (WHERE status='open'),0) AS outstanding
       FROM invoices WHERE firm_id=? AND client_id IS NOT NULL`, f);
  const collected = await one(
    `SELECT COALESCE(SUM(pay.amount),0) AS s FROM payments pay JOIN invoices i ON i.id=pay.invoice_id
      WHERE i.firm_id=? AND i.client_id IS NOT NULL AND pay.status='succeeded'`, f);
  const tax = await one(
    `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status='filed')::int AS filed,
            COUNT(*) FILTER (WHERE status='overdue')::int AS overdue
       FROM statutory_deadlines WHERE firm_id=?`, f);
  const audit = await one(
    `SELECT COALESCE(ROUND(AVG(progress_pct)),0)::int AS avg_progress, COUNT(*)::int AS engagements
       FROM audit_engagements WHERE firm_id=?`, f);
  const tasks = await one(
    `SELECT COUNT(*) FILTER (WHERE status='done')::int AS done,
            COUNT(*) FILTER (WHERE status IN ('open','in_progress'))::int AS open
       FROM tasks WHERE firm_id=?`, f);
  const clients = await one(`SELECT COUNT(*)::int AS n FROM clients WHERE firm_id=? AND deleted_at IS NULL`, f);
  const hours = await one(
    `SELECT COALESCE(SUM(hours),0) AS total, COALESCE(SUM(hours) FILTER (WHERE billable=1),0) AS billable
       FROM time_entries WHERE firm_id=?`, f);
  const staff = await q(
    `SELECT u.full_name AS staff, COALESCE(SUM(t.hours),0) AS hours,
            COALESCE(SUM(t.hours) FILTER (WHERE t.billable=1),0) AS billable
       FROM users u LEFT JOIN time_entries t ON t.user_id=u.id AND t.firm_id=?
      WHERE u.firm_id=? AND u.deleted_at IS NULL
      GROUP BY u.full_name HAVING COALESCE(SUM(t.hours),0) > 0 ORDER BY hours DESC LIMIT 10`,
    [req.user.firmId, req.user.firmId]);
  const revByMonth = await q(
    `SELECT to_char(date_trunc('month', COALESCE(issued_at, created_at)),'YYYY-MM') AS month,
            COALESCE(SUM(total),0) AS amount
       FROM invoices WHERE firm_id=? AND client_id IS NOT NULL AND status IN ('open','paid')
      GROUP BY 1 ORDER BY 1`, f);
  const compliance = tax.total > 0 ? Math.round((tax.filed / tax.total) * 100) : 0;
  res.json({
    data: {
      revenue: { invoiced: Number(rev.invoiced), paid: Number(rev.paid), outstanding: Number(rev.outstanding), collected: Number(collected.s) },
      tax: { total: tax.total, filed: tax.filed, overdue: tax.overdue, compliance },
      audit, tasks, clients: clients.n,
      hours: { total: Number(hours.total), billable: Number(hours.billable) },
      staff, revByMonth,
    },
  });
}));

module.exports = router;
