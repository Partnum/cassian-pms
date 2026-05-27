'use strict';
/** Excel / PDF export endpoints. Mounted at /api/v1/export. */
const express = require('express');
const router = express.Router();
const { q, one } = require('../config');
const { requirePermission, scopeClientIds, canAccessClient, asyncHandler } = require('../auth');
const acc = require('../services/accounting.service');
const xp = require('../services/export.service');

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PDF = 'application/pdf';
function sendFile(res, buf, type, filename) {
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(Buffer.from(buf));
}
const deny = (res) => res.status(403).json({ error: { code: 'FORBIDDEN', message: 'No access' } });

async function scopedClients(req) {
  const ids = await scopeClientIds(req.user);
  let where = 'c.deleted_at IS NULL AND c.firm_id=?'; const p = [req.user.firmId];
  if (ids !== '*') { if (!ids.length) return []; where += ` AND c.id IN (${ids.map(() => '?').join(',')})`; p.push(...ids); }
  return q(`SELECT c.*, mu.full_name AS manager_name FROM clients c LEFT JOIN users mu ON mu.id=c.manager_id WHERE ${where} ORDER BY c.name`, p);
}

router.get('/clients.xlsx', requirePermission('report.read'), asyncHandler(async (req, res) => {
  sendFile(res, await xp.clientsXlsx(await scopedClients(req)), XLSX, 'clients.xlsx');
}));

router.get('/tax-obligations.xlsx', requirePermission('report.read'), asyncHandler(async (req, res) => {
  const ids = await scopeClientIds(req.user);
  let where = 'o.firm_id=?'; const p = [req.user.firmId];
  if (ids !== '*') {
    if (!ids.length) return sendFile(res, await xp.obligationsXlsx([]), XLSX, 'tax-obligations.xlsx');
    where += ` AND o.client_id IN (${ids.map(() => '?').join(',')})`; p.push(...ids);
  }
  const rows = await q(`SELECT o.*, c.name AS client_name FROM statutory_deadlines o JOIN clients c ON c.id=o.client_id WHERE ${where} ORDER BY o.due_date`, p);
  sendFile(res, await xp.obligationsXlsx(rows), XLSX, 'tax-obligations.xlsx');
}));

async function loadClient(req, res) {
  const cid = req.query.client_id;
  if (!cid || !(await canAccessClient(req.user, cid))) { deny(res); return null; }
  const client = await one('SELECT name FROM clients WHERE id=? AND firm_id=?', [cid, req.user.firmId]);
  if (!client) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Client not found' } }); return null; }
  return { cid, client };
}

router.get('/trial-balance.xlsx', requirePermission('report.read'), asyncHandler(async (req, res) => {
  const ctx = await loadClient(req, res); if (!ctx) return;
  const tb = await acc.computeTrialBalance(req.user.firmId, ctx.cid, {});
  sendFile(res, await xp.trialBalanceXlsx(ctx.client, tb), XLSX, 'trial-balance.xlsx');
}));

router.get('/trial-balance.pdf', requirePermission('report.read'), asyncHandler(async (req, res) => {
  const ctx = await loadClient(req, res); if (!ctx) return;
  const tb = await acc.computeTrialBalance(req.user.firmId, ctx.cid, {});
  sendFile(res, await xp.trialBalancePdf(ctx.client, tb), PDF, 'trial-balance.pdf');
}));

router.get('/financial-statements.pdf', requirePermission('report.read'), asyncHandler(async (req, res) => {
  const ctx = await loadClient(req, res); if (!ctx) return;
  const fs = await acc.computeFinancialStatements(req.user.firmId, ctx.cid, {});
  sendFile(res, await xp.financialStatementsPdf(ctx.client, fs), PDF, 'financial-statements.pdf');
}));

module.exports = router;
