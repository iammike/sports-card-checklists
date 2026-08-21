import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';

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

describe('GitHubSync write spacing (#733)', () => {
    // globalThis.fetch already exists at describe-body collection time (setup.js
    // installs the tripwire before any test file loads), so capturing it here is
    // fine. sync.gistId/sync.token are not: `sync` itself isn't assigned until
    // beforeAll runs, well after this describe body executes - so those two are
    // just reset to null in afterEach rather than captured-and-restored.
    const realFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = realFetch;
        sync.gistId = null;
        sync.token = null;
        sync._lastWriteAt = 0;
    });

    it('lets the first write through immediately, then makes the next one wait out the minimum gap', async () => {
        sync.token = 'good-token';
        sync.gistId = 'gist123';
        sync._lastWriteAt = 0;
        globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });

        const t0 = Date.now();
        await sync._writeGistFile('a.json', { a: 1 });
        const t1 = Date.now();
        await sync._writeGistFile('a.json', { a: 2 });
        const t2 = Date.now();

        expect(t1 - t0).toBeLessThan(300);
        expect(t2 - t1).toBeGreaterThanOrEqual(950); // mirrors MIN_WRITE_SPACING_MS (1000ms)
    }, 10000);

    it('measures the gap from when the previous PATCH finished, not when it started', async () => {
        // A synchronous fetch stub can't tell "stamped before fn()" apart from
        // "stamped after fn()" - both look instantaneous. This needs a slow
        // request to separate the two: with the bug (stamped at call start),
        // a 700ms request leaves only ~300ms of the 1000ms gap enforced before
        // the next write fires.
        sync.token = 'good-token';
        sync.gistId = 'gist123';
        sync._lastWriteAt = 0;

        const starts = [];
        const ends = [];
        globalThis.fetch = async () => {
            starts.push(Date.now());
            await new Promise(r => setTimeout(r, 700));
            ends.push(Date.now());
            return { ok: true, json: async () => ({}) };
        };

        await sync._writeGistFile('a.json', { a: 1 });
        await sync._writeGistFile('a.json', { a: 2 });

        expect(starts[1] - ends[0]).toBeGreaterThanOrEqual(950);
    }, 15000);

    it('spaces out a 409 retry by the full minimum gap, not just the shorter conflict backoff', async () => {
        // A 409-conflict retry backs off only 300ms on its own (_patchGist's
        // existing retry logic) - well under the 1s write-spacing gap. The retry
        // has to go through the same spacing check as any other write, otherwise
        // it fires far sooner than every other consecutive write does (#733).
        sync.token = 'good-token';
        sync.gistId = 'gist123';
        sync._lastWriteAt = 0;

        const fetchTimestamps = [];
        let call = 0;
        globalThis.fetch = async () => {
            fetchTimestamps.push(Date.now());
            call++;
            if (call === 1) return { ok: false, status: 409, json: async () => ({}) };
            return { ok: true, json: async () => ({}) };
        };

        await sync._writeGistFile('a.json', { a: 1 });

        expect(fetchTimestamps).toHaveLength(2);
        expect(fetchTimestamps[1] - fetchTimestamps[0]).toBeGreaterThanOrEqual(950);
    }, 10000);
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

// Sign-in is owner-only. Anyone can authorize the OAuth app, and before this
// gate a stranger's callback ran all the way through findOrCreateGist(), which
// silently created a public gist in *their* GitHub account. It also left them on
// a half-broken site: the registry read follows the token to their own gist, so
// the index page rendered with no checklists and no nav links.
describe('GitHubSync owner-only sign-in', () => {
    const realFetch = globalThis.fetch;
    const realAlert = globalThis.alert;
    const realSearch = window.location.search;

    beforeEach(() => {
        globalThis.alert = () => {};
    });

    afterEach(() => {
        globalThis.fetch = realFetch;
        globalThis.alert = realAlert;
        window.history.replaceState({}, '', window.location.pathname + realSearch);
        sessionStorage.clear();
        sync.token = null;
        sync.user = null;
        sync.gistId = null;
        localStorage.clear();
    });

    it('rejects a non-owner and clears the session', () => {
        sync.token = 'tok';
        sync.user = { login: 'someone-else' };

        expect(sync._rejectIfNotOwner({ login: 'someone-else' })).toBe(true);
        expect(sync.token).toBeNull();
        expect(localStorage.getItem('github_token')).toBeNull();
    });

    it('accepts the owner and leaves the session intact', () => {
        sync.token = 'tok';

        expect(sync._rejectIfNotOwner({ login: 'iammike' })).toBe(false);
        expect(sync.token).toBe('tok');
    });

    it('rejects a missing or malformed user rather than defaulting to allow', () => {
        expect(sync._rejectIfNotOwner(undefined)).toBe(true);
        expect(sync._rejectIfNotOwner({})).toBe(true);
        expect(sync._rejectIfNotOwner({ login: null })).toBe(true);
    });

    // Deliberately case-exact, matching isOwner() and the other owner checks in
    // checklist-engine.js and index.html. Relaxing only this one would let a
    // differently-cased login sign in and then land read-only everywhere.
    it('matches the owner login case-exactly, like the sibling owner checks', () => {
        expect(sync._rejectIfNotOwner({ login: 'IamMike' })).toBe(true);
    });


    // The gates in handleCallback only fire on a fresh OAuth return, so a session
    // stored before this shipped would otherwise persist unchecked forever.
    it('clears a stored non-owner session when the sweeper runs', () => {
        sync.token = 'tok';
        sync.user = { login: 'someone-else' };

        sync._clearStaleNonOwnerSession();

        expect(sync.token).toBeNull();
    });

    // Calling the helper directly cannot show the constructor invokes it - without
    // this, the wiring could be dropped and every other test here still passes.
    it('clears a stale non-owner session when a new instance is constructed', () => {
        localStorage.setItem('github_token', 'tok');
        localStorage.setItem('github_user', JSON.stringify({ login: 'someone-else' }));

        const fresh = new sync.constructor();

        expect(fresh.token).toBeNull();
        expect(localStorage.getItem('github_token')).toBeNull();
    });

    it('leaves a stored owner session alone', () => {
        sync.token = 'tok';
        sync.user = { login: 'iammike' };

        sync._clearStaleNonOwnerSession();

        expect(sync.token).toBe('tok');
    });

    // The branch-preview redirect path stores token/user/gistId straight from the
    // URL fragment, so it needs the same gate as the code-exchange path above.
    it('rejects a non-owner arriving via the #auth= fragment', async () => {
        const authData = btoa(JSON.stringify({
            token: 'tok', user: { login: 'someone-else' }, gistId: 'gist1',
        }));
        window.history.replaceState({}, '', `${window.location.pathname}#auth=${authData}`);
        // A pre-existing value the gate must clear, so disabling the whole
        // fragment branch cannot leave this passing on absences alone.
        sync.token = 'pre-existing';

        const result = await sync.handleCallback();

        expect(result).toBe(false);
        expect(sync.token).toBeNull();
        expect(localStorage.getItem('github_token')).toBeNull();
    });

    // fetchUser() sits between the token write and the gate, and the outer catch
    // swallows anything it throws - a network blip or an HTML 5xx body is enough.
    // Persisting the token before the gate leaves a stranger with a token and no
    // user: isLoggedIn() is true, and the sweeper's user check cannot clean it up,
    // which is the exact broken state this whole change exists to prevent.
    it('persists no token when fetchUser fails after the exchange', async () => {
        globalThis.fetch = async (url) => {
            if (String(url).includes('/token')) {
                return { json: async () => ({ access_token: 'stranger-tok' }) };
            }
            throw new Error('network blip');
        };
        sessionStorage.setItem('oauth_state', 'csrf2');
        const state = btoa(JSON.stringify({ csrf: 'csrf2', returnUrl: null }));
        window.history.replaceState({}, '', `${window.location.pathname}?code=abc&state=${encodeURIComponent(state)}`);

        const result = await sync.handleCallback();

        expect(result).toBe(false);
        expect(localStorage.getItem('github_token')).toBeNull();
        expect(sync.isLoggedIn()).toBe(false);
    });

    // Fails closed: a token with no user must not survive, or the case above
    // becomes permanent across reloads.
    it('sweeps a token that has no stored user', () => {
        sync.token = 'orphan';
        sync.user = null;

        sync._clearStaleNonOwnerSession();

        expect(sync.token).toBeNull();
    });

    // The regression that matters most: locking the owner out of their own site is
    // worse than the bug being fixed. Both of these exercise the real constructor
    // and the real handleCallback - asserting on the helpers in isolation cannot
    // catch a gate that logs the owner out.
    it('leaves a stored owner session intact when a new instance is constructed', () => {
        localStorage.setItem('github_token', 'tok');
        localStorage.setItem('github_user', JSON.stringify({ login: 'iammike' }));

        const fresh = new sync.constructor();

        expect(fresh.token).toBe('tok');
        expect(localStorage.getItem('github_token')).toBe('tok');
    });

    it('completes the owner callback through to findOrCreateGist', async () => {
        const calls = [];
        let alerted = false;
        globalThis.alert = () => { alerted = true; };
        globalThis.fetch = async (url, opts) => {
            calls.push(String(url));
            if (String(url).includes('/token')) {
                return { json: async () => ({ access_token: 'owner-tok' }) };
            }
            if (String(url).includes('api.github.com/user')) {
                return { json: async () => ({ login: 'iammike' }) };
            }
            if (String(url).includes('/gists')) {
                return { ok: true, json: async () => ([{ id: 'g1', files: { 'sports-card-checklists.json': {} } }]) };
            }
            return { ok: true, json: async () => ({}) };
        };
        sessionStorage.setItem('oauth_state', 'csrf3');
        const state = btoa(JSON.stringify({ csrf: 'csrf3', returnUrl: null }));
        window.history.replaceState({}, '', `${window.location.pathname}?code=abc&state=${encodeURIComponent(state)}`);

        const result = await sync.handleCallback();

        expect(result).toBe(true);
        expect(localStorage.getItem('github_token')).toBe('owner-tok');
        expect(calls.some(u => u.includes('/gists'))).toBe(true);
        expect(alerted).toBe(false);
    });

    // findOrCreateGist runs after the token is committed to storage and throws
    // readily (unwrapped fetch, .json() on an HTML 5xx, a non-array body). Rolling
    // the in-memory token back there would desync it from storage: the owner would
    // see a signed-out UI holding a valid token until they reloaded.
    it('keeps memory and storage in step when findOrCreateGist throws', async () => {
        globalThis.fetch = async (url) => {
            if (String(url).includes('/token')) {
                return { json: async () => ({ access_token: 'owner-tok' }) };
            }
            if (String(url).includes('api.github.com/user')) {
                return { json: async () => ({ login: 'iammike' }) };
            }
            throw new Error('gists unavailable');
        };
        sessionStorage.setItem('oauth_state', 'csrf4');
        const state = btoa(JSON.stringify({ csrf: 'csrf4', returnUrl: null }));
        window.history.replaceState({}, '', `${window.location.pathname}?code=abc&state=${encodeURIComponent(state)}`);

        await sync.handleCallback();

        expect(localStorage.getItem('github_token')).toBe('owner-tok');
        expect(sync.token).toBe(localStorage.getItem('github_token'));
    });

    it('accepts the owner arriving via the #auth= fragment', async () => {
        const authData = btoa(JSON.stringify({
            token: 'owner-tok', user: { login: 'iammike' }, gistId: 'g1',
        }));
        window.history.replaceState({}, '', `${window.location.pathname}#auth=${authData}`);

        const result = await sync.handleCallback();

        expect(result).toBe(true);
        expect(sync.token).toBe('owner-tok');
    });

    // The behaviour that matters: the rejection lands before findOrCreateGist(),
    // so a stranger never gets a gist created in their account.
    it('never creates a gist for a non-owner callback', async () => {
        const calls = [];
        globalThis.fetch = async (url, opts) => {
            calls.push({ url: String(url), method: opts?.method || 'GET' });
            if (String(url).includes('/token')) {
                return { json: async () => ({ access_token: 'tok' }) };
            }
            if (String(url).includes('api.github.com/user')) {
                return { json: async () => ({ login: 'someone-else' }) };
            }
            return { ok: true, json: async () => ({}) };
        };
        sessionStorage.setItem('oauth_state', 'csrf1');
        const state = btoa(JSON.stringify({ csrf: 'csrf1', returnUrl: null }));
        window.history.replaceState({}, '', `${window.location.pathname}?code=abc&state=${encodeURIComponent(state)}`);

        const result = await sync.handleCallback();

        expect(result).toBe(false);
        expect(sync.token).toBeNull();
        expect(localStorage.getItem('github_token')).toBeNull();
        // Reaching /gists at all would mean the gate ran too late.
        expect(calls.filter(c => c.url.includes('/gists'))).toEqual([]);
        // Proves the callback really ran rather than bailing early for some
        // unrelated reason - otherwise the assertion above passes vacuously.
        expect(calls.some(c => c.url.includes('api.github.com/user'))).toBe(true);
    });
});

// The branch-preview return path classified a redirect target by substring
// (`returnUrl.includes('.pages.dev')`), skipped CSRF verification on that basis,
// and then put the live token in the target's URL fragment. A crafted authorize
// link therefore walked the OWNER through a genuine GitHub flow and delivered a
// gist+public_repo token to a host of the attacker's choosing.
describe('GitHubSync branch-preview return URL', () => {
    const ok = (u) => sync.isProjectPreviewUrl(u);

    it('accepts the project preview host and its branch subdomains', () => {
        expect(ok('https://sports-card-checklists.pages.dev/')).toBe(true);
        expect(ok('https://fix-something.sports-card-checklists.pages.dev/x?y=1')).toBe(true);
    });

    // Anyone can create a Cloudflare Pages project, so *.pages.dev is not a
    // boundary - only this project's own subdomain is.
    it('rejects another Pages project', () => {
        expect(ok('https://evil.pages.dev/')).toBe(false);
        expect(ok('https://sports-card-checklists.pages.dev.evil.com/')).toBe(false);
    });

    // The substring test that shipped: .pages.dev anywhere in the URL passed.
    it('rejects a foreign host that merely mentions the preview domain', () => {
        expect(ok('https://evil.example/?x=.pages.dev')).toBe(false);
        expect(ok('https://evil.example/#sports-card-checklists.pages.dev')).toBe(false);
        expect(ok('https://evil.example/.pages.dev')).toBe(false);
    });

    it('rejects non-https and unparseable values', () => {
        expect(ok('http://fix-x.sports-card-checklists.pages.dev/')).toBe(false);
        expect(ok('javascript:alert(1)//sports-card-checklists.pages.dev')).toBe(false);
        expect(ok('not a url')).toBe(false);
        expect(ok(null)).toBe(false);
        expect(ok(undefined)).toBe(false);
    });
});

describe('GitHubSync OAuth CSRF verification', () => {
    const realFetch = globalThis.fetch;
    const realAlert = globalThis.alert;
    const realSearch = window.location.search;

    let requests;
    beforeEach(() => {
        globalThis.alert = () => {};
        requests = [];
        globalThis.fetch = async (url) => {
            requests.push(String(url));
            throw new Error('no request should be made');
        };
    });

    afterEach(() => {
        globalThis.fetch = realFetch;
        globalThis.alert = realAlert;
        window.history.replaceState({}, '', window.location.pathname + realSearch);
        sessionStorage.clear();
        localStorage.clear();
        sync.token = null;
        sync.user = null;
    });

    const arrive = async (stateObj) => {
        const state = btoa(JSON.stringify(stateObj));
        window.history.replaceState({}, '', `${window.location.pathname}?code=abc&state=${encodeURIComponent(state)}`);
        return sync.handleCallback();
    };

    // The heart of it: a mismatched CSRF token must not be excused by anything
    // the attacker put in the state.
    it('rejects a mismatched csrf even with a preview-looking returnUrl', async () => {
        sessionStorage.setItem('oauth_state', 'the-real-one');

        const result = await arrive({ csrf: 'forged', returnUrl: 'https://evil.example/?x=.pages.dev' });

        expect(result).toBe(false);
        expect(sync.token).toBeNull();
        // Rejected at the CSRF check, not merely failed later: the code is never
        // exchanged. Without this the test passes on any downstream error.
        expect(requests).toEqual([]);
    });

    it('rejects a callback carrying no csrf and no preview return URL', async () => {
        sessionStorage.setItem('oauth_state', 'the-real-one');

        expect(await arrive({ returnUrl: null })).toBe(false);
        expect(requests).toEqual([]);
    });

    // A branch preview begins on <branch>.<project>.pages.dev and lands here on
    // <project>.pages.dev, so sessionStorage is empty and the token cannot be
    // matched. That exemption is deliberate and is why the origin check above
    // carries the weight: it is the only thing deciding who may be handed a token.
    it('exempts a genuine project preview return URL from the csrf check', async () => {
        sessionStorage.clear();

        await arrive({ csrf: 'unverifiable', returnUrl: 'https://fix-x.sports-card-checklists.pages.dev/' });

        expect(requests.some(u => u.includes('/token'))).toBe(true);
    });

    // The exploit end to end: a valid flow whose state names a foreign host must
    // complete against this origin and never treat that host as a return target.
    it('does not treat a foreign return URL as a redirect target', async () => {
        sessionStorage.setItem('oauth_state', 'match');
        const seen = [];
        globalThis.fetch = async (url) => {
            seen.push(String(url));
            if (String(url).includes('/token')) return { json: async () => ({ access_token: 'tok' }) };
            if (String(url).includes('api.github.com/user')) return { json: async () => ({ login: 'iammike' }) };
            return { ok: true, json: async () => ([{ id: 'g1', files: { 'sports-card-checklists.json': {} } }]) };
        };

        const result = await arrive({ csrf: 'match', returnUrl: 'https://evil.example/?x=.pages.dev' });

        // Completing here rather than redirecting is the observable difference:
        // the redirect branch returns before findOrCreateGist and never resolves
        // to true on this origin.
        expect(result).toBe(true);
        expect(seen.some(u => u.includes('/gists'))).toBe(true);
        expect(localStorage.getItem('github_token')).toBe('tok');
    });
});
