# Deploying DryRun to production

Two pieces: **backend** (FastAPI + C++ interpreter + LLM tutor) on **Render**, and
**frontend** (Vite/React) on **Vercel**. The LLM runs on **Groq** (`api.groq.com`) — the
hosted backend calls it; no GPU on your side.

```
[user browser] → Vercel (frontend) → Render (backend) → Groq (LLM)
```

---

## 1. Backend → Render (~5 min)

1. Push this repo to GitHub (already done: `origin`).
2. Go to https://dashboard.render.com → **New → Blueprint** → pick this repo.
   Render reads `render.yaml` and creates the `dryrun-backend` web service (Docker).
3. In the service's **Environment**, set the one secret:
   - `EXPLAIN_API_KEY` = your Groq key (`gsk_...`) from https://console.groq.com/keys
   (`EXPLAIN_BASE_URL` and `EXPLAIN_MODEL` come from `render.yaml` automatically.)
4. Deploy. When live you get a URL like `https://dryrun-backend.onrender.com`.
   Verify: open `https://dryrun-backend.onrender.com/health` → `{"status":"ok"}`.

Note: Render's free tier sleeps after inactivity, so the first request after idle takes
~30–60s to wake. Fine for validation; upgrade to remove it.

## 2. Frontend → Vercel (~5 min)

1. https://vercel.com → **New Project** → import this repo.
2. Settings:
   - **Root Directory:** `frontend`
   - Framework preset: **Vite** (auto-detected). Build `npm run build`, output `dist`.
3. **Environment Variable:**
   - `VITE_BACKEND_URL` = your Render backend URL (e.g. `https://dryrun-backend.onrender.com`)
   (Vite inlines this at build time, so set it before/at deploy.)
4. Deploy. You get a public URL like `https://dryrun.vercel.app` — that's your live product.

## 3. Verify end-to-end

- Open the Vercel URL, run a program, open the **Explain** panel, click **Explain step** /
  **walk me** → you should get a grounded answer from Groq.
- If the tutor 503s: check `EXPLAIN_API_KEY` is set on Render and the model id at
  https://console.groq.com/docs/models is current.
- The animation product works even if the tutor provider is down (graceful degrade).

## Env vars summary

| Where | Var | Value |
|-------|-----|-------|
| Render (backend) | `EXPLAIN_BASE_URL` | `https://api.groq.com/openai/v1` (from render.yaml) |
| Render (backend) | `EXPLAIN_MODEL` | `llama-3.3-70b-versatile` (from render.yaml) |
| Render (backend) | `EXPLAIN_API_KEY` | your `gsk_...` (secret, set in dashboard) |
| Vercel (frontend) | `VITE_BACKEND_URL` | your Render backend URL |
