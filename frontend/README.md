# Lease Deck Frontend

Next.js app (App Router only) for tenant lease financial analysis: scenario comparison, PDF reports, and document extraction.

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

## Backend URL (no localhost default)

The frontend **never** defaults to localhost. Backend base URL comes only from **`NEXT_PUBLIC_BACKEND_URL`** (trimmed, no trailing slash). When unset, the app uses **same-origin `/api`** (see Vercel proxy below).

- **Production (Vercel):** Set **`BACKEND_URL`** (server-side) to your backend (e.g. `https://your-backend.onrender.com`). Next.js rewrites `/api/:path*` to `BACKEND_URL/:path*`, so the browser only talks to your domain; no CORS, no public backend URL in the client.
- **Local dev:** In `frontend/.env.local` set **`BACKEND_URL`** so the dev server can proxy `/api` to your local backend (e.g. `http://127.0.0.1:8010`). Optionally set `NEXT_PUBLIC_BACKEND_URL` to the same value if you want the client to call the backend directly during dev; otherwise the client uses `/api` and the dev server proxies.

Connection errors show a friendly message and Retry button only (no URLs, no CLI commands). Diagnostics and "Show advanced options" are **off** unless `NEXT_PUBLIC_SHOW_DIAGNOSTICS=true` and `NODE_ENV !== "production"`.
