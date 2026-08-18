#!/bin/bash
# Ship the DryRun frontend to BOTH deployments (standing rule, 2026-08-18):
#   1. independent DryRun  — push main → Vercel (dryrun-z93y.vercel.app)
#   2. integrated OA×DryRun — build with /dryrun/ base → onlineassessments.tech/dryrun
# Run from the repo root, on main, with the changes already committed.
set -euo pipefail
cd "$(dirname "$0")"

BRANCH=$(git branch --show-current)
if [ "$BRANCH" != "main" ]; then echo "!! on '$BRANCH', not main — merge first"; exit 1; fi
if [ -n "$(git status --porcelain)" ]; then echo "!! uncommitted changes — commit first"; exit 1; fi

echo "── verify build"
cd frontend
npx tsc --noEmit
npm run build >/dev/null
echo "   tsc + build OK"

echo "── 1/2 independent DryRun: push main (Vercel auto-deploys)"
cd ..
git push origin main 2>&1 | tail -1

echo "── 2/2 integrated OA×DryRun: build for /dryrun/ + upload to box"
cd frontend
VITE_BACKEND_URL=https://dryrun-backend-vkli.onrender.com \
VITE_OA_API_URL=https://onlineassessments.tech \
npx vite build --base=/dryrun/ >/dev/null
TGZ=$(mktemp /tmp/dryrun-dist.XXXXXX.tgz)
tar -czf "$TGZ" -C dist .
scp -o BatchMode=yes "$TGZ" hostinger:domains/onlineassessments.tech/nodejs/dd.tgz >/dev/null
ssh -o BatchMode=yes hostinger 'cd ~/domains/onlineassessments.tech/nodejs && rm -rf public/dryrun && mkdir -p public/dryrun && tar xzf dd.tgz -C public/dryrun 2>/dev/null; rm -f dd.tgz'
rm -f "$TGZ"

echo "── verify"
curl -s "https://onlineassessments.tech/dryrun/" | grep -oE 'index-[A-Za-z0-9_-]+\.js' | head -1 | sed 's/^/   OA box serving: /'
echo "   Vercel rebuild takes ~1 min: https://dryrun-z93y.vercel.app/app"
echo "── DONE (both targets)"
