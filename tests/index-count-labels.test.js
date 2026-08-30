import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { renderCard, sourceOf } from './index-source.js';

// #779: with checklists naming their own counts ("Target Cards", "Main Cards"),
// the index was the last surface calling those numbers plain "cards" - and its
// aggregate called a sum that leaves cards out "Total Cards".

const INDEX_HTML = readFileSync(resolve(import.meta.dirname, '..', 'index.html'), 'utf-8');

const STATS = { owned: 45, total: 60, ownedValue: 1200, neededValue: 210 };
const ENTRY = { id: 'jd', type: 'dynamic', title: 'Jayden Daniels', navLabel: 'JD' };
const SPLIT = { totalLabel: 'Target Cards', categories: [{ id: 'base' }, { id: 'x', isMain: false }] };
const WHOLE = { categories: [{ id: 'base' }, { id: 'more' }] };

const countText = card => card.querySelector('.progress-main-text').textContent.trim().replace(/\s+/g, ' ');

describe('index card — the count says what it counts (#779)', () => {
    it("borrows the checklist's own label when the count leaves cards out", () => {
        expect(countText(renderCard(ENTRY, STATS, undefined, SPLIT)))
            .toBe('45 of 60 target cards');
    });

    // "45 of 60 total cards" would be noise: nothing is excluded, so "cards"
    // is already the honest word.
    it('says plain cards when nothing is excluded', () => {
        expect(countText(renderCard(ENTRY, STATS, undefined, WHOLE)))
            .toBe('45 of 60 cards');
    });

    it('says plain cards when the config could not be loaded', () => {
        expect(countText(renderCard(ENTRY, STATS, undefined, null)))
            .toBe('45 of 60 cards');
    });

    // "Total Cards" is a column heading on the checklist page, beside "Owned".
    // Spliced into a sentence it becomes a claim - and claiming 60 is the total
    // on a card that also shows extra-category pills is exactly what this issue
    // is about. Plain "cards" until the checklist names its own count.
    it('says plain cards when the checklist named no count of its own', () => {
        const config = { categories: [{ id: 'base' }, { id: 'x', isMain: false }] };

        expect(countText(renderCard(ENTRY, STATS, undefined, config)))
            .toBe('45 of 60 cards');
    });

    // Live data: blazers-legends and washington-legends both carry
    // totalLabel: "Total Cards" explicitly, from before the field was editable.
    // Reading that as a name the checklist chose puts the phrasing this issue
    // removes straight back on two real checklists.
    it('treats the default spelled out explicitly as no name at all', () => {
        for (const totalLabel of ['Total Cards', 'total cards', '  Total Cards  ']) {
            const config = { totalLabel, categories: SPLIT.categories };

            expect(countText(renderCard(ENTRY, STATS, undefined, config)), totalLabel)
                .toBe('45 of 60 cards');
        }
    });

    // "45 of 60 rookie card" reads as a bug; the parenthetical form the value
    // line uses does not have that problem, so parity is not the goal.
    it('ignores a label that would not read as a plural noun', () => {
        for (const totalLabel of ['Target', 'Rookie Card', 'Base Set']) {
            const config = { totalLabel, categories: SPLIT.categories };

            expect(countText(renderCard(ENTRY, STATS, undefined, config)), totalLabel)
                .toBe('45 of 60 cards');
        }
    });

    it('uses a label that does read as one, whatever its case', () => {
        const config = { totalLabel: 'BASE CARDS', categories: SPLIT.categories };

        expect(countText(renderCard(ENTRY, STATS, undefined, config)))
            .toBe('45 of 60 base cards');
    });

    it('escapes a label rather than trusting it', () => {
        const config = { totalLabel: '<img src=x onerror=alert(1)>', categories: SPLIT.categories };
        const card = renderCard(ENTRY, STATS, undefined, config);

        expect(card.querySelector('.progress-main-text img')).toBeNull();
        // Ends in ">", not "cards", so it never reaches the sentence at all -
        // the escaping still has to hold for the day that changes.
        expect(countText(card)).toBe('45 of 60 cards');
    });

    it('survives a non-string label', () => {
        const config = { totalLabel: 123, categories: SPLIT.categories };

        // Does not end in "cards", so it degrades to the plain noun rather than
        // splicing a number into the sentence.
        expect(countText(renderCard(ENTRY, STATS, undefined, config))).toBe('45 of 60 cards');
    });

    // The ring was the last unqualified count label on this card: a sighted user
    // read "45 of 60 target cards" while a screen reader said "Cards collected".
    it('names the ring after the same cards the line does', () => {
        const card = renderCard(ENTRY, STATS, undefined, SPLIT);

        expect(card.querySelector('.progress-ring').getAttribute('aria-label'))
            .toBe('target cards collected');
    });
});

describe('index aggregate — the count label follows the scope (#779)', () => {
    const loadAggregate = () => {
        const { start, end } = sourceOf('function updateAggregateStats(allStats, uniqueOwned, configs = {}) {');
        return new Function('animateValue',
            `let hasAnimatedStats = true; ${INDEX_HTML.slice(start, end)}; return updateAggregateStats;`)(vi.fn());
    };

    beforeEach(() => {
        document.body.innerHTML = '<div class="aggregate-stats" id="aggregate-stats">'
            + '<div id="agg-owned"></div><div id="agg-total"></div>'
            // A sentinel, not the expected default: seeded with "Total Cards"
            // the two tests below pass even when the else branch never writes.
            + '<div class="aggregate-stat-label" id="agg-total-label">UNSET</div>'
            + '<div id="agg-value"></div><div id="agg-value-label"></div>'
            + '<span id="agg-needed-value"></span></div>';
    });

    const label = () => document.getElementById('agg-total-label').textContent;
    const stats = { jd: { owned: 45, total: 60, ownedValue: 1200, neededValue: 210 } };

    // It sums checklists whose labels disagree, so it cannot borrow one.
    // "Target Cards": tracked was false - the excluded extras are tracked, and
    // visibly so - and counted described the machinery rather than the number.
    // Adjective-noun to match the state it swaps with and the configured labels.
    it('says Target Cards when any checklist excludes cards from its count', () => {
        loadAggregate()(stats, null, { jd: SPLIT });

        expect(label()).toBe('Target Cards');
    });

    it('stays Total Cards when nothing anywhere is excluded', () => {
        loadAggregate()(stats, null, { jd: WHOLE });

        expect(label()).toBe('Total Cards');
    });

    it('one excluding checklist is enough, since its count is in the sum', () => {
        loadAggregate()(
            { a: stats.jd, b: { owned: 1, total: 2, ownedValue: 5, neededValue: 5 } },
            null,
            { a: WHOLE, b: SPLIT },
        );

        expect(label()).toBe('Target Cards');
    });

    // Same gate as the value label: a checklist contributing nothing to the sum
    // cannot be the reason it is short.
    it('ignores a split checklist with no stats yet', () => {
        loadAggregate()(stats, null, { jd: WHOLE, brandnew: SPLIT });

        expect(label()).toBe('Total Cards');
    });

    // One closure, called twice: two calls to loadAggregate() would be two
    // independent copies, which is not the re-run this name promises.
    it('goes back to Total Cards when re-run without an excluding checklist', () => {
        const aggregate = loadAggregate();
        aggregate(stats, null, { jd: SPLIT });
        expect(label()).toBe('Target Cards');

        aggregate(stats, null, { jd: WHOLE });

        expect(label()).toBe('Total Cards');
    });
});

describe('index.html carries the element the aggregate label is written into', () => {
    it('has the id, since every test above builds its own DOM', () => {
        expect(INDEX_HTML).toContain('id="agg-total-label"');
    });
});

// #784: #781 centralised the "unset" wording as DEFAULT_COUNT_LABEL so the
// header, the completion suffix and the count-noun rule cannot disagree about
// it. updateAggregateStats reads the constant, but the markup it writes into
// ships with the string spelled out - the one place left that can drift, and
// the one a reader sees before any JS runs.
describe('the aggregate label placeholder matches the constant (#784)', () => {
    const INDEX_HTML = readFileSync(resolve(import.meta.dirname, '..', 'index.html'), 'utf-8');
    it('spells the default the same way src/shared.js does', () => {
        const m = INDEX_HTML.match(/id="agg-total-label"[^>]*>([^<]*)</);

        expect(m, 'agg-total-label not found in index.html').not.toBeNull();
        expect(m[1]).toBe(globalThis.DEFAULT_COUNT_LABEL);
    });

    // The JS half, so a rename cannot be applied to the markup alone.
    it('has the updater read the constant rather than restate it', () => {
        expect(INDEX_HTML).toMatch(/anyExcludes\s*\?\s*['"]Target Cards['"]\s*:\s*DEFAULT_COUNT_LABEL/);
    });
});
