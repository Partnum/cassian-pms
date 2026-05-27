# Installation & Deployment Guide

This guide covers local setup on **XAMPP** first, then optional integrations and production deployment.

---

## 1. Prerequisites

- **Node.js 18 or newer** — https://nodejs.org (verify with `node -v`).
- **XAMPP** — https://www.apachefriends.org (provides MySQL/MariaDB + phpMyAdmin). Only the **MySQL** module is required; Apache is not used (Node serves the app).
- A code editor (e.g. VS Code) and a terminal.

> The app's backend runs on Node, **not** on Apache/PHP. XAMPP is used purely for its bundled MySQL database and the convenient phpMyAdmin UI.

---

## 2. Database setup

### Option A — automatic (recommended)

1. Open the **XAMPP Control Panel** and click **Start** on the **MySQL** row.
2. In the project folder copy the environment file and keep the XAMPP defaults:
   ```bash
   cp .env.example .env        # Windows: copy .env.example .env
   ```
   Defaults: `DB_HOST=localhost`, `DB_PORT=3306`, `DB_USER=root`, `DB_PASSWORD=` (empty), `DB_NAME=cassian_pms`.
3. Run:
   ```bash
   npm install
   npm run setup
   ```
   `migrate` creates the `cassian_pms` database and all tables; `seed` loads sample data.

> **MySQL says "Access denied for root"?** Some XAMPP installs set a root password. Put it in `.env` as `DB_PASSWORD=...`. If you use MySQL on a different port, set `DB_PORT`.

### Option B — via phpMyAdmin (manual import)

1. Start MySQL in XAMPP, then open **http://localhost/phpmyadmin**.
2. Import the schema: **Import** tab → choose `database/schema.sql` → **Go**. This creates the `cassian_pms` database and tables.
3. Load sample data with `npm run seed` (recommended — it hashes passwords correctly), or skip seeding to start empty.

---

## 3. Run the application

```bash
npm start          # production-style
# or
npm run dev        # development with auto-reload
```

Open **http://localhost:4000/login.html** and sign in with `info@cassian.co.tz` / `Password123!`.

To change the port, set `PORT` in `.env` (and update `GOOGLE_REDIRECT_URI` and `CORS_ORIGINS` accordingly).

---

## 4. Google Drive integration (optional)

By default `DRIVE_MODE=local` — uploaded files are stored under `./uploads/<client>/<year>/` and everything works without Google.

To use **real Google Drive**:

1. In the **Google Cloud Console** create a project and **enable the Google Drive API**.
2. Create an **OAuth 2.0 Client ID** of type **Web application**. Add the authorised redirect URI:
   ```
   http://localhost:4000/api/v1/drive/callback
   ```
3. In `.env` set:
   ```
   DRIVE_MODE=google
   GOOGLE_CLIENT_ID=<your client id>
   GOOGLE_CLIENT_SECRET=<your client secret>
   GOOGLE_REDIRECT_URI=http://localhost:4000/api/v1/drive/callback
   DRIVE_ROOT_FOLDER=Cassian Clients
   ```
4. Restart the server, then visit **http://localhost:4000/api/v1/drive/connect** (signed in as Admin) and grant access. The refresh token is stored in `app_settings`.
5. Uploads now go to Drive under `Cassian Clients/<Client>/<Year>/`. Use **Sync** (per client) to pull files added directly in Drive into the catalogue.

---

## 5. AI assistant (optional)

By default `AI_MODE=mock` — the assistant returns deterministic, rule-based responses (no key, no cost). To enable a real model (any OpenAI-compatible API):

```
AI_MODE=openai
AI_BASE_URL=https://api.openai.com/v1
AI_API_KEY=<your api key>
AI_MODEL=gpt-4o-mini
```

The assistant grounds answers on the relevant client's documents (names + OCR text on file) and logs every call to `ai_logs`.

---

## 6. Email reminders (optional)

Set SMTP details to deliver reminder emails (in-app notifications work regardless):
```
SMTP_HOST=smtp.yourprovider.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
MAIL_FROM=Cassian PMS <no-reply@cassian.co.tz>
```

The reminder scheduler runs daily (`REMINDER_CRON`, default `0 7 * * *`). Trigger it manually from the Tax page (**Run reminder scan**) or `POST /api/v1/tax/scan`. Disable it with `ENABLE_SCHEDULER=false`.

---

## 7. Production deployment

The same codebase deploys to any Node host (a VPS, a cloud VM, or a managed Node platform) with a managed MySQL/MariaDB.

Checklist:

1. **Secrets** — set strong, unique `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` and a non-default `SEED_PASSWORD`. Set `NODE_ENV=production`.
2. **Database** — point `DB_*` at your managed MySQL; run `npm run migrate` once (run `seed` only if you want demo data).
3. **Process manager** — run under **pm2**: `npm i -g pm2 && pm2 start src/server.js --name cassian-pms && pm2 save`.
4. **HTTPS / reverse proxy** — terminate TLS at Nginx (or your platform's load balancer) and proxy to the Node port. With HTTPS, refresh-token cookies are automatically marked `Secure` (because `NODE_ENV=production`).
5. **CORS** — set `CORS_ORIGINS` to your real frontend origin(s).
6. **Drive/AI redirect URIs** — update `GOOGLE_REDIRECT_URI` and the Google Console authorised URI to your production domain.
7. **Backups** — schedule regular MySQL dumps (`mysqldump cassian_pms`) and back up the `uploads/` folder (local Drive mode). Test restores.
8. **Uploads** — for multi-instance deployments use `DRIVE_MODE=google` (or a shared volume/object store) rather than local disk.

### Run with Docker (alternative)

If you prefer containers, you can run MySQL and the app together; point `DB_HOST` at the database service name and run `npm run setup` once. (A `docker-compose.yml` can be added later — the app only needs the `DB_*` env vars.)

---

## 8. Troubleshooting

| Symptom | Fix |
|---|---|
| `Database connection failed` on start | Start MySQL in XAMPP; check `DB_*` in `.env`. |
| `ER_ACCESS_DENIED_ERROR` | Set the correct `DB_USER`/`DB_PASSWORD`. |
| Login fails for all users | Run `npm run seed`; ensure `SEED_PASSWORD` matches what you type. |
| Port 4000 in use | Change `PORT` in `.env`. |
| Drive upload error | Either set `DRIVE_MODE=local`, or complete the Google connect step (section 4). |
| AI returns "mock mode" text | Expected until you set `AI_MODE=openai` + `AI_API_KEY`. |
