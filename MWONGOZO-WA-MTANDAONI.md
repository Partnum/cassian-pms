# Mwongozo wa Kuweka Cassian PMS Mtandaoni (Online)

Mwongozo huu unakuwezesha kuweka mfumo **mtandaoni (cloud)** ili wafanyakazi waingie kutoka **kompyuta au simu yoyote, popote** — ofisini, nyumbani, au kwenye tovuti za wateja — kwa kufungua **link moja** kwenye kivinjari, **bila kusakinisha chochote**.

> **Utahitaji akaunti tatu za bure** (hakuna malipo kuanza):
> 1. **Supabase** — database ya kudumu (tayari unayo).
> 2. **GitHub** — kuhifadhi code (bure).
> 3. **Render** — hosting (bure; ina toleo la malipo $7/mwezi kama utataka mfumo usisinzie).
>
> Tutafanya **bila kuandika command** — kwa kutumia programu zenye vitufe (GitHub Desktop) na tovuti.

---

## Sehemu 1 — Andaa Supabase (database ya kudumu)

1. **Badilisha nenosiri** (lilikuwa limewekwa wazi, kwa hiyo ni LAZIMA):
   - Ingia https://supabase.com → project yako → **Settings → Database → Reset database password**.
   - Tumia nenosiri la **herufi na namba tu** (epuka alama kama `@ : / ?`) ili kurahisisha.
2. **Pata "Connection string":**
   - Bonyeza **Connect** (juu) → chagua **Session pooler** (port **5432**, SIYO Transaction pooler 6543).
   - Nakili URL. Itakuwa kama:
     ```
     postgresql://postgres.xxxxxxxx:NENOSIRI@aws-0-eu-west-1.pooler.supabase.com:5432/postgres
     ```
   - Hakikisha umeweka nenosiri lako halisi badala ya `[YOUR-PASSWORD]`.
3. **Weka URL hii mahali salama** — ni siri; tutaiweka Render baadaye.

---

## Sehemu 2 — Weka code kwenye GitHub (kwa GitHub Desktop, bila command)

1. Fungua akaunti ya bure: https://github.com → **Sign up**.
2. Pakua **GitHub Desktop**: https://desktop.github.com → sakinisha → ingia kwa akaunti yako.
3. Ndani ya GitHub Desktop: **File → Add local repository** → chagua folda:
   ```
   C:\Users\user\Documents\Claude\Projects\Management system\cassian-pms
   ```
   - Itasema "this directory is not a Git repository" → bonyeza **"create a repository"** → **Create repository**.
   - (Faili `.gitignore` tayari inazuia `node_modules`, `.env`, na `data/` zisiende — siri zako zinabaki salama.)
4. Bonyeza **Publish repository** → chagua **Keep this code private** → **Publish repository**.

Sasa code yako iko GitHub (binafsi/private).

---

## Sehemu 3 — Deploy kwenye Render

1. Nenda https://render.com → **Get Started** → **Sign up with GitHub** (ruhusu/authorize).
2. Kwenye dashboard: bonyeza **New +** → **Blueprint**.
3. Unganisha GitHub yako → chagua repository **cassian-pms**. Render itasoma faili `render.yaml` yenyewe na kuonyesha huduma inayoitwa **cassian-pms**.
4. Render itatengeneza siri za JWT zenyewe. Kuna **siri MOJA** unayopaswa kuweka mwenyewe:
   - **DATABASE_URL** → bandika ile URL ya **Session pooler** ya Supabase (Sehemu 1).
   - (`PGSSL=true` na `DB_MODE=pg` zimewekwa tayari na `render.yaml`.)
5. Bonyeza **Apply / Create**. Render itajenga mfumo:
   - `npm install` → `npm run migrate` (huunda jedwali kwenye Supabase) → `npm run seed:ifempty` (huingiza data + admin **mara ya kwanza tu**).
   - Subiri kama dakika **3–5**.

---

## Sehemu 4 — Fungua na shiriki na wafanyakazi

1. Render itakupa **link** kama:
   ```
   https://cassian-pms.onrender.com
   ```
2. Fungua link hiyo → ongeza `/login.html` → ingia kwa:
   - **`info@cassian.co.tz`** / **`Password123!`**
3. **Shiriki link** hiyo na wafanyakazi. Wanafungua kwenye kompyuta/simu zao — **hakuna kusakinisha**.
4. Wafanyakazi wa mfano wapo tayari (emmanuel@, amani@, neema@, fatma@, david@cassian.co.tz — wote `Password123!`).

---

## Mambo muhimu ya kujua

- **Toleo la bure la Render hulala** baada ya dakika 15 bila matumizi — ufunguzi wa kwanza baada ya kulala huchukua sekunde ~30–60. Ukitaka usilale, hamia toleo la $7/mwezi.
- **Domain yako mwenyewe** (mfano `pms.cassian.co.tz`): Render → Settings → **Custom Domain**.
- **Kusasisha mfumo baadaye:** badilisha code → kwenye GitHub Desktop bonyeza **Commit** kisha **Push** → Render itajitengeneza upya yenyewe. `migrate` huendeshwa tena (salama), `seed` huruka (data yako halisi haifutwi).

---

## Tahadhari za usalama (production)

1. **Badilisha nenosiri la Supabase** (lilikuwa wazi) — Sehemu 1.
2. **Badilisha manenosiri ya watumiaji** baada ya kuanza. *(Kumbuka: kwa sasa hakuna ukurasa wa ndani wa kubadilisha nenosiri — naweza kuujenga; ni jambo ninalopendekeza kabla ya matumizi halisi.)*
3. Data ya mfano (wateja 12 wa majaribio) inaweza kufutwa ndani ya mfumo na kuanza kuingiza wateja wako halisi.

---

## Ninachoshauri kiongezwe kabla ya matumizi makamilifu na wafanyakazi

- **Ukurasa wa kusimamia watumiaji** (admin kuongeza/kufuta wafanyakazi na kuweka manenosiri yao).
- **Kubadilisha nenosiri** (kila mfanyakazi).
Nikipata ruhusa, naweza kujenga vipengele hivi viwili — ni muhimu kwa usalama wa mfumo wa kampuni.
