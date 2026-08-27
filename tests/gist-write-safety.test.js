import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';

// #768: every write that PATCHes the collection file first *reads* it, then
// merges. The read returning null used to mean two different things - "this gist
// has no collection yet" and "the read failed" - and the writers assumed the
// first, so a single transient error PATCHed a blank collection over the real
// one. Worse, a 403 was classified as expired auth without checking for a rate
// limit first, so a throttled read fell back to the *public* gist and the
// writers copied a different collection over the user's own.

const GIST_FILENAME = 'sports-card-checklists.json';
const PERSONAL_GIST = 'personal-gist-id';

let sync;
beforeAll(() => {
    sync = globalThis.window.githubSync;
});

describe('GitHubSync — a failed collection read must not become a blank write (#768)', () => {
    const realFetch = globalThis.fetch;
    let calls;

    beforeEach(() => {
        calls = [];
        sync.token = 'tok';
        sync.gistId = PERSONAL_GIST;
        sync.clearDataCache();
        sync.clearGistCache();
        sync._saveQueue = Promise.resolve();
        // Skip _patchGist's inter-write spacing; a zero epoch reads as "the last
        // write was long ago", so the queue never sleeps out the real 1s gap.
        sync._lastWriteAt = 0;
    });

    afterEach(() => {
        globalThis.fetch = realFetch;
        sync.token = null;
        sync.gistId = null;
        sync.clearDataCache();
        sync.clearGistCache();
        sync._saveQueue = Promise.resolve();
        localStorage.clear();
    });

    // Records every request so a test can assert on what was *not* sent.
    function stubFetch(handler) {
        globalThis.fetch = async (url, opts = {}) => {
            calls.push({ url: String(url), method: opts.method || 'GET', body: opts.body });
            return handler(String(url), opts);
        };
    }

    const patches = () => calls.filter(c => c.method === 'PATCH');

    function gistResponse(collection) {
        const files = collection === null
            ? {}
            : { [GIST_FILENAME]: { content: JSON.stringify(collection) } };
        return { ok: true, status: 200, json: async () => ({ id: PERSONAL_GIST, files }) };
    }

    function errorResponse(status, headers = {}, body = '') {
        const lower = {};
        for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
        return {
            ok: false,
            status,
            headers: { get: k => (k.toLowerCase() in lower ? lower[k.toLowerCase()] : null) },
            clone: () => ({ text: async () => body }),
            json: async () => ({}),
        };
    }

    it('aborts saveChecklist instead of PATCHing a blank collection when the read 500s', async () => {
        stubFetch(() => errorResponse(500));

        expect(await sync.saveChecklist('jd', ['a', 'b'])).toBe(false);
        expect(patches()).toHaveLength(0);
    });

    it('aborts saveChecklist when the read fails at the network layer', async () => {
        stubFetch(() => { throw new TypeError('Failed to fetch'); });

        expect(await sync.saveChecklist('jd', ['a', 'b'])).toBe(false);
        expect(patches()).toHaveLength(0);
    });

    // The write path takes no fallback at all: a payload must be built on the
    // authenticated read it actually got, or not built. (The read path is
    // different - see the loadData tests below, where the public fallback is an
    // unauthenticated read of this very gist and worth keeping.)
    it('takes no fallback read when building a write payload', async () => {
        stubFetch(() => errorResponse(403, { 'Retry-After': '60' }));

        expect(await sync.saveChecklist('jd', ['a'])).toBe(false);
        expect(patches()).toHaveLength(0);
        // One GET, to the personal gist. No second read of any other gist.
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toContain(PERSONAL_GIST);
    });

    // loadData's contract is unchanged, and deliberately so. The public gist is
    // the same collection read without a token, so falling back beats handing
    // loadChecklist() an empty list - loadOwned() cannot tell that from
    // "nothing owned" and would report it as Synced, after which the next
    // toggle would write that truncated list back.
    it('still falls back to public data on a rate-limited 403', async () => {
        const publicCollection = { checklists: { jd: ['real', 'cards'] } };
        stubFetch((url) => (url.includes(PERSONAL_GIST)
            ? errorResponse(403, { 'X-RateLimit-Remaining': '0' })
            : gistResponse(publicCollection)));

        expect(await sync.loadData()).toEqual(publicCollection);
        expect(await sync.loadChecklist('jd')).toEqual(['real', 'cards']);
    });

    it('still falls back to public data on a genuine 401', async () => {
        const publicCollection = { checklists: { jd: ['pub'] } };
        stubFetch((url) => (url.includes(PERSONAL_GIST)
            ? errorResponse(401, {}, 'Bad credentials')
            : gistResponse(publicCollection)));

        expect(await sync.loadData()).toEqual(publicCollection);
        expect(calls).toHaveLength(2);
        expect(calls[1].url).not.toContain(PERSONAL_GIST);
    });

    // The first-save path must survive the new strictness: a gist that exists
    // but carries no collection file yet is writable, not a failed read.
    it('still seeds a collection when the gist has no collection file yet', async () => {
        stubFetch((url, opts) => (opts.method === 'PATCH'
            ? { ok: true, status: 200, json: async () => ({}) }
            : gistResponse(null)));

        expect(await sync.saveChecklist('jd', ['a'])).toBe(true);
        expect(patches()).toHaveLength(1);

        const written = JSON.parse(JSON.parse(patches()[0].body).files[GIST_FILENAME].content);
        expect(written.checklists.jd).toEqual(['a']);
    });

    it('preserves the other checklists it read back', async () => {
        stubFetch((url, opts) => (opts.method === 'PATCH'
            ? { ok: true, status: 200, json: async () => ({}) }
            : gistResponse({ checklists: { wqb: ['keep'] }, stats: { wqb: { owned: 1 } } })));

        expect(await sync.saveChecklist('jd', ['a'])).toBe(true);

        const written = JSON.parse(JSON.parse(patches()[0].body).files[GIST_FILENAME].content);
        expect(written.checklists.wqb).toEqual(['keep']);
        expect(written.checklists.jd).toEqual(['a']);
        expect(written.stats.wqb).toEqual({ owned: 1 });
    });

    // Reached only when there is no gist id yet - every other test here sets
    // one in beforeEach, so this branch of _loadDataForWrite was untested.
    it('creates the gist first when there is none, then builds on what it reads', async () => {
        sync.gistId = null;
        localStorage.clear();
        stubFetch((url, opts) => {
            if (opts.method === 'PATCH') return { ok: true, status: 200, json: async () => ({}) };
            if (opts.method === 'POST') {
                return { ok: true, status: 201, json: async () => ({ id: 'made-up-gist' }) };
            }
            if (url.endsWith('/gists')) return { ok: true, status: 200, json: async () => [] };
            return gistResponse({ checklists: { wqb: ['keep'] } });
        });

        expect(await sync.saveChecklist('jd', ['a'])).toBe(true);

        const written = JSON.parse(JSON.parse(patches()[0].body).files[GIST_FILENAME].content);
        expect(written.checklists.jd).toEqual(['a']);
        expect(written.checklists.wqb).toEqual(['keep']);
    });

    // findOrCreateGist is documented as returning null, never throwing, and one
    // caller runs un-awaited - GitHub answers an error with an object, not the
    // array the listing loop expects (#767).
    it('aborts rather than throwing when the gist listing fails', async () => {
        sync.gistId = null;
        localStorage.clear();
        stubFetch(() => ({
            ok: false,
            status: 500,
            headers: { get: () => null },
            clone: () => ({ text: async () => '' }),
            json: async () => ({ message: 'Server Error' }),
        }));

        expect(await sync.saveChecklist('jd', ['a'])).toBe(false);
        expect(patches()).toHaveLength(0);
    });

    // saveCardData has its own gist-id path, and it must report a reason: the
    // engine's noRetry() check reads an undefined reason as retryable.
    it('reports no_gist rather than a bare false when the listing fails', async () => {
        sync.gistId = null;
        localStorage.clear();
        stubFetch(() => ({
            ok: false,
            status: 500,
            headers: { get: () => null },
            clone: () => ({ text: async () => '' }),
            json: async () => ({ message: 'Server Error' }),
        }));

        expect(await sync.saveCardData('jd', [{ set: 'x' }], { owned: 1 }))
            .toEqual({ ok: false, reason: 'no_gist' });
        expect(await sync.saveCardData('jd', [{ set: 'x' }]))
            .toEqual({ ok: false, reason: 'no_gist' });
        expect(patches()).toHaveLength(0);
    });

    // Copilot review: the listing and create fetches were bare awaits, so a
    // network-layer rejection escaped a method every caller treats as
    // non-throwing - the same contract violation #767 is about.
    it('returns null rather than throwing when the gist listing rejects', async () => {
        sync.gistId = null;
        localStorage.clear();
        stubFetch(() => { throw new TypeError('Failed to fetch'); });

        await expect(sync.findOrCreateGist()).resolves.toBeNull();
        expect(await sync.saveChecklist('jd', ['a'])).toBe(false);
        expect(patches()).toHaveLength(0);
    });

    it('returns null rather than throwing when gist creation rejects', async () => {
        sync.gistId = null;
        localStorage.clear();
        stubFetch((url, opts) => {
            if (opts.method === 'POST') throw new TypeError('Failed to fetch');
            return { ok: true, status: 200, json: async () => [] };
        });

        await expect(sync.findOrCreateGist()).resolves.toBeNull();
    });

    it('returns null rather than throwing when the listing body will not parse', async () => {
        sync.gistId = null;
        localStorage.clear();
        stubFetch(() => ({
            ok: true,
            status: 200,
            json: async () => { throw new SyntaxError('Unexpected token <'); },
        }));

        await expect(sync.findOrCreateGist()).resolves.toBeNull();
    });

    // A missing gist id and a missing token are different problems; from the
    // write path only the first is reachable, and it means findOrCreateGist failed.
    it('separates "no gist" from "not authenticated"', async () => {
        sync.gistId = null;
        expect(await sync._readCollectionData()).toEqual({ ok: false, reason: 'no_gist' });

        sync.token = null;
        expect(await sync._readCollectionData()).toEqual({ ok: false, reason: 'not_authenticated' });
    });

    // Copilot review: valid JSON is not necessarily a collection. An array got
    // past saveChecklist's `if (!data.checklists)` guard, then JSON.stringify
    // dropped the properties we had just set - a silent write of nothing.
    it('refuses to build a write on a collection file that is not an object', async () => {
        for (const bad of ['[]', '[1,2,3]', '"hello"', '42', 'true']) {
            sync.clearDataCache();
            calls = [];
            stubFetch((url, opts) => (opts.method === 'PATCH'
                ? { ok: true, status: 200, json: async () => ({}) }
                : { ok: true, status: 200, json: async () => ({ files: { [GIST_FILENAME]: { content: bad } } }) }));

            expect(await sync.saveChecklist('jd', ['a'])).toBe(false);
            expect(patches(), `wrote on top of ${bad}`).toHaveLength(0);
        }
    });

    it('refuses to build a write on a collection file that will not parse', async () => {
        stubFetch(() => ({
            ok: true,
            status: 200,
            json: async () => ({ files: { [GIST_FILENAME]: { content: '{not json' } } }),
        }));

        expect(await sync.saveChecklist('jd', ['a'])).toBe(false);
        expect(patches()).toHaveLength(0);
    });

    // Copilot review: logout() clears the stored gist id, so a freshly signed-in
    // owner creating their first checklist has none. That is the first-create
    // case, not a failed read, and it was being reported as a connection problem.
    it('creates the gist first when the registry read finds no gist id', async () => {
        sync.gistId = null;
        localStorage.clear();
        stubFetch((url, opts) => {
            if (opts.method === 'POST') {
                return { ok: true, status: 201, json: async () => ({ id: 'made-up-gist' }) };
            }
            if (url.endsWith('/gists')) return { ok: true, status: 200, json: async () => [] };
            return { ok: true, status: 200, json: async () => ({ files: {} }) };
        });

        expect(await sync.loadRegistryForWrite()).toEqual({ ok: true, registry: { checklists: [] } });
    });

    it('still reports a failed registry read when the gist cannot be created', async () => {
        sync.gistId = null;
        localStorage.clear();
        stubFetch(() => { throw new TypeError('Failed to fetch'); });

        expect(await sync.loadRegistryForWrite()).toEqual({ ok: false, reason: 'read_failed' });
    });

    // Copilot review: `!content` treated a present-but-empty file the same as an
    // absent one, so the write path would seed over it. Whitespace-only content
    // already reported malformed, via the parse; the empty string did not.
    it('treats a blank collection file as malformed, not as an absent one', async () => {
        stubFetch((url, opts) => (opts.method === 'PATCH'
            ? { ok: true, status: 200, json: async () => ({}) }
            : { ok: true, status: 200, json: async () => ({ files: { [GIST_FILENAME]: { content: '' } } }) }));

        expect(await sync.saveChecklist('jd', ['a'])).toBe(false);
        expect(patches()).toHaveLength(0);
    });

    it('treats a blank registry file as malformed, not as an absent one', async () => {
        stubFetch(() => ({
            ok: true,
            status: 200,
            json: async () => ({ files: { 'checklists-registry.json': { content: '' } } }),
        }));

        expect(await sync.loadRegistryForWrite()).toEqual({ ok: false, reason: 'malformed' });
    });

    // Still seedable when the file genuinely is not there.
    it('still seeds a registry when the file is absent', async () => {
        stubFetch(() => ({ ok: true, status: 200, json: async () => ({ files: {} }) }));

        expect(await sync.loadRegistryForWrite()).toEqual({ ok: true, registry: { checklists: [] } });
    });

    it('aborts saveChecklistStats on a failed read', async () => {
        stubFetch(() => errorResponse(500));

        expect(await sync.saveChecklistStats('jd', { owned: 3 })).toBe(false);
        expect(patches()).toHaveLength(0);
    });

    // saveCardData is the one writer that should still go through: the card data
    // is the point of the call, the bundled stats are an optimisation. It drops
    // the collection file from the PATCH rather than writing a blank one.
    it('still writes card data when the bundled stats read fails, without the collection file', async () => {
        stubFetch((url, opts) => (opts.method === 'PATCH'
            ? { ok: true, status: 200, json: async () => ({}) }
            : errorResponse(500)));

        const result = await sync.saveCardData('jd', [{ set: 'x' }], { owned: 3 });
        expect(result.ok).toBe(true);

        const files = JSON.parse(patches()[0].body).files;
        expect(Object.keys(files)).toEqual(['jd-cards.json']);
        expect(files[GIST_FILENAME]).toBeUndefined();
    });

    // A doomed or pressure-adding PATCH is reported instead of being fired.
    it('reports the reason instead of writing when the stats read hits a dead session', async () => {
        stubFetch(() => errorResponse(401, {}, 'Bad credentials'));

        const result = await sync.saveCardData('jd', [{ set: 'x' }], { owned: 3 });
        expect(result).toEqual({ ok: false, reason: 'auth_expired' });
        expect(patches()).toHaveLength(0);
    });

    it('reports the reason instead of writing when the stats read is rate limited', async () => {
        stubFetch(() => errorResponse(403, { 'Retry-After': '60' }));

        const result = await sync.saveCardData('jd', [{ set: 'x' }], { owned: 3 });
        expect(result).toEqual({ ok: false, reason: 'rate_limited' });
        expect(patches()).toHaveLength(0);
    });

    // The read-only contract, pinned rather than asserted by inspection.
    it('leaves the read-only helpers reading through unchanged', async () => {
        stubFetch(() => gistResponse({ checklists: { jd: ['a'] }, stats: { jd: { owned: 1 } } }));

        expect(await sync.loadChecklist('jd')).toEqual(['a']);
        expect(await sync.loadAllStats()).toEqual({ jd: { owned: 1 } });
        expect(await sync.loadChecklist('missing')).toEqual([]);
    });
});
