'use strict';
/**
 * Connects document ingestion to the audit workflow:
 *  - notifies the client's manager & partner of new files
 *  - auto-advances the engagement when a document maps to the immediate next,
 *    NON-gated stage (e.g. EL -> "Engagement Letter", working papers -> "Fieldwork")
 *  - for gated or further-ahead stages, raises a review task instead of skipping
 *    (respects the manager/partner review gates)
 */
const { q, one, uuid } = require('../config');
const { WORKFLOW_STAGES, STAGE_GATES, stageIndex } = require('../constants');
const { DETECTED_TYPE_STAGE } = require('../drive.config');
const { createNotification } = require('./notifications.service');

const LABELS = {
  engagement_letter: 'Engagement Letter', bank_statement: 'Bank Statement',
  working_paper: 'Working Papers', trial_balance: 'Trial Balance',
  financial_statements: 'Financial Statements', final_financial_statements: 'Final Financial Statements',
  tax_return: 'Tax Return', roi: 'Return of Income', tra_document: 'TRA Document',
  vat_schedule: 'VAT Schedule', invoice: 'Invoice', payroll: 'Payroll', proof_of_payment: 'Proof of Payment',
};
const labelFor = (t) => LABELS[t] || (t || 'document').replace(/_/g, ' ');

async function onDocumentIngested(doc, ctx = {}) {
  const client = await one('SELECT id, name, manager_id, engagement_partner_id, category, firm_id FROM clients WHERE id=?', [doc.client_id]);
  if (!client) return { skipped: true };
  const firmId = doc.firm_id || client.firm_id;
  const recipients = [client.manager_id, client.engagement_partner_id].filter(Boolean);

  // Always notify the engagement team of the new file
  for (const uid of new Set(recipients)) {
    await createNotification({ firmId, userId: uid, type: 'info', title: `New document: ${doc.name}`, body: `${labelFor(doc.detected_type)} added for ${client.name}.`, link: '/app.html#documents' });
  }

  const targetStage = DETECTED_TYPE_STAGE[doc.detected_type];
  if (!targetStage) return { notified: recipients.length };

  const eng = await one("SELECT * FROM audit_engagements WHERE client_id=? AND type='Audit' ORDER BY financial_year DESC LIMIT 1", [doc.client_id]);
  if (!eng) return { notified: recipients.length };

  const ci = stageIndex(eng.current_stage);
  const ti = stageIndex(targetStage);
  if (ti < 0) return { notified: recipients.length };
  const gated = !!STAGE_GATES[targetStage];

  if (ti === ci + 1 && !gated) {
    // Safe auto-advance
    await q("UPDATE audit_stages SET status='completed', progress_pct=100, completed_at=now() WHERE engagement_id=? AND name=?", [eng.id, eng.current_stage]);
    await q("UPDATE audit_stages SET status='in_progress', started_at=COALESCE(started_at, now()) WHERE engagement_id=? AND name=?", [eng.id, targetStage]);
    const prog = Math.round((ti / (WORKFLOW_STAGES.length - 1)) * 100);
    await q('UPDATE audit_engagements SET current_stage=?, progress_pct=? WHERE id=?', [targetStage, prog, eng.id]);
    await q('INSERT INTO audit_workflow_history (id, engagement_id, from_stage, to_stage, action, changed_by, note) VALUES (?,?,?,?,?,?,?)',
      [uuid(), eng.id, eng.current_stage, targetStage, 'auto-advance', ctx.userId || null, `Auto-advanced on upload of ${doc.name}`]);
    for (const uid of new Set(recipients)) {
      await createNotification({ firmId, userId: uid, type: 'success', title: `Stage advanced: ${targetStage}`, body: `${client.name} moved to "${targetStage}" after ${doc.name} was uploaded.`, link: '/app.html#workflow' });
    }
    return { advanced: targetStage };
  }

  if (ti > ci) {
    // Gated or non-adjacent: raise a review task instead of skipping
    const assignee = client.manager_id || client.engagement_partner_id || null;
    await q('INSERT INTO tasks (id, firm_id, title, description, client_id, engagement_id, assignee_id, created_by, priority, status) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [uuid(), firmId, `Review ${labelFor(doc.detected_type)} & advance to ${targetStage}`, `Triggered by upload of ${doc.name}.`, client.id, eng.id, assignee, ctx.userId || null, 'high', 'open']);
    for (const uid of new Set(recipients)) {
      await createNotification({ firmId, userId: uid, type: 'warning', title: `Action needed: ${targetStage}`, body: `${doc.name} uploaded — review and advance ${client.name} to "${targetStage}".`, link: '/app.html#workflow' });
    }
    return { task: true, targetStage };
  }

  return { notified: recipients.length };
}

module.exports = { onDocumentIngested, labelFor };
