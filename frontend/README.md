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

The frontend **never** defaults to localhost in production.
In **production**, browser requests go to **same-origin `/api`**; the API route (`app/api/[...path]/route.ts`) proxies to your backend using **`BACKEND_URL`**.

- **Production (Vercel):** You **must** set **`BACKEND_URL`** in Vercel (Project → Settings → Environment Variables) to your Render backend URL (e.g. `https://financial-modeling.onrender.com`). If this is missing, lease extraction will show "Website could not reach the backend service."
- **Local dev:** The proxy defaults to `http://127.0.0.1:8010` when `BACKEND_URL` is unset. Override in `frontend/.env.local` if your backend runs on another port.

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
