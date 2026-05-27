'use strict';
/** Per-client collaboration comments by area. Mounted at /api/v1/comments. */
const express = require('express');
const router = express.Router();
const { q, one, uuid } = require('../config');
const { canAccessClient, logActivity, asyncHandler } = require('../auth');

const AREAS = ['general', 'audit', 'tax', 'accounting'];
const deny = (res) => res.status(403).json({ error: { code: 'FORBIDDEN', message: 'No access to this client' } });

// List comments for a client (optionally filtered by area).
router.get('/', asyncHandler(async (req, res) => {
  const clientId = req.query.client_id;
  if (!clientId || !(await canAccessClient(req.user, clientId))) return deny(res);
  let where = 'c.firm_id=? AND c.client_id=?'; const p = [req.user.firmId, clientId];
  if (req.query.area && AREAS.includes(req.query.area)) { where += ' AND c.area=?'; p.push(req.query.area); }
  const rows = await q(
    `SELECT c.id, c.area, c.body, c.mentions, c.parent_id, c.edited_at, c.created_at,
            c.user_id, u.full_name AS author
       FROM client_comments c LEFT JOIN users u ON u.id=c.user_id
      WHERE ${where} ORDER BY c.created_at`, p);
  res.json({ data: rows });
}));

// Post a comment.
router.post('/', asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!b.client_id || !(await canAccessClient(req.user, b.client_id))) return deny(res);
  if (!b.body || !String(b.body).trim()) return res.status(400).json({ error: { code: 'BAD_INPUT', message: 'Comment body is required' } });
  const area = AREAS.includes(b.area) ? b.area : 'general';
  const mentions = Array.isArray(b.mentions) ? b.mentions : null;
  const id = uuid();
  await q(
    `INSERT INTO client_comments (id, firm_id, client_id, area, user_id, body, mentions, parent_id)
     VALUES (?,?,?,?,?,?,?,?)`,
    [id, req.user.firmId, b.client_id, area, req.user.id, String(b.body).trim(),
      mentions ? JSON.stringify(mentions) : null, b.parent_id || null]);
  // Notify mentioned users (in-app notifications).
  if (mentions && mentions.length) {
    const cli = await one('SELECT name FROM clients WHERE id=?', [b.client_id]);
    for (const uid of mentions) {
      try {
        await q(`INSERT INTO notifications (id, firm_id, user_id, type, title, body) VALUES (?,?,?,?,?,?)`,
          [uuid(), req.user.firmId, uid, 'mention', 'You were mentioned',
            `${req.user.fullName || 'A colleague'} mentioned you on ${cli ? cli.name : 'a client'} (${area}).`]);
      } catch (e) { /* ignore notify failure */ }
    }
  }
  await logActivity(req, 'comment', 'client', b.client_id, { area });
  res.status(201).json({ data: { id } });
}));

// Edit own comment.
router.patch('/:id', asyncHandler(async (req, res) => {
  const c = await one('SELECT * FROM client_comments WHERE id=? AND firm_id=?', [req.params.id, req.user.firmId]);
  if (!c) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Comment not found' } });
  if (c.user_id !== req.user.id) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You can only edit your own comments' } });
  if (!req.body || !String(req.body.body || '').trim()) return res.status(400).json({ error: { code: 'BAD_INPUT', message: 'Comment body is required' } });
  await q('UPDATE client_comments SET body=?, edited_at=NOW() WHERE id=?', [String(req.body.body).trim(), req.params.id]);
  await logActivity(req, 'edit_comment', 'client', c.client_id);
  res.json({ data: { ok: true } });
}));

// Delete own comment (Admin/Partner may delete any).
router.delete('/:id', asyncHandler(async (req, res) => {
  const c = await one('SELECT * FROM client_comments WHERE id=? AND firm_id=?', [req.params.id, req.user.firmId]);
  if (!c) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Comment not found' } });
  if (c.user_id !== req.user.id && !['Admin', 'Partner'].includes(req.user.role)) {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You can only delete your own comments' } });
  }
  await q('DELETE FROM client_comments WHERE id=?', [req.params.id]);
  await logActivity(req, 'delete_comment', 'client', c.client_id);
  res.json({ data: { ok: true } });
}));

module.exports = router;
