'use strict';
/** Digital approvals & signatures. Mounted at /api/v1/approvals. */
const express = require('express');
const router = express.Router();
const { q, uuid } = require('../config');
const { logActivity, asyncHandler } = require('../auth');

const ENTITY_TYPES = ['engagement', 'invoice', 'report', 'working_paper', 'document'];
const bad = (res, m) => res.status(400).json({ error: { code: 'BAD_INPUT', message: m } });
const canApprove = (req) => ['Admin', 'Partner', 'Manager'].includes(req.user.role);

// Record an approve/reject decision with a typed digital signature.
router.post('/', asyncHandler(async (req, res) => {
  if (!canApprove(req)) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only Manager/Partner/Admin can approve' } });
  const b = req.body || {};
  if (!ENTITY_TYPES.includes(b.entity_type)) return bad(res, 'Invalid entity_type');
  if (!b.entity_id) return bad(res, 'entity_id is required');
  if (!['approved', 'rejected'].includes(b.decision)) return bad(res, 'decision must be approved or rejected');
  if (!b.signature || !String(b.signature).trim()) return bad(res, 'A typed signature is required');
  const id = uuid();
  await q(
    `INSERT INTO approvals (id, firm_id, entity_type, entity_id, decision, signature, comment, user_id)
     VALUES (?,?,?,?,?,?,?,?)`,
    [id, req.user.firmId, b.entity_type, b.entity_id, b.decision, String(b.signature).trim(), b.comment || null, req.user.id]);
  await logActivity(req, b.decision, b.entity_type, b.entity_id, { signature: String(b.signature).trim() });
  res.status(201).json({ data: { id } });
}));

// Approval history for an entity.
router.get('/', asyncHandler(async (req, res) => {
  const { entity_type, entity_id } = req.query;
  if (!entity_type || !entity_id) return bad(res, 'entity_type and entity_id are required');
  const rows = await q(
    `SELECT a.decision, a.signature, a.comment, a.created_at, u.full_name AS approver, u.role AS approver_role
       FROM approvals a LEFT JOIN users u ON u.id=a.user_id
      WHERE a.firm_id=? AND a.entity_type=? AND a.entity_id=? ORDER BY a.created_at DESC`,
    [req.user.firmId, entity_type, entity_id]);
  res.json({ data: rows });
}));

module.exports = router;
