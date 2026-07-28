import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// The "Collection Totals" bar used to read "$0 to complete" once every card was
// owned (#666). It now mirrors the per-checklist card: the needed-value line is
// suppressed and the bar picks up the shared .complete treatment.

// updateAggregateStats and the bar's markup are both inline in index.html, which
// tests/setup.js does not load (it only evals src/*.js). Extract the real source
// and evaluate it so this asserts the shipped code rather than a copy. Same trick
// as tests/index-stats-escaping.test.js.
const INDEX_HTML = readFileSync(resolve(import.meta.dirname, '..', 'index.html'), 'utf-8');

function loadUpdateAggregateStats() {
    const marker = 'function updateAggregateStats(allStats, uniqueOwned) {';
    const start = INDEX_HTML.indexOf(marker);
    if (start === -1) throw new Error('updateAggregateStats not found in index.html');

    const bodyStart = INDEX_HTML.indexOf('{', start + marker.length - 1);
    let depth = 0;
    let end = -1;
    for (let i = bodyStart; i < INDEX_HTML.length; i++) {
        if (INDEX_HTML[i] === '{') depth++;
        else if (INDEX_HTML[i] === '}') {
            depth--;
            if (depth === 0) {
                end = i + 1;
                break;
            }
        }
    }
    if (end === -1) throw new Error('unbalanced updateAggregateStats body in index.html');

    // hasAnimatedStats is a module-level `let` in index.html that the function
    // flips on first render. Give each extracted copy its own fresh one so a test
    // can drive the animated path and then the non-animated path.
    return new Function(
        'animateValue',
        `let hasAnimatedStats = false; ${INDEX_HTML.slice(start, end)}; return updateAggregateStats;`,
    );
}

function loadAggregateMarkup() {
    const start = INDEX_HTML.indexOf('<div class="aggregate-stats" id="aggregate-stats"');
    if (start === -1) throw new Error('#aggregate-stats not found in index.html');

    const tags = /<div\b|<\/div>/g;
    tags.lastIndex = start;
    let depth = 0;
    let match;
    while ((match = tags.exec(INDEX_HTML)) !== null) {
        if (match[0] === '</div>') {
            depth--;
            if (depth === 0) return INDEX_HTML.slice(start, match.index + '</div>'.length);
        } else {
            depth++;
        }
    }
    throw new Error('unbalanced #aggregate-stats markup in index.html');
}

const AGGREGATE_MARKUP = loadAggregateMarkup();

let animateCalls;
let updateAggregateStats;

// Stand in for the real animateValue: record the call and write the final value
// straight away, so both update paths can be asserted the same way.
function fakeAnimateValue(element, start, end, duration, prefix = '', suffix = '') {
    animateCalls.push({ id: element.id, end, prefix, suffix });
    element.textContent = prefix + end + suffix;
}

// Run the extracted updater and let the staggered setTimeout callbacks fire.
function update(allStats, uniqueOwned) {
    updateAggregateStats(allStats, uniqueOwned);
    vi.runAllTimers();
}

const bar = () => document.getElementById('aggregate-stats');
const neededLine = () => document.getElementById('agg-needed-value');

beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = AGGREGATE_MARKUP;
    animateCalls = [];
    updateAggregateStats = loadUpdateAggregateStats()(fakeAnimateValue);
});

afterEach(() => {
    vi.useRealTimers();
});

describe('index.html aggregate stats — animated first render', () => {
    it('suppresses the "to complete" line and marks the bar complete when every card is owned', () => {
        update({ a: { owned: 400, total: 400, ownedValue: 9000, neededValue: 0 } });

        expect(neededLine().style.display).toBe('none');
        expect(bar().classList.contains('complete')).toBe(true);
        expect(animateCalls.some(c => c.id === 'agg-needed-value')).toBe(false);
    });

    it('still shows "$X to complete" and no completion state while cards are missing', () => {
        update({ a: { owned: 399, total: 400, ownedValue: 9000, neededValue: 120 } });

        expect(neededLine().style.display).not.toBe('none');
        expect(neededLine().textContent).toBe('$120 to complete');
        expect(bar().classList.contains('complete')).toBe(false);
    });

    it('does not report complete when the checklists hold no cards at all', () => {
        update({ a: { owned: 0, total: 0, ownedValue: 0, neededValue: 0 } });

        expect(bar().classList.contains('complete')).toBe(false);
        expect(neededLine().style.display).not.toBe('none');
    });

    it('leaves the bar hidden and incomplete when no checklist has stats', () => {
        update({ a: null, b: null });

        expect(bar().style.display).toBe('none');
        expect(bar().classList.contains('complete')).toBe(false);
    });

    it('carries a checkmark that the .complete class reveals', () => {
        // CSS keeps the checkmark hidden until the bar is complete, so the class
        // above is what shows it. Assert the element the rule targets is really
        // in the bar's markup.
        update({ a: { owned: 400, total: 400, ownedValue: 9000, neededValue: 0 } });

        const check = bar().querySelector('.aggregate-complete-check');
        expect(check).not.toBeNull();
        expect(check.textContent).toBe('✓');
    });

    it('gives the checkmark an accessible name, since the glyph carries meaning', () => {
        // A bare ✓ announces as nothing useful, so it needs a name and a role
        // saying it stands for something. The display:none rule keeps it out of
        // the accessibility tree until the collection really is complete
        // (verified in Chrome - jsdom builds no accessibility tree to assert on).
        update({ a: { owned: 400, total: 400, ownedValue: 9000, neededValue: 0 } });

        const check = bar().querySelector('.aggregate-complete-check');
        expect(check.getAttribute('role')).toBe('img');
        expect(check.getAttribute('aria-label')).toBe('Collection complete');
    });

    it('uses the de-duplicated owned count when deciding completeness', () => {
        // The summed stats look short, but the live figure says everything is owned.
        update(
            { a: { owned: 380, total: 400, ownedValue: 8000, neededValue: 300 } },
            { count: 400, value: 9000 },
        );

        expect(bar().classList.contains('complete')).toBe(true);
        expect(neededLine().style.display).toBe('none');
    });
});

describe('index.html aggregate stats — non-animated update path', () => {
    it('suppresses the line and marks the bar complete when a data change finishes the collection', () => {
        update({ a: { owned: 399, total: 400, ownedValue: 9000, neededValue: 120 } });
        update({ a: { owned: 400, total: 400, ownedValue: 9120, neededValue: 0 } });

        expect(neededLine().style.display).toBe('none');
        expect(bar().classList.contains('complete')).toBe(true);
        expect(neededLine().textContent).not.toContain('$0 to complete');
        expect(document.getElementById('agg-owned').textContent).toBe('400');
    });

    it('restores the line and clears the completion state when a card is un-owned again', () => {
        update({ a: { owned: 400, total: 400, ownedValue: 9120, neededValue: 0 } });
        update({ a: { owned: 399, total: 400, ownedValue: 9000, neededValue: 120 } });

        expect(neededLine().style.display).not.toBe('none');
        expect(neededLine().textContent).toBe('$120 to complete');
        expect(bar().classList.contains('complete')).toBe(false);
    });
});
