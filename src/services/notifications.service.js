'use strict';
/**
 * Notifications + reminder engine (PostgreSQL).
 *  - In-app notifications (notifications table)
 *  - Optional email (SMTP via nodemailer, only if configured)
 *  - Scheduled scan (node-cron) flagging overdue/upcoming statutory
 *    deadlines (VAT, PAYE, SDL, NSSF, WCF, PDPC, ROI) and overdue tasks.
 */
const cron = require('node-cron');
const { env, q, one, uuid } = require('../config');

let transporter = null;
function mailer() {
  if (!env.mail.host) return null;
  if (transporter) return transporter;
  // eslint-disable-next-line global-require
  const nodemailer = require('nodemailer');
  transporter = nodemailer.createTransport({
    host: env.mail.host, port: env.mail.port,
    secure: env.mail.port === 465,
    auth: env.mail.user ? { user: env.mail.user, pass: env.mail.pass } : undefined,
  });
  return transporter;
}

async function emailUser(to, subject, text) {
  const t = mailer();
  if (!t || !to) return false;
  try { await t.sendMail({ from: env.mail.from, to, subject, text }); return true; }
  catch (e) { console.warn('Email send failed:', e.message); return false; }
}

async function createNotification({ firmId, userId, type = 'info', title, body, link = null }) {
  await q(
    'INSERT INTO notifications (id, firm_id, user_id, type, title, body, link) VALUES (?,?,?,?,?,?,?)',
    [uuid(), firmId, userId || null, type, title, body || '', link]
  );
}

/** Insert a notification at most once per user per day (per title). */
async function notifyOnce(firmId, userId, type, title, body, link) {
  const existing = await one(
    'SELECT id FROM notifications WHERE user_id IS NOT DISTINCT FROM ? AND title=? AND created_at::date = CURRENT_DATE',
    [userId || null, title]
  );
  if (existing) return false;
  await createNotification({ firmId, userId, type, title, body, link });
  return true;
}

async function partnersAndAdmins(firmId) {
  return q("SELECT id, email FROM users WHERE firm_id=? AND role IN ('Admin','Partner') AND status='active'", [firmId]);
}

/** Core reminder scan. Returns a small summary. */
async function runReminderScan() {
  const summary = { obligationsOverdue: 0, obligationsDue: 0, tasksOverdue: 0, tasksCreated: 0, notifications: 0 };

  // 1) Refresh deadline statuses
  await q("UPDATE statutory_deadlines SET status='overdue' WHERE due_date < CURRENT_DATE AND status NOT IN ('filed','exempt','overdue')");
  await q(
    "UPDATE statutory_deadlines SET status='due' WHERE due_date BETWEEN CURRENT_DATE AND (CURRENT_DATE + INTERVAL '1 day' * (?)::int) AND status='upcoming'",
    [env.scheduler.warnDays]
  );

  // 2) Overdue deadlines -> notify client manager + partners/admins
  const overdue = await q(
    `SELECT o.*, c.name AS client_name, c.manager_id, c.firm_id
       FROM statutory_deadlines o JOIN clients c ON c.id=o.client_id
      WHERE o.status='overdue'`
  );
  summary.obligationsOverdue = overdue.length;
  for (const o of overdue) {
    const title = `Overdue ${o.type} — ${o.client_name}`;
    const body = `${o.type} (${o.period || ''}) to ${o.authority} was due ${o.due_date} and is overdue. Penalty/interest risk.`;
    const recipients = new Set();
    if (o.manager_id) recipients.add(o.manager_id);
    (await partnersAndAdmins(o.firm_id)).forEach((u) => recipients.add(u.id));
    for (const uid of recipients) {
      if (await notifyOnce(o.firm_id, uid, 'warning', title, body, '/app.html#tax')) summary.notifications += 1;
    }
  }

  // 3) Due-soon deadlines -> notify client manager
  const dueSoon = await q(
    `SELECT o.*, c.name AS client_name, c.manager_id, c.firm_id
       FROM statutory_deadlines o JOIN clients c ON c.id=o.client_id
      WHERE o.status='due'`
  );
  summary.obligationsDue = dueSoon.length;
  for (const o of dueSoon) {
    if (!o.manager_id) continue;
    const title = `${o.type} due soon — ${o.client_name}`;
    const body = `${o.type} (${o.period || ''}) to ${o.authority} is due on ${o.due_date}.`;
    if (await notifyOnce(o.firm_id, o.manager_id, 'info', title, body, '/app.html#tax')) summary.notifications += 1;
  }

  // 4) Overdue tasks -> notify assignee
  const tasks = await q(
    `SELECT t.*, c.name AS client_name FROM tasks t LEFT JOIN clients c ON c.id=t.client_id
      WHERE t.status IN ('open','in_progress') AND t.due_date < NOW() AND t.assignee_id IS NOT NULL`
  );
  summary.tasksOverdue = tasks.length;
  for (const t of tasks) {
    const title = `Overdue task: ${t.title}`;
    const body = `Task "${t.title}"${t.client_name ? ' (' + t.client_name + ')' : ''} was due ${t.due_date}.`;
    if (await notifyOnce(t.firm_id, t.assignee_id, 'warning', title, body, '/app.html#tasks')) summary.notifications += 1;
  }

  // 5) Auto-generate filing tasks for due/overdue obligations (de-duplicated by title).
  const needTasks = await q(
    `SELECT o.type, o.period, o.authority, o.due_date, o.status, o.client_id,
            c.name AS client_name, c.manager_id, c.firm_id
       FROM statutory_deadlines o JOIN clients c ON c.id=o.client_id
      WHERE o.status IN ('due','overdue') AND c.deleted_at IS NULL`
  );
  for (const o of needTasks) {
    const title = `File ${o.type}${o.period ? ' (' + o.period + ')' : ''} — ${o.client_name}`;
    const exists = await one("SELECT id FROM tasks WHERE firm_id=? AND title=? AND status<>'cancelled'", [o.firm_id, title]);
    if (exists) continue;
    await q(
      `INSERT INTO tasks (id, firm_id, title, description, client_id, assignee_id, priority, status, due_date)
       VALUES (?,?,?,?,?,?,?, 'open', ?)`,
      [uuid(), o.firm_id, title,
        `Auto-generated from ${o.authority} ${o.type} deadline (${o.period || ''}). Due ${o.due_date}.`,
        o.client_id, o.manager_id || null, o.status === 'overdue' ? 'urgent' : 'high', o.due_date]
    );
    summary.tasksCreated += 1;
  }

  return summary;
}

let task = null;
function startScheduler() {
  if (!env.scheduler.enabled) { console.log('• Reminder scheduler disabled (ENABLE_SCHEDULER=false)'); return; }
  if (!cron.validate(env.scheduler.cron)) { console.warn('• Invalid REMINDER_CRON; scheduler not started'); return; }
  task = cron.schedule(env.scheduler.cron, () => {
    runReminderScan()
      .then((s) => console.log('• Reminder scan:', JSON.stringify(s)))
      .catch((e) => console.error('• Reminder scan failed:', e.message));
  });
  console.log(`• Reminder scheduler started (cron "${env.scheduler.cron}")`);
}

module.exports = { createNotification, notifyOnce, runReminderScan, startScheduler, emailUser };
