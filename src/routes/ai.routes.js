'use strict';
/** AI module. Mounted at /api/v1/ai. Requires the 'ai.use' permission. */
const express = require('express');
const router = express.Router();
const { q } = require('../config');
const { requirePermission, scopeClientIds, canAccessClient, asyncHandler } = require('../auth');
const ai = require('../services/ai.service');
const prompts = require('../ai/prompts');
const risk = require('../ai/risk.service');
const analytics = require('../ai/analytics.service');
const nlq = require('../ai/nlq.service');
const reports = require('../ai/reports.service');
const assistant = require('../ai/assistant.service');

router.use(requirePermission('ai.use'));

const forbid = (res) => res.status(403).json({ error: { code: 'FORBIDDEN', message: 'No access to this client' } });

async function clientContext(clientId) {
  if (!clientId) return '';
  const docs = await q('SELECT name, LEFT(ocr_text, 240) AS snippet FROM documents WHERE client_id=? AND deleted_at IS NULL LIMIT 6', [clientId]);
  if (!docs.length) return '';
  return '\n\nRelevant documents on file:\n' + docs.map((d) => `- ${d.name}: ${d.snippet || ''}`).join('\n');
}

// ---------------- Assistant (stateless + variance/conclusions) ----------------
router.post('/chat', asyncHandler(async (req, res) => {
  const { prompt, client_id, engagement_id } = req.body || {};
  if (!prompt) return res.status(400).json({ error: { code: 'BAD_INPUT', message: 'prompt is required' } });
  const out = await ai.chat(prompt + (await clientContext(client_id)));
  await ai.logAi({ firmId: req.user.firmId, userId: req.user.id, clientId: client_id, engagementId: engagement_id, feature: 'chat', prompt, response: out.text, model: out.model, tokens: out.tokens });
  res.json({ data: { text: out.text, model: out.model } });
}));

router.post('/variance', asyncHandler(async (req, res) => {
  const { subject, context, client_id } = req.body || {};
  if (!subject) return res.status(400).json({ error: { code: 'BAD_INPUT', message: 'subject is required' } });
  const out = await ai.callLLM(prompts.variance(subject, (context || '') + (await clientContext(client_id))), prompts.SYSTEM);
  await ai.logAi({ firmId: req.user.firmId, userId: req.user.id, clientId: client_id, feature: 'variance', prompt: subject, response: out.text, model: out.model, tokens: out.tokens });
  res.json({ data: { text: out.text, model: out.model } });
}));

router.post('/audit-comments', asyncHandler(async (req, res) => {
  const { area, details, client_id } = req.body || {};
  if (!area) return res.status(400).json({ error: { code: 'BAD_INPUT', message: 'area is required' } });
  const out = await ai.callLLM(prompts.auditComments(area, (details || '') + (await clientContext(client_id))), prompts.SYSTEM);
  await ai.logAi({ firmId: req.user.firmId, userId: req.user.id, clientId: client_id, feature: 'audit_comments', prompt: area, response: out.text, model: out.model, tokens: out.tokens });
  res.json({ data: { text: out.text, model: out.model } });
}));

router.post('/management-letter-point', asyncHandler(async (req, res) => {
  const { finding, client_id } = req.body || {};
  if (!finding) return res.status(400).json({ error: { code: 'BAD_INPUT', message: 'finding is required' } });
  const out = await ai.callLLM(prompts.managementLetterPoint(finding), prompts.SYSTEM);
  await ai.logAi({ firmId: req.user.firmId, userId: req.user.id, clientId: client_id, feature: 'ml_point', prompt: finding, response: out.text, model: out.model, tokens: out.tokens });
  res.json({ data: { text: out.text, model: out.model } });
}));

router.post('/audit-conclusion', asyncHandler(async (req, res) => {
  const { area, results, client_id } = req.body || {};
  if (!area) return res.status(400).json({ error: { code: 'BAD_INPUT', message: 'area is required' } });
  const out = await ai.callLLM(prompts.auditConclusion(area, results || ''), prompts.SYSTEM);
  await ai.logAi({ firmId: req.user.firmId, userId: req.user.id, clientId: client_id, feature: 'conclusion', prompt: area, response: out.text, model: out.model, tokens: out.tokens });
  res.json({ data: { text: out.text, model: out.model } });
}));

router.post('/risk-analysis', asyncHandler(async (req, res) => {
  const { context, client_id, engagement_id } = req.body || {};
  const out = await ai.riskAnalysis((context || '') + (await clientContext(client_id)));
  await ai.logAi({ firmId: req.user.firmId, userId: req.user.id, clientId: client_id, engagementId: engagement_id, feature: 'risk_analysis', prompt: context, response: out.text, model: out.model, tokens: out.tokens });
  res.json({ data: { text: out.text, model: out.model } });
}));

router.post('/financial-review', asyncHandler(async (req, res) => {
  const { figures, client_id } = req.body || {};
  if (!figures) return res.status(400).json({ error: { code: 'BAD_INPUT', message: 'figures is required' } });
  const out = await ai.financialReview(figures);
  await ai.logAi({ firmId: req.user.firmId, userId: req.user.id, clientId: client_id, feature: 'financial_review', prompt: figures, response: out.text, model: out.model, tokens: out.tokens });
  res.json({ data: { text: out.text, model: out.model } });
}));

// ---------------- Conversations (memory) ----------------
router.get('/conversations', asyncHandler(async (req, res) => res.json({ data: await assistant.listConversations(req.user.id) })));
router.post('/conversations', asyncHandler(async (req, res) => {
  const { client_id, engagement_id, title } = req.body || {};
  if (client_id && !(await canAccessClient(req.user, client_id))) return forbid(res);
  res.status(201).json({ data: await assistant.createConversation({ firmId: req.user.firmId, userId: req.user.id, clientId: client_id || null, engagementId: engagement_id || null, title: title || 'New conversation' }) });
}));
router.get('/conversations/:id', asyncHandler(async (req, res) => {
  const cv = await assistant.getConversation(req.params.id, req.user.id);
  if (!cv) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Conversation not found' } });
  res.json({ data: cv });
}));
router.post('/conversations/:id/messages', asyncHandler(async (req, res) => {
  const { content, client_id, engagement_id } = req.body || {};
  if (!content) return res.status(400).json({ error: { code: 'BAD_INPUT', message: 'content is required' } });
  if (client_id && !(await canAccessClient(req.user, client_id))) return forbid(res);
  try {
    const out = await assistant.sendMessage({ conversationId: req.params.id, userId: req.user.id, firmId: req.user.firmId, content, clientId: client_id || null, engagementId: engagement_id || null });
    res.json({ data: out });
  } catch (e) { res.status(400).json({ error: { code: 'AI_ERROR', message: e.message } }); }
}));

// ---------------- Risk center ----------------
router.get('/risk/center', asyncHandler(async (req, res) => res.json({ data: await risk.riskCenter(req.user.firmId, await scopeClientIds(req.user)) })));
router.post('/risk/recompute', asyncHandler(async (req, res) => res.json({ data: await risk.recomputeAll(req.user.firmId, await scopeClientIds(req.user)) })));
router.get('/risk/client/:id', asyncHandler(async (req, res) => {
  if (!(await canAccessClient(req.user, req.params.id))) return forbid(res);
  res.json({ data: await risk.clientRisk(req.params.id) });
}));

// ---------------- Anomalies ----------------
router.post('/anomalies/scan', asyncHandler(async (req, res) => res.json({ data: await risk.detectAnomalies(req.user.firmId, await scopeClientIds(req.user)) })));
router.get('/anomalies', asyncHandler(async (req, res) => res.json({ data: await risk.listAnomalies(req.user.firmId, await scopeClientIds(req.user)) })));

// ---------------- Accounting review ----------------
router.post('/accounting-review/:clientId', asyncHandler(async (req, res) => {
  if (!(await canAccessClient(req.user, req.params.clientId))) return forbid(res);
  const r = await risk.accountingReview(req.params.clientId);
  let commentary = '';
  try { commentary = (await ai.callLLM(prompts.accountingReview(r.issues), prompts.SYSTEM)).text; } catch (e) { commentary = ''; }
  res.json({ data: { ...r, commentary } });
}));

// ---------------- Financial analysis ----------------
router.get('/financial-analysis/:clientId', asyncHandler(async (req, res) => {
  if (!(await canAccessClient(req.user, req.params.clientId))) return forbid(res);
  res.json({ data: await analytics.financialAnalysis(req.params.clientId) });
}));

// ---------------- Compliance monitor / workflow assistant ----------------
router.get('/compliance/monitor', asyncHandler(async (req, res) => res.json({ data: await analytics.complianceMonitor(req.user.firmId, await scopeClientIds(req.user)) })));
router.get('/workflow/assistant', asyncHandler(async (req, res) => res.json({ data: await analytics.workflowAssistant(req.user.firmId, await scopeClientIds(req.user)) })));

// ---------------- Natural-language query ----------------
router.post('/nlq', asyncHandler(async (req, res) => {
  const query = (req.body || {}).q;
  if (!query) return res.status(400).json({ error: { code: 'BAD_INPUT', message: 'q is required' } });
  res.json({ data: await nlq.query(query, { firmId: req.user.firmId, ids: await scopeClientIds(req.user) }) });
}));

// ---------------- Report generation ----------------
router.post('/reports/:type', asyncHandler(async (req, res) => {
  const { client_id } = req.body || {};
  if (client_id && !(await canAccessClient(req.user, client_id))) return forbid(res);
  try {
    res.json({ data: await reports.generate(req.params.type, { clientId: client_id || null, firmId: req.user.firmId, userId: req.user.id }) });
  } catch (e) { res.status(400).json({ error: { code: 'BAD_INPUT', message: e.message } }); }
}));

// ---------------- Recommendations panel ----------------
router.get('/recommendations', asyncHandler(async (req, res) => {
  const ids = await scopeClientIds(req.user);
  let where = "r.firm_id=? AND r.status='open'"; const params = [req.user.firmId];
  if (ids !== '*') {
    if (!ids.length) return res.json({ data: [] });
    where += ` AND (r.client_id IN (${ids.map(() => '?').join(',')}) OR r.client_id IS NULL)`;
    params.push(...ids);
  }
  const rows = await q(
    `SELECT r.id, r.type, r.title, r.detail, r.severity, r.source, r.created_at, c.name AS client_name
       FROM ai_recommendations r LEFT JOIN clients c ON c.id=r.client_id
      WHERE ${where} ORDER BY r.created_at DESC LIMIT 100`, params
  );
  res.json({ data: rows });
}));
router.post('/recommendations/:id/status', asyncHandler(async (req, res) => {
  const st = (req.body || {}).status;
  if (!['accepted', 'dismissed', 'open'].includes(st)) return res.status(400).json({ error: { code: 'BAD_INPUT', message: 'status must be accepted|dismissed|open' } });
  await q('UPDATE ai_recommendations SET status=? WHERE id=? AND firm_id=?', [st, req.params.id, req.user.firmId]);
  res.json({ data: { ok: true } });
}));

// ---------------- Smart document search ----------------
router.get('/search', asyncHandler(async (req, res) => {
  const term = (req.query.q || '').trim();
  if (!term) return res.json({ data: [] });
  const ids = await scopeClientIds(req.user);
  let scope = ''; const params = [term, req.user.firmId];
  if (ids !== '*') {
    if (!ids.length) return res.json({ data: [] });
    scope = ` AND d.client_id IN (${ids.map(() => '?').join(',')})`;
    params.push(...ids);
  }
  const tsExpr = "to_tsvector('simple', coalesce(d.name,'') || ' ' || coalesce(d.ocr_text,''))";
  let rows;
  try {
    rows = await q(
      `SELECT d.id, d.name, d.doc_type, d.detected_type, d.year, c.name AS client_name,
              ts_rank(${tsExpr}, plainto_tsquery('simple', ?)) AS score
         FROM documents d JOIN clients c ON c.id=d.client_id
        WHERE d.firm_id=?${scope} AND ${tsExpr} @@ plainto_tsquery('simple', ?) AND d.deleted_at IS NULL
        ORDER BY score DESC LIMIT 25`, [...params, term]
    );
  } catch (e) {
    const like = `%${term}%`;
    rows = await q(
      `SELECT d.id, d.name, d.doc_type, d.detected_type, d.year, c.name AS client_name
         FROM documents d JOIN clients c ON c.id=d.client_id
        WHERE d.firm_id=?${scope} AND (d.name ILIKE ? OR d.ocr_text ILIKE ?) AND d.deleted_at IS NULL LIMIT 25`,
      [req.user.firmId, ...(ids !== '*' ? ids : []), like, like]
    );
  }
  res.json({ data: rows });
}));

router.get('/logs', asyncHandler(async (req, res) => {
  if (!['Admin', 'Partner'].includes(req.user.role)) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Admin/Partner only' } });
  const rows = await q('SELECT feature, model, tokens, created_at, LEFT(prompt,120) AS prompt FROM ai_logs WHERE firm_id=? ORDER BY created_at DESC LIMIT 50', [req.user.firmId]);
  res.json({ data: rows });
}));

module.exports = router;
