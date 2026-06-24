const ALLOWED_SORTS = new Set(['confidence', 'top', 'new', 'old', 'controversial', 'qa']);

function send(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function parseRedditPostId(input) {
  if (typeof input !== 'string') return null;
  const value = input.trim();
  if (!value) return null;

  const patterns = [
    /(?:https?:\/\/)?(?:www\.|old\.|new\.|sh\.)?reddit\.com\/r\/[^/]+\/comments\/([a-z0-9]+)/i,
    /(?:https?:\/\/)?(?:www\.|old\.|new\.|sh\.)?reddit\.com\/comments\/([a-z0-9]+)/i,
    /(?:https?:\/\/)?redd\.it\/([a-z0-9]+)/i
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match && match[1]) return match[1].toLowerCase();
  }
  if (/^[a-z0-9]{4,12}$/i.test(value)) return value.toLowerCase();
  return null;
}

function normalizePermalink(path) {
  if (!path || typeof path !== 'string') return '';
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  return `https://www.reddit.com${path.startsWith('/') ? '' : '/'}${path}`;
}

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function listingChildren(listing) {
  if (!isObject(listing) || !isObject(listing.data) || !Array.isArray(listing.data.children)) return [];
  return listing.data.children.filter(isObject);
}

function extractPost(listing) {
  const postThing = listingChildren(listing)[0];
  const data = postThing && isObject(postThing.data) ? postThing.data : {};
  return {
    thread_id: typeof data.id === 'string' ? data.id : '',
    thread_title: typeof data.title === 'string' ? data.title : '',
    subreddit: typeof data.subreddit === 'string' ? data.subreddit : '',
    permalink: normalizePermalink(data.permalink),
    author: typeof data.author === 'string' ? data.author : '',
    score: typeof data.score === 'number' ? data.score : null,
    num_comments: typeof data.num_comments === 'number' ? data.num_comments : null,
    created_utc: typeof data.created_utc === 'number' ? data.created_utc : null,
    created_date: typeof data.created_utc === 'number' ? new Date(data.created_utc * 1000).toISOString() : ''
  };
}

function flattenComments(children, thread, sourceUrl, depthFallback = 0) {
  const comments = [];
  const moreIds = [];
  const walk = (nodes, fallbackDepth) => {
    for (const node of nodes) {
      const kind = typeof node.kind === 'string' ? node.kind : '';
      const data = isObject(node.data) ? node.data : {};

      if (kind === 'more') {
        const childIds = Array.isArray(data.children) ? data.children : [];
        for (const id of childIds) {
          if (typeof id === 'string' && /^[a-z0-9]+$/i.test(id)) moreIds.push(id.toLowerCase());
        }
        continue;
      }

      if (kind !== 't1') continue;
      const id = typeof data.id === 'string' ? data.id : '';
      if (!id) continue;
      const createdUtc = typeof data.created_utc === 'number' ? data.created_utc : null;
      const depth = typeof data.depth === 'number' ? data.depth : fallbackDepth;
      comments.push({
        source_url: sourceUrl,
        thread_id: thread.thread_id,
        thread_title: thread.thread_title,
        subreddit: typeof data.subreddit === 'string' ? data.subreddit : thread.subreddit,
        id,
        name: typeof data.name === 'string' ? data.name : `t1_${id}`,
        parent_id: typeof data.parent_id === 'string' ? data.parent_id : '',
        link_id: typeof data.link_id === 'string' ? data.link_id : `t3_${thread.thread_id}`,
        author: typeof data.author === 'string' ? data.author : '',
        score: typeof data.score === 'number' ? data.score : null,
        created_utc: createdUtc,
        created_date: createdUtc ? new Date(createdUtc * 1000).toISOString() : '',
        depth,
        permalink: normalizePermalink(data.permalink),
        body: typeof data.body === 'string' ? data.body : '',
        body_html: typeof data.body_html === 'string' ? data.body_html : '',
        stickied: data.stickied === true,
        distinguished: typeof data.distinguished === 'string' ? data.distinguished : ''
      });

      if (isObject(data.replies)) {
        walk(listingChildren(data.replies), depth + 1);
      }
    }
  };
  walk(children, depthFallback);
  return { comments, moreIds };
}

function uniquePush(target, seen, ids) {
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      target.push(id);
    }
  }
}

let tokenCache = { token: '', expiresAt: 0 };

function getUserAgent() {
  return process.env.REDDIT_USER_AGENT || 'web:batch-reddit-comments-exporter:1.0.0 (by /u/unknown)';
}

function hasOAuthCredentials() {
  return Boolean(process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET);
}

async function getRedditAccessToken() {
  if (!hasOAuthCredentials()) return '';
  const now = Date.now();
  if (tokenCache.token && tokenCache.expiresAt > now + 60000) return tokenCache.token;

  const auth = Buffer.from(`${process.env.REDDIT_CLIENT_ID}:${process.env.REDDIT_CLIENT_SECRET}`).toString('base64');
  const params = new URLSearchParams({ grant_type: 'client_credentials' });

  const response = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': getUserAgent(),
      'Accept': 'application/json'
    },
    body: params.toString()
  });

  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}

  if (!response.ok || !data || !data.access_token) {
    throw new Error(`Reddit OAuth failed ${response.status}: ${text.slice(0, 180)}`);
  }

  tokenCache = {
    token: data.access_token,
    expiresAt: now + Math.max(60, Number(data.expires_in || 3600) - 60) * 1000
  };
  return tokenCache.token;
}

async function redditFetch(pathOrUrl, options = {}) {
  const userAgent = getUserAgent();
  const token = await getRedditAccessToken();
  let url = pathOrUrl;

  if (token) {
    if (url.startsWith('https://www.reddit.com')) {
      url = url.replace('https://www.reddit.com', 'https://oauth.reddit.com');
    } else if (url.startsWith('/')) {
      url = `https://oauth.reddit.com${url}`;
    }
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      'Accept': 'application/json',
      'User-Agent': userAgent,
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}
  return { response, data, text, usedOAuth: Boolean(token) };
}

async function fetchMoreChildren(threadId, childIds) {
  const params = new URLSearchParams({
    api_type: 'json',
    link_id: `t3_${threadId}`,
    children: childIds.join(','),
    limit_children: 'true',
    raw_json: '1'
  });

  const { response, data, text } = await redditFetch('https://www.reddit.com/api/morechildren.json?raw_json=1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });

  if (!response.ok) {
    throw new Error(`morechildren ${response.status}: ${text.slice(0, 160)}`);
  }

  const things = data && data.json && data.json.data && Array.isArray(data.json.data.things)
    ? data.json.data.things.filter(isObject)
    : [];
  return things;
}

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return send(res, 200, { ok: true });
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Use POST.' });

  try {
    const body = await readJsonBody(req);
    const sourceUrl = typeof body.url === 'string' ? body.url.trim() : '';
    const threadId = parseRedditPostId(sourceUrl);
    if (!threadId) return send(res, 400, { ok: false, error: 'Invalid Reddit thread URL or ID.' });

    const sort = ALLOWED_SORTS.has(body.sort) ? body.sort : 'confidence';
    const maxRows = Number.isFinite(Number(body.maxRows)) && Number(body.maxRows) > 0
      ? Math.min(50000, Math.floor(Number(body.maxRows)))
      : null;
    const expandMore = body.expandMore === true;
    const maxMoreBatches = expandMore
      ? Math.max(0, Math.min(100, Math.floor(Number(body.maxMoreBatches || 20))))
      : 0;

    const commentsUrl = `https://www.reddit.com/comments/${threadId}.json?limit=500&sort=${encodeURIComponent(sort)}&raw_json=1`;
    const { response, data, text, usedOAuth } = await redditFetch(commentsUrl);

    if (!response.ok) {
      const map = {
        403: usedOAuth ? 'Reddit denied access. The post may be private/restricted/removed, or the app lacks permission.' : 'Reddit blocked this public request. Add REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET on Vercel and redeploy.',
        404: 'Reddit post not found.',
        429: 'Reddit rate limit hit. Wait a bit and try again.'
      };
      return send(res, response.status, { ok: false, error: map[response.status] || `Reddit returned ${response.status}.`, details: text.slice(0, 240) });
    }

    if (!Array.isArray(data)) {
      return send(res, 502, { ok: false, error: 'Unexpected Reddit response.' });
    }

    const thread = extractPost(data[0]);
    if (!thread.thread_id) thread.thread_id = threadId;

    const seenCommentIds = new Set();
    const seenMoreIds = new Set();
    let allComments = [];
    const queue = [];

    const initial = flattenComments(listingChildren(data[1] || data[0]), thread, sourceUrl, 0);
    for (const comment of initial.comments) {
      if (!seenCommentIds.has(comment.id)) {
        seenCommentIds.add(comment.id);
        allComments.push(comment);
      }
    }
    uniquePush(queue, seenMoreIds, initial.moreIds);

    let moreError = '';
    let batches = 0;
    while (expandMore && queue.length > 0 && batches < maxMoreBatches && (!maxRows || allComments.length < maxRows)) {
      batches++;
      const ids = queue.splice(0, 100);
      try {
        const things = await fetchMoreChildren(thread.thread_id, ids);
        const expanded = flattenComments(things, thread, sourceUrl, 0);
        for (const comment of expanded.comments) {
          if (!seenCommentIds.has(comment.id)) {
            seenCommentIds.add(comment.id);
            allComments.push(comment);
            if (maxRows && allComments.length >= maxRows) break;
          }
        }
        uniquePush(queue, seenMoreIds, expanded.moreIds);
      } catch (error) {
        moreError = error && error.message ? error.message : 'Could not expand more comments.';
        break;
      }
    }

    if (maxRows && allComments.length > maxRows) allComments = allComments.slice(0, maxRows);

    const resultThread = {
      ...thread,
      source_url: sourceUrl,
      sort,
      comments_loaded: allComments.length,
      more_count: queue.length,
      more_batches_used: batches,
      more_error: moreError,
      auth_mode: usedOAuth ? 'oauth' : 'public_json'
    };

    return send(res, 200, { ok: true, thread: resultThread, comments: allComments });
  } catch (error) {
    return send(res, 500, { ok: false, error: error && error.message ? error.message : 'Server error.' });
  }
};
