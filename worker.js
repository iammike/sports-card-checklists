// Cloudflare Worker - GitHub OAuth Proxy
// Deploy this to Cloudflare Workers (free tier)
//
// Setup:
// 1. Go to dash.cloudflare.com > Workers & Pages > Create Worker
// 2. Paste this code
// 3. Add environment variables: GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET
// 4. Deploy and note your worker URL (e.g., https://your-worker.your-subdomain.workers.dev)

const ALLOWED_ORIGINS = [
  'https://iammike.github.io',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
];

// Cloudflare Pages preview domains (main + branch deploys)
const ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/sports-card-checklists\.pages\.dev$/,
  /^https:\/\/[a-z0-9-]+\.sports-card-checklists\.pages\.dev$/,
];

const ALLOWED_IMAGE_DOMAINS = [
  'i.ebayimg.com',
  'ebay.com',
  'www.ebay.com',
  'img.beckett.com',
];

const WORKER_URL = 'https://cards-oauth.iammikec.workers.dev';
const MAX_IMAGE_SIZE = 2 * 1024 * 1024; // 2MB

// Serve images from R2 (public, cached)
async function handleServeImage(request, env, key) {
  const object = await env.IMAGES_BUCKET.get(key);
  if (!object) {
    return new Response('Not found', { status: 404 });
  }

  const headers = new Headers();
  headers.set('Content-Type', object.httpMetadata?.contentType || 'image/webp');
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('ETag', object.httpEtag);
  headers.set('Access-Control-Allow-Origin', '*');

  // Support conditional requests
  const ifNoneMatch = request.headers.get('If-None-Match');
  if (ifNoneMatch && ifNoneMatch === object.httpEtag) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(object.body, { headers });
}

// Production origins allowed to upload images to R2.
// Preview sites share the same R2 bucket, so uploads from them
// would overwrite production images.
const UPLOAD_ALLOWED_ORIGINS = [
  'https://iammike.github.io',
];

// Upload image to R2 (authenticated)
async function handleUploadImage(request, env, corsOrigin) {
  const corsHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': corsOrigin,
  };

  // Block uploads from preview/non-production origins
  const requestOrigin = request.headers.get('Origin');
  if (!UPLOAD_ALLOWED_ORIGINS.includes(requestOrigin)) {
    return new Response(JSON.stringify({
      error: 'Image uploads are disabled on preview sites.',
    }), {
      status: 403, headers: corsHeaders,
    });
  }

  // Validate auth token
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Missing authorization' }), {
      status: 401, headers: corsHeaders,
    });
  }

  const token = authHeader.slice(7);
  try {
    const userResponse = await fetch('https://api.github.com/user', {
      headers: { 'Authorization': `Bearer ${token}`, 'User-Agent': 'cards-oauth-worker' },
    });
    if (!userResponse.ok) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401, headers: corsHeaders,
      });
    }
    const user = await userResponse.json();
    if (user.login !== 'iammike') {
      return new Response(JSON.stringify({ error: 'Unauthorized user' }), {
        status: 403, headers: corsHeaders,
      });
    }
  } catch {
    return new Response(JSON.stringify({ error: 'Auth verification failed' }), {
      status: 500, headers: corsHeaders,
    });
  }

  // Parse and validate request body
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: corsHeaders,
    });
  }

  const { key, base64, contentType } = body;

  if (!key || !base64) {
    return new Response(JSON.stringify({ error: 'Missing key or base64' }), {
      status: 400, headers: corsHeaders,
    });
  }

  // Validate key format: images/{folder}/{file}.webp
  if (!/^images\/[a-z0-9-]+\/[a-z0-9_.-]+\.webp$/i.test(key)) {
    return new Response(JSON.stringify({ error: 'Invalid key format. Expected: images/{folder}/{file}.webp' }), {
      status: 400, headers: corsHeaders,
    });
  }

  // Decode base64 and check size
  let bytes;
  try {
    const binaryString = atob(base64);
    bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid base64 data' }), {
      status: 400, headers: corsHeaders,
    });
  }

  if (bytes.length > MAX_IMAGE_SIZE) {
    return new Response(JSON.stringify({ error: `Image too large (${(bytes.length / 1024 / 1024).toFixed(1)}MB). Max 2MB.` }), {
      status: 413, headers: corsHeaders,
    });
  }

  // Upload to R2
  try {
    await env.IMAGES_BUCKET.put(key, bytes, {
      httpMetadata: { contentType: contentType || 'image/webp' },
    });
  } catch (error) {
    console.error('R2 upload error:', error);
    return new Response(JSON.stringify({ error: 'Upload failed' }), {
      status: 500, headers: corsHeaders,
    });
  }

  const url = `${WORKER_URL}/${key}`;
  return new Response(JSON.stringify({ url, key }), {
    headers: corsHeaders,
  });
}

// Proxy image endpoint - fetches external images to bypass CORS
async function handleProxyImage(request, corsOrigin) {
  try {
    const { url } = await request.json();

    if (!url) {
      return new Response(JSON.stringify({ error: 'Missing url' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': corsOrigin },
      });
    }

    // Validate URL domain
    const parsedUrl = new URL(url);
    if (!ALLOWED_IMAGE_DOMAINS.some(domain => parsedUrl.hostname === domain || parsedUrl.hostname.endsWith('.' + domain))) {
      return new Response(JSON.stringify({ error: 'Domain not allowed' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': corsOrigin },
      });
    }

    // Fetch the image
    const imageResponse = await fetch(url);
    if (!imageResponse.ok) {
      return new Response(JSON.stringify({ error: 'Failed to fetch image' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': corsOrigin },
      });
    }

    const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';
    const arrayBuffer = await imageResponse.arrayBuffer();

    // Convert to base64 in chunks (spread operator fails on large arrays)
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, chunk);
    }
    const base64 = btoa(binary);

    return new Response(JSON.stringify({ base64, contentType }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': corsOrigin },
    });
  } catch (error) {
    console.error('Proxy image error:', error);
    return new Response(JSON.stringify({ error: 'Failed to proxy image' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': corsOrigin },
    });
  }
}

function getCorsOrigin(request) {
  const origin = request.headers.get('Origin');
  if (ALLOWED_ORIGINS.includes(origin)) {
    return origin;
  }
  // Check against patterns (e.g., Cloudflare Pages preview deployments)
  if (origin && ALLOWED_ORIGIN_PATTERNS.some(pattern => pattern.test(origin))) {
    return origin;
  }
  return ALLOWED_ORIGINS[0];
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsOrigin = getCorsOrigin(request);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': corsOrigin,
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      });
    }

    // Serve images from R2 (public, no CORS needed)
    if (request.method === 'GET' && url.pathname.startsWith('/images/')) {
      const key = url.pathname.slice(1); // Remove leading slash
      return handleServeImage(request, env, key);
    }

    // Route requests
    if (request.method === 'POST' && url.pathname === '/proxy-image') {
      return handleProxyImage(request, corsOrigin);
    }

    if (request.method === 'POST' && url.pathname === '/upload-image') {
      return handleUploadImage(request, env, corsOrigin);
    }

    // Only handle POST to /token
    if (request.method !== 'POST' || url.pathname !== '/token') {
      return new Response('Not found', { status: 404 });
    }

    try {
      const { code, client_id } = await request.json();

      if (!code) {
        return new Response(JSON.stringify({ error: 'Missing code' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': corsOrigin },
        });
      }

      // Determine which OAuth app credentials to use
      // Preview app for pages.dev origins, production app otherwise
      const isPreview = ALLOWED_ORIGIN_PATTERNS.some(pattern => pattern.test(corsOrigin));
      const oauthClientId = isPreview ? env.GITHUB_CLIENT_ID_PREVIEW : env.GITHUB_CLIENT_ID;
      const oauthClientSecret = isPreview ? env.GITHUB_CLIENT_SECRET_PREVIEW : env.GITHUB_CLIENT_SECRET;

      // Exchange code for token
      const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_id: oauthClientId,
          client_secret: oauthClientSecret,
          code: code,
        }),
      });

      const tokenData = await tokenResponse.json();

      return new Response(JSON.stringify(tokenData), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': corsOrigin,
        },
      });
    } catch (error) {
      console.error('OAuth proxy error:', error);
      return new Response(JSON.stringify({ error: 'Authentication failed' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': corsOrigin },
      });
    }
  },
};
