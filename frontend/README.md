# Lease Deck Frontend

Next.js app (App Router only) for tenant lease financial analysis: scenario comparison, PDF reports, and document extraction.

## Development

```bash
npm install
npm run dev
```

Runs at [http://localhost:3000](http://localhost:3000) (or 3001 if using `npm run dev:report`).

### If you see ENOENT `.next/server/pages/_document.js`

This repo uses the **App Router** only (`app/`). Stale Pages Router build artifacts can cause that error. Fix:

```bash
cd frontend && npm run clean && npm run dev
```

Or use the combined script: `npm run dev:clean`.

## Backend URL

The frontend calls the Lease Deck backend for `/extract`, `/compute`, `/reports`, and `/health`. By default it uses:

- **`http://127.0.0.1:8010`** (or the value of `NEXT_PUBLIC_BACKEND_URL`)

To override (e.g. for a different host or port), set:

```bash
# .env.local
NEXT_PUBLIC_BACKEND_URL=http://127.0.0.1:8010
```

Example for a remote API:

```bash
NEXT_PUBLIC_BACKEND_URL=https://api.example.com
```

Restart the dev server after changing env vars. Use the **Diagnostics** section on the home page to test the backend connection and see the current backend URL.
