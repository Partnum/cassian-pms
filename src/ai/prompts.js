'use strict';
/**
 * Professional prompt templates for the Cassian AI module.
 * Tanzania-aware (TRA, VAT, PAYE, SDL, NSSF, WCF, PDPC, ROI; ISA/IFRS).
 * All output is decision-support for a qualified auditor — never a final opinion.
 */

const SYSTEM =
  'You are the Cassian audit & accounting copilot for a Tanzanian CPA firm (Cassian & Associates). '
  + 'You assist qualified auditors, tax consultants and accountants. Use precise professional language and '
  + 'cite the relevant standard or law where appropriate: ISA (audit), IFRS / IFRS for SMEs (accounting), and '
  + 'Tanzanian tax law administered by the TRA (VAT Act, Income Tax Act Cap 332, PAYE, SDL 3.5%, NSSF 20%, '
  + 'WCF 0.5%, PDPC data protection, Return of Income). Be concise and structured. Clearly mark assumptions and '
  + 'where professional judgement is required. Your output is decision-support, never the final audit opinion.';

const variance = (subject, context = '') =>
  `An auditor reports: "${subject}". ${context ? 'Context: ' + context + '. ' : ''}`
  + 'Respond with four clearly labelled sections: (1) Possible causes; (2) Audit risks and the assertions affected; '
  + '(3) Suggested audit procedures (specific and actionable); (4) A draft professional audit comment suitable for the working papers.';

const assistant = (question, context = '') =>
  `${context ? 'Engagement context:\n' + context + '\n\n' : ''}Question: ${question}\n`
  + 'Answer professionally and concretely, referencing the relevant standard/law where useful.';

const auditComments = (area, details = '') =>
  `Draft concise working-paper audit comments and any management-letter points for the audit area "${area}". `
  + `Details: ${details || 'none provided'}. Use ISA terminology and a neutral professional tone.`;

const managementLetterPoint = (finding) =>
  `Draft a management letter point for the following internal-control finding, using the standard structure `
  + `(Observation, Implication/Risk, Recommendation, Management response [to be obtained]): ${finding}`;

const auditConclusion = (area, results = '') =>
  `Write a balanced audit conclusion for the area "${area}" based on the work performed: ${results}. `
  + `State whether the evidence obtained is sufficient and appropriate and whether the balance/assertion is fairly stated.`;

const accountingReview = (findings) =>
  `The system detected the following accounting issues (JSON):\n${JSON.stringify(findings).slice(0, 4000)}\n`
  + `Summarise the issues for an accountant, explain the likely cause and IFRS implication of each, and give a `
  + `prioritised, actionable correction plan.`;

const riskCommentary = (clientName, factors) =>
  `For client "${clientName}", the risk engine produced these contributing factors (JSON):\n`
  + `${JSON.stringify(factors).slice(0, 3000)}\n`
  + `Write a brief risk narrative an engagement partner can read: overall risk posture, the most significant `
  + `drivers, and recommended audit responses / focus areas (ISA 315).`;

const financialCommentary = (clientName, ratios) =>
  `Perform an analytical review for "${clientName}". Ratios/figures (JSON):\n${JSON.stringify(ratios).slice(0, 3000)}\n`
  + `Comment on profitability, liquidity, gearing and any unusual movements; flag fluctuations that warrant audit `
  + `attention (ISA 520) and possible IFRS considerations.`;

const complianceSummary = (data) =>
  `Tanzanian statutory compliance snapshot (JSON):\n${JSON.stringify(data).slice(0, 3000)}\n`
  + `Produce prioritised compliance alerts (overdue first), the penalty/interest exposure under Tanzanian law, and `
  + `the recommended next action and responsible owner for each.`;

const REPORT_BRIEFS = {
  audit_report: 'an ISA-style draft Independent Auditor\'s Report outline (do not invent figures; mark placeholders).',
  management_letter: 'a management letter compiling the internal-control findings with recommendations.',
  tax_summary: 'a Tanzanian tax compliance summary (VAT, PAYE, SDL, NSSF, WCF, ROI status and exposures).',
  compliance_report: 'a statutory compliance report across all obligations with status and actions.',
  client_progress: 'a client engagement progress report (workflow stage, % complete, pending items, deadlines).',
  financial_review: 'a financial review summary with key ratios, trends and commentary.',
};
const report = (type, dataContext = '') =>
  `Generate ${REPORT_BRIEFS[type] || 'a professional report.'}\n\nData/context (JSON):\n${JSON.stringify(dataContext).slice(0, 6000)}\n`
  + `Use clear headings and professional accounting/audit language for a Tanzanian firm. Where data is missing, insert clearly-marked placeholders rather than inventing values.`;

module.exports = {
  SYSTEM, variance, assistant, auditComments, managementLetterPoint, auditConclusion,
  accountingReview, riskCommentary, financialCommentary, complianceSummary, report, REPORT_BRIEFS,
};
