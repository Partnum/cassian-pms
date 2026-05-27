# Cassian & Associates — Audit, Tax & Accounting Management System

A production-oriented practice-management platform for a Tanzanian audit/accounting firm: clients, a role-gated audit workflow engine, tasks, statutory tax-compliance tracking (TRA / NSSF / WCF / PDPC), Google Drive document management, an AI assistant, multi-user JWT auth with role-based access control, notifications/reminders, and a live dashboard.

**Stack:** Node.js + Express · **PostgreSQL 14+** · JWT auth · Google Drive API · OpenAI-compatible AI · vanilla JS frontend (served by the API).

The full enterprise database architecture (schema, sequential migrations, ERD, seed, setup guide) lives in **`database/postgres/`** — see [`database/postgres/DATABASE_SETUP.md`](database/postgres/DATABASE_SETUP.md).

---

## Quick start (~5 minutes)

> Prerequisites: **Node.js 18+** and **PostgreSQL 14+** (the installer also includes pgAdmin).

1. **Configure environment** — from this folder:
   ```bash
   copy .env.example .env        # Windows  (mac/Linux: cp .env.example .env)
   ```
   Set `PGUSER` / `PGPASSWORD` to your Postgres credentials (defaults assume user `postgres`). You can instead set a single `DATABASE_URL`.

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Create the database, run migrations and load sample data:**
   ```bash
   npm run setup        # = npm run migrate (creates DB + tables) && npm run seed
   ```
   `migrate` creates the `cassian_pms` database if it doesn't exist, then applies every file in `database/postgres/migrations` in order. `seed` loads Tanzanian sample data.

4. **Run it:**
   ```bash
   npm start            # or: npm run dev   (auto-reload)
   ```
   Open **http://localhost:4000/login.html**

### Default logins (all share the seeded password `Password123!`)

| Email | Role |
|---|---|
| `info@cassian.co.tz` | Admin (sees everything) |
| `emmanuel@cassian.co.tz` | Partner |
| `grace@cassian.co.tz` | Partner |
| `amani@cassian.co.tz` | Manager |
| `neema@cassian.co.tz` / `juma@cassian.co.tz` | Senior Auditor |
| `fatma@cassian.co.tz` | Accountant |
| `david@cassian.co.tz` | Tax Consultant |

Log in as different users to see role-based access control in action (e.g. a Senior Auditor cannot complete Partner Review in the workflow).

---

## What works out of the box

- **Auth & RBAC** — real login, JWT access tokens with rotating refresh tokens, bcrypt password hashing, 8 roles, per-client scoping.
- **Dashboard** — KPIs, client mix, compliance and audit-progress widgets from live data.
- **Clients** — list/filter/create; profiles with TIN, VRN, manager/partner, status.
- **Audit workflow engine** — Planning → Engagement Letter → Fieldwork → Manager Review → Partner Review → Draft Financial Report → Client Sign-off → ROI Submission → Completed, with role-gated transitions and full history.
- **Tasks & calendar**, **tax-compliance tracker**, **documents** (upload/download), **AI assistant** chat, **smart document search**, **notifications**.
- **Reminder scheduler** — a daily cron job flags overdue/upcoming statutory obligations and overdue tasks.

## Integrations (toggle in `.env`)

- **Google Drive** — set `DRIVE_MODE=google` plus `GOOGLE_CLIENT_ID/SECRET`, then connect once at `http://localhost:4000/api/v1/drive/connect`. Default `DRIVE_MODE=local` stores uploads under `./uploads/` so everything is testable without Google.
- **AI** — set `AI_MODE=openai` + `AI_API_KEY` (+ optional `AI_BASE_URL`, `AI_MODEL`) for any OpenAI-compatible provider. Default `AI_MODE=mock` returns deterministic, rule-based answers so the assistant works without a key.
- **Email reminders** — set the `SMTP_*` variables to send email alerts (optional).

See **[docs/INSTALLATION_DEPLOYMENT.md](docs/INSTALLATION_DEPLOYMENT.md)** for full setup (incl. phpMyAdmin import, Google/AI keys, production deployment) and **[docs/API_DOCUMENTATION.md](docs/API_DOCUMENTATION.md)** for the API reference.

---

## Project structure

```
cassian-pms/
├─ database/
│  ├─ postgres/               # ★ enterprise PostgreSQL architecture
│  │  ├─ schema.sql           #   aggregator (applies all migrations)
│  │  ├─ migrations/          #   0001..0007 sequential SQL migrations (50+ tables)
│  │  ├─ seed.sql             #   Tanzanian sample data (bcrypt via pgcrypto)
│  │  ├─ ERD.mermaid          #   full entity-relationship diagram
│  │  ├─ ERD.svg              #   schema module map
│  │  └─ DATABASE_SETUP.md    #   PostgreSQL setup, backup, RLS, performance
│  └─ schema.sql              # (legacy MySQL schema — superseded by postgres/)
├─ scripts/migrate.js         # PostgreSQL migration runner (creates DB, applies migrations)
├─ scripts/seed.js            # runs database/postgres/seed.sql
├─ src/
│  ├─ config.js               # env + pg pool + ?→$n rebinder + helpers
│  ├─ constants.js            # roles, RBAC matrix, workflow stages
│  ├─ auth.js                 # JWT, refresh rotation, RBAC, scoping, audit log
│  ├─ server.js               # app entry point
│  ├─ services/               # drive, ai, notifications (+ scheduler)
│  └─ routes/                 # auth, clients, workflow, tasks, tax, documents, notifications, ai, reports
├─ public/                    # login.html + app.html (connected frontend)
└─ docs/                      # installation/deployment + API reference
```

> Note: the running app uses the requested enterprise names for the audit module
> (`audit_engagements`, `audit_stages`), tax (`statutory_deadlines`) and sessions
> (`user_sessions`). Core `clients`/`tasks`/`documents` columns keep app-aligned names
> with SQL `COMMENT`s mapping to the requested labels (e.g. `clients.name` ↔ `company_name`).

## Useful scripts

| Command | Purpose |
|---|---|
| `npm run migrate` | Create database + tables |
| `npm run seed` | Load sample data (truncates first) |
| `npm run setup` | migrate + seed |
| `npm start` | Run the server |
| `npm run dev` | Run with auto-reload (nodemon) |

## Security notes

JWT access tokens are short-lived; refresh tokens are random, hashed in the database and rotated on use. Passwords are bcrypt-hashed. All queries are parameterised. RBAC is enforced per-route and combined with per-client scoping so staff only see their assigned clients. Every state-changing action is written to an immutable `activity_log`. **Before any real deployment, change `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` and `SEED_PASSWORD` in `.env`.**
