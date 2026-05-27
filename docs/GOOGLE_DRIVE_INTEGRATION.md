# Google Drive Integration

Production-grade Drive document management for the Cassian PMS: multi-user OAuth, automatic audit folder trees, an incremental sync engine, AI document classification + OCR + entity extraction, workflow auto-advancement, a missing-documents tracker, and full access logging.

---

## 1. Architecture

```
Browser (Drive workspace)
  └── /api/v1/drive/*  +  /api/v1/documents/*
         │
   drive.routes / documents.routes
         │
   ┌─────┴───────────────────────────────────────────────┐
   │ drive.service     OAuth2 (per user), folder tree,    │
   │                   upload/download, Changes-API sync  │
   │ ingest.service    persist → OCR → classify → extract │
   │                   → version → access-log → workflow  │
   │ classifier / ocr / extraction / workflow-hooks       │
   │ jobs/drive-sync   cron + on-demand background sync    │
   └──────────────────────────────────────────────────────┘
         │
   PostgreSQL: documents, document_versions, document_access_logs,
   drive_connections, drive_sync_state, client_drive_links,
   document_requirements   +  clients / audit_engagements / tasks / notifications
         │
   Google Drive API v3
```

Files: `src/services/drive.service.js`, `ingest.service.js`, `classifier.service.js`, `ocr.service.js`, `extraction.service.js`, `workflow-hooks.service.js`; `src/jobs/queue.js`, `drive-sync.job.js`; `src/routes/drive.routes.js`, `documents.routes.js`; `src/drive.config.js`; migration `database/postgres/migrations/0008_drive_integration.sql`.

The app runs in two modes via `DRIVE_MODE`:
- **`local`** (default) — uploads are stored on disk under `./uploads/<client>/<year>/<subfolder>`. Everything works without Google so you can test immediately.
- **`google`** — real Google Drive (per-user OAuth) with background sync.

---

## 2. OAuth 2.0 setup (Google Cloud Console)

1. Create / select a project at https://console.cloud.google.com.
2. **APIs & Services → Library →** enable **Google Drive API** (and **Cloud Vision API** if you want image OCR).
3. **APIs & Services → OAuth consent screen:** choose *Internal* (Workspace) or *External*; add your firm's users as test users if External; add the scope `https://www.googleapis.com/auth/drive`.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID → Web application.**
   - Authorised redirect URI: `http://localhost:4000/api/v1/drive/callback` (use your real domain in production).
5. Copy the Client ID and Client Secret into `.env`:
   ```
   DRIVE_MODE=google
   GOOGLE_CLIENT_ID=...apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=...
   GOOGLE_REDIRECT_URI=http://localhost:4000/api/v1/drive/callback
   DRIVE_ROOT_FOLDER=Cassian Clients
   TOKEN_ENC_KEY=<any long passphrase>     # encrypts stored tokens (AES-256-GCM)
   DRIVE_SYNC_CRON=*/10 * * * *
   ```
6. Restart the server. In the app, open **Drive & Documents → Connect Drive**; a Google popup opens, you grant access, and the refresh token is stored (encrypted) in `drive_connections`. Each staff member can connect their own Google account (multi-user).

**Token security:** tokens are stored in `drive_connections.token` (JSONB). With `TOKEN_ENC_KEY` set they are AES-256-GCM encrypted at rest; refreshed access tokens are persisted automatically. Never commit `.env`.

---

## 3. Folder automation

On first upload (or **Provision** action) the system creates, idempotently:

```
<DRIVE_ROOT_FOLDER>/<Category>/<Client Name>/<Year>/<Subfolders>
```

Audit subfolders: `Planning, EL, Bank Statements, Working Papers, Draft FS, Final FS, ROI, TRA, WCF, NSSF, PDPC, Invoices, Payroll` (Tax / Accounting / Consultancy have their own sets — see `src/drive.config.js`). Every folder id is recorded in `client_drive_links` so sync can map files back to a client/year/subfolder.

- **Create automatically:** `POST /api/v1/drive/clients/:id/provision` (or implicitly on first upload).
- **Connect existing folder:** `POST /api/v1/drive/clients/:id/link { folderId }`.
- The client's root folder id is stored on `clients.drive_folder_id`.

---

## 4. Sync engine

Incremental sync uses the **Drive Changes API**. A `start_page_token` per connection is stored in `drive_sync_state`; each run pulls only changes since the last token, maps each changed file to a client folder, and ingests new/updated files (skipping trashed items and folders). Versions are tracked by `md5Checksum` — a changed checksum bumps `documents.current_version` and adds a `document_versions` row.

- Background: cron (`DRIVE_SYNC_CRON`, default every 10 min) runs `runAllSyncs()` for every connected account.
- On demand: `POST /api/v1/drive/sync`.
- Monitoring: `GET /api/v1/drive/sync/status` and the status card on the Drive page (mode, account, last sync, last result).

Captured per file: name, mime type, size, Drive file id, parent folder, md5, modified time, uploaded-by, version.

---

## 5. Smart document detection

`classifier.service.js` matches the file name + extracted text against keyword/regex rules and returns the closest `documents.doc_type` enum, a finer `detected_type`, suggested `tags` and a confidence score. Detected types include: bank statement, financial statements (draft/final), tax return / ROI, payroll, engagement letter, proof of payment, invoice, VAT schedule, trial balance, TRA document, WCF/NSSF/PDPC, working paper. Documents are auto-tagged (`auto_tagged=1`) and filed into the matching subfolder. Re-run anytime with `POST /api/v1/documents/:id/reclassify`.

---

## 6. AI search & analysis

- **OCR** (`ocr.service.js`): `OCR_MODE=off` decodes native text files; `OCR_MODE=vision` runs Google Cloud Vision `DOCUMENT_TEXT_DETECTION` on images (set `OCR_API_KEY`). Extracted text is stored in `documents.ocr_text` and indexed by the GIN full-text index.
- **Search inside documents:** `GET /api/v1/ai/search?q=` (PostgreSQL `to_tsvector @@ plainto_tsquery`, ILIKE fallback).
- **Entity extraction** (`extraction.service.js`): TIN, VRN, dates and monetary amounts pulled from text into `documents.extracted` (JSONB).
- **Missing documents:** `GET /api/v1/drive/clients/:id/missing-documents` compares `document_requirements` against documents present.
- **Anomalies:** anomaly results have a home in `anomaly_detection_results`; wire a detector (e.g. duplicate md5, cut-off date mismatches) into the ingest pipeline.

---

## 7. Workflow connection

`workflow-hooks.service.js` runs after every ingest:
- Notifies the client's manager & partner of the new file.
- If the document maps to the **immediate next, non-gated** stage (e.g. EL → *Engagement Letter*, working papers → *Fieldwork*), it **auto-advances** the engagement and records `audit_workflow_history`.
- For gated stages (Draft FR needs partner review) or non-adjacent jumps (e.g. ROI), it raises a **review task** and an alert instead of skipping — respecting the RBAC review gates.

Example: uploading an ROI PDF for an engagement at *Partner Review* creates a "Review Return of Income & advance to ROI Submission" task and notifies the manager/partner.

---

## 8. Access control & audit

Every documents/Drive endpoint is gated by RBAC permissions (`document.read/upload/delete`, `client.update`) **and** per-client scoping — staff only see clients they manage or are granted (`user_client_access`). Every file action (upload, view, download, delete, sync-new, sync-update, reclassify) is written to `document_access_logs` and surfaced in the **activity timeline**; broader state changes also hit the immutable `activity_log`.

---

## 9. API endpoints

**Drive** (`/api/v1/drive`): `GET /status`, `GET /connect`, `POST /disconnect`, `GET /connections`, `POST /sync`, `GET /sync/status`, `POST /clients/:id/provision`, `POST /clients/:id/link`, `GET /clients/:id/folder-tree`, `GET /clients/:id/missing-documents`, `GET /activity`.

**Documents** (`/api/v1/documents`): `GET /` (filters: client_id, year, doc_type, detected_type, tag, search), `POST /upload` (multipart), `GET /:id`, `GET /:id/download`, `GET /:id/preview`, `POST /:id/reclassify`, `DELETE /:id`.

OAuth callback (public): `GET /api/v1/drive/callback?code&state` (state is a signed JWT identifying the initiating user).

---

## 10. Dashboard

The **Drive & Documents** page provides: connection status (mode/account/last sync), **Connect Drive** + **Sync now**, a drag-and-drop upload center, the synced-files list with detected-type tags + preview/download, a missing-documents tracker, a client folder explorer, and a file activity timeline.

---

## 11. Installation

This module ships inside the existing app. From `cassian-pms/`:
```bash
npm install                 # adds googleapis, pg, multer, node-cron
npm run migrate             # applies 0008_drive_integration.sql
npm run seed                # optional sample data
# configure .env per section 2 (or leave DRIVE_MODE=local to test now)
npm start
```
Open `http://localhost:4000/login.html` → sign in → **Drive & Documents**.

---

## 12. Scalability & large files

Uploads accept up to 200 MB (`multer` limit — raise as needed); binaries live in Google Drive, not the database (only metadata + OCR text are stored), so audit files of any size scale cleanly. Sync is incremental (Changes API) rather than full scans. Search is backed by a GIN full-text index. The in-process job queue (`src/jobs/queue.js`) is interface-compatible with BullMQ — point it at Redis for multi-instance/high-volume deployments. For many concurrent users, run several API instances behind a load balancer with PgBouncer in front of PostgreSQL.

---

## 13. Troubleshooting

| Symptom | Fix |
|---|---|
| `redirect_uri_mismatch` | The redirect URI in Google Console must exactly equal `GOOGLE_REDIRECT_URI`. |
| Connect popup succeeds but status stays "not connected" | Re-open the page (status is fetched on load); ensure cookies/popups aren't blocked. |
| `Google Drive not connected` on upload/sync | Connect Drive (section 2), or set `DRIVE_MODE=local` to use disk storage. |
| Sync finds nothing | Files must live under the provisioned client folder tree; provision/link the folder, then Sync. |
| OCR returns no text | Expected with `OCR_MODE=off`; set `OCR_MODE=vision` + `OCR_API_KEY` (images), and wire async PDF OCR for scanned PDFs. |
| Tokens visible in DB | Set `TOKEN_ENC_KEY` to encrypt tokens at rest. |
