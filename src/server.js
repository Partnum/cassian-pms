'use strict';
/**
 * Cassian PMS — application entry point.
 * Mounts middleware, public + protected API routes, the static frontend,
 * the Google Drive OAuth callback, the reminder scheduler and error handling.
 */
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

const jwt = require('jsonwebtoken');
const { env, dbMode, ping } = require('./config');
const { requireAuth } = require('./auth');
const drive = require('./services/drive.service');
const driveSync = require('./jobs/drive-sync.job');
const { startScheduler } = require('./services/notifications.service');

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors({ origin: env.corsOrigins, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));

// Rate-limit authentication endpoints
app.use('/api/v1/auth', rateLimit({ windowMs: 15 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false }));

// Health check
app.get('/api/v1/health', (req, res) => res.json({ data: { ok: true, time: new Date().toISOString() } }));

// ---- Public routes ----
app.use('/api/v1/auth', require('./routes/auth.routes'));

// Google Drive OAuth callback (public — Google redirects here without a bearer
// token; the signed `state` identifies the user that initiated /api/v1/drive/connect).
app.get('/api/v1/drive/callback', async (req, res) => {
  try {
    const decoded = jwt.verify(req.query.state, env.jwt.accessSecret);
    if (decoded.t !== 'drive') throw new Error('Invalid state');
    const { email } = await drive.exchangeCodeForUser(req.query.code, decoded.sub, decoded.firmId);
    res.send(`<h2 style="font-family:sans-serif">Google Drive connected ✓</h2><p style="font-family:sans-serif">${email || ''} is now linked. You can close this tab and return to Cassian PMS.</p>`);
  } catch (e) {
    res.status(400).send('Drive connection failed: ' + e.message);
  }
});

// ---- Protected API ----
app.use('/api/v1', requireAuth);
app.use('/api/v1/clients', require('./routes/clients.routes'));
app.use('/api/v1/engagements', require('./routes/workflow.routes'));
app.use('/api/v1', require('./routes/tasks.routes')); // /tasks + /calendar
app.use('/api/v1/tax', require('./routes/tax.routes'));
app.use('/api/v1/documents', require('./routes/documents.routes'));
app.use('/api/v1/drive', require('./routes/drive.routes'));
app.use('/api/v1/notifications', require('./routes/notifications.routes'));
app.use('/api/v1/ai', require('./routes/ai.routes'));
app.use('/api/v1/reports', require('./routes/reports.routes'));
app.use('/api/v1/accounting', require('./routes/accounting.routes'));
app.use('/api/v1/comments', require('./routes/comments.routes'));
app.use('/api/v1/export', require('./routes/export.routes'));
app.use('/api/v1/billing', require('./routes/billing.routes'));
app.use('/api/v1/timesheets', require('./routes/timesheets.routes'));
app.use('/api/v1/workpapers', require('./routes/workpapers.routes'));
app.use('/api/v1/approvals', require('./routes/approvals.routes'));
app.use('/api/v1/settings', require('./routes/settings.routes'));
app.use('/api/v1/search', require('./routes/search.routes'));
app.use('/api/v1/management', require('./routes/management.routes'));

// API 404
app.use('/api', (req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' } }));

// ---- Static frontend ----
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/', (req, res) => res.redirect('/login.html'));

// ---- Error handler ----
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(err.status || 500).json({
    error: { code: 'SERVER_ERROR', message: env.nodeEnv === 'production' ? 'Internal server error' : err.message },
  });
});

async function start() {
  try {
    await ping();
    if (dbMode === 'pglite') {
      console.log('✓ Database ready (PGlite — in-process PostgreSQL, no server needed)');
    } else {
      console.log('✓ Database connected (%s)', env.db.connectionString ? 'DATABASE_URL' : `${env.db.user}@${env.db.host}/${env.db.database}`);
    }
  } catch (e) {
    console.error('✗ Database connection failed:', e.message);
    if (dbMode === 'pglite') {
      console.error('  → First time? Run:  npm run setup   (creates tables + sample data)');
    } else {
      console.error('  → Ensure PostgreSQL is running / DATABASE_URL is correct in .env.');
      console.error('  → First time? Run:  npm run setup   (creates tables + sample data)');
      console.error('  → No database server? Set DB_MODE=pglite in .env for zero-setup mode.');
    }
  }
  startScheduler();
  driveSync.startSyncScheduler();
  app.listen(env.port, () => {
    console.log(`✓ Cassian PMS running:  http://localhost:${env.port}/login.html`);
    console.log(`  DB mode: ${dbMode} · AI mode: ${env.ai.mode} · Drive mode: ${env.drive.mode}`);
  });
}

start();
