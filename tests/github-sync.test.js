import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// github-sync.js isn't loaded by the shared setup (it instantiates a singleton
// and touches the network), so load it here in isolation to exercise its
// pure-ish error classification logic.
let sync;
beforeAll(() => {
    const code = readFileSync(resolve(import.meta.dirname, '..', 'src', 'github-sync.js'), 'utf-8');
    (0, eval)(code);
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
