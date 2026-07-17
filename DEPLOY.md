# Deploying the demo (Vercel + Render)

Architecture: the Next.js console on **Vercel**, the FastAPI backend on **Render**
(a persistent process — the in-memory demo store doesn't survive serverless).

> **Demo data only.** The API token ends up in the public JS bundle and the
> store is in-memory. Never point this deployment at real parcel or case data.
> A real pilot gets Keycloak login + PostGIS first (see PLAN.md).

Deploy in this order — the frontend URL is needed for the backend's CORS.

## 1. Frontend on Vercel (fixture mode first)

1. vercel.com → **Add New → Project** → import `roshanis/mapencroach`
2. **Root Directory**: `web` (everything else auto-detects)
3. No env vars yet → **Deploy**
4. Note your URL, e.g. `https://mapencroach.vercel.app`

The site already works at this point, on built-in fixture data.

## 2. Backend on Render

1. Generate a real JWT secret and save it somewhere safe:
   ```bash
   openssl rand -hex 32
   ```
2. render.com → **New → Web Service** → connect `roshanis/mapencroach`
3. **Root Directory**: `backend` — Render detects the Dockerfile automatically
4. Instance type: **Free** is fine for a demo
5. Environment variables:

   | Key | Value |
   |-----|-------|
   | `MAPENCROACH_DEMO` | `1` (seeds Haridwar–Roorkee demo data on boot) |
   | `MAPENCROACH_JWT_SECRET` | the value from step 1 |
   | `MAPENCROACH_CORS_ORIGINS` | `https://<your-app>.vercel.app,http://localhost:3000` |

6. Deploy, then note the URL, e.g. `https://mapencroach-api.onrender.com`
7. Sanity check — should return `401`:
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" https://<your-api>.onrender.com/parcels
   ```

Free-tier behavior to expect: the service **spins down when idle** (first
request after a quiet spell takes ~1 minute — open the site a few minutes
before a demo), and every restart **reseeds the demo data**, so case
transitions made through the API reset. Both are fine for demos.

## 3. Mint a long-lived demo token

From `backend/` on your machine (90 days so the deployed demo doesn't expire
mid-week; rotate by re-minting and redeploying):

```bash
MAPENCROACH_JWT_SECRET='<the-secret-from-step-2.1>' .venv/bin/python -c "
import os
from datetime import datetime, timedelta, UTC
from mapencroach.api.auth import create_token
print(create_token('demo-officer', 'case_officer', 'state',
      os.environ['MAPENCROACH_JWT_SECRET'], datetime.now(UTC)+timedelta(days=90)))"
```

## 4. Point Vercel at the backend

In the Vercel project → **Settings → Environment Variables**:

| Key | Value |
|-----|-------|
| `NEXT_PUBLIC_API_URL` | `https://<your-api>.onrender.com` |
| `NEXT_PUBLIC_API_TOKEN` | the token from step 3 |

Then **Deployments → Redeploy** (env vars are baked in at build time).

## 5. Verify

- Open the Vercel URL: the product landing page loads, and its primary CTA opens
  `/console`, where the map shows live backend parcel and alert data rather than
  the built-in `PCL-…` fixtures.
- `/cases/case-1` shows the due-process rail with evidence artifacts and
  Allowed Next Steps.
- The 409 encore from DEMO.md works against the hosted API too — replace
  `localhost:8000` with the Render URL and use the step-3 token.

## Troubleshooting

| Symptom | Cause |
|---------|-------|
| Map empty, console shows CORS errors | Vercel URL missing from `MAPENCROACH_CORS_ORIGINS` (exact match, `https://`, no trailing slash) |
| Everything 401 | Token minted with a different secret than the Render env var, or expired |
| First load takes a minute | Render free tier waking up — warm it before demos |
| Site shows fixture data (parcels named PCL-…) | `NEXT_PUBLIC_API_URL` not set at build time — set env vars, then redeploy |
