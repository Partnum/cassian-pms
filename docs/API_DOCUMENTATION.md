# API Documentation

Base URL: `http://localhost:4000/api/v1`

All responses are JSON. Success: `{ "data": ... }` (list endpoints may add `"meta"`). Errors: `{ "error": { "code", "message" } }` with an appropriate HTTP status.

## Authentication

Send the access token on every protected request:
```
Authorization: Bearer <accessToken>
```
Access tokens expire (~15 min). The refresh token is an HttpOnly cookie set at login; call `POST /auth/refresh` to get a new access token. Endpoints under `/auth` (login/refresh/logout) and the Drive OAuth callback are public; everything else requires authentication.

### Roles & permissions
Roles: **Admin, Partner, Manager, Senior Auditor, Accountant, Tax Consultant, Staff, Client.** Admin has full access. Each route checks a permission code (e.g. `client.create`, `workflow.partner_review`). Non-privileged users are additionally scoped to clients they manage or are explicitly granted (`user_client_access`). The permission matrix is defined in `src/constants.js`.

---

## Auth & users

| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/auth/login` | public | `{ email, password }` → `{ accessToken, user }` (sets refresh cookie) |
| POST | `/auth/refresh` | public (cookie) | → new `{ accessToken, user }` |
| POST | `/auth/logout` | public | revokes refresh token |
| GET | `/auth/me` | auth | current user |
| GET | `/auth/users` | Admin/Partner | list staff |
| POST | `/auth/users` | Admin/Partner | `{ full_name, email, role, phone?, password? }` |
| PATCH | `/auth/users/:id` | Admin/Partner | update `full_name`/`phone`/`role`/`status` |

**Example**
```bash
curl -X POST http://localhost:4000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"info@cassian.co.tz","password":"Password123!"}'
```

## Clients

| Method | Path | Permission |
|---|---|---|
| GET | `/clients?category=&search=` | `client.read` |
| GET | `/clients/:id` | `client.read` (+ scope) |
| POST | `/clients` | `client.create` |
| PATCH | `/clients/:id` | `client.update` |
| DELETE | `/clients/:id` | `client.delete` (soft delete) |
| GET | `/clients/:id/engagements` | `client.read` |
| GET | `/clients/:id/documents` | `client.read` |
| GET | `/clients/:id/obligations` | `client.read` |

Create body: `{ name*, category*, tin, vrn, sector, contact_email, financial_year_end, engagement_partner_id, manager_id }`.

## Engagements & audit workflow

| Method | Path | Permission |
|---|---|---|
| GET | `/engagements?client_id=` | `engagement.read` |
| GET | `/engagements/meta/stages` | `engagement.read` (stage list + gates) |
| GET | `/engagements/:id` | `engagement.read` (+ stages + history) |
| POST | `/engagements` | `engagement.update` (seeds 9 stages) |
| PATCH | `/engagements/:id` | `engagement.update` |
| PATCH | `/engagements/:id/stages/:stageId` | `engagement.update` |
| POST | `/engagements/:id/advance` | `workflow.advance` (+ stage gate) |
| POST | `/engagements/:id/revert` | `workflow.advance` |

**Workflow stages:** Planning → Engagement Letter → Fieldwork → Manager Review → Partner Review → Draft Financial Report → Client Sign-off → ROI Submission → Completed. Completing **Manager Review** requires `workflow.manager_review`; completing **Partner Review** (and reaching **Completed**) requires `workflow.partner_review`. Each transition is recorded in `workflow_history`.

## Tasks & calendar

| Method | Path | Permission |
|---|---|---|
| GET | `/tasks?status=&mine=1` | `task.read` |
| GET | `/tasks/:id` | `task.read` |
| POST | `/tasks` | `task.create` |
| PATCH | `/tasks/:id` | `task.update` |
| DELETE | `/tasks/:id` | `task.delete` |
| GET | `/calendar?from=&to=` | `task.read` (merged tasks + obligations + events) |

## Tax compliance

| Method | Path | Permission |
|---|---|---|
| GET | `/tax/obligations?status=&type=` | `tax.read` |
| GET | `/tax/summary` | `tax.read` |
| POST | `/tax/obligations` | `tax.update` |
| PATCH | `/tax/obligations/:id` | `tax.update` (set `status:"filed"` to file) |
| POST | `/tax/scan` | Admin/Partner (runs reminder scan) |

Obligation types: `VAT, PAYE, SDL, NSSF, WCF, PDPC, PROVISIONAL_TAX, ROI, OTHER`.

## Documents (Google Drive / local)

| Method | Path | Permission |
|---|---|---|
| GET | `/documents?client_id=&year=&doc_type=` | `document.read` |
| GET | `/documents/drive/status` | `document.read` |
| POST | `/documents/upload` | `document.upload` (multipart) |
| GET | `/documents/:id` | `document.read` |
| GET | `/documents/:id/download` | `document.read` |
| DELETE | `/documents/:id` | `document.delete` |
| POST | `/documents/sync/:clientId` | `document.upload` |

Upload is `multipart/form-data` with fields: `file` (the file), `client_id*`, `doc_type`, `year`, `engagement_id?`.
```bash
curl -X POST http://localhost:4000/api/v1/documents/upload \
  -H "Authorization: Bearer <token>" \
  -F "file=@statement.pdf" -F "client_id=<id>" -F "doc_type=bank_statement" -F "year=2025"
```

## Notifications

| Method | Path | Permission |
|---|---|---|
| GET | `/notifications` | `notification.read` (+ `meta.unread`) |
| POST | `/notifications/:id/read` | `notification.read` |
| POST | `/notifications/read-all` | `notification.read` |

## AI assistant

| Method | Path | Permission |
|---|---|---|
| POST | `/ai/chat` | `ai.use` — `{ prompt, client_id?, engagement_id? }` |
| POST | `/ai/audit-comments` | `ai.use` — `{ area, details?, client_id? }` |
| POST | `/ai/risk-analysis` | `ai.use` — `{ context, client_id? }` |
| POST | `/ai/financial-review` | `ai.use` — `{ figures }` |
| GET | `/ai/search?q=` | `ai.use` — smart document search |
| GET | `/ai/logs` | Admin/Partner |

## Reports

| Method | Path | Permission |
|---|---|---|
| GET | `/reports/dashboard` | auth (scoped) — KPIs, client mix, audit progress, compliance, deadlines, feed |
| GET | `/reports/productivity` | `report.read` |

## System

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | public health check |
| GET | `/drive/connect` | public — starts Google OAuth (Drive mode) |
| GET | `/drive/callback` | public — Google OAuth redirect target |

## Error codes

`NO_TOKEN` / `BAD_TOKEN` (401), `BAD_CREDENTIALS` (401), `FORBIDDEN` / `GATE` (403), `BAD_INPUT` (400), `NOT_FOUND` (404), `CONFLICT` (409), `DRIVE_ERROR` (502), `SERVER_ERROR` (500).
