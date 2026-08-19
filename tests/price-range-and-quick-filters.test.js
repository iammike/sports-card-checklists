import { describe, it, expect, beforeEach, vi } from 'vitest';

const ChecklistEngine = globalThis.ChecklistEngine;
const ChecklistManager = globalThis.ChecklistManager;

// Mirrors tests/custom-filter-match.test.js's harness: a real ChecklistManager
// and real DOM render, so these tests exercise the same path a user's clicks do
// rather than hand-built customFilterValues objects that could quietly diverge
// from what _renderFilters/_applyFilters actually produce.
function makeEngine(config, cards) {
    const engine = Object.create(ChecklistEngine.prototype);
    engine.id = 'test';
    engine.config = {
        dataShape: 'flat',
        customFields: {},
        cardDisplay: {},
        sortOptions: ['default'],
        customFilters: [],
        ...config,
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

function visibleSets(engine) {
    return [...document.querySelectorAll('#sections-container .card')]
        .filter(el => !el.classList.contains('filter-hidden'))
        .map(el => engine._renderedCards[parseInt(el.dataset.cardIdx)].set);
}

beforeEach(() => {
    document.body.innerHTML = '<div id="filters-container"></div><div id="sections-container"></div>';
});

describe('ChecklistEngine._getPriceBounds', () => {
    it('is null when no card has a price', () => {
        const engine = makeEngine({}, [
            { set: 'A', num: '1' },
            { set: 'B', num: '2', price: 0 },
        ]);
        expect(engine._getPriceBounds()).toBeNull();
    });

    it('spans 0 to the ceiling of the highest price', () => {
        const engine = makeEngine({}, [
            { set: 'A', num: '1', price: 12 },
            { set: 'B', num: '2', price: 47.4 },
        ]);
        expect(engine._getPriceBounds()).toEqual({ min: 0, max: 48 });
    });

    it('coerces a numeric price string the way getPrice/sort do', () => {
        // getPrice() is `card.price || 0` - a numeric string like "25" is
        // truthy and compares correctly against `> 0` via JS's numeric coercion.
        const engine = makeEngine({}, [
            { set: 'A', num: '1', price: '25' },
        ]);
        expect(engine._getPriceBounds()).toEqual({ min: 0, max: 25 });
    });

    it('does not crash and excludes a genuinely non-numeric price', () => {
        // "abc" > 0 is false (NaN comparison), so it's silently excluded from
        // bounds rather than throwing or poisoning Math.max with NaN.
        const engine = makeEngine({}, [
            { set: 'A', num: '1', price: 'abc' },
            { set: 'B', num: '2', price: 30 },
        ]);
        expect(engine._getPriceBounds()).toEqual({ min: 0, max: 30 });
    });
});

describe('ChecklistEngine._quickFilterDefs', () => {
    it('shows Auto/Patch/Numbered when customFields is entirely absent, matching renderAttributeBadges', () => {
        const engine = makeEngine({ customFields: undefined }, []);
        const keys = engine._quickFilterDefs([]).map(d => d.key);
        expect(keys).toEqual(['auto', 'patch', 'numbered']);
    });

    it('shows only the attributes this checklist declares in customFields', () => {
        const engine = makeEngine({ customFields: { auto: { type: 'checkbox' } } }, []);
        const keys = engine._quickFilterDefs([]).map(d => d.key);
        expect(keys).toEqual(['auto']);
    });

    it('adds Rookie only when some card actually carries rc, regardless of customFields', () => {
        const engine = makeEngine({ customFields: {} }, []);
        expect(engine._quickFilterDefs([{ set: 'A', num: '1' }]).map(d => d.key)).toEqual([]);
        expect(engine._quickFilterDefs([{ set: 'A', num: '1', rc: true }]).map(d => d.key)).toEqual(['rookie']);
    });
});

describe('ChecklistEngine — quick filter toggles combine with each other and existing filters', () => {
    const config = {
        customFields: { auto: { type: 'checkbox' }, patch: { type: 'checkbox' } },
        customFilters: [{
            id: 'sport',
            options: [{ value: 'nfl', label: 'NFL' }, { value: 'nba', label: 'NBA' }],
        }],
    };
    const cards = [
        { set: 'A', num: '1', sport: 'nfl', auto: true, patch: true },
        { set: 'B', num: '2', sport: 'nfl', auto: true, patch: false },
        { set: 'C', num: '3', sport: 'nba', auto: true, patch: true },
    ];

    it('a single toggle filters on its own', () => {
        const engine = makeEngine(config, cards);
        engine._renderFilters();
        engine.renderCards();
        document.getElementById('filters-container')
            .querySelector('[data-quick-filter="patch"]').click();

        expect(visibleSets(engine)).toEqual(['A', 'C']);
    });

    it('two toggles AND together', () => {
        const engine = makeEngine(config, cards);
        engine._renderFilters();
        engine.renderCards();
        const container = document.getElementById('filters-container');
        container.querySelector('[data-quick-filter="auto"]').click();
        container.querySelector('[data-quick-filter="patch"]').click();

        expect(visibleSets(engine)).toEqual(['A', 'C']);
    });

    it('a quick filter ANDs with an unrelated dropdown filter', () => {
        const engine = makeEngine(config, cards);
        engine._renderFilters();
        engine.renderCards();
        document.getElementById('filters-container')
            .querySelector('[data-quick-filter="patch"]').click();
        const sportSelect = document.getElementById('sport-filter');
        sportSelect.value = 'nba';
        sportSelect.dispatchEvent(new Event('change'));

        expect(visibleSets(engine)).toEqual(['C']);
    });

    it('clicking a toggle twice turns it back off', () => {
        const engine = makeEngine(config, cards);
        engine._renderFilters();
        engine.renderCards();
        const btn = document.getElementById('filters-container').querySelector('[data-quick-filter="patch"]');
        btn.click();
        btn.click();

        expect(btn.classList.contains('active')).toBe(false);
        expect(btn.getAttribute('aria-pressed')).toBe('false');
        expect(visibleSets(engine)).toEqual(['A', 'B', 'C']);
    });
});

describe('ChecklistEngine — price range filter', () => {
    const cards = [
        { set: 'A', num: '1', price: 5 },
        { set: 'B', num: '2', price: 50 },
        { set: 'C', num: '3', price: 100 },
        { set: 'D', num: '4' }, // unpriced -> getPrice() is 0
    ];

    it('narrowing the range hides cards outside it', () => {
        const engine = makeEngine({}, cards);
        engine._renderFilters();
        engine.renderCards();
        const min = document.getElementById('price-min-filter');
        const max = document.getElementById('price-max-filter');
        min.value = '10';
        max.value = '60';
        max.dispatchEvent(new Event('input')); // marks max as touched - see the ceiling tests below
        engine._applyFilters();

        expect(visibleSets(engine)).toEqual(['B']);
    });

    it('the default (untouched) range shows every card, priced or not', () => {
        const engine = makeEngine({}, cards);
        engine._renderFilters();
        engine.renderCards();

        expect(visibleSets(engine)).toEqual(['A', 'B', 'C', 'D']);
    });

    it('a max handle left at its ceiling stays uncapped for a card priced above the stale bound (#733-style regression)', () => {
        // Reproduces the real onSave path: _renderFilters() runs once at init and
        // computes bounds from the cards at that time; saving/adding a card only
        // calls renderCards(), never re-running _renderFilters(). A max handle
        // the user never touched should not silently exclude a card the checklist
        // owner just priced above the old ceiling.
        const engine = makeEngine({}, [
            { set: 'A', num: '1', price: 10 },
            { set: 'B', num: '2', price: 20 },
        ]);
        engine._renderFilters();
        engine.renderCards();
        expect(document.getElementById('price-max-filter').max).toBe('20');

        engine.cards.push({ set: 'C', num: '3', price: 50 });
        engine.renderCards(); // no _renderFilters() call, matching onSave

        expect(visibleSets(engine)).toEqual(['A', 'B', 'C']);
    });

    it('once the max handle is moved off its ceiling, it becomes a real cap again', () => {
        const engine = makeEngine({}, [
            { set: 'A', num: '1', price: 10 },
            { set: 'B', num: '2', price: 20 },
        ]);
        engine._renderFilters();
        engine.renderCards();
        const maxInput = document.getElementById('price-max-filter');
        maxInput.value = '15';
        maxInput.dispatchEvent(new Event('input')); // real drag fires 'input', not just a value assignment

        engine.cards.push({ set: 'C', num: '3', price: 50 });
        engine.renderCards();

        expect(visibleSets(engine)).toEqual(['A']);
    });

    it('a max handle dragged back to exactly the ceiling stays a real cap, not uncapped again', () => {
        // The naive "value === ceiling means untouched" check can't tell this
        // apart from a handle nobody ever moved - a user who drags max down and
        // deliberately back up to the top lands on the same number on purpose.
        // The "touched" flag (set on any real 'input' event) is what makes the
        // distinction, so a card priced above the ceiling added afterward must
        // still be excluded here, unlike the untouched case above.
        const engine = makeEngine({}, [
            { set: 'A', num: '1', price: 10 },
            { set: 'B', num: '2', price: 20 },
        ]);
        engine._renderFilters();
        engine.renderCards();
        const maxInput = document.getElementById('price-max-filter');
        maxInput.value = '20'; // same number as the ceiling, but arrived at deliberately
        maxInput.dispatchEvent(new Event('input'));

        engine.cards.push({ set: 'C', num: '3', price: 50 });
        engine.renderCards();

        expect(visibleSets(engine)).toEqual(['A', 'B']);
    });
});
