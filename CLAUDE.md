# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A multi-tenant B2B SaaS platform for commercial real estate professionals. Core capabilities:
- Lease scenario financial modeling and NPV analysis
- AI-powered lease document extraction (PDFs, DOCX, XLSX)
- White-label PDF report generation
- Multi-module workspace (Deals, Surveys, Obligations, Sublease Recovery, Completed Leases)
- Role-based multi-tenant access (Clerk auth + Stripe billing)

## Commands

### Unified Development
```bash
./dev.sh                        # Start backend (port 8010) + frontend (port 3000) together
```

### Frontend (`frontend/`)
```bash
npm run dev                     # Dev server on port 3000
npm run dev:clean               # Clean .next cache, then dev
npm run dev:report              # Dev on port 3001 (report rendering)
npm run build                   # Production build
npm run lint                    # ESLint
npm run test                    # Vitest unit tests
npm run test:watch              # Vitest watch mode
npm run test:e2e                # Playwright E2E tests
```

### Backend (`backend/`)
```bash
# First-time setup
./scripts/setup-backend-dev.sh

# Run
source backend/venv/bin/activate
uvicorn main:app --reload --host 127.0.0.1 --port 8010

# Async worker (PDF generation, OCR jobs)
celery -A jobs.tasks worker -l info

# Tests
./scripts/test-backend.sh
# or: cd backend && pytest

# Migrations
cd backend && alembic upgrade head
```

## Architecture

### Stack
- **Frontend**: Next.js 15 (App Router), TypeScript, React 19, Tailwind CSS, Recharts, Framer Motion
- **Backend**: FastAPI + Uvicorn (Python 3.12), SQLAlchemy ORM, PostgreSQL, Alembic migrations
- **Async jobs**: Celery + Redis (PDF generation, OCR processing)
- **Auth**: Clerk (JWT verification + webhook sync for org/user state)
- **Storage**: AWS S3 (reports, uploaded lease files)
- **AI**: OpenAI GPT (lease term extraction and classification)
- **PDF**: Playwright/Chromium (HTML→PDF rendering), Tesseract + Poppler (OCR for scanned PDFs)
- **Billing**: Stripe metered usage (runs, PDF exports)
- **Deploy**: Vercel (frontend) + Render Docker (backend)

### Backend Structure (`backend/`)

**`main.py`** is the FastAPI entry point (~12k lines). It registers routes and defines public endpoints directly. Key route groups:
- Public (no auth): `/health`, `/compute`, `/compute-canonical`, `/extract`, `/normalize`, `/upload_lease`, `/generate_scenarios`, `/report`, `/report/preview`, `/brands`
- Authenticated (`/api/v1`): deals, scenarios, runs, reports, files, jobs — defined in `routes/api.py`
- Webhooks: `routes/webhooks.py` (Clerk user/org sync)

**`engine/`** — Financial computation core:
- `compute.py`: Monthly cashflow modeling (rent escalation, opex, TI allowances, parking, holdover)
- `canonical_compute.py`: Advanced/canonical scenario modeling with NPV at multiple discount rates

**`extraction/`** — Lease document intelligence pipeline:
- `pipeline.py`: Orchestrates full extraction flow
- `llm_extract.py`: GPT-based structured field extraction
- `ocr.py`: Tesseract OCR for scanned/image PDFs
- `regex.py`: Pattern matching for lease terms
- `tables.py`: Rent schedule table detection
- `concessions.py`: TI/free rent/incentive parsing
- `reconcile.py` + `validate.py`: Field validation and quality checks

**`reporting/`** — PDF generation:
- `deck_builder.py`: Playwright HTML→PDF (institutional deck style)
- `report_builder.py`: Financial metrics assembly for reports
- `templates/`: HTML templates per brand
- Reports are cached by SHA256(scenario + brand + meta) to avoid regeneration

**`db/`** — Data layer:
- `models.py`: SQLAlchemy ORM entities (Organization, User, OrganizationMember, Deal, Scenario, Run, Report, etc.)
- `session.py`: DB connection pool
- Migrations managed via Alembic (`alembic.ini` at `backend/`)

**`auth.py`** — Clerk JWT verification + RBAC (owner/admin/member roles). All `/api/v1` routes require a valid Clerk JWT.

**`cache/disk_cache.py`** — SHA256-keyed disk cache used for extraction results and report PDFs.

**`jobs/tasks.py`** — Celery async tasks for PDF generation and OCR jobs.

### Frontend Structure (`frontend/`)

The entire application lives in `app/page.tsx` (122KB) — a single-page workspace shell that conditionally renders platform modules. Key providers wrap the app:
- **`ClientWorkspaceProvider`**: Global client (tenant) selection state
- **`BrokerOsProvider`**: Unified command center, module routing, entity graph

**`lib/`** — Core client utilities:
- `api.ts`: All backend HTTP communication
- `canonical-api.ts`: Lease engine integration calls
- `exportModel.ts` (134KB): Excel export logic

**Platform Modules** — Each is a self-contained feature area (Financial Analyses, Deals, Completed Leases, Surveys, Obligations, Sublease Recovery). Module routing is handled via a type-safe module registry inside `BrokerOsProvider`.

### Environment Configuration

**Backend** (copy `backend/.env.example` → `backend/.env`):
```
DATABASE_URL          # PostgreSQL connection string
CLERK_JWT_ISSUER      # Clerk JWT issuer URL
CLERK_WEBHOOK_SECRET  # Clerk webhook signing secret
OPENAI_API_KEY        # GPT for lease extraction
STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET / STRIPE_METERED_PRICE_ID
S3_BUCKET / AWS_REGION / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
REDIS_URL             # Celery broker
REPORT_BASE_URL       # URL Next.js serves on, used by Playwright for PDF rendering
```

**Frontend** (copy `frontend/.env.local.example` → `frontend/.env.local`):
```
NEXT_PUBLIC_BACKEND_URL   # Defaults to http://127.0.0.1:8010
```

### Key Architectural Notes

- **Pydantic models** (`backend/models.py`) are the request/response schemas; `backend/db/models.py` contains the ORM layer — these are separate files.
- **Clerk webhook** (`/webhooks/clerk`) keeps the local `users`/`organizations` tables in sync with Clerk's identity service. RBAC decisions in `auth.py` rely on this local state.
- **PDF rendering** requires `REPORT_BASE_URL` to point to a running Next.js instance because Playwright loads the `/report` route to capture the HTML before converting to PDF.
- **Async extraction and PDF jobs** require a running Celery worker and Redis. Without them, those endpoints will enqueue tasks that never complete.
- **Production domain enforcement** is in `frontend/middleware.ts` — it redirects non-`thecremodel.com` requests in production.
