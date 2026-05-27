'use strict';
/** Authentication + user/staff management. Mounted at /api/v1/auth (public). */
const express = require('express');
const router = express.Router();
const { q, one, uuid, env } = require('../config');
const {
  hashPassword, comparePassword, signAccessToken, issueRefreshToken,
  rotateRefreshToken, revokeRefreshToken, revokeAllForUser, requireAuth, logActivity, asyncHandler,
} = require('../auth');

const REFRESH_COOKIE = 'refresh_token';
const COOKIE_OPTS = {
  httpOnly: true, sameSite: 'lax', secure: env.nodeEnv === 'production',
  maxAge: env.jwt.refreshTtlDays * 86400000, path: '/api/v1/auth',
};
const publicUser = (u) => ({
  id: u.id, full_name: u.full_name, email: u.email, phone: u.phone,
  role: u.role, status: u.status, avatar_url: u.avatar_url, last_login_at: u.last_login_at,
});

function staffGuard(req, res, next) {
  if (!['Admin', 'Partner'].includes(req.user.role)) {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Staff management requires Admin or Partner' } });
  }
  return next();
}

// ---- Login ----
router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: { code: 'BAD_INPUT', message: 'Email and password are required' } });
  const user = await one('SELECT * FROM users WHERE email=? AND deleted_at IS NULL', [String(email).toLowerCase().trim()]);
  if (!user || user.status === 'suspended' || !(await comparePassword(password, user.password_hash))) {
    return res.status(401).json({ error: { code: 'BAD_CREDENTIALS', message: 'Invalid email or password' } });
  }
  await q('UPDATE users SET last_login_at=NOW() WHERE id=?', [user.id]);
  await q('INSERT INTO login_history (id, user_id, email, success, ip_address, user_agent) VALUES (?,?,?,?,?,?)',
    [uuid(), user.id, user.email, 1, req.ip || '', (req.headers['user-agent'] || '').slice(0, 250)]);
  const accessToken = signAccessToken(user);
  const refresh = await issueRefreshToken(user.id, req);
  res.cookie(REFRESH_COOKIE, refresh, COOKIE_OPTS);
  req.user = { id: user.id, firmId: user.firm_id, role: user.role };
  await logActivity(req, 'login', 'user', user.id);
  res.json({ data: { accessToken, user: publicUser(user) } });
}));

// ---- Refresh access token ----
router.post('/refresh', asyncHandler(async (req, res) => {
  const raw = (req.cookies && req.cookies[REFRESH_COOKIE]) || (req.body && req.body.refreshToken);
  const rotated = await rotateRefreshToken(raw, req);
  if (!rotated) return res.status(401).json({ error: { code: 'BAD_REFRESH', message: 'Session expired, please log in again' } });
  const user = await one('SELECT * FROM users WHERE id=? AND deleted_at IS NULL', [rotated.userId]);
  if (!user) return res.status(401).json({ error: { code: 'BAD_REFRESH', message: 'Invalid session' } });
  res.cookie(REFRESH_COOKIE, rotated.raw, COOKIE_OPTS);
  res.json({ data: { accessToken: signAccessToken(user), user: publicUser(user) } });
}));

// ---- Logout ----
router.post('/logout', asyncHandler(async (req, res) => {
  const raw = (req.cookies && req.cookies[REFRESH_COOKIE]) || (req.body && req.body.refreshToken);
  await revokeRefreshToken(raw);
  res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
  res.json({ data: { ok: true } });
}));

// ---- Current user ----
router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const user = await one('SELECT * FROM users WHERE id=?', [req.user.id]);
  if (!user) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
  res.json({ data: publicUser(user) });
}));

// ---- Staff management ----
router.get('/users', requireAuth, staffGuard, asyncHandler(async (req, res) => {
  const rows = await q(
    `SELECT id, full_name, email, phone, role, status, last_login_at, created_at,
            (SELECT COUNT(*)::int FROM clients c WHERE c.manager_id=u.id) AS managed_clients
       FROM users u WHERE firm_id=? AND deleted_at IS NULL ORDER BY full_name`,
    [req.user.firmId]
  );
  res.json({ data: rows });
}));

router.post('/users', requireAuth, staffGuard, asyncHandler(async (req, res) => {
  const { full_name, email, role, phone, password } = req.body || {};
  if (!full_name || !email || !role) return res.status(400).json({ error: { code: 'BAD_INPUT', message: 'full_name, email and role are required' } });
  const exists = await one('SELECT id FROM users WHERE email=?', [String(email).toLowerCase()]);
  if (exists) return res.status(409).json({ error: { code: 'CONFLICT', message: 'A user with that email already exists' } });
  const id = uuid();
  const hash = await hashPassword(password || env.seedPassword);
  await q(
    'INSERT INTO users (id, firm_id, full_name, email, phone, password_hash, role, status) VALUES (?,?,?,?,?,?,?,?)',
    [id, req.user.firmId, full_name, String(email).toLowerCase(), phone || null, hash, role, 'active']
  );
  await logActivity(req, 'create', 'user', id, { email });
  res.status(201).json({ data: { id } });
}));

router.patch('/users/:id', requireAuth, staffGuard, asyncHandler(async (req, res) => {
  const allowed = ['full_name', 'phone', 'role', 'status'];
  const sets = []; const params = [];
  for (const k of allowed) if (k in (req.body || {})) { sets.push(`${k}=?`); params.push(req.body[k]); }
  if (!sets.length) return res.status(400).json({ error: { code: 'BAD_INPUT', message: 'No updatable fields provided' } });
  params.push(req.params.id, req.user.firmId);
  await q(`UPDATE users SET ${sets.join(', ')} WHERE id=? AND firm_id=?`, params);
  await logActivity(req, 'update', 'user', req.params.id, req.body);
  res.json({ data: { ok: true } });
}));

// Admin/Partner resets another user's password (and signs that user out everywhere).
router.post('/users/:id/reset-password', requireAuth, staffGuard, asyncHandler(async (req, res) => {
  const { password } = req.body || {};
  if (!password || String(password).length < 6) return res.status(400).json({ error: { code: 'BAD_INPUT', message: 'Password must be at least 6 characters' } });
  const u = await one('SELECT id FROM users WHERE id=? AND firm_id=? AND deleted_at IS NULL', [req.params.id, req.user.firmId]);
  if (!u) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
  await q('UPDATE users SET password_hash=? WHERE id=?', [await hashPassword(password), req.params.id]);
  await revokeAllForUser(req.params.id);
  await logActivity(req, 'reset_password', 'user', req.params.id);
  res.json({ data: { ok: true } });
}));

// Soft-delete a staff member (Admin/Partner). Cannot delete yourself.
router.delete('/users/:id', requireAuth, staffGuard, asyncHandler(async (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: { code: 'BAD_INPUT', message: 'You cannot delete your own account' } });
  const u = await one('SELECT id FROM users WHERE id=? AND firm_id=? AND deleted_at IS NULL', [req.params.id, req.user.firmId]);
  if (!u) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
  await q("UPDATE users SET deleted_at=NOW(), status='suspended' WHERE id=?", [req.params.id]);
  await revokeAllForUser(req.params.id);
  await logActivity(req, 'delete', 'user', req.params.id);
  res.json({ data: { ok: true } });
}));

// Any signed-in user changes their own password.
router.post('/change-password', requireAuth, asyncHandler(async (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!current_password || !new_password) return res.status(400).json({ error: { code: 'BAD_INPUT', message: 'current_password and new_password are required' } });
  if (String(new_password).length < 6) return res.status(400).json({ error: { code: 'BAD_INPUT', message: 'New password must be at least 6 characters' } });
  const user = await one('SELECT * FROM users WHERE id=?', [req.user.id]);
  if (!user || !(await comparePassword(current_password, user.password_hash))) {
    return res.status(400).json({ error: { code: 'BAD_CREDENTIALS', message: 'Current password is incorrect' } });
  }
  await q('UPDATE users SET password_hash=? WHERE id=?', [await hashPassword(new_password), user.id]);
  await logActivity(req, 'change_password', 'user', user.id);
  res.json({ data: { ok: true } });
}));

module.exports = router;
