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

## Backend URL (direct to Render)

The browser calls the Render backend **directly** (no Vercel proxy), so lease uploads are not limited by Vercel’s 60s function timeout.

- **Production (Vercel):** Set **`NEXT_PUBLIC_BACKEND_URL`** in Vercel (Project → Settings → Environment Variables) to your Render backend URL, e.g. `https://financial-modeling-docker.onrender.com` (no trailing slash). The backend must allow CORS from `https://thecremodel.com` and `https://www.thecremodel.com`.
- **Local dev:** Set **`NEXT_PUBLIC_BACKEND_URL`** in `frontend/.env.local` (e.g. `http://127.0.0.1:8010` or your Render URL). Backend CORS allows `http://localhost:3000` and `http://127.0.0.1:3000`.

**`BACKEND_URL`** is no longer used by the frontend.
