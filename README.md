# MN Order Sync — SignPros Inc.

AI-powered order tracking for MN Custom Homes orders.

## Deploy

1. Push to GitHub (replace old files)
2. Vercel → Project Settings → Environment Variables → Add:
   - `ANTHROPIC_API_KEY` from console.anthropic.com
   - `GOOGLE_SCRIPT_URL` from Google Apps Script deployment
3. Redeploy
4. Visit URL → Settings tab → follow Google Apps Script setup guide

## Files

- `index.html` — Complete web app (SPA)
- `api/extract.js` — Claude AI OCR endpoint
- `api/sheets.js` — Google Sheets proxy
- `vercel.json` — Vercel routing config
- `package.json` — Node.js config
