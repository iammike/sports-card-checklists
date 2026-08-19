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

describe('ChecklistEngine._priceAtSliderPosition — quantile mapping against this checklist\'s own prices', () => {
    it('maps position 0 to $0 and PRICE_SLIDER_RESOLUTION to the exact highest price', () => {
        const engine = makeEngine({}, []);
        const sorted = [1, 2, 3, 4, 100];
        expect(engine._priceAtSliderPosition(0, sorted)).toBe(0);
        expect(engine._priceAtSliderPosition(1000, sorted)).toBe(100);
    });

    it('returns $0 for an empty price list instead of dividing by zero', () => {
        const engine = makeEngine({}, []);
        expect(engine._priceAtSliderPosition(500, [])).toBe(0);
    });

    it('spaces positions by count of cards, not by dollar gap - a cluster of cheap cards gets most of the track', () => {
        // 4 cheap cards ($1-$4) plus one $100 outlier. A dollar-linear scale
        // would put all four cheap cards under position 40 (4/100 of the
        // track). The quantile mapping instead gives each of the 5 values an
        // equal 1/5 (200-unit) share of the track, so the $1-$4 cluster
        // occupies fully 80% of it and the $100 outlier only the last 20%.
        const engine = makeEngine({}, []);
        const sorted = [1, 2, 3, 4, 100];
        expect(engine._priceAtSliderPosition(200, sorted)).toBe(1);
        expect(engine._priceAtSliderPosition(400, sorted)).toBe(2);
        expect(engine._priceAtSliderPosition(600, sorted)).toBe(3);
        expect(engine._priceAtSliderPosition(800, sorted)).toBe(4);
        // Still deep in the final ($4-$100) band - the jump to the outlier only
        // happens right at the very end of that band, not partway through it.
        expect(engine._priceAtSliderPosition(801, sorted)).toBeLessThan(50);
    });

    it('gives the low end of the range far more resolution than a linear scale would, using #740\'s own shape', () => {
        // Mirrors the real Jayden Daniels checklist data this feature was built
        // for: a large cluster of cards at $30 or under, plus a handful of rare
        // parallels running into the thousands. A linear scale would put $30 at
        // position ~4 out of 1000 (30 / 7000). The quantile mapping should put
        // it dramatically further out, since most of the *cards* - not dollars
        // - live under $30.
        const cheap = Array.from({ length: 190 }, (_, i) => 1 + (i % 30)); // 190 cards, $1-$30
        const expensive = [1000, 2000, 3000, 7000]; // a handful of rare outliers
        const sorted = [...cheap, ...expensive].sort((a, b) => a - b);
        const engine = makeEngine({}, []);

        const linearPosition = (30 / 7000) * 1000;
        let quantilePosition = 0;
        for (let raw = 0; raw <= 1000; raw++) {
            if (engine._priceAtSliderPosition(raw, sorted) <= 30) quantilePosition = raw;
        }
        expect(quantilePosition).toBeGreaterThan(linearPosition * 10);
    });
});

describe('ChecklistEngine — price range filter', () => {
    // Prices are spread far apart on purpose so log-curve rounding (±$1 or so)
    // near a boundary can never flip which card is included - these tests
    // exercise filtering behavior, not the exact curve math.
    const cards = [
        { set: 'A', num: '1', price: 5 },
        { set: 'B', num: '2', price: 50 },
        { set: 'C', num: '3', price: 100 },
        { set: 'D', num: '4' }, // unpriced -> getPrice() is 0
    ];

    // The slider's raw <input> position isn't a dollar amount (see
    // _priceAtSliderPosition) - this inverts that same curve to find the raw
    // position whose price is closest to `price`, so tests can express intent
    // ("drag min to about $20") without hardcoding the curve's math twice.
    function rawForPrice(price, ceiling, resolution) {
        if (price <= 0) return 0;
        if (price >= ceiling) return resolution;
        return resolution * Math.log(price + 1) / Math.log(ceiling + 1);
    }

    it('narrowing the range hides cards outside it', () => {
        const engine = makeEngine({}, cards);
        engine._renderFilters();
        engine.renderCards();
        const min = document.getElementById('price-min-filter');
        const max = document.getElementById('price-max-filter');
        const resolution = parseFloat(max.max);
        const ceiling = parseFloat(document.getElementById('price-range-filter').dataset.max);
        min.value = rawForPrice(20, ceiling, resolution); // between A ($5) and B ($50)
        max.value = rawForPrice(70, ceiling, resolution); // between B ($50) and C ($100)
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
        expect(document.getElementById('price-range-filter').dataset.max).toBe('20');

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
        const resolution = parseFloat(maxInput.max);
        const ceiling = parseFloat(document.getElementById('price-range-filter').dataset.max);
        maxInput.value = rawForPrice(15, ceiling, resolution); // between A ($10) and B ($20)
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
        maxInput.value = maxInput.max; // raw position for "exactly the ceiling", arrived at deliberately
        maxInput.dispatchEvent(new Event('input'));

        engine.cards.push({ set: 'C', num: '3', price: 50 });
        engine.renderCards();

        expect(visibleSets(engine)).toEqual(['A', 'B']);
    });
});
