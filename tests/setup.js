import { afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';

// shared.js expects browser globals; jsdom provides document/window.
// Stub APIs that jsdom doesn't provide.
globalThis.navigator.vibrate = () => {};
globalThis.performance = globalThis.performance || { now: () => Date.now() };

// No test may reach the network. This matters more now that github-sync.js is in the
// list below: window.githubSync is a real GitHubSync, and loadPublicData /
// loadPublicStats fetch the *production* gist without needing a token. A stray path
// that used to die on `!window.githubSync` would otherwise quietly hit api.github.com.
//
// Throwing alone would not be enough, which is what the array is for: every fetch in
// github-sync.js sits inside a try/catch that logs and returns null, so the thrown
// error is swallowed and the call just looks like an empty response. Recording the
// attempt and failing afterEach makes it unswallowable.
//
// A test that legitimately needs fetch assigns its own globalThis.fetch and never
// reaches this one; restoring the previous value afterwards puts the tripwire back.
const attemptedRequests = [];
globalThis.fetch = (input) => {
    const url = String(input && input.url ? input.url : input);
    attemptedRequests.push(url);
    throw new Error(`tests must not make network calls (attempted ${url})`);
};

// Returns the attempts since the last call, and clears them. Exported so
// no-network.test.js can assert the tripwire is armed without tripping it.
export function takeAttemptedRequests() {
    return attemptedRequests.splice(0);
}

afterEach(() => {
    const attempted = takeAttemptedRequests();
    if (attempted.length) {
        throw new Error(
            'test attempted a network call; stub fetch for this path instead:\n  '
            + attempted.join('\n  '),
        );
    }
});

// Load all shared modules into the jsdom global context so tests can access
// CardRenderer, sanitizeText, sanitizeUrl, etc.
// Use indirect eval so declarations land in global scope (not a local function scope).
//
// The list comes from build-manifest.js, the same source build.js uses, rather
// than being copied here - a test run that loads a different set of files than the
// browser gets is testing a scope that does not ship. github-sync.js used to be
// missing from this list, which meant the cross-file globals guard (#712) could not
// resolve anything declared in it: a symbol there that was exported correctly would
// still have failed that guard, and the only available fix would have been to load
// the file here.
//
// checklist-engine.js is appended because build.js emits it as a *separate* bundle
// that checklist.html loads on its own. It shares no scope with the concatenation at
// runtime, so loading it alongside is a small infidelity, but tests exercise both
// and nothing in either relies on the other being absent.
const { sharedFiles, engineFile } = createRequire(import.meta.url)('../build-manifest.js');

export const files = [...sharedFiles, engineFile];

for (const file of files) {
    const code = readFileSync(resolve(import.meta.dirname, '..', 'src', file), 'utf-8');
    (0, eval)(code);
}
