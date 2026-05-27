'use strict';
/**
 * Accounting computations derived from POSTED journal entries.
 * All amounts are converted to the client's base currency using each line's
 * fx_rate (debit*fx_rate / credit*fx_rate), so multi-currency books roll up
 * into a single trial balance / set of financial statements.
 */
const { q } = require('../config');

// Account "natural" side: assets & expenses are debit-normal; the rest credit-normal.
const DEBIT_NORMAL = ['asset', 'expense'];

function num(v) { return Number(v || 0); }
function round2(v) { return Math.round((Number(v) + Number.EPSILON) * 100) / 100; }

/** Optional date filter on the journal entry date. */
function dateClause(from, to, alias = 'j') {
  let clause = ''; const params = [];
  if (from) { clause += ` AND ${alias}.entry_date >= ?`; params.push(from); }
  if (to) { clause += ` AND ${alias}.entry_date <= ?`; params.push(to); }
  return { clause, params };
}

/**
 * Per-account posted totals for a client.
 * Returns rows: { account_id, code, name, type, debit, credit, balance }
 * where balance is signed on the account's natural side.
 */
async function accountTotals(firmId, clientId, { from, to } = {}) {
  const d = dateClause(from, to);
  const rows = await q(
    `SELECT a.id AS account_id, a.code, a.name, a.type,
            COALESCE(SUM(l.debit  * l.fx_rate), 0)  AS debit,
            COALESCE(SUM(l.credit * l.fx_rate), 0)  AS credit
       FROM chart_of_accounts a
       JOIN journal_lines   l ON l.account_id = a.id
       JOIN journal_entries j ON j.id = l.journal_id
      WHERE j.firm_id = ? AND j.client_id = ? AND j.status = 'posted' ${d.clause}
      GROUP BY a.id, a.code, a.name, a.type
      HAVING COALESCE(SUM(l.debit * l.fx_rate), 0) <> 0
          OR COALESCE(SUM(l.credit * l.fx_rate), 0) <> 0
      ORDER BY a.code`,
    [firmId, clientId, ...d.params]
  );
  return rows.map((r) => {
    const debit = round2(num(r.debit));
    const credit = round2(num(r.credit));
    const natural = DEBIT_NORMAL.includes(r.type) ? debit - credit : credit - debit;
    return { account_id: r.account_id, code: r.code, name: r.name, type: r.type, debit, credit, balance: round2(natural) };
  });
}

/** Classic trial balance: each account's net balance in its column; totals must match. */
async function computeTrialBalance(firmId, clientId, opts = {}) {
  const totals = await accountTotals(firmId, clientId, opts);
  const rows = totals.map((r) => {
    const net = round2(r.debit - r.credit); // raw debit-credit
    return {
      account_id: r.account_id, code: r.code, name: r.name, type: r.type,
      debit: net > 0 ? net : 0,
      credit: net < 0 ? -net : 0,
    };
  });
  const totalDebit = round2(rows.reduce((s, r) => s + r.debit, 0));
  const totalCredit = round2(rows.reduce((s, r) => s + r.credit, 0));
  return { rows, totals: { debit: totalDebit, credit: totalCredit }, balanced: Math.abs(totalDebit - totalCredit) < 0.01 };
}

/** IFRS-style P&L and Statement of Financial Position from posted entries. */
async function computeFinancialStatements(firmId, clientId, opts = {}) {
  const totals = await accountTotals(firmId, clientId, opts);
  const pick = (t) => totals.filter((r) => r.type === t)
    .map((r) => ({ code: r.code, name: r.name, amount: r.balance }));

  const income = pick('income');
  const expense = pick('expense');
  const assets = pick('asset');
  const liabilities = pick('liability');
  const equity = pick('equity');

  const sum = (arr) => round2(arr.reduce((s, r) => s + r.amount, 0));
  const totalIncome = sum(income);
  const totalExpense = sum(expense);
  const profit = round2(totalIncome - totalExpense);

  const totalAssets = sum(assets);
  const totalLiabilities = sum(liabilities);
  // Equity per the books + current-period profit (not yet closed to retained earnings).
  const equityBooked = sum(equity);
  const totalEquity = round2(equityBooked + profit);

  return {
    profitAndLoss: {
      income, expense,
      totalIncome, totalExpense, profit,
    },
    balanceSheet: {
      assets, liabilities, equity,
      totalAssets,
      totalLiabilities,
      equityBooked,
      currentProfit: profit,
      totalEquity,
      totalLiabilitiesAndEquity: round2(totalLiabilities + totalEquity),
      balanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01,
    },
  };
}

/** Running-balance ledger for one account. */
async function computeLedger(firmId, clientId, accountId, { from, to } = {}) {
  const acct = await q(`SELECT id, code, name, type FROM chart_of_accounts WHERE id=? AND firm_id=?`, [accountId, firmId]);
  if (!acct.length) return null;
  const d = dateClause(from, to);
  const lines = await q(
    `SELECT j.entry_date, j.ref_no, j.narration, l.description,
            (l.debit  * l.fx_rate) AS debit,
            (l.credit * l.fx_rate) AS credit
       FROM journal_lines l
       JOIN journal_entries j ON j.id = l.journal_id
      WHERE j.firm_id=? AND j.client_id=? AND l.account_id=? AND j.status='posted' ${d.clause}
      ORDER BY j.entry_date, j.created_at`,
    [firmId, clientId, accountId, ...d.params]
  );
  const debitNormal = DEBIT_NORMAL.includes(acct[0].type);
  let running = 0;
  const rows = lines.map((l) => {
    const debit = round2(num(l.debit));
    const credit = round2(num(l.credit));
    running = round2(running + (debitNormal ? debit - credit : credit - debit));
    return { entry_date: l.entry_date, ref_no: l.ref_no, narration: l.narration, description: l.description, debit, credit, balance: running };
  });
  return { account: acct[0], rows, closing: running };
}

/** Tanzania VAT helper (standard rate 18%). */
function vatCalc({ amount, rate = 18, inclusive = false }) {
  const a = Number(amount || 0);
  const r = Number(rate || 0) / 100;
  if (inclusive) {
    const net = round2(a / (1 + r));
    return { net, vat: round2(a - net), gross: round2(a), rate: Number(rate), inclusive: true };
  }
  const vat = round2(a * r);
  return { net: round2(a), vat, gross: round2(a + vat), rate: Number(rate), inclusive: false };
}

module.exports = { computeTrialBalance, computeFinancialStatements, computeLedger, accountTotals, vatCalc };
