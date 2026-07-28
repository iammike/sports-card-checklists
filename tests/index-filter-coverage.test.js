import { describe, it, expect, beforeEach } from 'vitest';
import {
    FILTER_BAR_MARKUP,
    GRID_MARKUP,
    loadInitChecklistFilters,
    renderCard,
} from './index-source.js';

// The index page's three state filters have to partition the checklists: every
// card belongs to exactly one of In Progress, Complete and Not Started, whatever
// owned/total it carries.
//
// That invariant broke on an over-owned checklist (#717). The card decides
// completeness with owned >= total, but applyFilters used owned === total for
// Complete and owned > 0 && owned < total for In Progress, so 12 of 10 rendered
// as complete and then matched no filter at all - it could only be found under
// All. Over-owned is a state the gist can genuinely hold: computeStats derives
// owned and total in one pass over the same cards and can never emit one, but a
// stored total goes stale, and it is only recomputed when the owner opens that
// checklist page while signed in (_refreshStatsIfStale in checklist-engine.js).
// Until then the index page keeps showing the figure it was given.
//
// The sweep below is the guard: it asserts the partition holds across the whole
// owned/total space rather than spot-checking the one pair that broke, so the
// next classification gap fails here too. The named cases underneath pin which
// filter each state belongs to, which the sweep alone would not catch.

const ENTRY = { id: 'test', title: 'Test Checklist', type: 'dynamic' };
const stats = (owned, total) => ({ owned, total, ownedValue: 0, neededValue: 0 });

const STATE_FILTERS = ['in-progress', 'complete', 'not-started'];

// Mount the real filter bar over a grid holding one real card, then click every
// pill and report which filters leave the card visible.
function filtersMatching(cardStats) {
    document.body.innerHTML = FILTER_BAR_MARKUP + GRID_MARKUP;
    const grid = document.querySelector('.checklist-grid');
    const card = renderCard(ENTRY, cardStats, grid);
    loadInitChecklistFilters()();

    const pills = [...document.querySelectorAll('.filter-pill')];
    expect(pills).toHaveLength(4);

    const matched = [];
    for (const pill of pills) {
        pill.click();
        if (card.style.display !== 'none') matched.push(pill.dataset.filter);
    }
    return matched;
}

// The single state filter a card falls under, or null if it slipped through all
// three - which is the failure #717 was.
function stateFilterFor(cardStats) {
    const matched = filtersMatching(cardStats).filter(f => STATE_FILTERS.includes(f));
    return matched.length === 1 ? matched[0] : null;
}

beforeEach(() => {
    document.body.innerHTML = '';
});

describe('index.html filters — every checklist lands in exactly one state', () => {
    // Deliberately runs past total: owned > total is the region that broke, and a
    // sweep that stopped at total would have passed all along.
    const pairs = [];
    for (let total = 0; total <= 4; total++) {
        for (let owned = 0; owned <= 6; owned++) pairs.push([owned, total]);
    }

    it.each(pairs)('%i of %i matches exactly one state filter', (owned, total) => {
        const matched = filtersMatching(stats(owned, total));

        expect(matched.filter(f => STATE_FILTERS.includes(f))).toHaveLength(1);
    });

    it.each(pairs)('%i of %i is always reachable under All', (owned, total) => {
        expect(filtersMatching(stats(owned, total))).toContain('all');
    });

    it('covers the whole space rather than a handful of pairs', () => {
        // Guards the loop bounds above: shrinking them would quietly narrow the
        // sweep while every case still passed.
        expect(pairs).toHaveLength(35);
        expect(pairs.filter(([owned, total]) => total > 0 && owned > total)).toHaveLength(14);
    });
});

describe('index.html filters — which state each checklist lands in', () => {
    it('files an untouched checklist under Not Started', () => {
        expect(stateFilterFor(stats(0, 10))).toBe('not-started');
    });

    it('files a partly collected checklist under In Progress', () => {
        expect(stateFilterFor(stats(3, 10))).toBe('in-progress');
    });

    it('files an exactly finished checklist under Complete', () => {
        expect(stateFilterFor(stats(10, 10))).toBe('complete');
    });

    it('files an over-owned checklist under Complete, as its card is already styled', () => {
        // The regression. A stale total can leave more cards owned than listed;
        // the card renders complete, so Complete is where it has to be findable.
        const card = renderCard(ENTRY, stats(12, 10));
        expect(card.classList.contains('complete')).toBe(true);

        expect(stateFilterFor(stats(12, 10))).toBe('complete');
    });

    it('files an empty checklist under Not Started, not Complete', () => {
        // 0 of 0 satisfies owned >= total, so only the hasCards guard keeps a
        // checklist with nothing in it out of Complete.
        expect(stateFilterFor(stats(0, 0))).toBe('not-started');
    });

    it('files a checklist with no stats at all under Not Started', () => {
        // No stats renders "No cards yet" and no progress text for applyFilters to
        // parse, so the missing-figures path has to classify too.
        const card = renderCard(ENTRY, null);
        expect(card.querySelectorAll('.progress-main-text')).toHaveLength(0);

        expect(stateFilterFor(null)).toBe('not-started');
    });
});

describe('index.html filters — the page does not disown a matching card', () => {
    it('does not report "no matches" while showing an over-owned card under Complete', () => {
        // The user-visible half of the bug: the only checklist in the grid matched
        // nothing, so Complete emptied the grid and announced no matches.
        document.body.innerHTML = FILTER_BAR_MARKUP + GRID_MARKUP;
        const grid = document.querySelector('.checklist-grid');
        renderCard(ENTRY, stats(12, 10), grid);
        loadInitChecklistFilters()();

        document.querySelector('.filter-pill[data-filter="complete"]').click();

        const visible = [...grid.querySelectorAll('.checklist-card')]
            .filter(c => c.style.display !== 'none');
        expect(visible).toHaveLength(1);
        expect(document.getElementById('checklist-no-results').textContent).toBe('');
    });

    it('still empties the grid when a filter genuinely matches nothing', () => {
        // Pins that the assertion above is not satisfied by a filter that stopped
        // hiding anything.
        document.body.innerHTML = FILTER_BAR_MARKUP + GRID_MARKUP;
        const grid = document.querySelector('.checklist-grid');
        renderCard(ENTRY, stats(12, 10), grid);
        loadInitChecklistFilters()();

        document.querySelector('.filter-pill[data-filter="not-started"]').click();

        const visible = [...grid.querySelectorAll('.checklist-card')]
            .filter(c => c.style.display !== 'none');
        expect(visible).toHaveLength(0);
        expect(document.getElementById('checklist-no-results').textContent)
            .toBe('No checklists match your search.');
    });
});
