# thecremodel.com must serve latest production (domain routing)

**Goal:** thecremodel.com always serves the latest production deployment for this Vercel project — never a preview, never a vercel.app URL, never a cached response.

Do these checks and changes **in order**.

---

## 1. Verify domain attachment

1. In **Vercel Dashboard**, open the **correct project** (this repo).
2. Go to **Settings** → **Domains**.
3. Confirm **thecremodel.com** is present.
4. Confirm **thecremodel.com** is marked **Primary**.
5. If thecremodel.com is attached to **any other Vercel project**, remove it from that project so it belongs only to this one.
6. Set **thecremodel.com** as the **only** Primary domain (no other primary).

---

## 2. Verify production deployment

1. Go to **Deployments**.
2. Find the **latest deployment from `main`**.
3. Click **Promote to Production** (if it is not already Production).
4. Then **Redeploy** with **Clear build cache** checked.
5. Confirm the **Production** badge is on the latest commit.

---

## 3. Add an always-visible production proof

- The app has **GET /api/version** returning JSON:  
  `buildSha`, `buildTime`, `vercelEnv`, `siteUrl`, `apiBaseUrl`.
- **Confirm:** Open **https://thecremodel.com/api/version** (in a browser or with `curl`).
  - Expect **vercelEnv** = `"production"`.
  - Expect **buildSha** to match the latest commit SHA from `main`.
  - Expect **siteUrl** = `"https://thecremodel.com"` and **apiBaseUrl** = `"https://financial-modeling-docker.onrender.com"`.
- The route sends `Cache-Control: no-store` so the proof is not cached.

---

## 4. Eliminate caching confusion

- **Vercel:** In project Settings, confirm there is **no** Edge Config or custom cache headers forcing stale HTML for thecremodel.com.
- **Cloudflare (if used):**
  - Set DNS for thecremodel.com to **DNS only** (grey cloud) while debugging, **or**
  - Purge cache for thecremodel.com.
  - If you see **cf-cache-status** on responses, purge cache and disable proxy until thecremodel.com is stable.

---

## 5. Lock production URLs to Ryan’s domain

- Ensure the app always uses Ryan’s domain in production.
- In **Vercel** → **Settings** → **Environment Variables** → **Production**, set exactly:

| Variable | Value |
|----------|--------|
| `NEXT_PUBLIC_SITE_URL` | `https://thecremodel.com` |
| `NEXT_PUBLIC_API_BASE_URL` | `https://financial-modeling-docker.onrender.com` |

- **verify-prod-env.js** runs before `next build` in production and **fails the build** if:
  - `NEXT_PUBLIC_SITE_URL` is not exactly `https://thecremodel.com`, or
  - `NEXT_PUBLIC_API_BASE_URL` is not exactly `https://financial-modeling-docker.onrender.com`.

So production builds only succeed when these are set exactly as above.

---

## 6. Canonical redirect

- **middleware.ts** (production only): any request whose host is **not** `thecremodel.com` gets a **308 redirect** to `https://thecremodel.com` with the **same path and query**.
- After this, visiting any **vercel.app** URL (e.g. `financial-modeling-xxx.vercel.app`) should land on **https://thecremodel.com** (same path/query).

---

## Quick checklist

- [ ] **1** thecremodel.com is the only Primary domain on this project; removed from any other project.
- [ ] **2** Latest `main` deployment is promoted to Production and redeployed with Clear build cache; Production badge on latest commit.
- [ ] **3** https://thecremodel.com/api/version shows `vercelEnv=production` and `buildSha` matches latest commit.
- [ ] **4** No Vercel/Edge/custom cache forcing stale HTML; if using Cloudflare, DNS-only or cache purged.
- [ ] **5** Production env: `NEXT_PUBLIC_SITE_URL` and `NEXT_PUBLIC_API_BASE_URL` set exactly as above; verify-prod-env fails if not.
- [ ] **6** Middleware 308 redirect in place; vercel.app visits land on thecremodel.com.
