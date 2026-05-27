'use strict';
/**
 * AI assistant service.
 * Works with any OpenAI-compatible Chat Completions API when AI_MODE=openai
 * and AI_API_KEY is set. Otherwise falls back to deterministic, rule-based
 * responses (AI_MODE=mock) so the app is fully functional without a key.
 *
 * All AI usage is recorded in ai_logs by the calling route.
 */
const { env, q, uuid } = require('../config');

const SYSTEM_PROMPT =
  'You are an audit & accounting copilot for a Tanzanian CPA firm (Cassian & Associates). ' +
  'You assist with audit findings, ratio and trend analysis, risk identification, revenue/expense testing, ' +
  'drafting audit comments and management-letter points, and Tanzanian tax compliance (TRA VAT, PAYE, SDL, ' +
  'NSSF, WCF, PDPC, ROI). Be precise and professional. Your output is decision-support for a qualified auditor, ' +
  'never a final audit opinion; flag where professional judgement is required.';

async function callLLM(userPrompt, systemPrompt = SYSTEM_PROMPT) {
  if (env.ai.mode !== 'openai' || !env.ai.apiKey) {
    return { text: mockReply(userPrompt), model: 'mock', tokens: 0 };
  }
  const resp = await fetch(`${env.ai.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.ai.apiKey}` },
    body: JSON.stringify({
      model: env.ai.model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`AI provider error ${resp.status}: ${t.slice(0, 200)}`);
  }
  const data = await resp.json();
  return {
    text: (data.choices && data.choices[0] && data.choices[0].message.content) || '',
    model: env.ai.model,
    tokens: (data.usage && data.usage.total_tokens) || 0,
  };
}

// ---- Feature wrappers ----
const chat = (prompt) => callLLM(prompt);

const auditComments = (area, details) =>
  callLLM(`Draft concise, professional audit working-paper comments and any management-letter points for the audit area "${area}". Context/details: ${details || 'none provided'}. Use ISA terminology where relevant.`);

const riskAnalysis = (context) =>
  callLLM(`Identify and rank the key risks of material misstatement and the assertions affected, based on this engagement context: ${context}. Suggest a recommended audit response for each.`);

const financialReview = (figures) =>
  callLLM(`Perform an analytical review and ratio analysis on these figures and flag unusual fluctuations and possible causes (consider IFRS implications): ${figures}.`);

// ---- Deterministic mock (used when no AI key) ----
function mockReply(prompt) {
  const p = (prompt || '').toLowerCase();
  if (p.includes('ratio') || p.includes('analytical') || p.includes('financial review')) {
    return [
      'Analytical review (illustrative — connect an AI key for live analysis):',
      '• Gross margin moved to 37.8% (from 41.2%) — investigate input-cost inflation / pricing.',
      '• Current ratio 1.42 (stable) — adequate short-term liquidity.',
      '• Receivable days 63 (up from 48) — possible collection slowdown; review IFRS 9 ECL.',
      '• Gearing 38% — within typical covenant levels.',
      'Recommended response: extend substantive testing on receivables and obtain management explanations for margin movement.',
    ].join('\n');
  }
  if (p.includes('risk')) {
    return [
      'Key risks of material misstatement (illustrative):',
      '1. Revenue recognition / cut-off (occurrence, cut-off) — significant risk; perform cut-off testing around year-end.',
      '2. Inventory valuation / NRV (valuation) — test costing and obsolescence.',
      '3. Management override of controls (presumed risk under ISA 240) — test journal entries.',
      'Connect an AI key for an engagement-specific assessment.',
    ].join('\n');
  }
  if (p.includes('management') || p.includes('letter') || p.includes('reconcil')) {
    return [
      'Draft management letter point — Bank reconciliations',
      'Observation: reconciliations for several accounts were prepared more than 30 days after month-end.',
      'Implication: increased risk that errors or unauthorised transactions go undetected.',
      'Recommendation: prepare and independently review all bank reconciliations within 7 working days of month-end.',
      'Management response: [to be obtained].',
    ].join('\n');
  }
  if (p.includes('tax') || p.includes('vat') || p.includes('paye') || p.includes('compliance')) {
    return [
      'Tax compliance alerts (illustrative):',
      '• Overdue: PAYE for several clients — penalty & interest exposure under the Tax Administration Act.',
      '• Upcoming: VAT returns (due 20th), PAYE/SDL (due 7th), NSSF/WCF (month-end), ROI (6-month rule).',
      'Connect an AI key for live, document-grounded alerts.',
    ].join('\n');
  }
  if (p.includes('finding') || p.includes('revenue') || p.includes('comment')) {
    return [
      'Suggested audit findings (illustrative):',
      '• Possible revenue cut-off misstatement — invoices dated just after year-end relating to pre year-end deliveries (IFRS 15).',
      '• EFD/VFD report total differs from GL revenue — reconcile to VAT returns.',
      '• Credit notes lacking supporting documentation — completeness/occurrence risk.',
    ].join('\n');
  }
  return 'I can help with audit findings, ratio/trend analysis, risk identification, testing assistance, drafting comments and management-letter points, and Tanzanian tax compliance. (Running in mock mode — set AI_MODE=openai and AI_API_KEY in .env for live, document-grounded answers.)';
}

/** Log an AI interaction. */
async function logAi({ firmId, userId, clientId, engagementId, feature, prompt, response, model, tokens }) {
  try {
    await q(
      `INSERT INTO ai_logs (id, firm_id, user_id, client_id, engagement_id, feature, prompt, response, model, tokens)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [uuid(), firmId, userId || null, clientId || null, engagementId || null, feature,
        (prompt || '').slice(0, 8000), (response || '').slice(0, 12000), model || null, tokens || 0]
    );
  } catch (e) { /* ignore logging errors */ }
}

module.exports = { callLLM, chat, auditComments, riskAnalysis, financialReview, logAi, SYSTEM_PROMPT };
