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

// Cloudflare Pages preview domains (branch deploys)
const ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/[a-z0-9-]+\.sports-card-checklists\.pages\.dev$/,
];

const ALLOWED_IMAGE_DOMAINS = [
  'i.ebayimg.com',
  'ebay.com',
  'www.ebay.com',
];

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
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    // Route requests
    if (request.method === 'POST' && url.pathname === '/proxy-image') {
      return handleProxyImage(request, corsOrigin);
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
