# Deploy Check and Exact Test Plan

## 0. Why Render might not be running the new backend

Render deploys from the **branch and commit** that’s at the remote (e.g. `origin/main`).  
If the new backend code (OPTIONS /brands, NORMALIZE_*, CANONICAL_*, lease_type coercion) exists only as **local uncommitted changes**, Render will keep deploying the **last pushed commit** (e.g. `b575b6a`).

**Do this first:**

1. **Commit and push** the backend (and any) changes to the branch Render uses (usually `main`):
   - `git add backend/main.py backend/models/canonical_lease.py` (and any other changed files you want deployed)
   - `git commit -m "Backend: OPTIONS /brands, NORMALIZE/CANONICAL logs, lease_type coercion, BOOT commit log"`
   - `git push origin main`
2. In **Render** → your service → **Manual Deploy** → check **Clear build cache and deploy** → Deploy.
3. After deploy, in **Render logs** search for **`BOOT RENDER_GIT_COMMIT=`**. The hash should be **different from** `b575b6a`. If it still shows `b575b6a`, the deploy did not pick up the new commit.

**Render config (from render.yaml):**

- **Branch:** typically `main` (auto-deploy from linked repo).
- **Root Directory:** not set in render.yaml; repo root.
- **Dockerfile path:** `./backend/Dockerfile` (dockerContext: `./backend`).

---

## 1. Confirm the new backend is actually live on Render

**After one upload and one compute**, in **Render logs** search for these **exact strings** (one line each):

| Search for       | You should see a log line that starts with |
|------------------|--------------------------------------------|
| `NORMALIZE_START`| `NORMALIZE_START rid=... content_type=... len=...` |
| `NORMALIZE_FILE` | `NORMALIZE_FILE rid=... filename=... size=...`   |
| `NORMALIZE_DONE` | `NORMALIZE_DONE rid=... lease_type=... rsf=... commencement=... expiration=...` |
| `CANONICAL_START`| `CANONICAL_START rid=... lease_type=...`   |
| `CANONICAL_DONE` | `CANONICAL_DONE rid=... status=200`       |

- If you **see all five** → the deploy is running the updated code.
- If you **do not see** those lines → the deploy is **not** running the updated code.

**When the deploy is not live, capture and report:**

- **Branch** Render is deploying (e.g. `main`)
- **Root Directory** (e.g. blank or `backend`)
- **Dockerfile path** (e.g. `Dockerfile` or `backend/Dockerfile`)
- **Latest Render commit hash** shown at boot (e.g. in a BOOT or “Backend starting” log line, or in Render’s “Latest commit” for the service)

Then we can compare that commit to the one that contains the new logging and lease_type coercion.

---

## 2. Run one clean test from the browser

1. Open **Chrome DevTools** (F12 or right‑click → Inspect).
2. Open the **Console** tab.
3. **Hard refresh** the page (Ctrl+Shift+R or Cmd+Shift+R).
4. **Upload Lease Example 2** again.
5. When the scenario appears, click **Run analysis** once.
6. Leave DevTools open (Console + Network) and note the approximate time (e.g. “21:45 UTC”).

---

## 3. What to paste back

### From Chrome DevTools → Network

- Select the **POST** request to **`/compute-canonical`**.
- Copy/paste or describe:
  - **Request Payload** (at least the `lease_type` field and a few other keys so we can see casing).
  - **Response**: status code and **Response body** (full JSON or first ~500 chars).

### From Render logs (same time window as the test)

Paste **one full log line** for each of these (the line that starts with that prefix):

- One line starting with **`NORMALIZE_DONE`**
- One line starting with **`CANONICAL_START`**
- One line starting with **`CANONICAL_ERR`** **or** **`CANONICAL_DONE`** (whichever appears for that request)

---

## 4. Expected results

- **Backend coercion:** Even if the frontend sends `lease_type: "nnn"`, the backend should coerce it and **compute should return 200**, not 422.
- If you still see **422** on POST `/compute-canonical`, then either:
  - **A)** The backend deploy is not live (no NORMALIZE_* / CANONICAL_* lines in logs), or  
  - **B)** The request is not hitting the new code path (e.g. different service URL or route).

**OPTIONS /brands**

- The **OPTIONS /brands 400** should be **gone** after the deploy (we added an explicit `OPTIONS /brands` handler that returns 200).
- If you still see **OPTIONS /brands 400**, the deploy is not live.

---

## Quick checklist

- [ ] Render logs contain: `NORMALIZE_START`, `NORMALIZE_FILE`, `NORMALIZE_DONE`, `CANONICAL_START`, `CANONICAL_DONE` after one upload + Run analysis.
- [ ] POST `/compute-canonical` returns **200** (and a JSON body with metrics), not 422.
- [ ] OPTIONS `/brands` returns **200** (or no 400), not 400.
- [ ] Pasted back: Request Payload (lease_type), Response body, and the three Render log lines (NORMALIZE_DONE, CANONICAL_START, CANONICAL_ERR or CANONICAL_DONE).
