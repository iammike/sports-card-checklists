import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';

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
        // Drop the own-property stub; the prototype method must resurface, or a
        // later test silently runs against a fake preview flag.
        delete sync.isPreview;
        delete sync._redirect;
        expect(sync.isPreview).toBe(Object.getPrototypeOf(sync).isPreview);
        expect(sync._redirect).toBe(Object.getPrototypeOf(sync)._redirect);
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
        sync.isPreview = () => true;
        sessionStorage.setItem('oauth_state', 'csrf-x');
        const authData = btoa(JSON.stringify({
            token: 'tok', user: { login: 'someone-else' }, gistId: 'gist1', csrf: 'csrf-x',
        }));
        window.history.replaceState({}, '', `${window.location.pathname}?id=jd#auth=${authData}`);
        // A pre-existing value the gate must clear, so disabling the whole
        // fragment branch cannot leave this passing on absences alone.
        sync.token = 'pre-existing';

        const result = await sync.handleCallback();

        expect(result).toBe(false);
        expect(sync.token).toBeNull();
        expect(localStorage.getItem('github_token')).toBeNull();
        expect(window.location.search).toBe('?id=jd');
        expect(window.location.hash).toBe('');
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
        sync.isPreview = () => true;
        sessionStorage.setItem('oauth_state', 'csrf-y');
        const authData = btoa(JSON.stringify({
            token: 'owner-tok', user: { login: 'iammike' }, gistId: 'g1', csrf: 'csrf-y',
        }));
        window.history.replaceState({}, '', `${window.location.pathname}?id=jayden-daniels#auth=${authData}`);

        const result = await sync.handleCallback();

        expect(result).toBe(true);
        expect(sync.token).toBe('owner-tok');
        // Success strips the auth fragment but must keep the checklist id.
        expect(window.location.search).toBe('?id=jayden-daniels');
        expect(window.location.hash).toBe('');
    });

    // Left in the address bar, an error response is both untidy and a stale state
    // sitting where the next callback will parse it. _returnQuery keeps it from
    // reaching GitHub; this clears it at the source.
    it('clears a denied authorization out of the address bar', async () => {
        window.history.replaceState({}, '',
            `${window.location.pathname}?id=busts&error=access_denied&state=STALE`);

        expect(await sync.handleCallback()).toBe(false);

        expect(window.location.search).toBe('?id=busts');
    });

    // ?error= with an empty value is still an error response, and the stale state
    // sits beside it. `params.get` is falsy there; `params.has` is not.
    it('clears a denied authorization whose error value is empty', async () => {
        window.history.replaceState({}, '',
            `${window.location.pathname}?id=busts&error=&state=STALE`);

        expect(await sync.handleCallback()).toBe(false);

        expect(window.location.search).toBe('?id=busts');
    });

    // A payload that will not decode is still a real token in history if it
    // happens to be one. The catch used to only log.
    it('clears the address bar when an auth fragment will not decode', async () => {
        sync.isPreview = () => true;
        sessionStorage.setItem('oauth_state', 'csrf-y');
        window.history.replaceState({}, '', `${window.location.pathname}?id=busts#auth=%%%not-base64`);

        expect(await sync.handleCallback()).toBe(false);

        expect(window.location.hash).toBe('');
        expect(window.location.search).toBe('?id=busts');
    });

    // The fragment is all it should drop. A code beside it is a callback this same
    // pass has not read yet - the query is parsed a few lines below the catch, so
    // clearing it there makes `code` null and the callback returns having done
    // nothing. Asserted on the exchange rather than on the address bar, because
    // the normal path cleans the query itself once it has read it.
    it('still exchanges a concurrent code when the fragment will not decode', async () => {
        sync.isPreview = () => true;
        sessionStorage.setItem('oauth_state', 'st');
        const state = btoa(JSON.stringify({ csrf: 'st', returnUrl: null }));
        window.history.replaceState({}, '',
            `${window.location.pathname}?code=REAL&state=${state}#auth=%%%not-base64`);
        const seen = [];
        globalThis.fetch = async (url) => {
            seen.push(String(url));
            return { json: async () => ({ error: 'stop_here' }) };
        };

        await sync.handleCallback();

        expect(window.location.hash).toBe('');
        expect(seen.some(u => u.includes('/token'))).toBe(true);
    });

    // _redirect appends the real payload last, so an earlier "#auth=" came from
    // the returnUrl prefix - and isProjectPreviewUrl accepts a preview URL that
    // already carries one. Reading the first would decode the attacker's text,
    // throw, and (before the catch cleaned up) strand the owner's live token.
    it('reads the last auth fragment, not a planted earlier one', async () => {
        sync.isPreview = () => true;
        sessionStorage.setItem('oauth_state', 'csrf-y');
        const real = btoa(JSON.stringify({
            token: 'owner-tok', user: { login: 'iammike' }, gistId: 'g1', csrf: 'csrf-y',
        }));
        window.history.replaceState({}, '',
            `${window.location.pathname}#auth=${btoa('planted')}#auth=${real}`);

        const result = await sync.handleCallback();

        expect(result).toBe(true);
        expect(sync.token).toBe('owner-tok');
        expect(window.location.hash).toBe('');
    });

    // The other half of #757: even with login() stripping the fragment, a receiver
    // that requires #auth= to be the whole hash fails silently on anything that
    // appends one, and silence here means a live token resting in the address bar.
    it('consumes an auth fragment that is not the whole hash', async () => {
        sync.isPreview = () => true;
        sessionStorage.setItem('oauth_state', 'csrf-y');
        const authData = btoa(JSON.stringify({
            token: 'owner-tok', user: { login: 'iammike' }, gistId: 'g1', csrf: 'csrf-y',
        }));
        window.history.replaceState({}, '',
            `${window.location.pathname}?id=busts#card-abc#auth=${authData}`);

        const result = await sync.handleCallback();

        expect(result).toBe(true);
        expect(sync.token).toBe('owner-tok');
        expect(window.location.hash).toBe('');
        expect(window.location.search).toBe('?id=busts');
    });

    // An attacker can hand the victim any link. Before the fragment carried a csrf,
    // this planted the attacker's token and gist in the owner's browser - and the
    // ownership check was no defence, because it read a login from the same blob.
    it('ignores an auth fragment this tab never asked for', async () => {
        sync.isPreview = () => true;
        sessionStorage.clear();
        const authData = btoa(JSON.stringify({
            token: 'attacker-tok', user: { login: 'iammike' }, gistId: 'attacker-gist',
        }));
        window.history.replaceState({}, '', `${window.location.pathname}?id=jayden-daniels#auth=${authData}`);

        const result = await sync.handleCallback();

        expect(result).toBe(false);
        expect(sync.token).toBeNull();
        expect(localStorage.getItem('github_token')).toBeNull();
        // The checklist id must survive: stripping it leaves a reload with
        // nothing to load. The token-bearing fragment must not survive - asserting
        // only on search is satisfied by the cleanup never running.
        expect(window.location.search).toBe('?id=jayden-daniels');
        expect(window.location.hash).toBe('');
    });

    // csrf:null specifically. On a fresh tab sessionStorage returns null, so an
    // equality check alone gives null !== null === false and lets the fragment
    // through - the whole fix defeated by one token. The !authData.csrf clause is
    // what stops it, and omitting csrf entirely does not exercise that clause.
    it('ignores an auth fragment whose csrf is null on a fresh tab', async () => {
        sync.isPreview = () => true;
        sessionStorage.clear();
        const authData = btoa(JSON.stringify({
            token: 'attacker-tok', user: { login: 'iammike' }, gistId: 'g', csrf: null,
        }));
        window.history.replaceState({}, '', `${window.location.pathname}#auth=${authData}`);

        expect(await sync.handleCallback()).toBe(false);
        expect(localStorage.getItem('github_token')).toBeNull();
    });

    it('ignores an auth fragment whose csrf does not match this tab', async () => {
        sync.isPreview = () => true;
        sessionStorage.setItem('oauth_state', 'mine');
        const authData = btoa(JSON.stringify({
            token: 'attacker-tok', user: { login: 'iammike' }, gistId: 'g', csrf: 'theirs',
        }));
        window.history.replaceState({}, '', `${window.location.pathname}#auth=${authData}`);

        expect(await sync.handleCallback()).toBe(false);
        expect(localStorage.getItem('github_token')).toBeNull();
    });

    // Production never uses the fragment hop at all.
    it('consumes the stored csrf so a replayed fragment fails', async () => {
        sync.isPreview = () => true;
        sessionStorage.setItem('oauth_state', 'once');
        const authData = btoa(JSON.stringify({
            token: 'owner-tok', user: { login: 'iammike' }, gistId: 'g', csrf: 'once',
        }));
        const url = `${window.location.pathname}#auth=${authData}`;
        window.history.replaceState({}, '', url);
        expect(await sync.handleCallback()).toBe(true);

        sync.logout();
        window.history.replaceState({}, '', url);

        expect(await sync.handleCallback()).toBe(false);
    });

    it('ignores an auth fragment outside a preview origin', async () => {
        sync.isPreview = () => false;
        sessionStorage.setItem('oauth_state', 'mine');
        const authData = btoa(JSON.stringify({
            token: 'tok', user: { login: 'iammike' }, gistId: 'g', csrf: 'mine',
        }));
        window.history.replaceState({}, '', `${window.location.pathname}#auth=${authData}`);

        expect(await sync.handleCallback()).toBe(false);
        expect(localStorage.getItem('github_token')).toBeNull();
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
// gist+public_repo token - the scope at the time; `gist` alone now - to a host
// of the attacker's choosing.
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
        // No dot before the host: a Pages project literally named
        // "evilsports-card-checklists" is registrable by anyone.
        expect(ok('https://evilsports-card-checklists.pages.dev/')).toBe(false);
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

// login() decides where GitHub sends the callback. Nothing covered it, so a
// misclassification here would break preview sign-in with the suite green.
describe('GitHubSync.login', () => {
    afterEach(() => {
        delete sync.isPreview;
        delete sync._redirect;
        expect(sync.isPreview).toBe(Object.getPrototypeOf(sync).isPreview);
        expect(sync._redirect).toBe(Object.getPrototypeOf(sync)._redirect);
        sessionStorage.clear();
    });

    it('treats a branch subdomain as a branch preview', () => {
        sync.isPreview = () => true;

        expect(sync._isBranchPreview('fix-x.sports-card-checklists.pages.dev')).toBe(true);
    });

    it('does not treat the apex preview, which receives the callback, as one', () => {
        sync.isPreview = () => true;

        expect(sync._isBranchPreview('sports-card-checklists.pages.dev')).toBe(false);
    });

    it('does not treat production as a preview at all', () => {
        sync.isPreview = () => false;

        expect(sync._isBranchPreview('iammike.github.io')).toBe(false);
    });

    it('sends a branch preview through the apex and asks to be returned', () => {
        sync.isPreview = () => true;
        let authUrl;
        sync._redirect = (u) => { authUrl = u; };

        sync.login();

        const params = new URL(authUrl).searchParams;
        expect(params.get('redirect_uri')).toBe('https://sports-card-checklists.pages.dev/');
        const state = JSON.parse(atob(params.get('state')));
        // Not window.location.href: login() builds this from origin + pathname +
        // the allowlisted query, and the two happen to match only because the test
        // environment's URL is bare. See the fragment test below.
        expect(state.returnUrl).toBe(window.location.origin + window.location.pathname);
        expect(state.csrf).toBe(sessionStorage.getItem('oauth_state'));
    });

    // #764. The token this asks for is the one an attacker gets if they ever get
    // one, so it should buy as little as possible. public_repo was here for card
    // data edits through the repo Contents API; that API is gone, card data lives
    // in the gist, and the Worker only ever calls /user with this token.
    it('asks for no more scope than the gist it writes', () => {
        sync.isPreview = () => false;
        let authUrl;
        sync._redirect = (u) => { authUrl = u; };

        sync.login();

        expect(new URL(authUrl).searchParams.get('scope')).toBe('gist');
    });

    it('keeps the callback on this origin when not a branch preview', () => {
        sync.isPreview = () => false;
        let authUrl;
        sync._redirect = (u) => { authUrl = u; };

        sync.login();

        const params = new URL(authUrl).searchParams;
        expect(params.get('redirect_uri')).toBe(window.location.origin + window.location.pathname);
        expect(JSON.parse(atob(params.get('state'))).returnUrl).toBeNull();
    });

    // #757. The ?id= and #card- cases are unreachable today - checklist.html has
    // no sign-in button, so those two go live only when one is added. The stale
    // OAuth params below are reachable right now, from index.html, by clicking
    // Cancel on GitHub's authorize screen.
    describe('the address bar a sign-in starts from', () => {
        const realHref = window.location.href;
        afterEach(() => {
            window.history.replaceState({}, '', realHref);
        });

        const loginFrom = (url) => {
            window.history.replaceState({}, '', url);
            let authUrl;
            sync._redirect = (u) => { authUrl = u; };
            sync.login();
            return new URL(authUrl).searchParams;
        };

        it('keeps ?id= on the callback, without which the return lands on "No checklist ID specified"', () => {
            sync.isPreview = () => false;

            const params = loginFrom('/checklist.html?id=jayden-daniels');

            expect(params.get('redirect_uri'))
                .toBe(window.location.origin + '/checklist.html?id=jayden-daniels');
        });

        it('drops a deep-link fragment from the preview return URL', () => {
            // "<returnUrl>#auth=<payload>" with a fragment already present yields
            // two, the receiver's check fails, and a live token is left parked in
            // the address bar and history.
            sync.isPreview = () => true;

            const params = loginFrom('/checklist.html?id=busts#card-abc');

            const { returnUrl } = JSON.parse(atob(params.get('state')));
            expect(returnUrl).toBe(window.location.origin + '/checklist.html?id=busts');
            expect(returnUrl).not.toContain('#');
        });

        it('keeps the query on the preview return URL', () => {
            sync.isPreview = () => true;

            const params = loginFrom('/checklist.html?id=busts');

            expect(JSON.parse(atob(params.get('state'))).returnUrl)
                .toBe(window.location.origin + '/checklist.html?id=busts');
        });

        // The failure this closed: denying authorization returns ?error=...&
        // state=<old> with no code, handleCallback returned before cleaning, and
        // the stale state rode back out to arrive ahead of the fresh one GitHub
        // appends - params.get('state') reads the first, so the retry died on a
        // CSRF mismatch and only self-healed on a third attempt. The allowlist
        // below is what prevents it now; this pins that no OAuth parameter, by
        // any route, reaches redirect_uri.
        it('never sends an OAuth response parameter back out', () => {
            sync.isPreview = () => false;

            const params = loginFrom(
                '/?id=busts&error=access_denied&error_description=no&state=STALE&code=OLD');

            const redirectUri = new URL(params.get('redirect_uri'));
            expect(redirectUri.searchParams.get('id')).toBe('busts');
            for (const p of ['code', 'state', 'error', 'error_description']) {
                expect(redirectUri.searchParams.has(p)).toBe(false);
            }
        });

        // An allowlist, not a denylist: nothing stops a third party handing the
        // owner a link to this site with any query they like, and the sign-in
        // link is one click away on every page. Whatever they put there would
        // otherwise ride into redirect_uri - and if GitHub is strict about extra
        // query parameters, that is a sign-in that keeps failing until the owner
        // notices the address bar.
        it('sends only the checklist id, not whatever else is in the address bar', () => {
            sync.isPreview = () => false;

            const params = loginFrom('/?id=busts&utm_source=x&anything=%3Cscript%3E');

            expect(params.get('redirect_uri'))
                .toBe(window.location.origin + '/?id=busts');
        });

        it('sends a bare callback when there is no id', () => {
            sync.isPreview = () => false;

            const params = loginFrom('/?utm_source=x');

            expect(params.get('redirect_uri')).toBe(window.location.origin + '/');
        });

        it('strips them from the preview return URL too', () => {
            sync.isPreview = () => true;

            const params = loginFrom('/checklist.html?id=busts&state=STALE');

            expect(JSON.parse(atob(params.get('state'))).returnUrl)
                .toBe(window.location.origin + '/checklist.html?id=busts');
        });
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
        // Same discipline as the owner-only block: a leaked stub leaves later
        // tests running on a fake preview flag or a swallowed redirect.
        delete sync.isPreview;
        delete sync._redirect;
        expect(sync.isPreview).toBe(Object.getPrototypeOf(sync).isPreview);
        expect(sync._redirect).toBe(Object.getPrototypeOf(sync)._redirect);
        sessionStorage.clear();
        localStorage.clear();
        sync.token = null;
        sync.user = null;
    });

    const happyFetch = (seen) => async (url) => {
        seen.push(String(url));
        if (String(url).includes('/token')) return { json: async () => ({ access_token: 'tok' }) };
        if (String(url).includes('api.github.com/user')) return { json: async () => ({ login: 'iammike' }) };
        return { ok: true, json: async () => ([{ id: 'g1', files: { 'sports-card-checklists.json': {} } }]) };
    };

    const arrive = async (stateObj) => {
        const state = btoa(JSON.stringify(stateObj));
        window.history.replaceState({}, '', `${window.location.pathname}?code=abc&state=${encodeURIComponent(state)}`);
        return sync.handleCallback();
    };

    // The heart of it: a mismatched CSRF token must not be excused by anything
    // the attacker put in the state.
    it('rejects a mismatched csrf even with a preview-looking returnUrl', async () => {
        // On a preview origin, where the exemption is actually live - otherwise the
        // gate short-circuits on isPreview() and the returnUrl in this test is
        // inert, leaving the attacker-relevant case uncovered.
        sync.isPreview = () => true;
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

    // The simplest unsolicited link there is: ?code= with no state at all. The
    // parse fails, csrf falls to null, and on a fresh tab the stored value is null
    // too - so an equality check alone gives null !== null === false and exchanges
    // the attacker's code. Only !stateData.csrf stops it. This mirrors the same
    // null-vs-null cover the fragment path already has.
    it('rejects a callback with no state parameter on a fresh tab', async () => {
        sessionStorage.clear();
        window.history.replaceState({}, '', `${window.location.pathname}?code=attacker-code`);

        expect(await sync.handleCallback()).toBe(false);
        expect(requests).toEqual([]);
    });

    it('rejects a callback whose csrf is null on a fresh tab', async () => {
        sessionStorage.clear();

        expect(await arrive({ csrf: null, returnUrl: null })).toBe(false);
        expect(requests).toEqual([]);
    });

    // A branch preview begins on <branch>.<project>.pages.dev and lands here on
    // <project>.pages.dev, so sessionStorage is empty and the token cannot be
    // matched. That exemption is deliberate and is why the origin check above
    // carries the weight: it is the only thing deciding who may be handed a token.
    it('exempts a genuine project preview return URL from the csrf check', async () => {
        sync.isPreview = () => true;   // the apex; production is covered below
        sessionStorage.clear();

        await arrive({ csrf: 'unverifiable', returnUrl: 'https://fix-x.sports-card-checklists.pages.dev/' });

        expect(requests.some(u => u.includes('/token'))).toBe(true);
    });

    // The query path's own search IS the OAuth response, so it must go - while
    // anything else in the query must stay. Neither direction was pinned, which is
    // how a helper that preserved the whole query passed.
    //
    // The mixed shape below cannot arise on the query path in production, because
    // login() builds redirect_uri from origin+pathname and drops the search. It is
    // here to pin the helper itself, which the fragment path - where returnUrl does
    // carry the query - genuinely depends on.
    it('strips code and state from the URL but keeps the rest', async () => {
        sessionStorage.setItem('oauth_state', 'match');
        globalThis.fetch = happyFetch([]);
        const state = btoa(JSON.stringify({ csrf: 'match', returnUrl: null }));
        window.history.replaceState({}, '',
            `${window.location.pathname}?id=jayden-daniels&code=abc&state=${encodeURIComponent(state)}`);

        await sync.handleCallback();

        expect(window.location.search).toBe('?id=jayden-daniels');
    });

    it('leaves no query at all when the OAuth response was the whole query', async () => {
        sessionStorage.clear();
        window.history.replaceState({}, '', `${window.location.pathname}?code=abc`);

        await sync.handleCallback();

        expect(window.location.search).toBe('');
    });

    // The nonce is one-time on this path too; the fragment path already covers it.
    it('consumes the stored csrf so a replayed query callback fails', async () => {
        sessionStorage.setItem('oauth_state', 'once');
        globalThis.fetch = happyFetch([]);
        const url = `${window.location.pathname}?code=abc&state=`
            + encodeURIComponent(btoa(JSON.stringify({ csrf: 'once', returnUrl: null })));
        window.history.replaceState({}, '', url);
        expect(await sync.handleCallback()).toBe(true);

        sync.logout();
        requests.length = 0;
        window.history.replaceState({}, '', url);

        expect(await sync.handleCallback()).toBe(false);
        expect(requests).toEqual([]);
    });

    // The exemption is justified only by the apex's empty sessionStorage. On
    // production that reason does not hold: an unsolicited ?code= with a
    // preview-shaped returnUrl must still be refused.
    it('grants no csrf exemption on a production origin', async () => {
        sync.isPreview = () => false;
        sessionStorage.setItem('oauth_state', 'mine');

        const result = await arrive({ csrf: 'forged', returnUrl: 'https://sports-card-checklists.pages.dev/' });

        expect(result).toBe(false);
        expect(requests).toEqual([]);
    });

    // The exploit end to end. Asserting on the return value or on /gists cannot
    // show this: the redirect branch runs AFTER findOrCreateGist and also returns
    // true, so every such assertion holds just as well while the token is being
    // written into evil.example's fragment. Only the redirect itself distinguishes
    // them, so _redirect is a seam we can watch.

    it('never redirects a token to a foreign return URL', async () => {
        // On a preview origin, where a redirect is possible at all - otherwise
        // returnUrl is null for the wrong reason and this proves nothing.
        sync.isPreview = () => true;
        sessionStorage.setItem('oauth_state', 'match');
        const seen = [];
        globalThis.fetch = happyFetch(seen);
        const redirects = [];
        sync._redirect = (url) => redirects.push(url);

        await arrive({ csrf: 'match', returnUrl: 'https://evil.example/?x=.pages.dev' });

        expect(redirects).toEqual([]);
    });

    // The whole hop, end to end: what the sender embeds must be what the receiver
    // accepts. Without this, dropping the csrf from the payload breaks every
    // preview login - silently, and only once deployed.
    it('completes a branch-preview round trip', async () => {
        sync.isPreview = () => true;   // both legs run on preview origins
        const seen = [];
        globalThis.fetch = happyFetch(seen);
        const redirects = [];
        sync._redirect = (url) => redirects.push(url);

        // Leg one, on the apex origin. Its sessionStorage is empty - the branch's
        // copy belongs to another origin - so this leg genuinely exercises the
        // returnUrl exemption, which is what production does here.
        sessionStorage.clear();
        await arrive({ csrf: 'round-trip', returnUrl: 'https://fix-x.sports-card-checklists.pages.dev/' });
        expect(redirects).toHaveLength(1);

        // Leg two, back on the branch origin, whose own sessionStorage still holds
        // the value - a separate store from the apex's, which was just consumed.
        sessionStorage.setItem('oauth_state', 'round-trip');
        sync.token = null;
        window.history.replaceState({}, '', window.location.pathname
            + redirects[0].slice(redirects[0].indexOf('#')));

        expect(await sync.handleCallback()).toBe(true);
        expect(sync.token).toBe('tok');
    });

    it('redirects back to a genuine project preview', async () => {
        sync.isPreview = () => true;
        sessionStorage.setItem('oauth_state', 'match');
        const seen = [];
        globalThis.fetch = happyFetch(seen);
        const redirects = [];
        sync._redirect = (url) => redirects.push(url);

        await arrive({ csrf: 'match', returnUrl: 'https://fix-x.sports-card-checklists.pages.dev/' });

        expect(redirects).toHaveLength(1);
        expect(redirects[0]).toContain('https://fix-x.sports-card-checklists.pages.dev/#auth=');
    });
});

// Not an auth guard but the same function's gate: without it every ordinary page
// load consumes oauth_state and logs a spurious CSRF error, and the #card- deep
// link that _scrollToHashCard reads is cleaned away before it is used.
describe('GitHubSync.handleCallback without an OAuth response', () => {
    afterEach(() => {
        window.history.replaceState({}, '', window.location.pathname);
        sessionStorage.clear();
    });

    it('leaves the URL alone when there is no code', async () => {
        sessionStorage.setItem('oauth_state', 'untouched');
        window.history.replaceState({}, '', `${window.location.pathname}?id=jd#card-abc`);

        expect(await sync.handleCallback()).toBe(false);

        expect(window.location.hash).toBe('#card-abc');
        expect(sessionStorage.getItem('oauth_state')).toBe('untouched');
    });
});

// The `gist` scope is only honest while nothing reaches for a repo endpoint. A
// re-added repo call would fail at runtime against a gist-only token, which is a
// confusing way to find out - this says so at the source instead.
//
// Every surface the token reaches, not just src/: worker.js is the deployment that
// actually receives and forwards it, and is the likeliest home for a future
// "commit this to the repo" endpoint. Same shape as the owner-login guard in
// cross-file-globals.test.js, for the same reason - a file nobody thought to scan
// is how one of these stops guarding.
describe('nothing that holds the token uses a repo endpoint', () => {
    const ROOT = resolve(import.meta.dirname, '..');
    // The manifest is the canonical src list and bundle-file-lists.test.js already
    // pins it against readdirSync, so this inherits that coverage instead of
    // carrying its own magic floor.
    const { sharedFiles, engineFile } = createRequire(import.meta.url)('../build-manifest.js');

    // Both spellings: the literal host string, and a bare /repos path for a call
    // assembled from a base-URL constant. No trailing slash in the pattern -
    // `POST /user/repos` creates a repository and is exactly what this promises to
    // catch, and it has no path segment after it.
    //
    // Whole-line comments are dropped first: a link to docs.github.com/rest/repos
    // in prose would otherwise fail this and name a file with no repo call in it.
    // A doc URL trailing a line of code still trips it - that fails closed, which
    // is the right direction to be wrong in.
    const usesRepoApi = (source) => {
        const code = source.split('\n')
            .filter(line => !/^\s*(\/\/|\*|\/\*|<!--)/.test(line))
            .join('\n');
        return code.includes('api.github.com/repos') || /['"`/]repos\b/.test(code);
    };

    it('finds no repo endpoint in any file that handles the token', () => {
        const bundle = [...sharedFiles, engineFile];
        const pages = readdirSync(ROOT).filter(f => f.endsWith('.html'));
        const scanned = [
            ...bundle.map(f => ['src/' + f, resolve(ROOT, 'src', f)]),
            ['worker.js', resolve(ROOT, 'worker.js')],
            ...pages.map(f => [f, resolve(ROOT, f)]),
        ];
        const offenders = scanned
            .filter(([, path]) => usesRepoApi(readFileSync(path, 'utf-8')))
            .map(([name]) => name);

        // Non-vacuity, without a magic number that a legitimate new file breaks.
        // The size is an identity against what it was built from, so a dropped or
        // duplicated entry fails; the manifest behind `bundle` is itself pinned
        // against readdirSync by bundle-file-lists.test.js, so an empty one cannot
        // quietly shrink this. The named three are the surfaces most likely to be
        // forgotten, which is why they are asserted rather than counted.
        expect(scanned.length).toBe(bundle.length + 1 + pages.length);
        expect(scanned.map(([n]) => n)).toEqual(
            expect.arrayContaining(['worker.js', 'index.html', 'checklist.html']));
        expect(offenders).toEqual([]);
    });
});
