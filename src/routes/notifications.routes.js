'use strict';
/** In-app notifications. Mounted at /api/v1/notifications. */
const express = require('express');
const router = express.Router();
const { q, one } = require('../config');
const { requirePermission, asyncHandler } = require('../auth');

router.get('/', requirePermission('notification.read'), asyncHandler(async (req, res) => {
  const rows = await q(
    'SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 50',
    [req.user.id]
  );
  const unread = await one('SELECT COUNT(*)::int AS n FROM notifications WHERE user_id=? AND is_read=0', [req.user.id]);
  res.json({ data: rows, meta: { unread: unread.n } });
}));

router.post('/:id/read', requirePermission('notification.read'), asyncHandler(async (req, res) => {
  await q('UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
  res.json({ data: { ok: true } });
}));

router.post('/read-all', requirePermission('notification.read'), asyncHandler(async (req, res) => {
  await q('UPDATE notifications SET is_read=1 WHERE user_id=? AND is_read=0', [req.user.id]);
  res.json({ data: { ok: true } });
}));

module.exports = router;
