'use strict';
/**
 * Natural-language query over firm data via a SAFE intent router (no free-form
 * SQL from the model). Each intent maps to a parameterized, firm-scoped query.
 * Falls back to document full-text search.
 */
const { q } = require('../config');

const TYPES = ['VAT', 'PAYE', 'SDL', 'NSSF', 'WCF', 'PDPC', 'ROI'];

function scopeIn(col, ids) {
  if (!ids || ids === '*') return { sql: '', params: [] };
  if (!ids.length) return { sql: ' AND 1=0', params: [] };
  return { sql: ` AND ${col} IN (${ids.map(() => '?').join(',')})`, params: ids };
}

async function query(text, { firmId, ids }) {
  const t = (text || '').trim();
  const lc = t.toLowerCase();
  const type = TYPES.find((x) => new RegExp(`\\b${x}\\b`, 'i').test(t));

  // 1) High-risk clients
  if (/\b(high[- ]?risk|riskiest|risk)\b/.test(lc)) {
    const s = scopeIn('ra.client_id', ids);
    const rows = await q(
      `SELECT DISTINCT ON (ra.client_id) c.name client, ra.score, ra.level
         FROM risk_assessments ra JOIN clients c ON c.id=ra.client_id
        WHERE ra.firm_id=?${s.sql} ORDER BY ra.client_id, ra.computed_at DESC`, [firmId, ...s.params]
    );
    rows.sort((a, b) => Number(b.score) - Number(a.score));
    const top = rows.filter((r) => ['high', 'critical'].includes(r.level));
    return { intent: 'high_risk_clients', summary: `${top.length} client(s) at high/critical risk`, columns: ['Client', 'Score', 'Level'], rows: (top.length ? top : rows).slice(0, 25).map((r) => [r.client, r.score, r.level]) };
  }

  // 2) Overdue tasks
  if (/task/.test(lc) && /(overdue|late|past due)/.test(lc)) {
    const s = scopeIn('t.client_id', ids);
    const rows = await q(
      `SELECT t.title, c.name client, t.due_date, u.full_name assignee
         FROM tasks t LEFT JOIN clients c ON c.id=t.client_id LEFT JOIN users u ON u.id=t.assignee_id
        WHERE t.firm_id=? AND t.status IN ('open','in_progress') AND t.due_date < now()${s.sql}
        ORDER BY t.due_date`, [firmId, ...s.params]
    );
    return { intent: 'overdue_tasks', summary: `${rows.length} overdue task(s)`, columns: ['Task', 'Client', 'Due', 'Assignee'], rows: rows.map((r) => [r.title, r.client || '—', (r.due_date || '').slice(0, 10), r.assignee || '—']) };
  }

  // 3) Pending reviews / approvals
  if (/(pending|awaiting|outstanding).*(review|approval|sign)/.test(lc) || /review queue/.test(lc)) {
    const s = scopeIn('e.client_id', ids);
    const rows = await q(
      `SELECT c.name client, e.current_stage, e.progress_pct
         FROM audit_engagements e JOIN clients c ON c.id=e.client_id
        WHERE e.firm_id=? AND e.current_stage IN ('Manager Review','Partner Review')${s.sql}
        ORDER BY c.name`, [firmId, ...s.params]
    );
    return { intent: 'pending_reviews', summary: `${rows.length} engagement(s) awaiting review`, columns: ['Client', 'Stage', 'Progress %'], rows: rows.map((r) => [r.client, r.current_stage, r.progress_pct]) };
  }

  // 4) Overdue / upcoming statutory obligations (optionally by type)
  if (/(overdue|late|due|upcoming|filing|return)/.test(lc) || type) {
    const overdue = /(overdue|late|past due)/.test(lc);
    const s = scopeIn('o.client_id', ids);
    let where = "o.firm_id=? AND o.status NOT IN ('filed','exempt')";
    const params = [firmId];
    if (overdue) where = "o.firm_id=? AND o.status='overdue'";
    if (type) { where += ' AND o.type=?'; params.push(type); }
    const rows = await q(
      `SELECT c.name client, o.type, o.period, o.due_date, o.status
         FROM statutory_deadlines o JOIN clients c ON c.id=o.client_id
        WHERE ${where}${s.sql} ORDER BY o.due_date LIMIT 100`, [...params, ...s.params]
    );
    return { intent: 'obligations', summary: `${rows.length} ${overdue ? 'overdue ' : ''}${type || ''} obligation(s)`, columns: ['Client', 'Type', 'Period', 'Due', 'Status'], rows: rows.map((r) => [r.client, r.type, r.period || '', r.due_date, r.status]) };
  }

  // 5) Fallback: document full-text search
  const s = scopeIn('d.client_id', ids);
  let rows = [];
  try {
    rows = await q(
      `SELECT d.name, c.name client, d.detected_type
         FROM documents d JOIN clients c ON c.id=d.client_id
        WHERE d.firm_id=?${s.sql}
          AND to_tsvector('simple', coalesce(d.name,'') || ' ' || coalesce(d.ocr_text,'')) @@ plainto_tsquery('simple', ?)
          AND d.deleted_at IS NULL LIMIT 25`, [firmId, ...s.params, t]
    );
  } catch (e) { rows = []; }
  return { intent: 'document_search', summary: `${rows.length} document(s) matched "${t}"`, columns: ['Document', 'Client', 'Type'], rows: rows.map((r) => [r.name, r.client, (r.detected_type || '').replace(/_/g, ' ')]) };
}

module.exports = { query };
