import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';

import { files as setupFiles } from './setup.js';

// build.js and tests/setup.js once carried separate copies of the src/ load order,
// and they had drifted: github-sync.js was in the bundle but not in the test run
// (#713). Both now read build-manifest.js, so that particular pair cannot diverge
// again. What can still diverge is src/ itself against the manifest, and setup.js
// against the manifest if someone re-inlines the list. This covers both.
//
// Note this compares *data* - arrays of filenames, and which globals the loaded
// files actually published - rather than asserting on the text of the source, which
// is the pattern #711 removed.

const ROOT = resolve(import.meta.dirname, '..');
const SRC = resolve(ROOT, 'src');
const { sharedFiles, engineFile } = createRequire(import.meta.url)('../build-manifest.js');

// The two bundles build.js emits. They are deliberately different things:
// sharedFiles are concatenated into dist/app.min.js and so share one scope, while
// engineFile becomes dist/checklist-engine.min.js, a script checklist.html loads by
// itself. setup.js loads both because tests exercise both.
const bundled = [...sharedFiles, engineFile];

describe('bundle file lists', () => {
    // An unbundled src file is dead code that ships to nobody. The reverse - a
    // manifest entry with no file behind it - in practice takes the whole run down
    // first, since setup.js reads each listed file; this is the assertion that names
    // it if it somehow gets this far.
    it('covers every file in src/, and only files in src/', () => {
        const onDisk = readdirSync(SRC).filter(f => f.endsWith('.js')).sort();
        expect([...bundled].sort()).toEqual(onDisk);
    });

    // Trivially true while setup.js derives its list from the manifest. It exists so
    // that re-inlining the list there fails here instead of silently shrinking what
    // the suite loads, which is how #713 happened. Reordering the manifest is not
    // drift and is not caught here: both consumers move together, by construction.
    it('is the same list tests/setup.js loads, in the same order', () => {
        expect(setupFiles).toEqual(bundled);
    });
});

// Column-0 `window.X =`, which is how every src file publishes its globals. Anchored
// at column 0 so an assignment inside a function or a comment is not picked up.
function windowExports(file) {
    const code = readFileSync(resolve(SRC, file), 'utf-8');
    return [...code.matchAll(/^window\.([A-Za-z_$][\w$]*)\s*=/gm)].map(m => m[1]);
}

describe('the shared setup actually loads each bundled file', () => {
    // Asserting on the file list alone would not notice a file that is listed but
    // fails to eval, so check the observable result: something each file publishes is
    // on window. github-sync.js is the reason this is here - it was the file missing
    // from setup.js, so window.githubSync was absent for every test.
    const expectations = bundled.map(file => [file, windowExports(file)]);

    it.each(expectations)('%s publishes at least one global to key off', (_file, exports) => {
        // Guards the check below from passing vacuously for a file with no matches.
        expect(exports.length).toBeGreaterThan(0);
    });

    it.each(expectations)('%s is loaded (its globals resolve)', (_file, exports) => {
        expect(exports.filter(name => !(name in globalThis.window))).toEqual([]);
    });
});
