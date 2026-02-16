# Vercel production checklist

Use this so **every merge to main** deploys to **https://thecremodel.com** and is always visible on the production domain.

---

## 1. Domains (Project → Settings → Domains)

- [ ] **thecremodel.com** is added.
- [ ] **www.thecremodel.com** is added.
- [ ] **thecremodel.com** is set as the **Primary** domain (not www).
- [ ] Production traffic is served from the **Production** deployment (not Preview).  
  (In practice: Production branch `main` is assigned to the Production deployment; domain is linked to that deployment.)

---

## 2. Git (Project → Settings → Git)

- [ ] **Production Branch** = `main`.
- [ ] **Auto Deployments** = enabled (deploy every push to `main`).
- [ ] No **Ignored Build Step** that skips production builds (or ensure the command returns success for `main`).
- [ ] No branch filters that exclude `main` from production.

---

## 3. Environment variables (Project → Settings → Environment Variables)

Set these for **Production** (and optionally Preview if you want previews to work):

| Variable | Production value | Notes |
|----------|------------------|--------|
| `BACKEND_URL` | Your Render backend URL (e.g. `https://your-backend.onrender.com`) | Required for `/api` rewrites. Must **not** contain `localhost` or `127.0.0.1`. |
| `NEXT_PUBLIC_BACKEND_URL` | *(leave unset/empty in Production)* | Production browser traffic must use same-origin `/api` only. |

- [ ] `BACKEND_URL` is set for **Production** and does not contain localhost.
- [ ] `NEXT_PUBLIC_BACKEND_URL` is unset/empty for **Production**.

---

## 4. Build

- [ ] Build command is `node scripts/verify-prod-env.js && next build` (or equivalent: verify script runs **before** `next build`).
- [ ] The verify script ensures production builds never use localhost; if env is missing or invalid, the build fails.

---

## 5. After deploy: smoke check

Run once after a production deploy to confirm the live site is correct:

```bash
cd frontend && npm run smoke:prod
```

Or with a custom URL:

```bash
SMOKE_CHECK_URL=https://thecremodel.com npm run smoke:prod
```

The check asserts:

- The page title contains "The Commercial Real Estate Model" or "theCREmodel".
- The response does **not** contain: localhost, 127.0.0.1, Diagnostics, "Test backend connection", npm run, npx, curl.

---

## Summary

1. **Domains**: thecremodel.com + www added; **thecremodel.com** = Primary.
2. **Git**: Production branch = **main**; auto deployments on.
3. **Env**: **BACKEND_URL** set for Production (Render URL); **NEXT_PUBLIC_BACKEND_URL** unset.
4. **Build**: Verify script runs before `next build`; no localhost fallback in production.
5. **Smoke**: Run `npm run smoke:prod` after deploy to validate the live site.

---

## Optional hard lock: force deploy from GitHub Actions

This repo includes `/Users/ryanarnold/Desktop/Lease Deck/.github/workflows/vercel-production-deploy.yml`, which triggers on every push to `main` and performs:

1. `vercel pull --environment=production`
2. `vercel build --prod`
3. `vercel deploy --prebuilt --prod`
4. Smoke check against `https://thecremodel.com`

Set these GitHub repository secrets:

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

This gives you deterministic production deploys from CI even if Vercel project Git settings drift.
