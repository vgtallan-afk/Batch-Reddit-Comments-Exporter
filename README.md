# Batch Reddit Comments Exporter for Vercel

This ZIP turns the downloaded Lection page into a standalone batch Reddit comments exporter.

## What it does

- Paste multiple Reddit thread URLs, one per line.
- Fetch comments for each thread through a Vercel serverless API route.
- Combine everything into one export.
- Download as CSV, TXT, JSON, or Excel-compatible `.xls`.
- No Chrome extension required.
- No Reddit API key required for basic public JSON thread fetches.

## Files

- `index.html` — static frontend.
- `api/reddit-comments.js` — Vercel serverless function.

## Deploy on Vercel

1. Upload/push these files to a GitHub repo.
2. Import the repo in Vercel.
3. Deploy.
4. Open the Vercel URL.

No environment variable is strictly required.

Optional recommended environment variable:

```txt
REDDIT_USER_AGENT=web:your-app-name:1.0.0 (by /u/yourredditusername)
```

Reddit recommends unique, descriptive user-agent strings. If you leave it blank, the API route uses a generic fallback.

## Important limitations

Reddit can block/rate-limit requests, especially for very large batches. Private, deleted, removed, quarantined, or restricted threads may fail.

The main `.json` endpoint may return `more` placeholders instead of every comment for huge threads. The frontend includes an optional "Try to expand more comments" mode that calls `/api/morechildren.json`, but Reddit may block this depending on access/rate limits.

Use responsibly and respect Reddit's terms and deleted-content rules.
