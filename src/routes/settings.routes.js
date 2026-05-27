'use strict';
/** Firm profile + key/value system settings (Admin/Partner). Mounted at /api/v1/settings. */
const express = require('express');
const router = express.Router();
const { q, one, uuid } = require('../config');
const { logActivity, asyncHandler } = require('../auth');

const adminGuard = (req, res, next) => {
  if (!['Admin', 'Partner'].includes(req.user.role)) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Admin/Partner only' } });
  return next();
};

router.get('/', adminGuard, asyncHandler(async (req, res) => {
  const firm = await one('SELECT name, tin, vrn, address FROM firms WHERE id=?', [req.user.firmId]);
  const rows = await q('SELECT setting_key, setting_value FROM app_settings WHERE firm_id=?', [req.user.firmId]);
  const settings = {};
  rows.forEach((r) => { settings[r.setting_key] = r.setting_value; });
  res.json({ data: { firm, settings } });
}));

router.put('/', adminGuard, asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (b.firm && typeof b.firm === 'object') {
    const sets = []; const params = [];
    ['name', 'tin', 'vrn', 'address'].forEach((k) => { if (k in b.firm) { sets.push(`${k}=?`); params.push(b.firm[k]); } });
    if (sets.length) { params.push(req.user.firmId); await q(`UPDATE firms SET ${sets.join(', ')} WHERE id=?`, params); }
  }
  if (b.settings && typeof b.settings === 'object') {
    for (const [key, value] of Object.entries(b.settings)) {
      const existing = await one('SELECT id FROM app_settings WHERE firm_id=? AND setting_key=?', [req.user.firmId, key]);
      if (existing) await q('UPDATE app_settings SET setting_value=?, updated_at=NOW() WHERE id=?', [value == null ? null : String(value), existing.id]);
      else await q('INSERT INTO app_settings (id, firm_id, setting_key, setting_value) VALUES (?,?,?,?)', [uuid(), req.user.firmId, key, value == null ? null : String(value)]);
    }
  }
  await logActivity(req, 'update', 'settings', null, Object.keys(b.settings || {}));
  res.json({ data: { ok: true } });
}));

module.exports = router;
