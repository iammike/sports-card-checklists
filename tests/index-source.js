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

import { readFileSync } from 'fs';
import { resolve } from 'path';

export const INDEX_HTML = readFileSync(resolve(import.meta.dirname, '..', 'index.html'), 'utf-8');

// Bounds of the balanced {...} block opening at or after `from`.
function balancedBlock(from) {
    const bodyStart = INDEX_HTML.indexOf('{', from);
    let depth = 0;
    for (let i = bodyStart; i < INDEX_HTML.length; i++) {
        if (INDEX_HTML[i] === '{') depth++;
        else if (INDEX_HTML[i] === '}' && --depth === 0) return { bodyStart, end: i + 1 };
    }
    throw new Error('unbalanced block in index.html');
}

export function sourceOf(marker) {
    const start = INDEX_HTML.indexOf(marker);
    if (start === -1) throw new Error(`${marker} not found in index.html`);
    return { start, ...balancedBlock(start + marker.length - 1) };
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
export function renderCard(entry, stats, grid = document.createElement('div')) {
    buildRenderCard(
        { [entry.id]: stats },
        CIRCUMFERENCE,
        grid,
        {},
        globalThis.sanitizeText,
        globalThis.isSafeColor,
    )(entry);
    return grid.querySelector('.checklist-card:last-of-type');
}
