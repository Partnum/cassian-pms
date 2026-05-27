'use strict';
/**
 * Roles, RBAC permission matrix, audit workflow definition, and reference enums.
 */

const ROLES = [
  'Admin', 'Partner', 'Manager', 'Senior Auditor',
  'Accountant', 'Tax Consultant', 'Staff', 'Client',
];

// Roles that can see ALL clients (bypass per-client scoping).
const ALL_CLIENT_ROLES = ['Admin', 'Partner'];

// Permission codes -> assigned per role. Admin uses the '*' wildcard.
const PERMISSIONS = {
  Admin: ['*'],
  Partner: [
    'client.read', 'client.create', 'client.update', 'client.delete',
    'engagement.read', 'engagement.update',
    'workflow.advance', 'workflow.manager_review', 'workflow.partner_review',
    'task.read', 'task.create', 'task.update', 'task.delete',
    'document.read', 'document.upload', 'document.delete', 'document.approve',
    'tax.read', 'tax.update', 'notification.read', 'ai.use', 'report.read',
    'accounting.read', 'accounting.create', 'accounting.update', 'accounting.post',
    'billing.read', 'billing.manage',
  ],
  Manager: [
    'client.read', 'client.create', 'client.update',
    'engagement.read', 'engagement.update',
    'workflow.advance', 'workflow.manager_review',
    'task.read', 'task.create', 'task.update', 'task.delete',
    'document.read', 'document.upload', 'document.approve',
    'tax.read', 'notification.read', 'ai.use', 'report.read',
    'accounting.read', 'accounting.create', 'accounting.update', 'accounting.post',
    'billing.read', 'billing.manage',
  ],
  'Senior Auditor': [
    'client.read', 'engagement.read', 'engagement.update', 'workflow.advance',
    'task.read', 'task.create', 'task.update',
    'document.read', 'document.upload',
    'tax.read', 'notification.read', 'ai.use',
    'accounting.read',
  ],
  Accountant: [
    'client.read', 'engagement.read',
    'task.read', 'task.create', 'task.update',
    'document.read', 'document.upload',
    'tax.read', 'notification.read', 'ai.use', 'report.read',
    'accounting.read', 'accounting.create', 'accounting.update', 'accounting.post',
    'billing.read', 'billing.manage',
  ],
  'Tax Consultant': [
    'client.read', 'engagement.read',
    'task.read', 'task.create', 'task.update',
    'document.read', 'document.upload',
    'tax.read', 'tax.update', 'notification.read', 'ai.use',
    'accounting.read',
  ],
  Staff: [
    'client.read', 'engagement.read',
    'task.read', 'task.update',
    'document.read', 'document.upload', 'notification.read',
  ],
  Client: ['client.read', 'document.read', 'notification.read'],
};

function hasPermission(role, code) {
  const perms = PERMISSIONS[role] || [];
  return perms.includes('*') || perms.includes(code);
}

// ---- Audit workflow engine ----
// Ordered status flow requested by the firm.
const WORKFLOW_STAGES = [
  'Planning',
  'Engagement Letter',
  'Fieldwork',
  'Manager Review',
  'Partner Review',
  'Draft Financial Report',
  'Client Sign-off',
  'ROI Submission',
  'Completed',
];

// Permission required to ENTER a given stage (i.e. to complete the previous one).
// Stages not listed only require the generic 'workflow.advance'.
const STAGE_GATES = {
  'Partner Review': 'workflow.manager_review',     // completing Manager Review
  'Draft Financial Report': 'workflow.partner_review', // completing Partner Review
  'Completed': 'workflow.partner_review',
};

function stageIndex(name) {
  return WORKFLOW_STAGES.indexOf(name);
}

const OBLIGATION_TYPES = ['VAT', 'PAYE', 'SDL', 'NSSF', 'WCF', 'PDPC', 'PROVISIONAL_TAX', 'ROI', 'OTHER'];
const AUTHORITIES = ['TRA', 'NSSF', 'WCF', 'PDPC', 'OTHER'];

const DOC_TYPES = [
  'financial_statements', 'bank_statement', 'tra_document', 'tax_return',
  'engagement_letter', 'proof_of_payment', 'invoice', 'payroll',
  'wcf_nssf_pdpc', 'working_paper', 'other',
];

const CLIENT_CATEGORIES = ['Audit', 'Tax', 'Accounting', 'Consultancy'];

module.exports = {
  ROLES, ALL_CLIENT_ROLES, PERMISSIONS, hasPermission,
  WORKFLOW_STAGES, STAGE_GATES, stageIndex,
  OBLIGATION_TYPES, AUTHORITIES, DOC_TYPES, CLIENT_CATEGORIES,
};
