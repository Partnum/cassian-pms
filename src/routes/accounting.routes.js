'use strict';
/** Accounting: chart of accounts, journals, ledger, trial balance, financial
 *  statements and a VAT helper. Mounted at /api/v1/accounting. */
const express = require('express');
const router = express.Router();
const { q, one, uuid } = require('../config');
const { requirePermission, scopeClientIds, logActivity, asyncHandler } = require('../auth');
const acc = require('../services/accounting.service');

const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'income', 'expense'];

/** True if the user may act on this client (and the client is in their firm). */
async function canClient(req, clientId) {
  if (!clientId) return false;
  const ids = await scopeClientIds(req.user);
  if (ids === '*') {
    const c = await one('SELECT id FROM clients WHERE id=? AND firm_id=?', [clientId, req.user.firmId]);
    return !!c;
  }
  return ids.includes(clientId);
}
function deny(res) { return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'No access to this client' } }); }
function bad(res, message) { return res.status(400).json({ error: { code: 'BAD_INPUT', message } }); }

/* ---------------- Chart of accounts ---------------- */
router.get('/accounts', requirePermission('accounting.read'), asyncHandler(async (req, res) => {
  const clientId = req.query.client_id;
  if (!(await canClient(req, clientId))) return deny(res);
  const rows = await q(
    `SELECT id, code, name, type, parent_id, is_active
       FROM chart_of_accounts WHERE firm_id=? AND client_id=? ORDER BY code`,
    [req.user.firmId, clientId]
  );
  res.json({ data: rows });
}));

router.post('/accounts', requirePermission('accounting.create'), asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!(await canClient(req, b.client_id))) return deny(res);
  if (!b.code || !b.name || !ACCOUNT_TYPES.includes(b.type)) return bad(res, 'code, name and a valid type are required');
  const dup = await one('SELECT id FROM chart_of_accounts WHERE firm_id=? AND client_id=? AND code=?', [req.user.firmId, b.client_id, b.code]);
  if (dup) return bad(res, 'An account with this code already exists for the client');
  const id = uuid();
  await q(
    `INSERT INTO chart_of_accounts (id, firm_id, client_id, code, name, type, parent_id)
     VALUES (?,?,?,?,?,?,?)`,
    [id, req.user.firmId, b.client_id, String(b.code), b.name, b.type, b.parent_id || null]
  );
  await logActivity(req, 'create', 'account', id, { code: b.code });
  res.status(201).json({ data: { id } });
}));

/* ---------------- Journal entries ---------------- */
router.get('/journals', requirePermission('accounting.read'), asyncHandler(async (req, res) => {
  const clientId = req.query.client_id;
  if (!(await canClient(req, clientId))) return deny(res);
  let where = 'j.firm_id=? AND j.client_id=?'; const p = [req.user.firmId, clientId];
  if (req.query.status) { where += ' AND j.status=?'; p.push(req.query.status); }
  const rows = await q(
    `SELECT j.id, j.ref_no, j.entry_date, j.narration, j.currency, j.status,
            COALESCE((SELECT SUM(l.debit) FROM journal_lines l WHERE l.journal_id=j.id),0) AS total,
            (SELECT COUNT(*)::int FROM journal_lines l WHERE l.journal_id=j.id) AS lines
       FROM journal_entries j WHERE ${where} ORDER BY j.entry_date DESC, j.created_at DESC`,
    p
  );
  res.json({ data: rows });
}));

router.get('/journals/:id', requirePermission('accounting.read'), asyncHandler(async (req, res) => {
  const j = await one('SELECT * FROM journal_entries WHERE id=? AND firm_id=?', [req.params.id, req.user.firmId]);
  if (!j || !(await canClient(req, j.client_id))) return deny(res);
  const lines = await q(
    `SELECT l.id, l.account_id, a.code, a.name, l.description, l.debit, l.credit, l.currency, l.fx_rate
       FROM journal_lines l JOIN chart_of_accounts a ON a.id=l.account_id
      WHERE l.journal_id=? ORDER BY l.created_at`,
    [req.params.id]
  );
  res.json({ data: { ...j, lines } });
}));

router.post('/journals', requirePermission('accounting.create'), asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!(await canClient(req, b.client_id))) return deny(res);
  if (!b.entry_date) return bad(res, 'entry_date is required');
  const lines = Array.isArray(b.lines) ? b.lines : [];
  if (lines.length < 2) return bad(res, 'At least two journal lines are required');

  let totalDebit = 0, totalCredit = 0;
  for (const l of lines) {
    const debit = Number(l.debit || 0), credit = Number(l.credit || 0);
    if (debit < 0 || credit < 0) return bad(res, 'Debit/credit cannot be negative');
    if (debit > 0 && credit > 0) return bad(res, 'A line cannot have both a debit and a credit');
    if (!l.account_id) return bad(res, 'Each line needs an account');
    totalDebit += debit; totalCredit += credit;
  }
  totalDebit = Math.round(totalDebit * 100) / 100; totalCredit = Math.round(totalCredit * 100) / 100;
  if (totalDebit === 0) return bad(res, 'Journal total cannot be zero');
  if (Math.abs(totalDebit - totalCredit) > 0.01) return bad(res, `Out of balance: debits ${totalDebit} ≠ credits ${totalCredit}`);

  // Validate all accounts belong to this client.
  const acctIds = [...new Set(lines.map((l) => l.account_id))];
  const owned = await q(
    `SELECT id FROM chart_of_accounts WHERE firm_id=? AND client_id=? AND id IN (${acctIds.map(() => '?').join(',')})`,
    [req.user.firmId, b.client_id, ...acctIds]
  );
  if (owned.length !== acctIds.length) return bad(res, 'One or more accounts do not belong to this client');

  const id = uuid();
  await q(
    `INSERT INTO journal_entries (id, firm_id, client_id, ref_no, entry_date, narration, currency, status, created_by)
     VALUES (?,?,?,?,?,?,?, 'draft', ?)`,
    [id, req.user.firmId, b.client_id, b.ref_no || null, b.entry_date, b.narration || null, b.currency || 'TZS', req.user.id]
  );
  for (const l of lines) {
    await q(
      `INSERT INTO journal_lines (id, journal_id, account_id, description, debit, credit, currency, fx_rate)
       VALUES (?,?,?,?,?,?,?,?)`,
      [uuid(), id, l.account_id, l.description || null, Number(l.debit || 0), Number(l.credit || 0), l.currency || (b.currency || 'TZS'), Number(l.fx_rate || 1)]
    );
  }
  await logActivity(req, 'create', 'journal', id, { total: totalDebit });
  res.status(201).json({ data: { id } });
}));

router.post('/journals/:id/post', requirePermission('accounting.post'), asyncHandler(async (req, res) => {
  const j = await one('SELECT * FROM journal_entries WHERE id=? AND firm_id=?', [req.params.id, req.user.firmId]);
  if (!j || !(await canClient(req, j.client_id))) return deny(res);
  if (j.status !== 'draft') return bad(res, 'Only draft entries can be posted');
  const bal = await one('SELECT COALESCE(SUM(debit),0) AS d, COALESCE(SUM(credit),0) AS c FROM journal_lines WHERE journal_id=?', [req.params.id]);
  if (Math.abs(Number(bal.d) - Number(bal.c)) > 0.01) return bad(res, 'Entry is out of balance and cannot be posted');
  await q(`UPDATE journal_entries SET status='posted', posted_by=? WHERE id=?`, [req.user.id, req.params.id]);
  await logActivity(req, 'post', 'journal', req.params.id, null);
  res.json({ data: { ok: true } });
}));

router.post('/journals/:id/reverse', requirePermission('accounting.post'), asyncHandler(async (req, res) => {
  const j = await one('SELECT * FROM journal_entries WHERE id=? AND firm_id=?', [req.params.id, req.user.firmId]);
  if (!j || !(await canClient(req, j.client_id))) return deny(res);
  if (j.status !== 'posted') return bad(res, 'Only posted entries can be reversed');
  const lines = await q('SELECT * FROM journal_lines WHERE journal_id=?', [req.params.id]);
  const revId = uuid();
  await q(
    `INSERT INTO journal_entries (id, firm_id, client_id, ref_no, entry_date, narration, currency, status, created_by, posted_by)
     VALUES (?,?,?,?,?,?,?, 'posted', ?, ?)`,
    [revId, req.user.firmId, j.client_id, (j.ref_no ? j.ref_no + '-REV' : null), new Date().toISOString().slice(0, 10),
      'Reversal of ' + (j.ref_no || j.id.slice(0, 8)), j.currency, req.user.id, req.user.id]
  );
  for (const l of lines) {
    await q(
      `INSERT INTO journal_lines (id, journal_id, account_id, description, debit, credit, currency, fx_rate)
       VALUES (?,?,?,?,?,?,?,?)`,
      [uuid(), revId, l.account_id, 'Reversal', l.credit, l.debit, l.currency, l.fx_rate]
    );
  }
  await q(`UPDATE journal_entries SET status='reversed' WHERE id=?`, [req.params.id]);
  await logActivity(req, 'reverse', 'journal', req.params.id, { reversal: revId });
  res.json({ data: { ok: true, reversal_id: revId } });
}));

/* ---------------- Reports ---------------- */
router.get('/trial-balance', requirePermission('accounting.read'), asyncHandler(async (req, res) => {
  const clientId = req.query.client_id;
  if (!(await canClient(req, clientId))) return deny(res);
  const tb = await acc.computeTrialBalance(req.user.firmId, clientId, { from: req.query.from, to: req.query.to });
  res.json({ data: tb });
}));

router.get('/financial-statements', requirePermission('accounting.read'), asyncHandler(async (req, res) => {
  const clientId = req.query.client_id;
  if (!(await canClient(req, clientId))) return deny(res);
  const fs = await acc.computeFinancialStatements(req.user.firmId, clientId, { from: req.query.from, to: req.query.to });
  res.json({ data: fs });
}));

router.get('/ledger', requirePermission('accounting.read'), asyncHandler(async (req, res) => {
  const clientId = req.query.client_id;
  if (!(await canClient(req, clientId))) return deny(res);
  if (!req.query.account_id) return bad(res, 'account_id is required');
  const led = await acc.computeLedger(req.user.firmId, clientId, req.query.account_id, { from: req.query.from, to: req.query.to });
  if (!led) return bad(res, 'Account not found');
  res.json({ data: led });
}));

router.post('/vat-calc', requirePermission('accounting.read'), asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (b.amount == null || isNaN(Number(b.amount))) return bad(res, 'amount is required');
  res.json({ data: acc.vatCalc({ amount: b.amount, rate: b.rate != null ? b.rate : 18, inclusive: !!b.inclusive }) });
}));

module.exports = router;
