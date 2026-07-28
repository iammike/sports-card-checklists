import { describe, it, expect } from 'vitest';

import { takeAttemptedRequests } from './setup.js';

// tests/setup.js replaces fetch with a tripwire, because window.githubSync is now a
// real GitHubSync (#713) whose loadPublicData/loadPublicStats fetch the production
// gist with no token required. Without this file, deleting that tripwire would leave
// the suite green and the guard silently gone.

describe('the no-network tripwire', () => {
    it('refuses a request and names the URL', () => {
        expect(() => fetch('https://api.github.com/gists/example'))
            .toThrow(/must not make network calls.*api\.github\.com\/gists\/example/);

        // Also drains the record, so the afterEach hook in setup.js does not fail
        // this test for the call it was just asked to make.
        expect(takeAttemptedRequests()).toEqual(['https://api.github.com/gists/example']);
    });

    it('records the attempt even when the caller swallows the error', async () => {
        // The reason setup.js records attempts rather than only throwing: every fetch
        // in github-sync.js sits in a try/catch that logs and returns null, so the
        // throw alone vanishes and the call reads as an empty response. This asserts
        // the swallowing really happens - if it ever stops, throwing would be enough
        // and the record could go.
        const stats = await globalThis.window.githubSync.loadPublicStats();
        expect(stats).toEqual({});

        expect(takeAttemptedRequests()).toHaveLength(1);
    });

    // These two run in order and are a pair: the first deliberately leaves fetch
    // clobbered so the second can prove setup.js re-arms it. Keep them adjacent, and
    // keep the first one's missing restore - it is the point, not an oversight.
    it('lets a test install its own fetch', async () => {
        globalThis.fetch = async () => ({ ok: true, json: async () => ({ hello: 'world' }) });

        // Awaited rather than `expect(() => fetch(...)).not.toThrow()`, which only
        // catches a synchronous throw: an async stub always returns a Promise, so that
        // form passes even when the stub rejects and proves nothing.
        await expect(fetch('https://example.test/allowed')).resolves.toMatchObject({ ok: true });
        expect(takeAttemptedRequests()).toEqual([]);

        // Deliberately not restoring globalThis.fetch.
    });

    it('re-arms itself after a test that clobbered fetch without restoring', () => {
        expect(() => fetch('https://example.test/blocked'))
            .toThrow(/must not make network calls/);

        takeAttemptedRequests();
    });
});
