# AI Module

An intelligent audit assistant, tax advisor, compliance monitor and accounting analyst for the Cassian PMS. The analytic engines are **deterministic over the PostgreSQL database** (auditable, run with no API key), with an LLM layered on for professional commentary and drafting.

---

## 1. Architecture

```
Browser: AI Assistant · AI Risk Center · AI Analytics · Recommendations
   │  /api/v1/ai/*
ai.routes.js (RBAC: ai.use + per-client scoping)
   │
 ┌─┴───────────────────────────────────────────────────────────┐
 │ services/ai.service.js    LLM gateway (OpenAI-compatible) +   │
 │                           deterministic mock fallback + logs  │
 │ ai/prompts.js             Tanzania-aware prompt templates      │
 │ ai/assistant.service.js   conversation memory + RAG context    │
 │ ai/risk.service.js        risk scoring · anomaly · acct review │
 │ ai/analytics.service.js   financial analysis · compliance ·    │
 │                           workflow assistant                   │
 │ ai/nlq.service.js         natural-language query (safe intents)│
 │ ai/reports.service.js     report generation                    │
 │ classifier/ocr/extraction (document intelligence — Drive doc)  │
 └──────────────────────────────────────────────────────────────┘
   │
 PostgreSQL: ai_conversations, ai_messages, ai_logs, ai_recommendations,
 ai_risk_analysis, risk_assessments, anomaly_detection_results
 (+ clients, audit_engagements, statutory_deadlines, documents, journals, trial_balance, tasks)
```

Tech stack: Node.js, **OpenAI-compatible Chat Completions** (works with OpenAI or any compatible endpoint; Claude via a compatible gateway), OCR (Google Vision optional), PostgreSQL full-text search for retrieval (RAG), the in-process job queue for background work, prompt templates, and conversation memory.

---

## 2. Configuration

```
AI_MODE=openai            # or 'mock' (default; deterministic, no key, no cost)
AI_BASE_URL=https://api.openai.com/v1
AI_API_KEY=sk-...
AI_MODEL=gpt-4o-mini
# OCR (document intelligence) — see GOOGLE_DRIVE_INTEGRATION.md
OCR_MODE=off|vision
OCR_API_KEY=
```

In `mock` mode every feature still works: the analytic engines compute from the database, and the LLM wrappers return professional rule-based text. Set `AI_MODE=openai` + a key for live narrative generation and free-form chat.

---

## 3. Capabilities & endpoints (`/api/v1/ai`)

**Assistant & drafting**
- `POST /chat` — single-turn Q&A (optional `client_id` grounds it on the client's documents).
- `POST /conversations`, `GET /conversations`, `GET /conversations/:id`, `POST /conversations/:id/messages` — **chat with memory** + RAG over the client's documents; citations returned.
- `POST /variance` — the worked example: *"Variance between VAT return and ledger"* → possible causes, audit risks & assertions, suggested procedures, and a draft working-paper comment.
- `POST /audit-comments`, `POST /management-letter-point`, `POST /audit-conclusion`.

**Risk engine** (`ai/risk.service.js`)
- `GET /risk/center` — per-client scores + a category **heatmap** (Tax compliance, Documentation, Engagement progress, Anomalies, Workflow).
- `POST /risk/recompute` — recompute and persist `risk_assessments`; high/critical clients raise recommendations.
- `GET /risk/client/:id`.
Scoring is a transparent weighted model (`rule-v1`): overdue/ due statutory items (30%), missing required documents (20%), engagement progress vs deadline (20%), open anomalies (15%), overdue tasks (15%).

**Anomaly detection** — `POST /anomalies/scan`, `GET /anomalies`: late filings, unbalanced journals, possible duplicate payments, negative asset balances → `anomaly_detection_results`.

**Accounting review** — `POST /accounting-review/:clientId`: unbalanced journals, trial-balance imbalance, negative balances → recommendations + AI commentary.

**Financial analysis** — `GET /financial-analysis/:clientId`: revenue, net profit/margin, assets/liabilities/equity, current ratio, gearing, ROA, chart datasets and AI commentary (ISA 520 framing).

**Tax compliance monitor** — `GET /compliance/monitor`: predicts overdue risk per obligation (using due date + the client's overdue history), prioritised alerts and recommended next action/owner.

**Workflow assistant** — `GET /workflow/assistant`: delayed reviews (stuck >7 days), missing partner approvals, overdue audits (auto-escalated to the partner), and a priority-task list.

**Natural-language query** — `POST /nlq { q }`: safe intent router (no model-authored SQL), e.g. *"show all clients with overdue VAT returns"*, "high-risk clients", "pending reviews", "overdue tasks"; falls back to document search.

**Report generation** — `POST /reports/:type` where type ∈ `audit_report, management_letter, tax_summary, compliance_report, client_progress, financial_review`: gathers data context and drafts the report (stored in `reports`, logged in `ai_logs`).

**Recommendations panel** — `GET /recommendations`, `POST /recommendations/:id/status` (accept/dismiss).

**Smart search** — `GET /search?q=` full-text over document name + OCR text.

All endpoints require the `ai.use` permission and are scoped to clients the user may access; every call is logged to `ai_logs`.

---

## 4. Dashboard pages

- **AI Assistant** — natural-language query bar, quick-tool chips (variance, procedures, ML point, tax risks) and a chat panel.
- **AI Risk Center** — risk heatmap with per-category scores and a one-click recompute.
- **AI Analytics** — per-client financial ratios, performance/position charts and AI commentary.
- **Recommendations** — open AI recommendations with accept/dismiss and a "run scans" action.

---

## 5. Database & logging

`ai_conversations` / `ai_messages` (threaded memory + citations), `ai_logs` (every prompt/response, model, tokens), `ai_recommendations` (findings/risk/accounting/anomaly/workflow/compliance, with status), `risk_assessments` (score history + factor breakdown), `ai_risk_analysis` (engagement risk areas), `anomaly_detection_results`. Migration: `database/postgres/migrations/0009_ai.sql`.

---

## 6. Machine-learning readiness

The deterministic `rule-v1` risk model writes scored history with full factor breakdowns to `risk_assessments`, and labelled outcomes accumulate in `anomaly_detection_results` and `ai_recommendations` (accepted/dismissed). This dataset is the training substrate for future models: **predictive analytics** (deadline-miss probability from compliance history), **fraud detection** (supervised on confirmed anomalies), **audit scoring models** (engagement risk), and **client risk profiling**. The model version is stamped on every assessment so models can be compared. For semantic retrieval, the current RAG uses PostgreSQL full-text; swap in `pgvector` embeddings behind the same `ragSnippets` interface when available.

---

## 7. Security & professionalism

RBAC (`ai.use`) + per-client scoping on every endpoint; AI output is decision-support, never a final opinion, and is logged for traceability. Prompts enforce professional accounting/audit language and the Tanzanian context (TRA, VAT, PAYE, SDL, NSSF, WCF, PDPC, ROI; ISA/IFRS). The assistant is grounded on the firm's own documents and the Drive integration.

---

## 8. Installation

```bash
npm install
npm run migrate          # applies 0009_ai.sql
# optional: set AI_MODE=openai + AI_API_KEY in .env for live LLM
npm start
```
Open the app → **AI Assistant / AI Risk Center / AI Analytics / Recommendations**. Click **Recompute risk** and **Run scans** to populate the Risk Center and Recommendations from your data.
