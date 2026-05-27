'use strict';
/**
 * Google Drive folder taxonomy and document-routing maps.
 * Folder tree:  <ROOT>/<Category>/<Client Name>/<Year>/<Subfolder>
 */

// Subfolders provisioned per client/year, by engagement category.
const CATEGORY_SUBFOLDERS = {
  Audit: ['Planning', 'EL', 'Bank Statements', 'Working Papers', 'Draft FS', 'Final FS', 'ROI', 'TRA', 'WCF', 'NSSF', 'PDPC', 'Invoices', 'Payroll'],
  Tax: ['Tax Returns', 'VAT', 'TRA', 'Bank Statements', 'POP', 'Payroll'],
  Accounting: ['Bank Statements', 'Invoices', 'Payroll', 'Trial Balance', 'VAT', 'TRA'],
  Consultancy: ['Reports', 'Correspondence', 'Invoices'],
};

// detected_type (fine-grained) -> preferred subfolder name.
const DOC_TYPE_SUBFOLDER = {
  engagement_letter: 'EL',
  bank_statement: 'Bank Statements',
  working_paper: 'Working Papers',
  trial_balance: 'Trial Balance',
  financial_statements: 'Draft FS',
  final_financial_statements: 'Final FS',
  tax_return: 'ROI',
  roi: 'ROI',
  tra_document: 'TRA',
  vat_schedule: 'VAT',
  invoice: 'Invoices',
  payroll: 'Payroll',
  proof_of_payment: 'POP',
  wcf: 'WCF',
  nssf: 'NSSF',
  pdpc: 'PDPC',
  planning: 'Planning',
};

// detected_type -> audit workflow stage to advance/trigger.
const DETECTED_TYPE_STAGE = {
  engagement_letter: 'Engagement Letter',
  bank_statement: 'Fieldwork',
  working_paper: 'Fieldwork',
  trial_balance: 'Fieldwork',
  financial_statements: 'Draft Financial Report',
  final_financial_statements: 'Client Sign-off',
  tax_return: 'ROI Submission',
  roi: 'ROI Submission',
  tra_document: 'ROI Submission',
};

/** Choose the best subfolder for a document within a client's category. */
function subfolderFor(category, detectedType) {
  const subs = CATEGORY_SUBFOLDERS[category] || [];
  const pref = DOC_TYPE_SUBFOLDER[detectedType];
  if (pref && subs.includes(pref)) return pref;
  return null; // file directly under the year folder
}

module.exports = { CATEGORY_SUBFOLDERS, DOC_TYPE_SUBFOLDER, DETECTED_TYPE_STAGE, subfolderFor };
