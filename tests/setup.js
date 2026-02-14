import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load shared.js into the jsdom global context so tests can access
// CardRenderer, sanitizeText, sanitizeUrl, etc.
const sharedPath = resolve(import.meta.dirname, '..', 'shared.js');
const sharedCode = readFileSync(sharedPath, 'utf-8');

// shared.js expects browser globals; jsdom provides document/window.
// Stub APIs that jsdom doesn't provide.
globalThis.navigator.vibrate = () => {};
globalThis.performance = globalThis.performance || { now: () => Date.now() };

// Use indirect eval so declarations land in global scope (not a local function scope).
// This makes sanitizeText, sanitizeUrl, etc. accessible to tests.
(0, eval)(sharedCode);
