// Shared extract-and-evaluate helpers for the inline code in index.html, used by
// tests/index-a11y.test.js and tests/index-filter-coverage.test.js.
//
// Not named *.test.js, so vitest's default include does not collect it as a suite.
//
// index.html is a page, not a module: the card builder and the filter logic are
// inline <script> and tests/setup.js does not load them (it only evals src/*.js).
// Rather than restate either in a test, these helpers slice the real source out of
// the shipped file and evaluate it, so a test asserts what the page actually does.
//
// One copy rather than one per file on purpose - the same reasoning as
// tests/dom-helpers.js. The balanced-brace scanning below is fiddly enough that
// two copies would drift, and a slicer that silently grabs the wrong span still
// produces a passing suite.
//
// Being shared raises the stakes: a silent-failure path here would reach every
// index.html suite at once. The failure modes are pinned in
// tests/index-source.test.js - run those after changing anything below, since a
// slicer that quietly stops slicing correctly reports success everywhere.

import { readFileSync } from 'fs';
import { resolve } from 'path';

export const INDEX_HTML = readFileSync(resolve(import.meta.dirname, '..', 'index.html'), 'utf-8');

// Bounds of the balanced {...} block opening at or after `from` in `source`.
//
// What this guarantees: it either returns a span whose braces balance, or it
// throws naming the offset. It never returns a span it is unsure of. Both throws
// matter - before the guard below, a `from` with no brace after it left indexOf
// returning -1, the scan started at i = -1 and locked onto the *first* brace in
// the whole file, and the caller got a plausible-looking span that sliced to the
// empty string (#718). Silence was the bug, not the wrong answer.
//
// What it does not do: skip braces inside string literals, template literals,
// regexes or comments - it is a brace counter, not a parser. Measured, with each
// case pinned in tests/index-source.test.js:
//
//   - a stray `}` truncates the span, and does NOT throw. This is the one case it
//     can still get wrong. In practice the truncation lands mid-token, so the
//     consumer's `new Function` reports an unterminated string rather than a
//     silent pass - but that is the consumer catching it, not this function.
//   - a stray `{` only mis-slices if a surplus bare `}` appears later to absorb
//     it. index.html is brace-balanced, so there is none: depth never returns to
//     zero, the scan runs to the end and throws.
//
// So a mis-slice is caught downstream, not here: every span taken from this file
// is immediately compiled by `new Function` or parsed as markup. That safety
// belongs to the callers - keep it that way when adding one, and do not add a
// consumer that merely eyeballs the slice.
//
// `source` is a parameter rather than a closure over INDEX_HTML so the failure
// modes above can be tested on synthetic input instead of only on the real page.
export function balancedBlock(source, from, label = 'index.html') {
    const bodyStart = source.indexOf('{', from);
    if (bodyStart === -1) {
        throw new Error(
            `no '{' at or after offset ${from} in ${label}, so there is no block to extract; `
            + `text there: ${JSON.stringify(source.slice(from, from + 60))}`,
        );
    }

    let depth = 0;
    for (let i = bodyStart; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}' && --depth === 0) return { bodyStart, end: i + 1 };
    }
    throw new Error(
        `unbalanced block opening at offset ${bodyStart} in ${label}: `
        + `${depth} brace(s) still open at end of input`,
    );
}

export function sourceOf(marker) {
    const start = INDEX_HTML.indexOf(marker);
    if (start === -1) throw new Error(`${marker} not found in index.html`);
    return { start, ...balancedBlock(INDEX_HTML, start + marker.length - 1) };
}

// The element opened by `startTag`, up to its matching </div>.
export function markupOf(startTag) {
    const start = INDEX_HTML.indexOf(startTag);
    if (start === -1) throw new Error(`${startTag} not found in index.html`);

    const tags = /<div\b|<\/div>/g;
    tags.lastIndex = start;
    let depth = 0;
    let match;
    while ((match = tags.exec(INDEX_HTML)) !== null) {
        if (match[0] === '</div>') {
            if (--depth === 0) return INDEX_HTML.slice(start, match.index + '</div>'.length);
        } else {
            depth++;
        }
    }
    throw new Error(`unbalanced ${startTag} markup in index.html`);
}

export const FILTER_BAR_MARKUP = markupOf('<div class="checklist-filter-bar"');
export const GRID_MARKUP = markupOf('<div class="checklist-grid">');

// Matches the r="20" circle in the card's SVG, as index.html's own constant does.
export const CIRCUMFERENCE = 2 * Math.PI * 20;

const buildRenderCard = (() => {
    const { bodyStart, end } = sourceOf('dynamicEntries.forEach(entry => {');
    return new Function(
        'allGistStats',
        'PROGRESS_RING_CIRCUMFERENCE',
        'grid',
        'dynamicStats',
        'configs',
        'sanitizeText',
        'isSafeColor',
        `return (entry) => ${INDEX_HTML.slice(bodyStart, end)};`,
    );
})();

export const loadInitChecklistFilters = () => {
    const { start, end } = sourceOf('function initChecklistFilters() {');
    return new Function(`${INDEX_HTML.slice(start, end)}; return initChecklistFilters;`)();
};

// Render one registry entry through the real card builder and hand back the card.
// The sanitize helpers come off globalThis at call time, not module load: setup.js
// evals src/*.js before test modules, but reading them lazily keeps this module
// importable regardless of that ordering.
export function renderCard(entry, stats, grid = document.createElement('div'), config = null) {
    buildRenderCard(
        { [entry.id]: stats },
        CIRCUMFERENCE,
        grid,
        {},
        { [entry.id]: config },
        globalThis.sanitizeText,
        globalThis.isSafeColor,
    )(entry);
    return grid.querySelector('.checklist-card:last-of-type');
}
