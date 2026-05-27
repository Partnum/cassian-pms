'use strict';
/** Documents (Google Drive / local) + intelligence. Mounted at /api/v1/documents. */
const express = require('express');
const multer = require('multer');
const router = express.Router();
const { q, one } = require('../config');
const { requirePermission, scopeClientIds, canAccessClient, logActivity, asyncHandler } = require('../auth');
const drive = require('../services/drive.service');
const ingest = require('../services/ingest.service');
const classifier = require('../services/classifier.service');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } }); // up to 200MB (large audit files)

// List documents (scoped + filters)
router.get('/', requirePermission('document.read'), asyncHandler(async (req, res) => {
  const ids = await scopeClientIds(req.user);
  let where = 'd.firm_id=? AND d.deleted_at IS NULL'; const params = [req.user.firmId];
  if (ids !== '*') {
    if (!ids.length) return res.json({ data: [] });
    where += ` AND d.client_id IN (${ids.map(() => '?').join(',')})`;
    params.push(...ids);
  }
  if (req.query.client_id) { where += ' AND d.client_id=?'; params.push(req.query.client_id); }
  if (req.query.year) { where += ' AND d.year=?'; params.push(req.query.year); }
  if (req.query.doc_type) { where += ' AND d.doc_type=?'; params.push(req.query.doc_type); }
  if (req.query.detected_type) { where += ' AND d.detected_type=?'; params.push(req.query.detected_type); }
  if (req.query.tag) { where += ' AND ? = ANY(d.tags)'; params.push(req.query.tag); }
  if (req.query.search) { where += ' AND d.name ILIKE ?'; params.push(`%${req.query.search}%`); }
  const rows = await q(
    `SELECT d.id, d.name, d.doc_type, d.detected_type, d.tags, d.classified_conf, d.year, d.subfolder,
            d.storage, d.size_bytes, d.web_link, d.mime_type, d.modified_time, d.created_at,
            c.name AS client_name, u.full_name AS uploaded_by_name
       FROM documents d
       LEFT JOIN clients c ON c.id=d.client_id
       LEFT JOIN users u ON u.id=d.uploaded_by
      WHERE ${where} ORDER BY d.created_at DESC LIMIT 300`, params
  );
  res.json({ data: rows });
}));

// Upload (-> Drive/local, then classify + extract + workflow hook)
router.post('/upload', requirePermission('document.upload'), upload.single('file'), asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!req.file) return res.status(400).json({ error: { code: 'NO_FILE', message: 'A file is required (multipart field "file")' } });
  if (!b.client_id) return res.status(400).json({ error: { code: 'BAD_INPUT', message: 'client_id is required' } });
  if (!(await canAccessClient(req.user, b.client_id))) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'No access to this client' } });
  const client = await one('SELECT * FROM clients WHERE id=? AND firm_id=?', [b.client_id, req.user.firmId]);
  if (!client) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Client not found' } });
  const year = parseInt(b.year, 10) || new Date().getFullYear();

  let stored;
  try {
    stored = await drive.uploadToDrive({ client, year, subfolder: b.subfolder || null, file: req.file, userId: req.user.id });
  } catch (e) {
    return res.status(502).json({ error: { code: 'DRIVE_ERROR', message: e.message } });
  }
  const result = await ingest.ingestUploaded({ client, engagementId: b.engagement_id || null, userId: req.user.id, file: req.file, stored, year });
  await logActivity(req, 'upload', 'document', result.id, { name: req.file.originalname, client_id: client.id });
  res.status(201).json({
    data: {
      id: result.id, storage: stored.storage, web_link: stored.webLink,
      doc_type: result.classification.docType, detected_type: result.classification.detectedType,
      tags: result.classification.tags, confidence: result.classification.confidence,
      entities: result.entities, workflow: result.workflow,
    },
  });
}));

// Metadata
router.get('/:id', requirePermission('document.read'), asyncHandler(async (req, res) => {
  const doc = await one('SELECT * FROM documents WHERE id=? AND firm_id=? AND deleted_at IS NULL', [req.params.id, req.user.firmId]);
  if (!doc) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Document not found' } });
  if (doc.client_id && !(await canAccessClient(req.user, doc.client_id))) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'No access' } });
  res.json({ data: doc });
}));

// Version history for a document.
router.get('/:id/versions', requirePermission('document.read'), asyncHandler(async (req, res) => {
  const doc = await one('SELECT id, client_id FROM documents WHERE id=? AND firm_id=? AND deleted_at IS NULL', [req.params.id, req.user.firmId]);
  if (!doc) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Document not found' } });
  if (doc.client_id && !(await canAccessClient(req.user, doc.client_id))) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'No access' } });
  const rows = await q(
    `SELECT v.version, v.size_bytes, v.note, v.created_at, u.full_name AS uploaded_by
       FROM document_versions v LEFT JOIN users u ON u.id=v.uploaded_by
      WHERE v.document_id=? ORDER BY v.version DESC`, [req.params.id]);
  res.json({ data: rows });
}));

async function streamDoc(req, res, disposition, action) {
  const doc = await one('SELECT * FROM documents WHERE id=? AND firm_id=? AND deleted_at IS NULL', [req.params.id, req.user.firmId]);
  if (!doc) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Document not found' } });
  if (doc.client_id && !(await canAccessClient(req.user, doc.client_id))) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'No access' } });
  try {
    const { stream, mime } = await drive.getDownloadStream(doc, { userId: req.user.id });
    await ingest.logAccess(doc.id, req.user.id, action);
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `${disposition}; filename="${doc.name.replace(/"/g, '')}"`);
    stream.on('error', () => res.destroy());
    return stream.pipe(res);
  } catch (e) {
    return res.status(404).json({ error: { code: 'NOT_AVAILABLE', message: e.message } });
  }
}
router.get('/:id/download', requirePermission('document.read'), asyncHandler((req, res) => streamDoc(req, res, 'attachment', 'download')));
router.get('/:id/preview', requirePermission('document.read'), asyncHandler((req, res) => streamDoc(req, res, 'inline', 'view')));

// Re-run AI classification
router.post('/:id/reclassify', requirePermission('document.upload'), asyncHandler(async (req, res) => {
  const doc = await one('SELECT * FROM documents WHERE id=? AND firm_id=?', [req.params.id, req.user.firmId]);
  if (!doc) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Document not found' } });
  if (doc.client_id && !(await canAccessClient(req.user, doc.client_id))) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'No access' } });
  const cls = classifier.classify(doc.name, doc.ocr_text || '');
  await q('UPDATE documents SET doc_type=?, detected_type=?, classified_conf=?, tags=?, auto_tagged=1 WHERE id=?',
    [cls.docType, cls.detectedType, cls.confidence, cls.tags, doc.id]);
  await logActivity(req, 'reclassify', 'document', doc.id, cls);
  res.json({ data: cls });
}));

// Soft delete
router.delete('/:id', requirePermission('document.delete'), asyncHandler(async (req, res) => {
  await q('UPDATE documents SET deleted_at=now() WHERE id=? AND firm_id=?', [req.params.id, req.user.firmId]);
  await ingest.logAccess(req.params.id, req.user.id, 'delete');
  await logActivity(req, 'delete', 'document', req.params.id);
  res.json({ data: { ok: true } });
}));

module.exports = router;
