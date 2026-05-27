'use strict';
/** Global search across clients, tasks, documents, invoices, tax deadlines.
 *  Firm-scoped and client-access-aware. Mounted at /api/v1/search. */
const express = require('express');
const router = express.Router();
const { q } = require('../config');
const { scopeClientIds, asyncHandler } = require('../auth');

router.get('/', asyncHandler(async (req, res) => {
  const term = (req.query.q || '').trim();
  const empty = { clients: [], tasks: [], documents: [], invoices: [], deadlines: [] };
  if (term.length < 2) return res.json({ data: empty });
  const like = '%' + term + '%';
  const firm = req.user.firmId;
  const ids = await scopeClientIds(req.user);
  const scoped = ids !== '*';
  if (scoped && !ids.length) return res.json({ data: empty });
  const inC = scoped ? ` AND client_id IN (${ids.map(() => '?').join(',')})` : '';
  const inClient = scoped ? ` AND id IN (${ids.map(() => '?').join(',')})` : '';

  const clients = await q(
    `SELECT id, name, category FROM clients
      WHERE firm_id=? AND deleted_at IS NULL AND (name ILIKE ? OR tin ILIKE ? OR vrn ILIKE ?)${inClient}
      ORDER BY name LIMIT 8`,
    scoped ? [firm, like, like, like, ...ids] : [firm, like, like, like]);
  const tasks = await q(
    `SELECT id, title, status FROM tasks WHERE firm_id=? AND title ILIKE ?${inC} ORDER BY created_at DESC LIMIT 8`,
    scoped ? [firm, like, ...ids] : [firm, like]);
  const documents = await q(
    `SELECT id, name FROM documents WHERE firm_id=? AND deleted_at IS NULL AND name ILIKE ?${inC} ORDER BY created_at DESC LIMIT 8`,
    scoped ? [firm, like, ...ids] : [firm, like]);
  const invoices = await q(
    `SELECT id, number, total, status FROM invoices WHERE firm_id=? AND client_id IS NOT NULL AND number ILIKE ?${inC} ORDER BY created_at DESC LIMIT 8`,
    scoped ? [firm, like, ...ids] : [firm, like]);
  const deadlines = await q(
    `SELECT id, type, period, due_date, status FROM statutory_deadlines WHERE firm_id=? AND (type ILIKE ? OR period ILIKE ?)${inC} ORDER BY due_date DESC LIMIT 8`,
    scoped ? [firm, like, like, ...ids] : [firm, like, like]);

  res.json({ data: { clients, tasks, documents, invoices, deadlines } });
}));

module.exports = router;
