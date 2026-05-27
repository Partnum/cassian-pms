'use strict';
/**
 * Smart audit-document classifier.
 * Rule/keyword based over the file name + extracted text. Returns the closest
 * documents.doc_type enum value, a finer detected_type, suggested tags and a
 * confidence score. (Swap in an LLM/ML classifier behind the same interface.)
 */

// detected_type -> documents.doc_type enum
const ENUM_MAP = {
  bank_statement: 'bank_statement',
  financial_statements: 'financial_statements',
  final_financial_statements: 'financial_statements',
  tax_return: 'tax_return',
  roi: 'tax_return',
  payroll: 'payroll',
  engagement_letter: 'engagement_letter',
  proof_of_payment: 'proof_of_payment',
  invoice: 'invoice',
  vat_schedule: 'tax_return',
  trial_balance: 'working_paper',
  tra_document: 'tra_document',
  wcf: 'wcf_nssf_pdpc',
  nssf: 'wcf_nssf_pdpc',
  pdpc: 'wcf_nssf_pdpc',
  working_paper: 'working_paper',
};

const RULES = [
  { type: 'bank_statement', tags: ['bank'], rx: [/bank\s*statement/i, /\baccount\s*statement\b/i, /\bstatement\s*of\s*account\b/i, /\bCRDB\b|\bNMB\b|\bNBC\b|\bstanbic\b|\bequity\b/i] },
  { type: 'final_financial_statements', tags: ['financials', 'final'], rx: [/final\s+(financial|accounts|fs)/i, /audited\s+financial/i] },
  { type: 'financial_statements', tags: ['financials'], rx: [/financial\s*statement/i, /\bstatement\s+of\s+financial\s+position\b/i, /\bprofit\s+and\s+loss\b/i, /\bincome\s+statement\b/i, /\bdraft\s+fs\b/i] },
  { type: 'trial_balance', tags: ['accounting'], rx: [/trial\s*balance/i, /\bTB\b/, /\bgeneral\s+ledger\b/i] },
  { type: 'vat_schedule', tags: ['tax', 'vat'], rx: [/\bVAT\b.*(schedule|return|201)/i, /value\s+added\s+tax/i, /vat\s*schedule/i] },
  { type: 'roi', tags: ['tax', 'roi'], rx: [/return\s+of\s+income/i, /\bROI\b/, /income\s+tax\s+return/i, /\bITX\b/i] },
  { type: 'tax_return', tags: ['tax'], rx: [/tax\s*return/i, /provisional\s+tax/i, /\bPAYE\b.*return/i] },
  { type: 'engagement_letter', tags: ['engagement'], rx: [/engagement\s*letter/i, /\bEL\b\s*(signed|draft)?/i, /letter\s+of\s+engagement/i] },
  { type: 'proof_of_payment', tags: ['payment'], rx: [/proof\s+of\s+payment/i, /\bPOP\b/, /payment\s+receipt/i, /control\s+number/i] },
  { type: 'invoice', tags: ['billing'], rx: [/\binvoice\b/i, /\btax\s+invoice\b/i, /\bEFD\b|\bVFD\b/i, /receipt\s+no/i] },
  { type: 'payroll', tags: ['payroll'], rx: [/payroll/i, /\bpay\s*slip\b/i, /salaries/i, /\bP9\b/i] },
  { type: 'wcf', tags: ['statutory', 'wcf'], rx: [/\bWCF\b/i, /workers?\s+compensation/i] },
  { type: 'nssf', tags: ['statutory', 'nssf'], rx: [/\bNSSF\b/i, /social\s+security/i] },
  { type: 'pdpc', tags: ['statutory', 'pdpc'], rx: [/\bPDPC\b/i, /data\s+protection/i, /personal\s+data/i] },
  { type: 'tra_document', tags: ['tra'], rx: [/\bTRA\b/i, /tanzania\s+revenue/i, /\bTIN\b\s*certificate/i, /tax\s+clearance/i] },
  { type: 'working_paper', tags: ['workpaper'], rx: [/working\s*paper/i, /\bWP\b\s*ref/i, /lead\s+schedule/i] },
];

/** Classify a document. text is optional (OCR / extracted body). */
function classify(name = '', text = '') {
  const hay = `${name}\n${(text || '').slice(0, 4000)}`;
  let best = null;
  for (const rule of RULES) {
    let hits = 0;
    for (const rx of rule.rx) if (rx.test(hay)) hits += 1;
    const nameHit = rule.rx.some((rx) => rx.test(name)) ? 1 : 0;
    if (hits === 0) continue;
    const score = hits + nameHit * 1.5;
    if (!best || score > best.score) best = { score, rule, nameHit };
  }
  if (!best) return { docType: 'other', detectedType: 'other', tags: [], confidence: 0 };
  const conf = Math.min(0.99, 0.45 + best.score * 0.15 + best.nameHit * 0.1);
  return {
    docType: ENUM_MAP[best.rule.type] || 'other',
    detectedType: best.rule.type,
    tags: best.rule.tags,
    confidence: Number(conf.toFixed(2)),
  };
}

module.exports = { classify, ENUM_MAP };
