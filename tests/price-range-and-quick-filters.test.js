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

    // 47.4 is not a price this app can store (#761): getPrice normalizes it to
    // 47, which is what the badge shows and what the filter compares, so the
    // ceiling is 47. Ceiling-ing to 48 would put the top of the slider above any
    // price a card can actually have.
    it('spans 0 to the ceiling of the highest price', () => {
        const engine = makeEngine({}, [
            { set: 'A', num: '1', price: 12 },
            { set: 'B', num: '2', price: 47.4 },
        ]);
        expect(engine._getPriceBounds()).toEqual({ min: 0, max: 47 });
    });

    it('coerces a numeric price string the way getPrice/sort do', () => {
        // getPrice() is `Number(card.price) || 0` - a hand-edited gist can store
        // price as a string ("25"), and Number() turns it into a real number
        // rather than the truthy-but-still-a-string value the bare field would be.
        const engine = makeEngine({}, [
            { set: 'A', num: '1', price: '25' },
        ]);
        expect(engine._getPriceBounds()).toEqual({ min: 0, max: 25 });
    });

    it('does not crash and excludes a genuinely non-numeric price', () => {
        // Number("abc") is NaN, and the || 0 fallback catches it the same way
        // it catches a missing price - excluded from bounds, not thrown.
        const engine = makeEngine({}, [
            { set: 'A', num: '1', price: 'abc' },
            { set: 'B', num: '2', price: 30 },
        ]);
        expect(engine._getPriceBounds()).toEqual({ min: 0, max: 30 });
    });
});

describe('ChecklistEngine.getPrice', () => {
    it('coerces a numeric string to a real number, not a truthy string', () => {
        // A bare `card.price || 0` would return the string "25" itself (truthy),
        // which downstream arithmetic then silently mishandles - most sharply in
        // _priceAtSliderPosition's `pointAt(lo) + frac * (...)`, where `+` with a
        // string operand does concatenation instead of addition (e.g.
        // "25" + 2.5 -> "252.5"), producing a wildly wrong price.
        const engine = makeEngine({}, []);
        const price = engine.getPrice({ price: '25' });
        expect(price).toBe(25);
        expect(typeof price).toBe('number');
    });

    it('a numeric-string price sorts correctly alongside real numbers instead of corrupting the order', () => {
        const engine = makeEngine({}, [
            { set: 'A', num: '1', price: '25' }, // hand-edited gist could store this as a string
            { set: 'B', num: '2', price: 10 },
            { set: 'C', num: '3', price: 100 },
        ]);
        const sorted = engine._getSortedPrices();
        expect(sorted).toEqual([10, 25, 100]);
        expect(sorted.every(p => typeof p === 'number')).toBe(true);
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

describe('ChecklistEngine._getPriceBands (#772)', () => {
    const bands = (prices) => makeEngine({}, prices.map((p, i) => ({ set: String(i), num: String(i), price: p })))
        ._getPriceBands();

    it('is empty when nothing is priced, so no dead control renders', () => {
        expect(bands([])).toEqual([]);
    });

    // A checklist topping out at $12 has no use for a $100+ chip.
    it('stops at the last edge below this checklist ceiling', () => {
        expect(bands([1, 4, 12]).map(b => b.label)).toEqual(['Under $5', '$5+']);
    });

    it('offers the full ladder when the prices reach it', () => {
        expect(bands([1, 40, 7000]).map(b => b.label))
            .toEqual(['Under $5', '$5-25', '$25-100', '$100-500', '$500+']);
    });

    // Every edge above the ceiling would be a chip matching nothing.
    it('renders no bands at all when every card is under the first edge', () => {
        expect(bands([1, 2, 3])).toEqual([]);
    });

    it('leaves the top band open rather than pinning it to the priciest card', () => {
        // A ceiling that moves whenever the most expensive card is edited is a
        // filter that quietly means something different each time.
        const top = bands([1, 40, 7000]).at(-1);
        expect(top.max).toBeNull();
        expect(top.min).toBe(500);
    });

    it('runs the bands edge to edge with no gap or overlap', () => {
        const list = bands([1, 40, 7000]);
        for (let i = 1; i < list.length; i++) {
            expect(list[i].min).toBe(list[i - 1].max);
        }
        expect(list[0].min).toBe(0);
    });
});

describe('ChecklistEngine — price filter (#772)', () => {
    const cards = [
        { set: 'A', num: '1', price: 5 },
        { set: 'B', num: '2', price: 50 },
        { set: 'C', num: '3', price: 100 },
        // Unpriced usually means "too rare to find a price", so it filters as if
        // priced at Infinity: a floor never hides it, a real ceiling does.
        { set: 'D', num: '4' },
    ];

    const setUp = (list = cards) => {
        const engine = makeEngine({}, list);
        engine._renderFilters();
        engine.renderCards();
        return engine;
    };
    const minField = () => document.getElementById('price-min-filter');
    const maxField = () => document.getElementById('price-max-filter');
    const type = (el, value) => { el.value = value; el.dispatchEvent(new Event('input')); };
    const chip = label => [...document.querySelectorAll('.price-band-btn')]
        .find(b => b.textContent === label);

    it('shows every card until a bound is set', () => {
        const engine = setUp();

        expect(visibleSets(engine)).toEqual(['A', 'B', 'C', 'D']);
    });

    it('narrows to a typed range', () => {
        const engine = setUp();

        type(minField(), '20');
        type(maxField(), '70');

        expect(visibleSets(engine)).toEqual(['B']);
    });

    it('leaves an unpriced card alone for a floor', () => {
        const engine = setUp();

        type(minField(), '30');

        expect(visibleSets(engine)).toEqual(['B', 'C', 'D']);
    });

    it('excludes an unpriced card once a ceiling is set', () => {
        const engine = setUp();

        type(maxField(), '60');

        expect(visibleSets(engine)).toEqual(['A', 'B']);
    });

    // The whole "touched" flag existed because a handle at the top of a track
    // could not say whether it meant anything. An empty field can.
    it('treats a cleared field as no bound at all', () => {
        const engine = setUp();
        type(maxField(), '60');
        expect(visibleSets(engine)).toEqual(['A', 'B']);

        type(maxField(), '');

        expect(visibleSets(engine)).toEqual(['A', 'B', 'C', 'D']);
    });

    // The slider froze its ceiling at render time, so a card priced above it
    // vanished until reload. Nothing is frozen now.
    it('does not hide a card priced above what the filter bar was built from', () => {
        const engine = setUp([{ set: 'A', num: '1', price: 10 }, { set: 'B', num: '2', price: 20 }]);

        engine.cards.push({ set: 'C', num: '3', price: 50 });
        engine.renderCards(); // no _renderFilters, matching the onSave path

        expect(visibleSets(engine)).toEqual(['A', 'B', 'C']);
    });

    it('fills the fields from a band chip', () => {
        setUp();

        chip('$5-25').click();

        expect(minField().value).toBe('5');
        expect(maxField().value).toBe('25');
    });

    it('leaves the min blank for the lowest band, and the max blank for the top one', () => {
        setUp();

        chip('Under $5').click();
        expect(minField().value).toBe('');
        expect(maxField().value).toBe('5');

        // $25+ is the top band here: the fixture's ceiling is $100, so the
        // $100 and $500 edges never appear.
        chip('$25+').click();
        expect(minField().value).toBe('25');
        expect(maxField().value).toBe('');
    });

    it('filters by the band it just set', () => {
        const engine = setUp();

        chip('$5-25').click();

        // A ($5) alone: B and C are above the band, and the unpriced D is
        // excluded by its ceiling.
        expect(visibleSets(engine)).toEqual(['A']);
    });

    // Worth pinning: which chips exist is derived, so a fixture change silently
    // changes what the tests above are clicking.
    it('offers the bands this fixture ceiling earns, and no more', () => {
        setUp();

        expect([...document.querySelectorAll('.price-band-btn')].map(b => b.textContent))
            .toEqual(['Under $5', '$5-25', '$25+']);
    });

    it('marks the active chip, and only that one', () => {
        setUp();

        chip('$5-25').click();

        const pressed = [...document.querySelectorAll('.price-band-btn')]
            .filter(b => b.getAttribute('aria-pressed') === 'true');
        expect(pressed).toHaveLength(1);
        expect(pressed[0].textContent).toBe('$5-25');
    });

    // A chip you cannot un-click is a trap you can only leave via Clear filters.
    it('clicking the active chip clears it', () => {
        const engine = setUp();
        chip('$5-25').click();

        chip('$5-25').click();

        expect(minField().value).toBe('');
        expect(maxField().value).toBe('');
        expect(visibleSets(engine)).toEqual(['A', 'B', 'C', 'D']);
    });

    it('releases the chip when typing takes the range somewhere else', () => {
        setUp();
        chip('$5-25').click();

        type(maxField(), '70');

        expect(chip('$5-25').getAttribute('aria-pressed')).toBe('false');
    });

    // Typing the band's own numbers should light it, or the two controls
    // disagree about the same range.
    it('lights the chip when a typed range happens to match it', () => {
        setUp();

        type(minField(), '5');
        type(maxField(), '25');

        expect(chip('$5-25').getAttribute('aria-pressed')).toBe('true');
    });

    // The mechanism is the input type, not a guard in _applyFilters: a number
    // input drops text on the floor, leaving the field empty, which reads as no
    // bound. Named for what actually happens so the next reader doesn't go
    // looking for parsing code that isn't doing the work.
    it('shows everything when text is typed, because the field refuses to hold it', () => {
        const engine = setUp();

        type(minField(), 'abc');

        expect(minField().value).toBe('');
        expect(visibleSets(engine)).toEqual(['A', 'B', 'C', 'D']);
    });

    // 1e5 is valid to a number input, so it must not be read as 1.
    it('reads an exponent the field does accept as its full value', () => {
        const engine = setUp();

        type(minField(), '1e5');

        expect(visibleSets(engine)).toEqual(['D']);
    });

    it('renders no price control at all when nothing is priced', () => {
        makeEngine({}, [{ set: 'A', num: '1' }])._renderFilters();

        expect(document.getElementById('price-filter')).toBeNull();
        expect(document.getElementById('price-min-filter')).toBeNull();
    });
});

// #772's separable defect: the slider's inputs were labelled "Minimum price"
// but carried a raw 0-1000 position and no aria-valuetext, so a screen reader
// announced "420" for a control that said it was about dollars. Number inputs
// announce their own value, so the fix is that the value IS the dollars - these
// pin the labelling that makes that true.
describe('price filter accessibility (#772)', () => {
    beforeEach(() => {
        makeEngine({}, [
            { set: 'A', num: '1', price: 5 },
            { set: 'B', num: '2', price: 100 },
        ])._renderFilters();
    });

    it('announces dollars, because the field holds dollars', () => {
        const min = document.getElementById('price-min-filter');

        expect(min.type).toBe('number');
        expect(min.getAttribute('aria-label')).toMatch(/dollars/i);
        // The old control's value was a slider position; this one is the price.
        min.value = '25';
        expect(Number(min.value)).toBe(25);
    });

    it('labels the maximum too', () => {
        expect(document.getElementById('price-max-filter').getAttribute('aria-label'))
            .toMatch(/maximum price in dollars/i);
    });

    it('groups the bands under the filter name', () => {
        const group = document.querySelector('.price-band-group');

        expect(group.getAttribute('role')).toBe('group');
        const label = document.getElementById(group.getAttribute('aria-labelledby'));
        expect(label).not.toBeNull();
        expect(label.textContent).toBe('Price');
    });

    it('exposes each band press state to assistive tech', () => {
        const chips = [...document.querySelectorAll('.price-band-btn')];

        expect(chips.length).toBeGreaterThan(0);
        expect(chips.every(c => c.getAttribute('aria-pressed') === 'false')).toBe(true);
    });

    it('offers a numeric keypad on touch devices', () => {
        expect(document.getElementById('price-min-filter').getAttribute('inputmode')).toBe('numeric');
    });
});
