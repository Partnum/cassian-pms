'use strict';
/**
 * AI report generation: audit report, management letter, tax summary,
 * compliance report, client progress, financial review. Gathers data context,
 * prompts the LLM with a professional template, logs and stores the report.
 */
const { q, one, uuid } = require('../config');
const ai = require('../services/ai.service');
const prompts = require('./prompts');
const analytics = require('./analytics.service');

const TYPES = Object.keys(prompts.REPORT_BRIEFS);

async function gatherContext(type, { clientId, firmId }) {
  const context = {};
  if (clientId) {
    context.client = await one('SELECT name, category, tin, vrn, financial_year_end FROM clients WHERE id=?', [clientId]);
  }
  if (type === 'client_progress' || type === 'audit_report') {
    const eng = await one('SELECT id, current_stage, progress_pct, financial_year, target_completion FROM audit_engagements WHERE client_id=? ORDER BY financial_year DESC LIMIT 1', [clientId]);
    context.engagement = eng;
    if (eng) context.stages = await q('SELECT name, status, progress_pct FROM audit_stages WHERE engagement_id=? ORDER BY sequence', [eng.id]);
  }
  if (type === 'tax_summary' || type === 'compliance_report') {
    context.obligations = clientId
      ? await q('SELECT type, authority, period, due_date, status FROM statutory_deadlines WHERE client_id=? ORDER BY due_date', [clientId])
      : await q("SELECT type, status, COUNT(*)::int n FROM statutory_deadlines WHERE firm_id=? GROUP BY type, status", [firmId]);
  }
  if (type === 'financial_review') {
    const fa = await analytics.financialAnalysis(clientId);
    context.financials = fa.metrics || { note: fa.message };
  }
  if (type === 'management_letter') {
    context.findings = await q(
      "SELECT title, detail, severity, type FROM ai_recommendations WHERE client_id=? AND status='open' AND type IN ('accounting','control','risk','anomaly') ORDER BY created_at DESC LIMIT 30",
      [clientId]
    );
    context.anomalies = await q("SELECT description, severity FROM anomaly_detection_results WHERE client_id=? AND status='open' LIMIT 30", [clientId]);
  }
  return context;
}

async function generate(type, { clientId = null, firmId, userId }) {
  if (!TYPES.includes(type)) throw new Error(`Unknown report type. Use one of: ${TYPES.join(', ')}`);
  const context = await gatherContext(type, { clientId, firmId });
  const out = await ai.callLLM(prompts.report(type, context), prompts.SYSTEM);
  await ai.logAi({ firmId, userId, clientId, feature: `report:${type}`, prompt: type, response: out.text, model: out.model, tokens: out.tokens });
  await q('INSERT INTO reports (id, firm_id, name, type, params, created_by) VALUES (?,?,?,?,?,?)',
    [uuid(), firmId, `${type}${context.client ? ' — ' + context.client.name : ''}`, type, JSON.stringify({ clientId }), userId]).catch(() => {});
  return { type, text: out.text, model: out.model };
}

module.exports = { generate, TYPES };
