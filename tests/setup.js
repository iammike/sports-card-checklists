import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';

// shared.js expects browser globals; jsdom provides document/window.
// Stub APIs that jsdom doesn't provide.
globalThis.navigator.vibrate = () => {};
globalThis.performance = globalThis.performance || { now: () => Date.now() };

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
