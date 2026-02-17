# Force Production to Deploy Latest (thecremodel.com)

Do **not** rely on preview deployments. Use these steps to ensure thecremodel.com serves the latest commit.

## 1. Confirm domain assignment

- In **Vercel Dashboard** → your project → **Settings** → **Domains**
- Confirm **thecremodel.com** is assigned to this project (same repo).

## 2. Promote and redeploy

1. Go to **Deployments**.
2. Find the **latest deployment from the `main` branch**.
3. Open the **⋮** menu on that deployment → **Promote to Production** (if it is not already Production).
4. Open the **⋮** menu again → **Redeploy**.
5. In the redeploy dialog, check **Clear build cache** (invalidate cache).
6. Confirm **Redeploy**.

## 3. Verify build stamp

1. Open **https://thecremodel.com** (not a Vercel preview URL).
2. Scroll to the bottom of the homepage.
3. In the footer area you should see a build stamp line showing:
   - **BUILD_SHA** – commit hash (should match latest commit on `main`)
   - **BUILD_TIME** – build timestamp
   - **VERCEL_ENV=production**
   - **NEXT_PUBLIC_SITE_URL=https://thecremodel.com**
   - **RESOLVED_API_BASE_URL=https://financial-modeling-docker.onrender.com**
4. Take a screenshot of the build stamp. Only after this confirms the domain is updated should you evaluate building/suite display and formatting.

## 4. Required Production env vars (Vercel)

In **Settings** → **Environment Variables** → **Production**, set and enforce:

| Variable | Value |
|----------|--------|
| `NEXT_PUBLIC_SITE_URL` | `https://thecremodel.com` |
| `NEXT_PUBLIC_API_BASE_URL` | `https://financial-modeling-docker.onrender.com` |

The build will **fail** in Production if these are missing or if either contains `localhost`, `127.0.0.1`, or `vercel.app`.
