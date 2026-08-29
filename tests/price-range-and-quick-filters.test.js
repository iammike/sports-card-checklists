import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

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
        // which downstream arithmetic then silently mishandles - computeStats'
        // running totals concatenate instead of adding (e.g. "25" + 2.5 ->
        // "252.5"), and _getPriceBands compares a string against its edges.
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

// #787: the chips were named by hardcoded strings while every config already
// carried a label the card editor was rendering. Re-wording an attribute meant
// editing code; now it is a config edit, settable from the settings modal.
describe('ChecklistEngine._quickFilterDefs — chip wording comes from the config (#787)', () => {
    const labelsOf = (engine) => Object.fromEntries(
        engine._quickFilterDefs([]).map(d => [d.key, d.label]));

    it('names each chip with the checklist own label', () => {
        const engine = makeEngine({ customFields: {
            auto: { type: 'checkbox', label: 'Signed' },
            patch: { type: 'checkbox', label: 'Relic' },
            serial: { type: 'text', label: 'Numbered To' },
        } }, []);

        expect(labelsOf(engine)).toEqual({
            auto: 'Signed', patch: 'Relic', numbered: 'Numbered To',
        });
    });

    // The wording that shipped before this change, for any field that declares
    // no label of its own.
    it('falls back to the built-in wording', () => {
        const engine = makeEngine({ customFields: {
            auto: { type: 'checkbox' },
            patch: { type: 'checkbox' },
            serial: { type: 'text' },
        } }, []);

        expect(labelsOf(engine)).toEqual({
            auto: 'Auto', patch: 'Patch', numbered: 'Numbered',
        });
    });

    it('falls back with no customFields at all', () => {
        const engine = makeEngine({ customFields: undefined }, []);

        expect(labelsOf(engine)).toEqual({
            auto: 'Auto', patch: 'Patch', numbered: 'Numbered',
        });
    });

    // A blank label should not render a nameless chip.
    it('falls back for a blank label', () => {
        const engine = makeEngine({ customFields: {
            patch: { type: 'checkbox', label: '   ' },
        } }, []);

        expect(labelsOf(engine)).toEqual({ patch: 'Patch' });
    });

    // The chip's label reaches the DOM, so the rendered button has to carry it
    // too - reading it off the defs alone would not prove the chip changed.
    it('renders the configured wording on the button', () => {
        const engine = makeEngine({ customFields: {
            patch: { type: 'checkbox', label: 'Relic' },
        } }, [{ set: 'A', num: '1', patch: true }]);
        engine._renderFilters();

        const chip = document.querySelector('[data-quick-filter="patch"]');
        expect(chip).not.toBeNull();
        expect(chip.textContent).toBe('Relic');
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
        { set: 'A', num: '1', price: 1 },
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
    // The slider froze its ceiling at render time, so a card priced above it
    // vanished until reload. Reproduced properly: a bound is actually set from
    // the bar built against the old prices, then a pricier card arrives.
    it('does not hide a card priced above what the filter bar was built from', () => {
        const engine = setUp([{ set: 'A', num: '1', price: 1 }, { set: 'B', num: '2', price: 20 }]);
        chip('$5+').click(); // the top band, built when $20 was the ceiling

        engine.cards.push({ set: 'C', num: '3', price: 50 });
        engine.renderCards(); // no _renderFilters, matching the onSave path

        expect(visibleSets(engine)).toEqual(['B', 'C']);
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

        // $25+ is the top band here: the ceiling is $100, so the $100 and $500
        // edges never appear.
        chip('$25+').click();
        expect(minField().value).toBe('25');
        expect(maxField().value).toBe('');
    });

    it('filters by the band it just set', () => {
        const engine = setUp();

        chip('Under $5').click();

        // A ($1) alone: B and C are above the band, and the unpriced D is
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
        // Visibly, not only to assistive tech: aria-pressed alone leaves a
        // sighted user unable to see which band is on, or that the chip they
        // must click again to clear is the lit one.
        expect(chip('$5-25').classList.contains('active')).toBe(true);
        expect(chip('$25+').classList.contains('active')).toBe(false);
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

    // The chip and the filter have to read the text the same way. Parsed
    // differently, "$5" to "25" filters as the $5-25 band with its chip dark.
    it('lights the chip for a range typed with a currency symbol', () => {
        const engine = setUp();

        type(minField(), '$5');
        type(maxField(), '25');

        expect(chip('$5-25').getAttribute('aria-pressed')).toBe('true');
        expect(chip('$5-25').classList.contains('active')).toBe(true);
        // And the filter agrees with the chip it just lit.
        expect(visibleSets(engine)).toEqual([]);
    });

    // These are text inputs, so the field keeps whatever is typed and
    // _applyFilters is what has to cope - which is the point: a number input
    // would have silently eaten the two cases below.
    it('reads a typed currency symbol as the number beside it', () => {
        const engine = setUp();

        type(maxField(), '$60');

        expect(maxField().value).toBe('$60');
        expect(visibleSets(engine)).toEqual(['A', 'B']);
    });

    it('reads a thousands separator as the whole number, not the first digit', () => {
        const engine = setUp();

        // Parsed as 1 rather than 1200, this would exclude B and C.
        type(minField(), '1,200');

        expect(visibleSets(engine)).toEqual(['D']);
    });

    it('treats junk as no bound rather than as zero', () => {
        const engine = setUp();

        type(maxField(), 'ask');

        expect(visibleSets(engine)).toEqual(['A', 'B', 'C', 'D']);
    });

    // "ask" strips down to empty and is caught before the parse; this survives
    // the strip and comes out NaN, which is the branch that actually needs the
    // guard. A max of 0 here would hide the entire checklist.
    it('treats an unparseable number as no bound rather than as zero', () => {
        const engine = setUp();

        type(maxField(), '1.2.3');

        expect(visibleSets(engine)).toEqual(['A', 'B', 'C', 'D']);
    });

    // Stripping first turns "-5" into 5 - the trap parsePriceInput documents.
    it('treats a negative as no bound rather than flipping its sign', () => {
        const engine = setUp();

        type(minField(), '-5');

        expect(visibleSets(engine)).toEqual(['A', 'B', 'C', 'D']);
    });

    // An expensive checklist used to be offered "Under $5" through "$100-500",
    // four chips matching nothing, each landing on "No cards match these
    // filters". Only edges that actually split its range survive.
    it('offers only the bands that split its own range', () => {
        makeEngine({}, [
            { set: 'A', num: '1', price: 400 },
            { set: 'B', num: '2', price: 7000 },
        ])._renderFilters();

        expect([...document.querySelectorAll('.price-band-btn')].map(b => b.textContent))
            .toEqual(['Under $500', '$500+']);
    });

    // Every edge sits below the cheapest card, so each would match everything.
    it('drops the bands entirely rather than offering one that filters nothing', () => {
        makeEngine({}, [
            { set: 'A', num: '1', price: 600 },
            { set: 'B', num: '2', price: 7000 },
        ])._renderFilters();

        expect(document.querySelectorAll('.price-band-btn')).toHaveLength(0);
    });

    it('does the same for a single priced card, which no band can divide', () => {
        makeEngine({}, [{ set: 'A', num: '1', price: 1000 }])._renderFilters();

        expect(document.querySelectorAll('.price-band-btn')).toHaveLength(0);
    });

    // Bands can be empty while cards are still priced. The exact fields are then
    // the only way to filter on price - and the only way to hide unpriced cards.
    it('still offers the exact fields when no band is worth showing', () => {
        makeEngine({}, [
            { set: 'A', num: '1', price: 1 },
            { set: 'B', num: '2', price: 3 },
        ])._renderFilters();

        expect(document.querySelectorAll('.price-band-btn')).toHaveLength(0);
        expect(document.getElementById('price-min-filter')).not.toBeNull();
        expect(document.getElementById('price-max-filter')).not.toBeNull();
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
// The pressed state has to be visible, not only announced - review found a
// mutation removing the class survived the whole suite. jsdom applies no
// stylesheet, so the rule itself is asserted from source, the way
// css-color-validation.test.js does.
describe('the pressed band chip is styled, not just flagged (#772)', () => {
    const css = () => readFileSync(resolve(import.meta.dirname, '..', 'shared.css'), 'utf-8');

    it('has a rule for the active chip', () => {
        expect(css()).toMatch(/\.price-band-btn\.active\s*\{/);
    });

    // The fields were type="number" for one commit, and the stylesheet kept
    // selecting on that after they became text - leaving them entirely unstyled.
    it('styles the exact fields on the class, not on an input type', () => {
        const sheet = css();

        expect(sheet).toMatch(/\.price-exact input\s*\{/);
        expect(sheet).not.toContain('.price-exact input[type="number"]');
    });

    it('keeps it distinct on hover, like the quick filters do', () => {
        expect(css()).toMatch(/\.price-band-btn\.active:hover\s*\{/);
    });
});

describe('price filter accessibility (#772)', () => {
    beforeEach(() => {
        makeEngine({}, [
            { set: 'A', num: '1', price: 5 },
            { set: 'B', num: '2', price: 100 },
        ])._renderFilters();
    });

    it('announces dollars, because the field holds dollars', () => {
        const min = document.getElementById('price-min-filter');

        expect(min.getAttribute('aria-label')).toMatch(/dollars/i);
        // The old control's value was a slider position; this one is the price
        // the user typed, which is what a text input announces.
        min.value = '25';
        expect(min.value).toBe('25');
    });

    it('labels the maximum too', () => {
        expect(document.getElementById('price-max-filter').getAttribute('aria-label'))
            .toMatch(/maximum price in dollars/i);
    });

    it('groups the bands under the filter name', () => {
        // The band group shares .filter-row-group with the Type toggles since
        // #785 put both in the panel; it is the one labelled by the Price row.
        const group = document.querySelector('[aria-labelledby="price-filter-label"]');

        expect(group.getAttribute('role')).toBe('group');
        const label = document.getElementById('price-filter-label');
        expect(label).not.toBeNull();
        expect(label.textContent).toBe('Price');
    });

    it('exposes each band press state to assistive tech', () => {
        const chips = [...document.querySelectorAll('.price-band-btn')];

        expect(chips.length).toBeGreaterThan(0);
        expect(chips.every(c => c.getAttribute('aria-pressed') === 'false')).toBe(true);
    });

    // On a text input this is what actually summons the keypad - on the
    // number input it replaced, inputmode was inert and the type did the work.
    it('offers a numeric keypad on touch devices', () => {
        const min = document.getElementById('price-min-filter');

        expect(min.type).toBe('text');
        expect(min.getAttribute('inputmode')).toBe('decimal');
    });
});
