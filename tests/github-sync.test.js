import { describe, it, expect, beforeAll, afterEach } from 'vitest';

// The shared setup loads github-sync.js along with the rest of the bundle (#719),
// so this exercises the real singleton rather than a re-loaded copy. Constructing
// it touches localStorage but not the network; the tests below stub fetch for the
// paths that would make a request.
let sync;
beforeAll(() => {
    sync = globalThis.window.githubSync;
});

// Minimal Response stand-in: only the bits _isRateLimited reads.
function mockResponse({ status, headers = {}, body = '' }) {
    const lower = {};
    for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
    return {
        status,
        headers: { get: k => (k.toLowerCase() in lower ? lower[k.toLowerCase()] : null) },
        clone: () => ({ text: async () => body }),
    };
}

describe('GitHubSync._isRateLimited', () => {
    it('returns false for a successful response', async () => {
        expect(await sync._isRateLimited(mockResponse({ status: 200 }))).toBe(false);
    });

    it('returns false for a 401 (genuine auth failure)', async () => {
        expect(await sync._isRateLimited(mockResponse({ status: 401, body: 'Bad credentials' }))).toBe(false);
    });

    it('detects the secondary write rate limit from the 403 body', async () => {
        const body = '{"message":"API rate limit exceeded for user ID 4030685."}';
        expect(await sync._isRateLimited(mockResponse({ status: 403, body }))).toBe(true);
    });

    it('detects a rate limit from the Retry-After header', async () => {
        expect(await sync._isRateLimited(mockResponse({ status: 403, headers: { 'Retry-After': '60' } }))).toBe(true);
    });

    it('detects a rate limit when remaining quota is exhausted', async () => {
        expect(await sync._isRateLimited(mockResponse({ status: 403, headers: { 'X-RateLimit-Remaining': '0' } }))).toBe(true);
    });

    it('treats a 403 without rate-limit signals as not rate limited (auth/scope)', async () => {
        const body = '{"message":"Resource not accessible by personal access token"}';
        expect(await sync._isRateLimited(mockResponse({ status: 403, body }))).toBe(false);
    });

    it('detects a 429 rate-limit response', async () => {
        const body = '{"message":"You have exceeded a secondary rate limit"}';
        expect(await sync._isRateLimited(mockResponse({ status: 429, body }))).toBe(true);
    });
});

describe('GitHubSync image ops auth handling', () => {
    const realFetch = globalThis.fetch;
    afterEach(() => {
        globalThis.fetch = realFetch;
        sync.token = null;
    });

    // Worker response stand-in for image endpoints (they call response.json()).
    function jsonResponse({ ok, status, body = {} }) {
        return { ok, status, json: async () => body };
    }

    it('uploadImage flags an expired session on 401 so callers can prompt re-login', async () => {
        sync.token = 'stale-token';
        globalThis.fetch = async () => jsonResponse({ ok: false, status: 401, body: { error: 'Invalid token' } });
        await expect(sync.uploadImage('images/x.webp', 'AAAA')).rejects.toMatchObject({ authExpired: true });
    });

    it('uploadImage does not flag non-auth failures as expired sessions', async () => {
        sync.token = 'good-token';
        globalThis.fetch = async () => jsonResponse({ ok: false, status: 500, body: { error: 'Boom' } });
        const err = await sync.uploadImage('images/x.webp', 'AAAA').catch(e => e);
        expect(err.message).toBe('Boom');
        expect(err.authExpired).toBeFalsy();
    });

    it('uploadImage does not flag a 403 (preview-site block / unauthorized user) as expired', async () => {
        sync.token = 'good-token';
        globalThis.fetch = async () => jsonResponse({ ok: false, status: 403, body: { error: 'Image uploads are disabled on preview sites.' } });
        const err = await sync.uploadImage('images/x.webp', 'AAAA').catch(e => e);
        expect(err.message).toBe('Image uploads are disabled on preview sites.');
        expect(err.authExpired).toBeFalsy();
    });

    it('deleteImage flags an expired session on 401', async () => {
        sync.token = 'stale-token';
        globalThis.fetch = async () => jsonResponse({ ok: false, status: 401, body: { error: 'Invalid token' } });
        await expect(sync.deleteImage('images/x.webp')).rejects.toMatchObject({ authExpired: true });
    });
});

// These two are the only place the private cache fields are touched from outside
// github-sync.js. Reading them is the assertion, and seeding them is the only way
// to tell a real clear from a no-op.
describe('GitHubSync cache clearing', () => {
    afterEach(() => {
        sync.clearGistCache();
        sync.clearDataCache();
    });

    it('clearGistCache drops both raw gist caches, so the next _fetchGist refetches', () => {
        sync._gistCache = { files: {} };
        sync._publicGistCache = { files: {} };

        sync.clearGistCache();

        expect(sync._gistCache).toBeNull();
        expect(sync._publicGistCache).toBeNull();
    });

    it('clearDataCache drops the collection-data cache, so the next loadData refetches', () => {
        sync._cachedData = { checklists: {} };

        sync.clearDataCache();

        expect(sync._cachedData).toBeNull();
    });

    // The two are separate because the callers want different things. Folding
    // either into the other would make some caller refetch data it did not ask for.
    it('clearGistCache leaves the collection-data cache alone', () => {
        sync._gistCache = { files: {} };
        sync._cachedData = { checklists: {} };

        sync.clearGistCache();

        expect(sync._cachedData).toEqual({ checklists: {} });
    });

    it('clearDataCache leaves the raw gist caches alone', () => {
        sync._gistCache = { files: {} };
        sync._publicGistCache = { files: {} };
        sync._cachedData = { checklists: {} };

        sync.clearDataCache();

        expect(sync._gistCache).toEqual({ files: {} });
        expect(sync._publicGistCache).toEqual({ files: {} });
    });
});
