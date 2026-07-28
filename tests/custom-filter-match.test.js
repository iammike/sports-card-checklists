import { describe, it, expect, beforeEach, vi } from 'vitest';

const ChecklistEngine = globalThis.ChecklistEngine;
const ChecklistManager = globalThis.ChecklistManager;

// A custom filter's option values reach _filterCard through a <select>, so they
// are always strings. A card field stored as a number or a boolean therefore
// never matched its own option under strict equality - the "0" option hid every
// card. Matching compares the string forms of both sides, while a card that
// simply lacks the field still matches nothing.

const SPORT_FILTER = {
    id: 'sport',
    options: [
        { value: 'nfl', label: 'NFL' },
        { value: 'usfl', label: 'USFL' },
        { value: 'football', label: 'Football' },
    ],
    multiMatch: { football: ['nfl', 'usfl'] },
};

// A filter whose option values are written as numbers in the config, the way a
// "years pro" or "round" filter would be. sanitizeAttr renders 0 as value="0".
const ROUND_FILTER = {
    id: 'round',
    options: [
        { value: 0, label: 'Undrafted' },
        { value: 1, label: 'Round 1' },
    ],
    multiMatch: { early: [0, 1] },
};

function makeEngine(customFilters, cards) {
    const engine = Object.create(ChecklistEngine.prototype);
    engine.id = 'test';
    engine.config = {
        dataShape: 'flat',
        customFields: {},
        cardDisplay: {},
        sortOptions: ['default'],
        customFilters,
    };
    engine.cards = cards;
    engine._renderedCards = [];
    engine._reorderMode = false;
    engine.updateStats = vi.fn();
    engine.checklistManager = new ChecklistManager({ checklistId: 'test' });
    engine.checklistManager.ownedCards = [];
    engine.checklistManager.isReadOnly = false;
    return engine;
}

// Drive the real path: render the real <select>, pick an option the way a user
// would, then let _applyFilters read el.value and hand it to _filterCard. A
// hand-written customFilterValues object could quietly use the wrong type and
// hide the very bug this covers.
function selectAndRender(engine, filterId, optionValue) {
    engine._renderFilters();
    engine.renderCards();
    const select = document.getElementById(`${filterId}-filter`);
    select.value = optionValue;
    // The option has to exist, or value= silently leaves the select on "all"
    // and every assertion below passes for the wrong reason.
    expect(select.value).toBe(optionValue);
    engine._applyFilters();
    return [...document.querySelectorAll('#sections-container .card')]
        .filter(el => !el.classList.contains('filter-hidden'))
        .map(el => engine._renderedCards[parseInt(el.dataset.cardIdx)]);
}

beforeEach(() => {
    document.body.innerHTML = '<div id="filters-container"></div><div id="sections-container"></div>';
});

describe('ChecklistEngine._filterCard — custom filter value coercion', () => {
    it('matches a numeric card field against its string option value', () => {
        const engine = makeEngine([ROUND_FILTER], [
            { set: 'A', num: '1', round: 0 },
            { set: 'B', num: '2', round: 1 },
        ]);

        const visible = selectAndRender(engine, 'round', '0');

        expect(visible.map(c => c.set)).toEqual(['A']);
    });

    it('matches a numeric card field against a non-zero string option value', () => {
        const engine = makeEngine([ROUND_FILTER], [
            { set: 'A', num: '1', round: 0 },
            { set: 'B', num: '2', round: 1 },
        ]);

        const visible = selectAndRender(engine, 'round', '1');

        expect(visible.map(c => c.set)).toEqual(['B']);
    });

    it('matches a boolean card field against its string option value', () => {
        const engine = makeEngine([
            { id: 'rc', options: [{ value: 'true', label: 'Rookie' }] },
        ], [
            { set: 'A', num: '1', rc: true },
            { set: 'B', num: '2', rc: false },
        ]);

        const visible = selectAndRender(engine, 'rc', 'true');

        expect(visible.map(c => c.set)).toEqual(['A']);
    });

    it('hides a card whose field is missing when a real value is selected', () => {
        const engine = makeEngine([ROUND_FILTER], [
            { set: 'A', num: '1', round: 0 },
            { set: 'B', num: '2' },
        ]);

        const visible = selectAndRender(engine, 'round', '0');

        expect(visible.map(c => c.set)).toEqual(['A']);
    });

    it('hides a card whose field is explicitly null when a real value is selected', () => {
        const engine = makeEngine([ROUND_FILTER], [
            { set: 'A', num: '1', round: 0 },
            { set: 'B', num: '2', round: null },
        ]);

        const visible = selectAndRender(engine, 'round', '0');

        expect(visible.map(c => c.set)).toEqual(['A']);
    });

    it('shows every card when the filter is left on "all"', () => {
        const engine = makeEngine([ROUND_FILTER], [
            { set: 'A', num: '1', round: 0 },
            { set: 'B', num: '2' },
        ]);

        const visible = selectAndRender(engine, 'round', 'all');

        expect(visible.map(c => c.set)).toEqual(['A', 'B']);
    });

    it('still matches plain string fields against string option values', () => {
        const engine = makeEngine([SPORT_FILTER], [
            { set: 'A', num: '1', sport: 'nfl' },
            { set: 'B', num: '2', sport: 'usfl' },
        ]);

        const visible = selectAndRender(engine, 'sport', 'nfl');

        expect(visible.map(c => c.set)).toEqual(['A']);
    });
});

describe('ChecklistEngine._filterCard — multiMatch coercion', () => {
    it('matches a numeric card field against a string multiMatch entry', () => {
        // The gap: the two sides of a multiMatch list are written by hand in the
        // config and need not agree on type with the card data. A list of "0"/"1"
        // never matched cards holding 0/1.
        const engine = makeEngine([{
            id: 'round',
            options: [{ value: 'early', label: 'Early' }],
            multiMatch: { early: ['0', '1'] },
        }], [
            { set: 'A', num: '1', round: 0 },
            { set: 'B', num: '2', round: 1 },
            { set: 'C', num: '3', round: 7 },
        ]);

        const visible = selectAndRender(engine, 'round', 'early');

        expect(visible.map(c => c.set)).toEqual(['A', 'B']);
    });

    it('matches a string card field against a numeric multiMatch entry', () => {
        const engine = makeEngine([{
            id: 'round',
            options: [{ value: 'early', label: 'Early' }],
            multiMatch: { early: [0, 1] },
        }], [
            { set: 'A', num: '1', round: '0' },
            { set: 'B', num: '2', round: '7' },
        ]);

        const visible = selectAndRender(engine, 'round', 'early');

        expect(visible.map(c => c.set)).toEqual(['A']);
    });

    it('matches a numeric card field against a numeric multiMatch entry', () => {
        const engine = makeEngine([{
            ...ROUND_FILTER,
            options: [...ROUND_FILTER.options, { value: 'early', label: 'Early' }],
        }], [
            { set: 'A', num: '1', round: 0 },
            { set: 'B', num: '2', round: 1 },
            { set: 'C', num: '3', round: 7 },
        ]);

        const visible = selectAndRender(engine, 'round', 'early');

        expect(visible.map(c => c.set)).toEqual(['A', 'B']);
    });

    it('hides a card whose field is missing from a multiMatch list', () => {
        const engine = makeEngine([{
            ...ROUND_FILTER,
            options: [...ROUND_FILTER.options, { value: 'early', label: 'Early' }],
        }], [
            { set: 'A', num: '1', round: 0 },
            { set: 'B', num: '2' },
        ]);

        const visible = selectAndRender(engine, 'round', 'early');

        expect(visible.map(c => c.set)).toEqual(['A']);
    });

    it('still matches string multiMatch entries', () => {
        const engine = makeEngine([SPORT_FILTER], [
            { set: 'A', num: '1', sport: 'nfl' },
            { set: 'B', num: '2', sport: 'usfl' },
            { set: 'C', num: '3', sport: 'nba' },
        ]);

        const visible = selectAndRender(engine, 'sport', 'football');

        expect(visible.map(c => c.set)).toEqual(['A', 'B']);
    });
});

describe('ChecklistEngine._filterKey', () => {
    it('renders present values as strings', () => {
        expect(ChecklistEngine._filterKey(0)).toBe('0');
        expect(ChecklistEngine._filterKey(1)).toBe('1');
        expect(ChecklistEngine._filterKey(false)).toBe('false');
        expect(ChecklistEngine._filterKey('nfl')).toBe('nfl');
    });

    it('keeps a missing value as null rather than the string "undefined"', () => {
        // "undefined"/"null" would be indistinguishable from a config that
        // legitimately used those words as an option value.
        expect(ChecklistEngine._filterKey(undefined)).toBeNull();
        expect(ChecklistEngine._filterKey(null)).toBeNull();
    });
});
