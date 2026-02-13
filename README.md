# Lease Deck

Tenant office lease financial analysis: scenario comparison, PDF reports, and AI lease extraction.

## SaaS setup (multi-tenant)

- **Auth & orgs:** Clerk (JWT + organizations). Backend verifies JWTs and syncs org/user/member on first use or via webhooks.
- **DB:** Postgres with SQLAlchemy (see `backend/db/`). Migrations: Alembic (`cd backend && alembic upgrade head`).
- **RBAC:** Owner, admin, member per organization.
- **Audit:** `audit_log` table; mutations log action, resource, actor.
- **Billing:** Stripe usage-based (runs + PDF exports). Set meters in Stripe and env (see `backend/.env.example`).
- **Storage:** S3 for report PDFs and uploaded lease files.
- **Jobs:** Celery + Redis for PDF generation and lease extraction. Run worker: `celery -A jobs.tasks worker -l info` (from `backend/`).

### Backend env

Copy `backend/.env.example` to `backend/.env` and set:

- `DATABASE_URL` – Postgres connection string
- `CLERK_JWT_ISSUER` – Clerk JWT issuer (Dashboard → JWT Templates). For org context in JWT, add claims `org_id`, `org_role`, `org_slug` in the template.
- `CLERK_WEBHOOK_SECRET` – for Clerk webhooks (user/org sync)
- `STRIPE_*` – Stripe keys and webhook secret
- `S3_BUCKET`, `AWS_REGION`, AWS credentials
- `REDIS_URL` – for Celery
- `REPORT_BASE_URL` – URL the PDF worker loads (e.g. `http://localhost:3000`)

### Frontend env

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` – from Clerk Dashboard
- `CLERK_SECRET_KEY` – from Clerk Dashboard
- `NEXT_PUBLIC_BACKEND_URL` – optional; backend URL (default `http://127.0.0.1:8010`)

### API

- **Public (no auth):** `GET /health`, `POST /compute`, `POST /generate_scenarios`, `POST /upload_lease`, `POST /reports`, `GET /reports/{id}`, `GET /reports/{id}/pdf`, `GET /brands`, `POST /report`, `POST /report/preview`
- **Authenticated (`Authorization: Bearer <Clerk JWT>` + org context):** `GET/POST/PATCH/DELETE /api/v1/deals`, `.../deals/{id}/scenarios`, `.../scenarios/{id}`, `POST /api/v1/runs`, `POST/GET /api/v1/reports`, `POST /api/v1/reports/{id}/pdf`, `POST/GET /api/v1/files`, `GET /api/v1/jobs/{id}`

### Migrations

```bash
cd backend
# Create DB: createdb lease_deck  # or your DB URL
alembic upgrade head
```

### Run locally

**One command (recommended)** — from the repo root, start both backend and frontend with port cleanup and health wait:

```bash
./dev.sh
```

This script: frees ports 8010 and 3000 if in use, ensures `frontend/.env.local` has `NEXT_PUBLIC_BACKEND_URL=http://127.0.0.1:8010`, starts the backend (with venv if present), waits for `GET http://127.0.0.1:8010/health` to return 200, then starts the frontend. Backend runs on **8010**; frontend reads the backend URL from `NEXT_PUBLIC_BACKEND_URL` (default `http://127.0.0.1:8010`). Requires bash and `lsof` (macOS/Linux). First time: `cd backend && python3 -m venv venv && pip install -r requirements.txt` and `cd frontend && npm install`.

---

**Backend only (optional)** — if you prefer to run backend and frontend separately:

```bash
cd backend
# Optional: create and activate a venv
python3 -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate

# Install dependencies (from backend root)
pip install -r requirements.txt

# Set OpenAI for lease extraction (required for POST /extract)
export OPENAI_API_KEY=your_openai_key_here

# Run API (port 8010)
uvicorn main:app --reload --host 127.0.0.1 --port 8010
```

**Render (backend)** — Set Render **Root Directory** to `backend`. Build: `pip install -r requirements.txt`. Start: `uvicorn main:app --host 0.0.0.0 --port $PORT`. All dependencies are in `backend/requirements.txt`. For PDF generation (POST /report) you may need a build step that runs `playwright install chromium` after pip install. **Pin Python version** (Render may default to 3.14): Option A — set Render env var `PYTHON_VERSION` to a fully qualified version (e.g. `3.12.8`); Option B — add `.python-version` in repo root with `3.12`.

**Backend deps sanity check** — From repo root: `bash backend/scripts/check-deps.sh` (installs deps and runs `python -c "import fastapi, uvicorn"`). CI runs the same check on push/PR when `backend/` changes (see `.github/workflows/backend-deps.yml`).

**Optional: Playwright for PDF report generation**

To generate the institutional report PDF (POST /report) you need Playwright and Chromium:

```bash
pip install playwright
playwright install chromium
```

If Playwright is not installed, POST /report returns 503; use **POST /report/preview** to get HTML instead.

**Frontend**

```bash
cd frontend
npm install
npm run dev
```

If you see `ENOENT .next/server/pages/_document.js`, the build cache is stale (this repo is App Router only). Run: `npm run clean && npm run dev` (or `npm run dev:clean`) from `frontend/`.

The `./dev.sh` script sets `NEXT_PUBLIC_BACKEND_URL=http://127.0.0.1:8010` in `frontend/.env.local` automatically. If you run frontend manually, set it there when the backend is on 8010.

### Vercel (production)

This repo is a **monorepo** (`/frontend` = Next.js, `/backend` = API). Vercel must deploy **only** the Next.js app so the custom domain always serves the correct app.

#### Exact Vercel UI settings (required)

In the Vercel project go to **Settings → General** and set:

| Setting | Value | Do not override |
|--------|--------|------------------|
| **Root Directory** | `frontend` | Must be `frontend` (not blank, not repo root). |
| **Framework Preset** | Next.js | Leave as Next.js. |
| **Build Command** | *(leave blank)* | Use framework default. |
| **Install Command** | *(leave blank)* | Use framework default. |
| **Output Directory** | *(leave blank)* | Use framework default. |

- **Root Directory** is required: Edit → set to `frontend` → Save. All other build fields should be empty so Vercel uses defaults for the selected framework.
- Root `vercel.json` in the repo provides fallback install/build commands that run from `frontend/` if the project is ever built from repo root.

#### Promote to Production and domain alias

- **Production** is the deployment Vercel serves on your production domain(s). It is usually the latest deployment from your production branch (e.g. `main`).
- To **Promote to Production**: Deployments → open the deployment you want → **Promote to Production** (or merge to production branch to auto-deploy).
- To confirm the **custom domain points to the latest production deployment**: Settings → Domains → your domain should list **Production** as the target. The production deployment is the one marked with the production badge in the Deployments list; your domain alias serves that deployment.

**If domain shows NOT_FOUND (404):** (1) **Root Directory** = `frontend`, (2) Build completed successfully, (3) Domain is assigned to **Production**. Then redeploy and promote to Production if needed.

**Build guard:** The frontend build runs `check:app` before `next build`; it fails if `frontend/app/page.tsx` or `frontend/app/layout.tsx` are missing.

**Worker (optional, for async PDF and extraction)**

```bash
cd backend && celery -A jobs.tasks worker -l info
```

### Reporting and white-label PDF

- **GET /brands** – List available brands for the report dropdown (e.g. `default`, `sample`).
- **POST /report** – Build and download the Lease Financial Analysis PDF (body: `brand_id`, `scenario`, optional `meta`). Validates `brand_id` (400 if unknown) and scenario (422 if invalid). Returns `X-Report-ID` header and `Content-Disposition` with filename from `meta.proposal_name` when provided. Uses cache when scenario + brand + meta are identical; does not regenerate PDF.
- **POST /report/preview** – Same body as POST /report; returns HTML (no Playwright needed). Also returns `X-Report-ID`.

**Backend env for reports**

- `backend/.env` – Set `OPENAI_API_KEY` for lease extraction (POST /extract). Optional for report-only use.
- No API keys required for POST /report or POST /report/preview; Playwright is only required for PDF (POST /report).

**Frontend env**

- `frontend/.env.local` – Set `NEXT_PUBLIC_BACKEND_URL=http://127.0.0.1:8010` (or your backend URL) so the app can call the API.

**Playwright install (for PDF export)**

```bash
cd backend
pip install playwright
playwright install chromium
```

If Playwright is not installed, POST /report returns 503 with a clear message; POST /report/preview still returns HTML.

**BrandConfig and adding brands**

Brand config lives in `backend/models_branding.py` and `backend/brands.py`. Each brand has: `brand_id`, `company_name`, `logo_url`, `primary_color`, `secondary_color`, `font_family`, `header_text`, `footer_text`, `disclaimer_text`, `cover_page_enabled`, `watermark_text`, `default_assumptions`. Optional: `support_email`, `contact_phone`, `address`, `report_title_override`, `executive_summary_template`, `include_confidence_section`, `include_methodology_section`, `page_margin_mm`, `table_density` (`"compact"` | `"standard"` | `"spacious"`). To add a brand, add a new `BrandConfig` entry to the `BRANDS` dict in `backend/brands.py` keyed by `brand_id`.

**Caching and clearing it**

- **Extraction cache:** Keyed by SHA256 of file contents + `force_ocr`. Stored under `backend/cache/extraction/` as JSON. Same file + same `force_ocr` returns cached extraction without re-running OCR or LLM.
- **Report cache:** Keyed by SHA256 of `{ scenario, brand_id, meta }`. Stored under `backend/cache/reports/` as PDF. Identical scenario + brand + meta returns cached PDF; no regeneration.
- **In-memory cache:** Report data (for preview) is cached in process memory (max 100 entries) to speed repeated previews; cleared on process restart.
- **To clear caches:** Delete the contents of `backend/cache/extraction/` and/or `backend/cache/reports/`, or remove specific `.json` / `.pdf` files. Restart the backend to clear the in-memory report-data cache.

## Using Codex in Cursor

This workspace is preconfigured for the official extension and local Codex runtime.

### 1) Install the official extension

1. Open Cursor Extensions.
2. Install **Codex - OpenAI's coding agent** (`openai.chatgpt`).
3. Disable/uninstall duplicate AI coding extensions in this workspace (for example Copilot, Codeium, Continue, Cody, Tabnine) so Codex is the primary agent.

Workspace recommendations are in `.vscode/extensions.json`.

### 2) Local runtime to prevent Codex 503 errors

A workspace script has been added:

```bash
npm run start:codex
```

It starts the local Codex runtime service via:

```bash
npx -y @openai/codex@latest app-server
```

This is also configured to auto-run when the folder opens through `.vscode/tasks.json` (`Codex: Start Local Runtime`).

### 3) Authentication: ChatGPT login (not API key)

Use extension sign-in with your **ChatGPT account**. Do not use `backend/.env` OpenAI API keys for Codex extension auth.

If you previously authenticated Codex CLI with API key, clear it and sign in again:

```bash
codex logout
```

Then sign in from the extension UI (or run `codex login`) and choose ChatGPT account auth.

### 4) Work with Apps (macOS)

If you use the ChatGPT macOS app integration:

1. Update ChatGPT macOS app to a current version that supports Work with Apps.
2. In ChatGPT app settings, enable **Work with Apps**.
3. In macOS **System Settings > Privacy & Security > Accessibility**, allow ChatGPT access if prompted.
4. Open Cursor while signed into the same ChatGPT account used by the extension.
5. In Cursor/Codex, complete any account-link or permission prompt.

### 5) Avoid extension and keybinding conflicts

1. Keep only `openai.chatgpt` enabled for coding-agent workflows.
2. Disable competing assistant/chat extensions in Cursor/VS Code.
3. In Keyboard Shortcuts, remove conflicting mappings that override Codex commands.

### 6) Invoke Codex inside Cursor

- Open command palette and run: `Codex: New Task`
- Default shortcut for a new task: `Cmd+Shift+I` (macOS)
- To open current task details: `Codex: View Task`

Quick test prompt after opening a file:

```text
Refactor this function for readability without changing behavior.
```
