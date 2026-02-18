import { readFileSync } from 'fs';
import { resolve } from 'path';

// shared.js expects browser globals; jsdom provides document/window.
// Stub APIs that jsdom doesn't provide.
globalThis.navigator.vibrate = () => {};
globalThis.performance = globalThis.performance || { now: () => Date.now() };

// Load all shared modules into the jsdom global context so tests can access
// CardRenderer, sanitizeText, sanitizeUrl, etc.
// Use indirect eval so declarations land in global scope (not a local function scope).
const files = [
    'shared.js',
    'collapsible-sections.js',
    'card-renderer.js',
    'checklist-manager.js',
    'image-editor.js',
    'card-editor.js',
    'shopping-list.js',
    'nav.js',
    'checklist-creator.js',
];

for (const file of files) {
    const code = readFileSync(resolve(import.meta.dirname, '..', 'src', file), 'utf-8');
    (0, eval)(code);
}
