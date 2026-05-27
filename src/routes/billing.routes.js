'use strict';
/** Client fee invoicing, payments and revenue analytics. Mounted at /api/v1/billing. */
const express = require('express');
const router = express.Router();
const { q, one, uuid } = require('../config');
const { requirePermission, logActivity, asyncHandler } = require('../auth');

const METHODS = ['mpesa', 'airtel', 'tigo', 'halopesa', 'card', 'bank'];
const bad = (res, m) => res.status(400).json({ error: { code: 'BAD_INPUT', message: m } });

// List client fee invoices.
router.get('/invoices', requirePermission('billing.read'), asyncHandler(async (req, res) => {
  let where = 'i.firm_id=? AND i.client_id IS NOT NULL'; const p = [req.user.firmId];
  if (req.query.status) { where += ' AND i.status=?'; p.push(req.query.status); }
  const rows = await q(
    `SELECT i.id, i.number, i.status, i.currency, i.subtotal, i.tax, i.total, i.issued_at, i.due_at, i.paid_at, i.created_at,
            c.name AS client_name,
            COALESCE((SELECT SUM(pay.amount) FROM payments pay WHERE pay.invoice_id=i.id AND pay.status='succeeded'),0) AS paid
       FROM invoices i LEFT JOIN clients c ON c.id=i.client_id
      WHERE ${where} ORDER BY i.created_at DESC`, p);
  res.json({ data: rows });
}));

// Create a draft invoice.
router.post('/invoices', requirePermission('billing.manage'), asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!b.client_id) return bad(res, 'client_id is required');
  const client = await one('SELECT id FROM clients WHERE id=? AND firm_id=? AND deleted_at IS NULL', [b.client_id, req.user.firmId]);
  if (!client) return bad(res, 'Client not found');
  const lines = Array.isArray(b.lines) ? b.lines : [];
  if (!lines.length) return bad(res, 'At least one line item is required');
  let subtotal = 0;
  const norm = lines.map((l) => {
    const qty = Number(l.quantity || 1), ua = Number(l.unit_amount || 0);
    const amt = Math.round(qty * ua * 100) / 100; subtotal += amt;
    return { description: l.description || 'Service', quantity: qty, unit_amount: ua, amount: amt };
  });
  subtotal = Math.round(subtotal * 100) / 100;
  const tax = b.tax != null ? Number(b.tax) : (b.vat ? Math.round(subtotal * 0.18 * 100) / 100 : 0);
  const total = Math.round((subtotal + tax) * 100) / 100;
  const year = new Date().getFullYear();
  const cnt = await one('SELECT COUNT(*)::int n FROM invoices WHERE firm_id=? AND client_id IS NOT NULL', [req.user.firmId]);
  const number = `INV-${year}-${String((cnt.n || 0) + 1).padStart(4, '0')}`;
  const id = uuid();
  await q(
    `INSERT INTO invoices (id, firm_id, client_id, number, currency, subtotal, tax, total, status, due_at, notes)
     VALUES (?,?,?,?,?,?,?,?, 'draft', ?, ?)`,
    [id, req.user.firmId, b.client_id, number, b.currency || 'TZS', subtotal, tax, total, b.due_at || null, b.notes || null]);
  for (const l of norm) {
    await q(`INSERT INTO invoice_lines (id, invoice_id, kind, description, quantity, unit_amount, amount) VALUES (?,?,?,?,?,?,?)`,
      [uuid(), id, 'service', l.description, l.quantity, l.unit_amount, l.amount]);
  }
  if (tax > 0) {
    await q(`INSERT INTO invoice_lines (id, invoice_id, kind, description, quantity, unit_amount, amount) VALUES (?,?,?,?,?,?,?)`,
      [uuid(), id, 'tax', 'VAT 18%', 1, tax, tax]);
  }
  await logActivity(req, 'create', 'invoice', id, { number, total });
  res.status(201).json({ data: { id, number } });
}));

// Invoice detail + lines + payments.
router.get('/invoices/:id', requirePermission('billing.read'), asyncHandler(async (req, res) => {
  const inv = await one(`SELECT i.*, c.name AS client_name FROM invoices i LEFT JOIN clients c ON c.id=i.client_id WHERE i.id=? AND i.firm_id=?`, [req.params.id, req.user.firmId]);
  if (!inv) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Invoice not found' } });
  inv.lines = await q('SELECT kind, description, quantity, unit_amount, amount FROM invoice_lines WHERE invoice_id=?', [req.params.id]);
  inv.payments = await q("SELECT method, amount, status, msisdn, provider_ref, paid_at, created_at FROM payments WHERE invoice_id=? ORDER BY created_at", [req.params.id]);
  res.json({ data: inv });
}));

// Issue (move draft -> open).
router.post('/invoices/:id/issue', requirePermission('billing.manage'), asyncHandler(async (req, res) => {
  const inv = await one('SELECT * FROM invoices WHERE id=? AND firm_id=?', [req.params.id, req.user.firmId]);
  if (!inv) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Invoice not found' } });
  if (inv.status !== 'draft') return bad(res, 'Only draft invoices can be issued');
  await q("UPDATE invoices SET status='open', issued_at=NOW() WHERE id=?", [req.params.id]);
  await logActivity(req, 'issue', 'invoice', req.params.id);
  res.json({ data: { ok: true } });
}));

// Record a payment (mobile money / bank / card). Marks the invoice paid when fully settled.
router.post('/invoices/:id/payments', requirePermission('billing.manage'), asyncHandler(async (req, res) => {
  const b = req.body || {};
  const inv = await one('SELECT * FROM invoices WHERE id=? AND firm_id=?', [req.params.id, req.user.firmId]);
  if (!inv) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Invoice not found' } });
  if (!METHODS.includes(b.method)) return bad(res, 'Invalid payment method');
  const amount = Number(b.amount || 0);
  if (amount <= 0) return bad(res, 'Amount must be greater than zero');
  await q(
    `INSERT INTO payments (id, firm_id, invoice_id, method, provider, provider_ref, amount, currency, status, msisdn, paid_at)
     VALUES (?,?,?,?,?,?,?,?, 'succeeded', ?, NOW())`,
    [uuid(), req.user.firmId, req.params.id, b.method, b.provider || null, b.provider_ref || null, amount, inv.currency, b.msisdn || null]);
  const paid = await one("SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE invoice_id=? AND status='succeeded'", [req.params.id]);
  if (Number(paid.s) >= Number(inv.total) && inv.status !== 'paid') {
    await q("UPDATE invoices SET status='paid', paid_at=NOW() WHERE id=?", [req.params.id]);
  }
  await logActivity(req, 'payment', 'invoice', req.params.id, { amount, method: b.method });
  res.status(201).json({ data: { ok: true, paid: Number(paid.s) } });
}));

// Revenue analytics.
router.get('/revenue', requirePermission('billing.read'), asyncHandler(async (req, res) => {
  const f = [req.user.firmId];
  const totals = await one(
    `SELECT
       COALESCE(SUM(i.total) FILTER (WHERE i.status IN ('open','paid')),0) AS invoiced,
       COALESCE(SUM(i.total) FILTER (WHERE i.status='paid'),0)            AS paid_total,
       COALESCE(SUM(i.total) FILTER (WHERE i.status='open'),0)            AS outstanding,
       COUNT(*) FILTER (WHERE i.status='draft')::int AS drafts,
       COUNT(*) FILTER (WHERE i.status='open')::int  AS open_n,
       COUNT(*) FILTER (WHERE i.status='paid')::int  AS paid_n
     FROM invoices i WHERE i.firm_id=? AND i.client_id IS NOT NULL`, f);
  const collected = await one(
    `SELECT COALESCE(SUM(pay.amount),0) AS s FROM payments pay JOIN invoices i ON i.id=pay.invoice_id
      WHERE i.firm_id=? AND i.client_id IS NOT NULL AND pay.status='succeeded'`, f);
  const byMonth = await q(
    `SELECT to_char(date_trunc('month', COALESCE(i.issued_at, i.created_at)),'YYYY-MM') AS month,
            COALESCE(SUM(i.total),0) AS amount
       FROM invoices i WHERE i.firm_id=? AND i.client_id IS NOT NULL AND i.status IN ('open','paid')
      GROUP BY 1 ORDER BY 1`, f);
  const topClients = await q(
    `SELECT c.name AS client, COALESCE(SUM(i.total),0) AS amount
       FROM invoices i JOIN clients c ON c.id=i.client_id
      WHERE i.firm_id=? AND i.client_id IS NOT NULL AND i.status IN ('open','paid')
      GROUP BY c.name ORDER BY amount DESC LIMIT 5`, f);
  res.json({ data: { totals, collected: Number(collected.s), byMonth, topClients } });
}));

module.exports = router;
