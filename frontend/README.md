# TheCREmodel Frontend

Next.js app (App Router only) for **The Commercial Real Estate Model**: scenario comparison, PDF reports, and document extraction.

## Development

```bash
npm install
npm run dev
```

Runs at port 3000 (or 3001 if using `npm run dev:report`).

### If you see ENOENT `.next/server/pages/_document.js`

This repo uses the **App Router** only (`app/`). Stale Pages Router build artifacts can cause that error. Fix:

```bash
cd frontend && npm run clean && npm run dev
```

Or use the combined script: `npm run dev:clean`.

## Backend URL (Render through website domain)

The frontend **never** defaults to localhost.
In **production**, browser requests are forced to **same-origin `/api`** so traffic always flows through `https://thecremodel.com` and then to Render via Vercel rewrite.

- **Production (Vercel):** Set **`BACKEND_URL`** (server-side) to your Render backend (e.g. `https://your-backend.onrender.com`). Keep `NEXT_PUBLIC_BACKEND_URL` unset in production.
- **Local dev:** In `frontend/.env.local` set **`BACKEND_URL`** so the dev server can proxy `/api` to local backend (e.g. `http://127.0.0.1:8010`). Optionally set `NEXT_PUBLIC_BACKEND_URL` in dev only if you want direct browser calls.

### Local reliability hardening

- `fetchApi` now automatically retries common local backend targets in development if the primary URL/proxy is unavailable:
  - `/api/...`
  - `http://127.0.0.1:8010/...`
  - `http://localhost:8010/...`
  - `http://127.0.0.1:8000/...`
  - `http://localhost:8000/...`
- To avoid port mismatch, start backend explicitly on `8010`:

```bash
cd backend
uvicorn main:app --reload --host 127.0.0.1 --port 8010
```

Connection errors show a friendly message and Retry button only (no URLs, no CLI commands). Diagnostics and "Show advanced options" are **off** unless `NEXT_PUBLIC_SHOW_DIAGNOSTICS=true` and `NODE_ENV !== "production"`.
