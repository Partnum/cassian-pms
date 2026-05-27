'use strict';
/**
 * Document ingestion pipeline shared by uploads and Drive sync:
 *   persist metadata -> OCR/text -> classify -> extract entities ->
 *   version -> access log -> workflow hook.
 */
const { q, one, uuid } = require('../config');
const { subfolderFor } = require('../drive.config');
const classifier = require('./classifier.service');
const ocr = require('./ocr.service');
const extraction = require('./extraction.service');
const hooks = require('./workflow-hooks.service');

const DOC_COLS = `id, firm_id, client_id, engagement_id, drive_file_id, storage, local_path, name,
  doc_type, year, mime_type, size_bytes, web_link, uploaded_by, current_version, ocr_text, ocr_status,
  detected_type, classified_conf, auto_tagged, modified_time, md5_checksum, drive_parent_id, subfolder, extracted, tags`;

async function logAccess(documentId, userId, action) {
  await q('INSERT INTO document_access_logs (id, document_id, user_id, action) VALUES (?,?,?,?)',
    [uuid(), documentId, userId || null, action]).catch(() => {});
}

/** Ingest a freshly uploaded file (we have the bytes -> OCR runs inline). */
async function ingestUploaded({ client, engagementId, userId, file, stored, year }) {
  const { text, status } = await ocr.extractText(file.buffer, file.mimetype, file.originalname);
  const cls = classifier.classify(file.originalname, text);
  const entities = extraction.extract(text);
  const subfolder = stored.subfolder || subfolderFor(client.category, cls.detectedType);
  const id = uuid();
  await q(
    `INSERT INTO documents (${DOC_COLS}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, client.firm_id, client.id, engagementId || null, stored.driveFileId, stored.storage, stored.localPath,
      file.originalname, cls.docType, year || new Date().getFullYear(), file.mimetype, stored.size, stored.webLink,
      userId || null, 1, text || null, status, cls.detectedType, cls.confidence, 1, stored.modifiedTime,
      stored.md5, stored.parentId, subfolder, JSON.stringify(entities), cls.tags]
  );
  await q('INSERT INTO document_versions (id, document_id, version, drive_revision_id, size_bytes, uploaded_by) VALUES (?,?,?,?,?,?)',
    [uuid(), id, 1, stored.driveFileId, stored.size, userId || null]);
  await logAccess(id, userId, 'upload');
  const doc = { id, client_id: client.id, firm_id: client.firm_id, name: file.originalname, detected_type: cls.detectedType, doc_type: cls.docType };
  const wf = await hooks.onDocumentIngested(doc, { userId });
  return { id, classification: cls, entities, workflow: wf };
}

/** Ingest / update a file discovered by Drive sync (classify by name; OCR deferred). */
async function ingestFromDrive({ file, clientId, year, subfolder, userId }) {
  const client = await one('SELECT id, firm_id, category FROM clients WHERE id=?', [clientId]);
  if (!client) return { skipped: true };

  const existing = await one('SELECT id, md5_checksum, current_version FROM documents WHERE drive_file_id=?', [file.id]);
  if (existing) {
    const changed = file.md5Checksum && file.md5Checksum !== existing.md5_checksum;
    const ver = changed ? existing.current_version + 1 : existing.current_version;
    await q('UPDATE documents SET name=?, size_bytes=?, modified_time=?, web_link=?, md5_checksum=?, current_version=?, updated_at=now() WHERE id=?',
      [file.name, Number(file.size || 0), file.modifiedTime || null, file.webViewLink || null, file.md5Checksum || existing.md5_checksum, ver, existing.id]);
    if (changed) {
      await q('INSERT INTO document_versions (id, document_id, version, drive_revision_id, size_bytes) VALUES (?,?,?,?,?)',
        [uuid(), existing.id, ver, file.id, Number(file.size || 0)]);
      await logAccess(existing.id, userId, 'sync-update');
    }
    return { id: existing.id, updated: true };
  }

  const cls = classifier.classify(file.name, '');
  const sub = subfolder || subfolderFor(client.category, cls.detectedType);
  const id = uuid();
  await q(
    `INSERT INTO documents (${DOC_COLS}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, client.firm_id, client.id, null, file.id, 'google', null, file.name, cls.docType,
      year || new Date().getFullYear(), file.mimeType, Number(file.size || 0), file.webViewLink || null,
      userId || null, 1, null, 'pending', cls.detectedType, cls.confidence, 1, file.modifiedTime || null,
      file.md5Checksum || null, (file.parents || [])[0] || null, sub, JSON.stringify({}), cls.tags]
  );
  await q('INSERT INTO document_versions (id, document_id, version, drive_revision_id, size_bytes) VALUES (?,?,?,?,?)',
    [uuid(), id, 1, file.id, Number(file.size || 0)]);
  await logAccess(id, userId, 'sync-new');
  const doc = { id, client_id: client.id, firm_id: client.firm_id, name: file.name, detected_type: cls.detectedType, doc_type: cls.docType };
  const wf = await hooks.onDocumentIngested(doc, { userId });
  return { id, created: true, classification: cls, workflow: wf };
}

module.exports = { ingestUploaded, ingestFromDrive, logAccess };
