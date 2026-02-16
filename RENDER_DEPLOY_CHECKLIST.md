# Render Deploy Checklist (no git steps)

## 1. Deployment inputs to verify in Render

Check these in **Render Dashboard → your service (financial-modeling-docker) → Settings** (and Build & Deploy):

| Setting | Exact value to use / expect | How it was confirmed |
|--------|-----------------------------|------------------------|
| **Branch** | Usually **main** (Render uses the repo’s default branch unless you changed it). | `render.yaml` does not set branch; Render default is the connected repo default. **Verify:** Settings → Build & Deploy → Branch. |
| **Root Directory** | **Leave blank** (repo root). | Build uses `dockerContext: ./backend` from `render.yaml`; the context is the **backend** folder, but the repo root is still the “root” for Render. **Verify:** Root Directory should be empty. |
| **Dockerfile path** | **`./backend/Dockerfile`** | From `render.yaml`: `dockerfilePath: ./backend/Dockerfile`. **Confirmed:** file exists at `backend/Dockerfile` in this repo. |
| **Docker build context** | **`./backend`** (Dockerfile’s build context) | From `render.yaml`: `dockerContext: ./backend`. Build runs with `backend/` as context so `COPY . .` in the Dockerfile copies backend code. |

**Repo layout used for this:**  
- Repo root contains `render.yaml`, `backend/`, `frontend/`.  
- `backend/main.py` is the app; `backend/Dockerfile` exists.  
- `render.yaml` defines one web service, Docker runtime, `dockerfilePath: ./backend/Dockerfile`, `dockerContext: ./backend`.

---

## 2. Deploy marker (so you know the new backend is running)

**Code added:**  
- **File:** `backend/main.py`  
- **Line:** Near the top of the startup section, a constant and a log line:

```python
DEPLOY_MARKER = "v4_2026_02_16_2215"

# In _startup_log():
_LOG.info("DEPLOY_MARKER %s commit=%s", DEPLOY_MARKER, commit)
```

**Where it shows:**  
- In **Render logs**, right after the service starts.  
- Search for: **`DEPLOY_MARKER`**  
- You should see one line like: **`DEPLOY_MARKER v4_2026_02_16_2215 commit=<hash>`**

If you see that line with **v4_2026_02_16_2215** and a **commit=** value that is **not** `b575b6a`, the new backend is what’s running.  
If you never see **DEPLOY_MARKER** or the marker is different, the deploy is still an old build.

---

## 3. Guarantee the new backend is running (what must appear)

After **one** run (one upload + one Run analysis), **Render logs** must contain **all** of these (search for the exact string):

- **NORMALIZE_START**
- **NORMALIZE_FILE**
- **NORMALIZE_DONE**
- **CANONICAL_START**
- **CANONICAL_DONE**

And in the **Network** tab (or a quick check): **OPTIONS /brands** must return **200**, not 400.

| If this is missing | Conclusion | Next thing to check |
|--------------------|------------|----------------------|
| **DEPLOY_MARKER** line with v4_2026_02_16_2215 | New code did not deploy. | Render → Manual Deploy → **Clear build cache and deploy**. Then confirm the commit in Render matches the one that has these changes. |
| **NORMALIZE_START** | Normalize request didn’t hit the new code or didn’t run. | Confirm you did “upload” and that the request goes to this Render service URL. Check DEPLOY_MARKER and commit. |
| **NORMALIZE_FILE** | No file was sent (e.g. pasted text or JSON path). | For “upload” you must use the file upload path so a file is sent; then NORMALIZE_FILE is logged. |
| **NORMALIZE_DONE** | Normalize failed or returned before logging. | Look for NORMALIZE_ERR in logs. Check for 5xx or 4xx on POST /normalize in Network. |
| **CANONICAL_START** | Compute request didn’t hit the new code or wasn’t sent. | Confirm you clicked **Run analysis**. Check DEPLOY_MARKER. Ensure frontend is calling this Render URL for /compute-canonical. |
| **CANONICAL_DONE** | Compute failed (validation or server error). | Look for **CANONICAL_ERR** in logs; it will show lease_type and error. If you see CANONICAL_ERR, paste that line. |
| **OPTIONS /brands** still 400 | New backend not live (OPTIONS handler not deployed). | Same as “DEPLOY_MARKER missing”: clear build cache and redeploy; confirm commit. |

---

## 4. Network proof (frontend logs + where to look)

**Added in the frontend:**

- **Before** the compute-canonical `fetch`:  
  **`console.log("[compute] about to POST", url, canonical?.lease_type)`**  
  So in **Chrome DevTools → Console** you see the **full URL** and **lease_type** right before the POST.

- **After** the `fetch`:  
  **`console.log("[compute] after POST status=%s responsePreview=%s", res.status, first200)`**  
  So you see **status** (e.g. 200 or 422) and the **first 200 characters** of the response text.

**Exact UI path that triggers POST /compute-canonical:**

1. Open the app (e.g. thecremodel.com or localhost).
2. **Upload** a lease file (e.g. Lease Example 2) via the upload control.
3. If a **review/confirm** step appears, complete it (e.g. click **Confirm** or **Add scenario**).
4. When the scenario appears in the list, click **“Run analysis”** (or the single main “Run”/“Analyze” button for that scenario).

**Only step 4** sends POST /compute-canonical. So:

- In **Network**: filter by **“compute”** or **“compute-canonical”**; the POST appears when you click **Run analysis**.
- In **Console**: right when you click **Run analysis**, you should see **`[compute] about to POST`** then **`[compute] after POST status=...`**.

---

## 5. Backend: accept lowercase lease_type (no 422 on casing)

- **Pydantic:** In **`backend/models/canonical_lease.py`**, `CanonicalLease` has a **`lease_type`** field with a **`mode="before"`** validator that calls **`_coerce_lease_type`**. That function maps:
  - `nnn` → NNN  
  - `gross` → Gross  
  - `modified gross` / `modified_gross` → Modified Gross  
  - `absolute nnn` / `absolute_nnn` → Absolute NNN  
  - `full service` / `full_service` / `fs` → Full Service  
  and returns **LeaseType.NNN** for unknown/empty.

- **Endpoint shim:** In **`backend/main.py`**, in **`compute_canonical_endpoint`**, right after parsing the JSON body and before **`CanonicalLease.model_validate(body)`**, the code does:
  - If `body` is a dict and has `"lease_type"`, it replaces it with **`_normalize_lease_type_body(body.get("lease_type"))`** (same mappings as above, string form).

So even if the frontend sends **`lease_type: "nnn"`**, the backend coerces it and **POST /compute-canonical** should return **200**, not 422. If you still get 422, then either the new backend is not deployed (see section 3) or the error is not about lease_type (check **CANONICAL_ERR** in logs for the exact error).

---

## 6. 60-second test plan (what to click, what to paste back)

**What to do:**

1. **Render:** Trigger a deploy (Manual Deploy → **Clear build cache and deploy**). Wait until the service is **Live**.
2. **Render logs:** Search for **`DEPLOY_MARKER`**. Confirm you see **`DEPLOY_MARKER v4_2026_02_16_2215 commit=...`** and commit is not `b575b6a`.
3. **Browser:** Open the app, open **Chrome DevTools** (F12) → **Console** tab and **Network** tab.
4. **Hard refresh** the page (Ctrl+Shift+R or Cmd+Shift+R).
5. **Upload** a lease file (e.g. Lease Example 2).
6. If a review/confirm step appears, complete it.
7. Click **“Run analysis”** (or the main Run/Analyze button for the new scenario).
8. In **Console**, confirm you see **`[compute] about to POST`** and **`[compute] after POST status=...`**.
9. In **Network**, filter by **compute-canonical**. Select the **POST** request to **compute-canonical**.

**What to copy/paste back:**

**From Network (POST /compute-canonical):**

- **Request payload:** Copy the **Payload** (or **Request** body). At least include the **`lease_type`** field and a couple of others so we can see casing.
- **Response:** **Status code** (e.g. 200 or 422) and the **Response** body (full JSON or first ~500 chars).

**From Render logs (same time window as that run):**

- One full line that **starts with** **NORMALIZE_DONE**
- One full line that **starts with** **CANONICAL_START**
- One full line that **starts with** **CANONICAL_DONE** or **CANONICAL_ERR** (whichever appears for that request)

That’s enough to confirm deploy, request/response, and backend path in one go.
