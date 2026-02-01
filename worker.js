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

function getCorsOrigin(request) {
  const origin = request.headers.get('Origin');
  return ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
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

    // Only handle POST to /token
    if (request.method !== 'POST' || url.pathname !== '/token') {
      return new Response('Not found', { status: 404 });
    }

    try {
      const { code } = await request.json();

      if (!code) {
        return new Response(JSON.stringify({ error: 'Missing code' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': corsOrigin },
        });
      }

      // Exchange code for token
      const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_id: env.GITHUB_CLIENT_ID,
          client_secret: env.GITHUB_CLIENT_SECRET,
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
