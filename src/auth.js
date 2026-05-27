'use strict';
/**
 * Authentication & authorization: password hashing, JWT access tokens,
 * rotating refresh tokens, auth + RBAC middleware, client scoping, audit log.
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { env, q, one, uuid } = require('./config');
const { hasPermission, ALL_CLIENT_ROLES } = require('./constants');

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ---- Passwords ----
const hashPassword = (plain) => bcrypt.hash(plain, 10);
const comparePassword = (plain, hash) => bcrypt.compare(plain, hash);

// ---- Access tokens ----
function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, firmId: user.firm_id, role: user.role, name: user.full_name, email: user.email },
    env.jwt.accessSecret,
    { expiresIn: env.jwt.accessTtl }
  );
}

// ---- Refresh tokens (random opaque string, hash stored in DB) ----
async function issueRefreshToken(userId, req) {
  const raw = crypto.randomBytes(48).toString('hex');
  const expires = new Date(Date.now() + env.jwt.refreshTtlDays * 86400000);
  await q(
    `INSERT INTO user_sessions (id, user_id, token_hash, expires_at, user_agent, ip_address)
     VALUES (?,?,?,?,?,?)`,
    [uuid(), userId, sha256(raw), expires, (req.headers['user-agent'] || '').slice(0, 250), req.ip || '']
  );
  return raw;
}

async function rotateRefreshToken(raw, req) {
  if (!raw) return null;
  const row = await one('SELECT * FROM user_sessions WHERE token_hash=? AND revoked_at IS NULL', [sha256(raw)]);
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) return null;
  await q('UPDATE user_sessions SET revoked_at=NOW() WHERE id=?', [row.id]);
  const newRaw = await issueRefreshToken(row.user_id, req);
  return { userId: row.user_id, raw: newRaw };
}

async function revokeRefreshToken(raw) {
  if (raw) await q('UPDATE user_sessions SET revoked_at=NOW() WHERE token_hash=?', [sha256(raw)]);
}
async function revokeAllForUser(userId) {
  await q('UPDATE user_sessions SET revoked_at=NOW() WHERE user_id=? AND revoked_at IS NULL', [userId]);
}

// ---- Middleware ----
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: { code: 'NO_TOKEN', message: 'Authentication required' } });
  try {
    const d = jwt.verify(token, env.jwt.accessSecret);
    req.user = { id: d.sub, firmId: d.firmId, role: d.role, fullName: d.name, email: d.email };
    return next();
  } catch (e) {
    return res.status(401).json({ error: { code: 'BAD_TOKEN', message: 'Invalid or expired token' } });
  }
}

function requirePermission(code) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: { code: 'NO_TOKEN', message: 'Authentication required' } });
    if (!hasPermission(req.user.role, code)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: `Missing permission: ${code}` } });
    }
    return next();
  };
}

// ---- Client scoping ----
// Returns '*' (sees everything) or an array of client ids the user may access.
async function scopeClientIds(user) {
  if (ALL_CLIENT_ROLES.includes(user.role)) return '*';
  const rows = await q(
    `SELECT id FROM clients
       WHERE deleted_at IS NULL
         AND (manager_id=? OR engagement_partner_id=?
              OR id IN (SELECT client_id FROM user_client_access WHERE user_id=?))`,
    [user.id, user.id, user.id]
  );
  return rows.map((r) => r.id);
}

async function canAccessClient(user, clientId) {
  if (!clientId) return false;
  const ids = await scopeClientIds(user);
  return ids === '*' ? true : ids.includes(clientId);
}

// ---- Audit trail ----
async function logActivity(req, action, entityType, entityId = null, detail = null) {
  try {
    await q(
      `INSERT INTO activity_log (id, firm_id, user_id, action, entity_type, entity_id, detail, ip_address)
       VALUES (?,?,?,?,?,?,?,?)`,
      [uuid(), req.user ? req.user.firmId : null, req.user ? req.user.id : null,
        action, entityType, entityId, detail ? JSON.stringify(detail) : null, req.ip || '']
    );
  } catch (e) { /* never block the request on logging */ }
}

// ---- Helpers ----
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = {
  hashPassword, comparePassword,
  signAccessToken, issueRefreshToken, rotateRefreshToken, revokeRefreshToken, revokeAllForUser,
  requireAuth, requirePermission, scopeClientIds, canAccessClient, logActivity, asyncHandler,
};
