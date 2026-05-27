# Mwongozo wa Uzinduzi — Cassian PMS

Mwongozo huu unakuwezesha kuufungua mfumo (Audit, Tax & Accounting Management System) kutoka mwanzo hadi uendeshwe na kufanya kazi kwenye kompyuta yako. Fuata hatua kwa mpangilio.

> **Muhimu (njia rahisi):** Mfumo umewekwa tayari kufanya kazi kwa **Node.js PEKEE**. Database imejengwa ndani ya Node (PGlite — ni PostgreSQL halisi inayokimbia ndani ya programu). **HUHITAJI** kusakinisha PostgreSQL, XAMPP, wala connection string yoyote. Endesha hatua zote ndani ya folda **`cassian-pms`**.

---

## Sehemu A — Kifaa unachohitaji (mara moja tu)

1. **Node.js 18 au zaidi** — pakua kutoka https://nodejs.org (chagua toleo la "LTS"). Baada ya kusakinisha, fungua "Command Prompt"/"Terminal" na thibitisha:
   ```
   node -v
   ```
   Ukiona namba (mf. `v22.x`), uko tayari. **Hicho ndicho kitu pekee unachohitaji** kwa njia rahisi (PGlite).

> Hauhitaji PostgreSQL, pgAdmin, wala XAMPP kwa njia hii. Database yote huhifadhiwa kwenye folda `cassian-pms/data/pglite` moja kwa moja.

---

## Sehemu A2 (HIARI) — Database ya wingu (Supabase/Neon) kwa matumizi ya kudumu

> Tumia hii **tu** ukitaka database ya kudumu mtandaoni (mf. watumiaji wengi, seva). Si lazima kuanza — njia ya PGlite (Sehemu A) inatosha kabisa kujaribu na kufanya kazi.

1. Fungua akaunti ya bure kwenye **Supabase** (https://supabase.com) **au Neon** (https://neon.tech) na tengeneza project/database.
2. Nakili **"Connection string"** (URL) wanayokupa.
3. Kwenye `.env`, **badilisha** `DB_MODE` kuwa `pg`, kisha ondoa alama `#` kwenye mistari hii miwili na uweke maadili yako:
   ```
   DB_MODE=pg
   DATABASE_URL=postgresql://USER:PASSWORD@HOST/DBNAME?sslmode=require
   PGSSL=true
   ```
4. Kisha endelea kawaida: `npm install` → `npm run setup` → `npm start`.

(SSL huwashwa moja kwa moja kwa Neon/Supabase/Render/Railway. Kwa wingu, database huundwa na mtoa huduma — `npm run migrate` huingiza jedwali moja kwa moja.)

**Kidokezo cha Supabase:** Tumia connection string ya **"Session pooler"** (port **5432**), SI "Transaction pooler" (6543). Jina la mtumiaji litakuwa `postgres.<project-ref>` (lipo tayari ndani ya URL). Kama nenosiri lina alama maalum, zibadilishe kwa msimbo (mf. `@` → `%40`), au tumia nenosiri la herufi/namba tu (Settings → Database).

---

## Sehemu B — Anzisha mfumo (mara ya kwanza)

**Hatua 1 — Fungua folda ya mradi**
Fungua "Command Prompt" / "Terminal" ndani ya folda `cassian-pms` (ile yenye faili `package.json`).

**Hatua 2 — Tengeneza faili la mipangilio `.env`**
```
copy .env.example .env        :: Windows
cp .env.example .env          # macOS / Linux
```
**Si lazima kubadilisha chochote** kwa njia rahisi. Faili `.env` tayari ina `DB_MODE=pglite`, hivyo database hujifanya yenyewe ndani ya Node — **hakuna nenosiri la database linalohitajika.** (Drive na AI nazo zinafanya kazi katika hali ya majaribio "mock".)

**Hatua 3 — Sakinisha vifurushi (packages)**
```
npm install
```
(Hii hupakua PGlite na vifurushi vingine — mara ya kwanza inaweza kuchukua dakika kadhaa.)

**Hatua 4 — Tengeneza jedwali na data ya mfano**
```
npm run setup
```
Hii huunda **jedwali zote (migrations 0001–0010)** ndani ya folda `data/pglite`, kisha hujaza **data ya mfano** (kampuni, watumiaji, wateja, n.k.). Ukiona `✓ Seed complete.` umefanikiwa.

> Hatua hii imejaribiwa na inafanya kazi: migrations zote 10 + data ya mfano huingia salama, na login hufanya kazi. Ukianzisha upya data wakati wowote, endesha `npm run seed`.

**Hatua 5 — Washa mfumo**
```
npm start
```
Utaona ujumbe: `✓ Cassian PMS running: http://localhost:4000/login.html`
(Kwa maendeleo, tumia `npm run dev` — hujiwasha upya unapobadilisha msimbo.)

**Hatua 6 — Ingia**
Fungua **http://localhost:4000/login.html** kwenye kivinjari. Ingia kwa:

| Barua pepe | Nenosiri | Wajibu |
|---|---|---|
| `info@cassian.co.tz` | `Password123!` | Admin (anaona kila kitu) |
| `emmanuel@cassian.co.tz` | `Password123!` | Partner |
| `amani@cassian.co.tz` | `Password123!` | Manager |
| `neema@cassian.co.tz` | `Password123!` | Senior Auditor |
| `fatma@cassian.co.tz` | `Password123!` | Accountant |
| `david@cassian.co.tz` | `Password123!` | Tax Consultant |

Ingia kama watumiaji tofauti kuona jinsi ruhusa (RBAC) zinavyobadilika.

---

## Sehemu C — Jaribu kila moduli (orodha ya ukaguzi)

Baada ya kuingia, pitia haya ili kuthibitisha mfumo unafanya kazi:

1. **Dashboard** — KPIs, chati, makataa yajayo.
2. **Clients** — orodha ya wateja; bonyeza "Add client" kuongeza mteja mpya.
3. **Audit Workflow** — chagua engagement; bonyeza **Advance ▸** (Senior Auditor atazuiwa kupita "Partner Review" — hii ni RBAC ikifanya kazi).
4. **Tasks & Calendar** — kazi; tiki kuhitimisha.
5. **Drive & Documents** — pakia faili (drag & drop); litatambuliwa na kupangwa kiotomatiki; jaribu Preview/Get.
6. **Tax Compliance** — orodha ya majukumu ya TRA/NSSF/WCF; bonyeza "Run reminder scan".
7. **AI Assistant** — andika swali, au tumia upau wa NLQ: *"show all clients with overdue VAT returns"*.
8. **AI Risk Center** — bonyeza **Recompute risk** kuona heatmap ya hatari.
9. **AI Analytics** — chagua mteja kuona uchambuzi wa kifedha.
10. **Recommendations** — bonyeza **Run scans** kuzalisha mapendekezo.

> Ukipata kosa kwenye ukurasa wowote, nakili ujumbe wa kosa (kutoka terminal au kivinjari → F12 → Console) na uniletee — nitarekebisha.

---

## Sehemu D — Kuufanya uwe "halisia" (huduma za nje)

Mfumo unafanya kazi bila funguo za nje (Drive = local, AI = mock). Ili kuamilisha huduma halisi, hariri `.env` kisha washa upya (`npm start`):

**Google Drive (halisi):**
```
DRIVE_MODE=google
GOOGLE_CLIENT_ID=<kutoka Google Cloud Console>
GOOGLE_CLIENT_SECRET=<...>
GOOGLE_REDIRECT_URI=http://localhost:4000/api/v1/drive/callback
TOKEN_ENC_KEY=<neno lolote refu — husimba tokeni>
```
Kisha ndani ya programu: **Drive & Documents → Connect Drive**. (Maelezo kamili: `docs/GOOGLE_DRIVE_INTEGRATION.md`.)

**AI (halisi badala ya mock):**
```
AI_MODE=openai
AI_API_KEY=<API key yako>
AI_MODEL=gpt-4o-mini
```
**OCR ya picha (hiari):** `OCR_MODE=vision` na `OCR_API_KEY=<Google Vision key>`.
**Barua pepe za vikumbusho (hiari):** weka `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`.

---

## Sehemu E — Utatuzi wa makosa ya kawaida

**Njia ya PGlite (chaguo-msingi):**

| Tatizo (ujumbe) | Suluhisho |
|---|---|
| `command not found: node` / `node si amri` | Node.js haijasakinishwa au haijaongezwa kwenye PATH. Sakinisha kutoka https://nodejs.org, funga na ufungue Terminal upya. |
| `npm run setup` haijatoa `✓ Seed complete.` | Nakili ujumbe wote wa kosa kutoka terminal uniletee. Mara nyingi ni `npm install` haikukamilika — irudie. |
| `Port 4000 already in use` | Badilisha `PORT` kwenye `.env` (mf. 4001) na uwashe upya. |
| Login inashindwa kwa watumiaji wote | Endesha `npm run seed`; hakikisha nenosiri ni `Password123!`. |
| Nataka kuanza data upya | Endesha `npm run seed` (huifuta na kuijaza upya). Au futa folda `data/pglite` kisha `npm run setup`. |
| `Cannot open file` (Preview/Get) | Faili za mfano ni metadata tu; pakia faili lako halisi kwanza, kisha jaribu. |
| AI inajibu maandishi ya "mock mode" | Ni kawaida hadi uweke `AI_MODE=openai` + `AI_API_KEY`. |

**Njia ya `DB_MODE=pg` (Supabase/Neon/PostgreSQL ya ndani — hiari tu):**

| Tatizo (ujumbe) | Suluhisho |
|---|---|
| `Database connection failed` | Thibitisha `DATABASE_URL` ni sahihi; kwa PostgreSQL ya ndani, thibitisha inafanya kazi na `PGUSER`/`PGPASSWORD`. |
| `password authentication failed` | Nenosiri si sahihi; encode alama maalum (`@` → `%40`). |
| Kosa la SSL kwa database ya wingu | Hakikisha `DATABASE_URL` ina `?sslmode=require` na `PGSSL=true`. |
| `permission denied to create extension` | Tumia mtumiaji `postgres` (superuser) au omba msimamizi akimbie `CREATE EXTENSION pgcrypto; CREATE EXTENSION citext;`. |
| Ungependa kurudi njia rahisi? | Weka `DB_MODE=pglite` kwenye `.env` na uwashe upya. |

> Ukipata kosa kwenye ukurasa wowote, nakili ujumbe wa kosa (kutoka terminal au kivinjari → F12 → Console) uniletee — nitarekebisha.

---

## Sehemu F — Hatua zinazofuata baada ya kuendesha

1. **Thibitisha inafanya kazi** kwa hatua za Sehemu C; niletee makosa yoyote nirekebishe.
2. **Amilisha Drive + AI** halisi (Sehemu D) ukiwa tayari.
3. **Kilichobaki kujengwa** (tunaweza kuendelea pamoja): moduli ya malipo (subscriptions + M-Pesa + dashboard ya mapato — schema `0010` ipo tayari), kurasa za uhasibu (journals/trial balance), OCR ya PDF zilizoskaniwa, kutoa ripoti kama Word/PDF, majaribio (tests), na **uwekaji mtandaoni (deployment)**.
4. **Uwekaji mtandaoni** ukitaka kuutumia kwa wateja halisi: seva/cloud, PostgreSQL ya kudumu, domain + HTTPS, backups (`pg_dump`), na kubadilisha `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `SEED_PASSWORD`.

---

## Nyaraka za marejeo (ndani ya mradi)

- `README.md` — muhtasari na quickstart.
- `database/postgres/DATABASE_SETUP.md` — usakinishaji wa PostgreSQL, backup, RLS.
- `docs/INSTALLATION_DEPLOYMENT.md` — usakinishaji na uwekaji mtandaoni.
- `docs/API_DOCUMENTATION.md` — orodha ya API zote.
- `docs/GOOGLE_DRIVE_INTEGRATION.md` — ujumuishaji wa Google Drive.
- `docs/AI_MODULE.md` — moduli ya AI.
- `../Commercial-Strategy-and-Monetization.md` — mkakati wa biashara na bei.

**Amri muhimu kwa muhtasari:**
```
npm install      # sakinisha (mara moja)
npm run setup    # database + jedwali + data ya mfano (mara moja)
npm start        # washa mfumo
npm run dev      # washa kwa hali ya maendeleo (auto-reload)
npm run seed     # rudisha data ya mfano upya
```
