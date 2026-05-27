'use strict';
/**
 * Financial analysis, tax-compliance monitoring and workflow assistance.
 * Deterministic computation from the database + optional LLM commentary.
 */
const { q, one, uuid } = require('../config');
const ai = require('../services/ai.service');
const prompts = require('./prompts');
const { createNotification } = require('../services/notifications.service');

const num = (v) => Number(v || 0);
const round = (v) => Math.round(num(v) * 100) / 100;

// ---------------- Financial analysis ----------------
async function financialAnalysis(clientId) {
  const client = await one('SELECT id, name FROM clients WHERE id=?', [clientId]);
  if (!client) return { hasData: false, message: 'Client not found' };
  const rows = await q(
    `SELECT coa.type, COALESCE(SUM(tb.debit),0) d, COALESCE(SUM(tb.credit),0) c
       FROM trial_balance tb JOIN chart_of_accounts coa ON coa.id=tb.account_id
      WHERE tb.client_id=? GROUP BY coa.type`, [clientId]
  );
  if (!rows.length) return { hasData: false, message: 'No trial balance has been posted for this client yet.', client: client.name };

  const m = {}; rows.forEach((r) => { m[r.type] = { d: num(r.d), c: num(r.c) }; });
  const revenue = m.income ? m.income.c - m.income.d : 0;
  const expenses = m.expense ? m.expense.d - m.expense.c : 0;
  const assets = m.asset ? m.asset.d - m.asset.c : 0;
  const liabilities = m.liability ? m.liability.c - m.liability.d : 0;
  const equity = m.equity ? m.equity.c - m.equity.d : 0;
  const netProfit = revenue - expenses;

  const metrics = {
    revenue: round(revenue), expenses: round(expenses), netProfit: round(netProfit),
    netMargin: revenue ? round((netProfit / revenue) * 100) : 0,
    totalAssets: round(assets), totalLiabilities: round(liabilities), equity: round(equity),
    currentRatio: liabilities ? round(assets / liabilities) : null,
    gearing: (liabilities + equity) ? round((liabilities / (liabilities + equity)) * 100) : 0,
    returnOnAssets: assets ? round((netProfit / assets) * 100) : 0,
  };
  const charts = {
    performance: { labels: ['Revenue', 'Expenses', 'Net profit'], values: [metrics.revenue, metrics.expenses, metrics.netProfit] },
    position: { labels: ['Assets', 'Liabilities', 'Equity'], values: [metrics.totalAssets, metrics.totalLiabilities, metrics.equity] },
  };
  let commentary = '';
  try { commentary = (await ai.callLLM(prompts.financialCommentary(client.name, metrics), prompts.SYSTEM)).text; } catch (e) { commentary = ''; }
  return { hasData: true, client: client.name, metrics, charts, commentary };
}

// ---------------- Compliance monitor (predict overdue) ----------------
async function complianceMonitor(firmId, ids) {
  let scope = ''; const params = [firmId];
  if (ids && ids !== '*') {
    if (!ids.length) return { alerts: [], summary: { overdue: 0, dueSoon: 0 } };
    scope = ` AND o.client_id IN (${ids.map(() => '?').join(',')})`;
    params.push(...ids);
  }
  const obs = await q(
    `SELECT o.id, o.type, o.authority, o.period, o.due_date, o.status, c.id client_id, c.name client_name, c.manager_id,
            (SELECT COUNT(*) FROM statutory_deadlines h WHERE h.client_id=o.client_id AND h.status='overdue')::int hist_overdue
       FROM statutory_deadlines o JOIN clients c ON c.id=o.client_id
      WHERE o.firm_id=? AND o.status NOT IN ('filed','exempt')${scope}
      ORDER BY o.due_date`, params
  );
  const today = new Date();
  const alerts = obs.map((o) => {
    const days = Math.round((new Date(o.due_date) - today) / 86400000);
    let risk = 'low';
    if (o.status === 'overdue' || days < 0) risk = 'overdue';
    else if (days <= 3) risk = 'critical';
    else if (days <= 7) risk = 'high';
    else if (days <= 14 || o.hist_overdue > 0) risk = 'medium';
    return {
      id: o.id, type: o.type, authority: o.authority, period: o.period, due_date: o.due_date,
      client: o.client_name, days_to_due: days, risk, history_overdue: o.hist_overdue,
      action: risk === 'overdue' ? 'File immediately; quantify penalty/interest exposure'
        : risk === 'critical' || risk === 'high' ? 'Prepare and file now; confirm payment control number'
          : 'Schedule preparation and assign owner',
    };
  });
  const order = { overdue: 0, critical: 1, high: 2, medium: 3, low: 4 };
  alerts.sort((a, b) => order[a.risk] - order[b.risk] || a.days_to_due - b.days_to_due);
  return {
    alerts,
    summary: {
      overdue: alerts.filter((a) => a.risk === 'overdue').length,
      dueSoon: alerts.filter((a) => ['critical', 'high'].includes(a.risk)).length,
      total: alerts.length,
    },
  };
}

// ---------------- Workflow assistant ----------------
async function workflowAssistant(firmId, ids) {
  let scope = ''; const params = [firmId];
  if (ids && ids !== '*') {
    if (!ids.length) return { delayedReviews: [], missingApprovals: [], overdueAudits: [], priorityTasks: [] };
    scope = ` AND e.client_id IN (${ids.map(() => '?').join(',')})`;
    params.push(...ids);
  }
  const engBase = `FROM audit_engagements e JOIN clients c ON c.id=e.client_id WHERE e.firm_id=?${scope}`;

  const delayedReviews = await q(
    `SELECT e.id, c.name client_name, e.current_stage, e.updated_at
       ${engBase} AND e.current_stage IN ('Manager Review','Partner Review')
        AND e.updated_at < now() - INTERVAL '7 days' ORDER BY e.updated_at`, params
  );
  const overdueAudits = await q(
    `SELECT e.id, c.name client_name, e.current_stage, e.progress_pct, e.target_completion
       ${engBase} AND e.target_completion < CURRENT_DATE AND e.current_stage <> 'Completed'
      ORDER BY e.target_completion`, params
  );
  const missingApprovals = await q(
    `SELECT e.id, c.name client_name, e.current_stage
       ${engBase} AND e.current_stage IN ('Client Sign-off','ROI Submission','Completed')
        AND NOT EXISTS (SELECT 1 FROM audit_signoffs s WHERE s.engagement_id=e.id AND s.sign_role='Partner')
      ORDER BY c.name`, params
  );

  // Priority tasks (scoped by client where applicable)
  let tScope = ''; const tParams = [firmId];
  if (ids && ids !== '*' && ids.length) { tScope = ` AND (t.client_id IN (${ids.map(() => '?').join(',')}))`; tParams.push(...ids); }
  const priorityTasks = await q(
    `SELECT t.id, t.title, t.priority, t.due_date, c.name client_name, u.full_name assignee
       FROM tasks t LEFT JOIN clients c ON c.id=t.client_id LEFT JOIN users u ON u.id=t.assignee_id
      WHERE t.firm_id=? AND t.status IN ('open','in_progress')${tScope}
      ORDER BY (t.due_date < now()) DESC, (t.priority='urgent') DESC, (t.priority='high') DESC, t.due_date NULLS LAST LIMIT 10`,
    tParams
  );

  // Escalate overdue audits -> notify partner + recommendation (best effort)
  for (const a of overdueAudits) {
    const eng = await one('SELECT partner_id, manager_id, firm_id FROM audit_engagements WHERE id=?', [a.id]); // eslint-disable-line no-await-in-loop
    const uid = (eng && (eng.partner_id || eng.manager_id)) || null;
    if (uid) await createNotification({ firmId, userId: uid, type: 'warning', title: `Overdue audit: ${a.client_name}`, body: `${a.client_name} is past its target completion (${a.target_completion}) at stage "${a.current_stage}".`, link: '/app.html#workflow' }); // eslint-disable-line no-await-in-loop
  }

  return { delayedReviews, missingApprovals, overdueAudits, priorityTasks };
}

module.exports = { financialAnalysis, complianceMonitor, workflowAssistant };
