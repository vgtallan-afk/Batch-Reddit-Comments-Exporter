# Batch Reddit Comments Exporter for Vercel

This is a standalone batch Reddit comments exporter for Vercel.

## What it does

- Paste multiple Reddit thread URLs, one per line.
- Fetch comments for each thread through a Vercel serverless API route.
- Combine everything into one export.
- Download as CSV, TXT, JSON, or Excel-compatible `.xls`.
- No Chrome extension required.

## Files

- `index.html` — static frontend.
- `api/reddit-comments.js` — Vercel serverless function.
- `vercel.json` — Vercel routing/config.

## Required Reddit environment variables

Reddit can block anonymous/public `.json` requests from hosted servers like Vercel. For reliable use, create a Reddit developer app and add these variables in Vercel:

```txt
REDDIT_CLIENT_ID=your_reddit_app_client_id
REDDIT_CLIENT_SECRET=your_reddit_app_client_secret
REDDIT_USER_AGENT=web:reddit-comments-batch:1.0.0 (by /u/yourredditusername)
```

Recommended Reddit app type: **script**.

## Deploy on Vercel

1. Push/upload these files to a GitHub repo.
2. Import the repo in Vercel.
3. In Vercel, open **Project Settings → Environment Variables**.
4. Add `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, and `REDDIT_USER_AGENT`.
5. Deploy or redeploy the project.

## Important limitations

OAuth improves reliability for public Reddit content, but it still will not bypass Reddit access rules. Private, deleted, removed, quarantined, age-gated, or restricted threads may still fail.

Reddit may also rate-limit very large batches. If that happens, increase the delay between threads, lower max comments per thread, or disable “expand more comments”.

Use responsibly and respect Reddit's terms and deleted-content rules.
