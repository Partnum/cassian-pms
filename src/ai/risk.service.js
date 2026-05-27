'use strict';
/**
 * AI review engines (deterministic over the database, auditable):
 *   - risk scoring per client/engagement  -> risk_assessments + ai_recommendations
 *   - anomaly detection                   -> anomaly_detection_results
 *   - accounting review                   -> ai_recommendations
 * The LLM (analytics/assistant services) layers commentary on top.
 */
const { q, one, uuid } = require('../config');

const MODEL = 'rule-v1';

async function recommend(firmId, { clientId = null, engagementId = null, type, title, detail, severity = 'medium', source = 'ai' }) {
  await q(
    `INSERT INTO ai_recommendations (id, firm_id, engagement_id, client_id, type, title, detail, severity, source, status)
     VALUES (?,?,?,?,?,?,?,?,?, 'open')`,
    [uuid(), firmId, engagementId, clientId, type, title, JSON.stringify(detail || {}), severity, source]
  ).catch(() => {});
}

// ---------------- Risk scoring ----------------
async function computeClientRisk(client) {
  const firmId = client.firm_id;
  const factors = [];

  const ob = await one(
    "SELECT COUNT(*) FILTER (WHERE status='overdue')::int overdue, COUNT(*) FILTER (WHERE status='due')::int due FROM statutory_deadlines WHERE client_id=?",
    [client.id]
  ) || { overdue: 0, due: 0 };
  const taxScore = Math.min(100, (ob.overdue || 0) * 35 + (ob.due || 0) * 10);
  factors.push({ category: 'Tax compliance', score: taxScore, weight: 0.30, detail: `${ob.overdue || 0} overdue, ${ob.due || 0} due soon` });

  const reqs = await q('SELECT doc_type FROM document_requirements WHERE category=? AND (firm_id IS NULL OR firm_id=?)', [client.category, firmId]);
  const present = await q('SELECT DISTINCT doc_type, detected_type FROM documents WHERE client_id=? AND deleted_at IS NULL', [client.id]);
  const have = new Set();
  present.forEach((p) => { if (p.doc_type) have.add(p.doc_type); if (p.detected_type) have.add(p.detected_type); });
  const missing = reqs.filter((r) => !have.has(r.doc_type)).length;
  const docScore = reqs.length ? Math.round((missing / reqs.length) * 100) : 0;
  factors.push({ category: 'Documentation', score: docScore, weight: 0.20, detail: `${missing}/${reqs.length} required documents missing` });

  const eng = await one('SELECT current_stage, progress_pct, target_completion FROM audit_engagements WHERE client_id=? ORDER BY financial_year DESC LIMIT 1', [client.id]);
  let progScore = 0; let progDetail = 'no active engagement';
  if (eng) {
    const prog = eng.progress_pct || 0;
    const daysLeft = eng.target_completion ? Math.round((new Date(eng.target_completion) - new Date()) / 86400000) : null;
    if (daysLeft != null) {
      if (daysLeft < 0 && prog < 100) progScore = 90;
      else if (daysLeft < 30 && prog < 70) progScore = 70;
      else if (daysLeft < 60 && prog < 40) progScore = 45;
      else progScore = Math.max(0, 30 - Math.round(prog / 4));
      progDetail = `${prog}% complete, ${daysLeft} days to deadline`;
    } else { progScore = Math.max(0, 40 - Math.round(prog / 3)); progDetail = `${prog}% complete`; }
  }
  factors.push({ category: 'Engagement progress', score: progScore, weight: 0.20, detail: progDetail });

  const an = await one("SELECT COUNT(*)::int n FROM anomaly_detection_results WHERE client_id=? AND status='open'", [client.id]) || { n: 0 };
  factors.push({ category: 'Anomalies', score: Math.min(100, (an.n || 0) * 20), weight: 0.15, detail: `${an.n || 0} open anomalies` });

  const tk = await one("SELECT COUNT(*)::int n FROM tasks WHERE client_id=? AND status IN ('open','in_progress') AND due_date < now()", [client.id]) || { n: 0 };
  factors.push({ category: 'Workflow', score: Math.min(100, (tk.n || 0) * 25), weight: 0.15, detail: `${tk.n || 0} overdue tasks` });

  const score = Math.round(factors.reduce((s, f) => s + f.score * f.weight, 0));
  const level = score >= 75 ? 'critical' : score >= 50 ? 'high' : score >= 25 ? 'medium' : 'low';
  return { score, level, factors };
}

async function recomputeAll(firmId, clientIds) {
  let clients;
  if (clientIds && clientIds !== '*') {
    if (!clientIds.length) return { count: 0 };
    clients = await q(`SELECT * FROM clients WHERE firm_id=? AND deleted_at IS NULL AND id IN (${clientIds.map(() => '?').join(',')})`, [firmId, ...clientIds]);
  } else {
    clients = await q('SELECT * FROM clients WHERE firm_id=? AND deleted_at IS NULL', [firmId]);
  }
  let count = 0;
  for (const c of clients) {
    const r = await computeClientRisk(c); // eslint-disable-line no-await-in-loop
    await q('INSERT INTO risk_assessments (id, firm_id, client_id, score, level, factors, model_version) VALUES (?,?,?,?,?,?,?)',
      [uuid(), firmId, c.id, r.score, r.level, JSON.stringify(r.factors), MODEL]); // eslint-disable-line no-await-in-loop
    await q("DELETE FROM ai_recommendations WHERE client_id=? AND type='risk' AND status='open'", [c.id]); // eslint-disable-line no-await-in-loop
    if (r.level === 'high' || r.level === 'critical') {
      await recommend(firmId, { clientId: c.id, type: 'risk', severity: r.level === 'critical' ? 'high' : 'medium', source: 'risk-engine', title: `${c.name}: ${r.level} risk (${r.score})`, detail: { factors: r.factors } }); // eslint-disable-line no-await-in-loop
    }
    count += 1;
  }
  return { count, model: MODEL };
}

async function riskCenter(firmId, ids) {
  let scope = ''; const params = [firmId];
  if (ids && ids !== '*') {
    if (!ids.length) return { clients: [], heatmap: { categories: [], rows: [] } };
    scope = ` AND ra.client_id IN (${ids.map(() => '?').join(',')})`;
    params.push(...ids);
  }
  const rows = await q(
    `SELECT DISTINCT ON (ra.client_id) ra.client_id, ra.score, ra.level, ra.factors, ra.computed_at,
            c.name AS client_name, c.category
       FROM risk_assessments ra JOIN clients c ON c.id=ra.client_id
      WHERE ra.firm_id=?${scope}
      ORDER BY ra.client_id, ra.computed_at DESC`, params
  );
  rows.sort((a, b) => Number(b.score) - Number(a.score));
  const categories = ['Tax compliance', 'Documentation', 'Engagement progress', 'Anomalies', 'Workflow'];
  const heatRows = rows.map((r) => {
    const f = {}; (r.factors || []).forEach((x) => { f[x.category] = x.score; });
    return { client: r.client_name, level: r.level, score: Number(r.score), cells: categories.map((c) => f[c] || 0) };
  });
  return { clients: rows, heatmap: { categories, rows: heatRows } };
}

async function clientRisk(clientId) {
  return one('SELECT * FROM risk_assessments WHERE client_id=? ORDER BY computed_at DESC LIMIT 1', [clientId]);
}

// ---------------- Anomaly detection ----------------
async function detectAnomalies(firmId, ids) {
  const found = [];
  const scopeClause = (col) => {
    if (!ids || ids === '*') return { sql: '', params: [] };
    if (!ids.length) return { sql: ' AND 1=0', params: [] };
    return { sql: ` AND ${col} IN (${ids.map(() => '?').join(',')})`, params: ids };
  };
  const record = async (clientId, engagementId, source, description, severity, score) => {
    const existing = await one("SELECT id FROM anomaly_detection_results WHERE client_id IS NOT DISTINCT FROM ? AND description=? AND status='open'", [clientId, description]);
    if (existing) return;
    await q("INSERT INTO anomaly_detection_results (id, firm_id, client_id, engagement_id, source, description, severity, score, status) VALUES (?,?,?,?,?,?,?,?, 'open')",
      [uuid(), firmId, clientId, engagementId, source, description, severity, score]);
    found.push({ clientId, source, description, severity });
  };

  // Late statutory filings
  const lf = scopeClause('client_id');
  const overdue = await q(`SELECT id, client_id, type, period, due_date FROM statutory_deadlines WHERE firm_id=? AND status='overdue'${lf.sql}`, [firmId, ...lf.params]);
  for (const o of overdue) await record(o.client_id, null, 'tax', `Late filing: ${o.type} (${o.period || ''}) due ${o.due_date} is overdue.`, 'high', 0.9); // eslint-disable-line no-await-in-loop

  // Unbalanced journals
  const jc = scopeClause('je.client_id');
  const unbalanced = await q(
    `SELECT je.id, je.client_id, je.ref_no, SUM(jl.debit) d, SUM(jl.credit) c
       FROM journal_entries je JOIN journal_lines jl ON jl.journal_id=je.id
      WHERE je.firm_id=?${jc.sql}
      GROUP BY je.id, je.client_id, je.ref_no HAVING ABS(SUM(jl.debit)-SUM(jl.credit)) > 0.005`,
    [firmId, ...jc.params]
  );
  for (const j of unbalanced) await record(j.client_id, null, 'journals', `Unbalanced journal ${j.ref_no || j.id} (Dr ${j.d} vs Cr ${j.c}).`, 'high', 0.85); // eslint-disable-line no-await-in-loop

  // Possible duplicate payments (same client + identical large debit appearing >1)
  const dup = await q(
    `SELECT je.client_id, jl.debit amt, COUNT(*) n
       FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_id
      WHERE je.firm_id=? AND jl.debit >= 100000${jc.sql}
      GROUP BY je.client_id, jl.debit HAVING COUNT(*) > 1`,
    [firmId, ...jc.params]
  );
  for (const d of dup) await record(d.client_id, null, 'journals', `Possible duplicate payment: amount ${d.amt} appears ${d.n} times.`, 'medium', 0.6); // eslint-disable-line no-await-in-loop

  // Negative asset balances in the trial balance
  const tc = scopeClause('tb.client_id');
  const neg = await q(
    `SELECT tb.client_id, coa.name, (SUM(tb.debit)-SUM(tb.credit)) bal
       FROM trial_balance tb JOIN chart_of_accounts coa ON coa.id=tb.account_id
      WHERE tb.firm_id=? AND coa.type='asset'${tc.sql}
      GROUP BY tb.client_id, coa.name HAVING (SUM(tb.debit)-SUM(tb.credit)) < 0`,
    [firmId, ...tc.params]
  );
  for (const n of neg) await record(n.client_id, null, 'accounting', `Negative balance on asset account "${n.name}" (${n.bal}).`, 'medium', 0.6); // eslint-disable-line no-await-in-loop

  return { detected: found.length, items: found };
}

async function listAnomalies(firmId, ids) {
  let scope = ''; const params = [firmId];
  if (ids && ids !== '*') {
    if (!ids.length) return [];
    scope = ` AND a.client_id IN (${ids.map(() => '?').join(',')})`;
    params.push(...ids);
  }
  return q(
    `SELECT a.id, a.source, a.description, a.severity, a.score, a.status, a.created_at, c.name AS client_name
       FROM anomaly_detection_results a LEFT JOIN clients c ON c.id=a.client_id
      WHERE a.firm_id=?${scope} ORDER BY a.created_at DESC LIMIT 100`, params
  );
}

// ---------------- Accounting review ----------------
async function accountingReview(clientId) {
  const client = await one('SELECT id, firm_id, name FROM clients WHERE id=?', [clientId]);
  if (!client) return { issues: [], count: 0 };
  const issues = [];

  const unb = await q(
    `SELECT je.id, je.ref_no, SUM(jl.debit) d, SUM(jl.credit) c
       FROM journal_entries je JOIN journal_lines jl ON jl.journal_id=je.id
      WHERE je.client_id=? GROUP BY je.id, je.ref_no HAVING ABS(SUM(jl.debit)-SUM(jl.credit)) > 0.005`, [clientId]
  );
  unb.forEach((j) => issues.push({ type: 'unbalanced_journal', severity: 'high', detail: `Journal ${j.ref_no || j.id} is out of balance (Dr ${j.d} vs Cr ${j.c}).` }));

  const tb = await one('SELECT COALESCE(SUM(debit),0) d, COALESCE(SUM(credit),0) c FROM trial_balance WHERE client_id=?', [clientId]);
  if (tb && (Number(tb.d) > 0 || Number(tb.c) > 0) && Math.abs(Number(tb.d) - Number(tb.c)) > 0.005) {
    issues.push({ type: 'tb_imbalance', severity: 'high', detail: `Trial balance does not balance (Dr ${tb.d} vs Cr ${tb.c}).` });
  }

  const neg = await q(
    `SELECT coa.name, (SUM(tb.debit)-SUM(tb.credit)) bal
       FROM trial_balance tb JOIN chart_of_accounts coa ON coa.id=tb.account_id
      WHERE tb.client_id=? AND coa.type='asset'
      GROUP BY coa.name HAVING (SUM(tb.debit)-SUM(tb.credit)) < 0`, [clientId]
  );
  neg.forEach((n) => issues.push({ type: 'negative_balance', severity: 'medium', detail: `Asset account "${n.name}" has a negative balance (${n.bal}).` }));

  for (const i of issues) {
    await recommend(client.firm_id, { clientId, type: 'accounting', severity: i.severity, source: 'accounting-review', title: i.type.replace(/_/g, ' '), detail: i }); // eslint-disable-line no-await-in-loop
  }
  return { issues, count: issues.length };
}

module.exports = {
  computeClientRisk, recomputeAll, riskCenter, clientRisk,
  detectAnomalies, listAnomalies, accountingReview, recommend,
};
