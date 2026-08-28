import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ChecklistEngine = globalThis.ChecklistEngine;
const ChecklistManager = globalThis.ChecklistManager;

// #785: the filter row had grown to 13 controls with no hierarchy and no media
// query anywhere. Only search, sort and the actions stay in the row now;
// everything that narrows moved behind one disclosure. The chips beneath are
// what makes that safe - a panel that hides which filters are on would be worse
// than the crowded row it replaced.

const CONFIG = {
    dataShape: 'flat',
    customFields: { auto: { type: 'checkbox' } },
    cardDisplay: {},
    // Two entries, or _renderFilters skips the sort dropdown entirely and the
    // test that pins where sort lives has nothing to find.
    sortOptions: ['default', 'year'],
    // The real shape, from jmu-pro-players: {id, allLabel, cardField, options}.
    // There is no `label` - inventing one hid a heading reading "ALL SPORTS".
    customFilters: [{
        id: 'sport',
        allLabel: 'All Sports',
        cardField: 'sport',
        options: [{ value: 'nfl', label: 'NFL' }, { value: 'nba', label: 'NBA' }],
    }],
};
const CARDS = [
    { set: 'A', num: '1', sport: 'nfl', price: 1 },
    { set: 'B', num: '2', sport: 'nba', price: 50 },
    { set: 'C', num: '3', sport: 'nfl', price: 100 },
];

function makeEngine(cards = CARDS, config = {}) {
    const engine = Object.create(ChecklistEngine.prototype);
    engine.id = 'test';
    engine.config = { ...CONFIG, ...config };
    engine.cards = cards;
    engine._renderedCards = [];
    engine._reorderMode = false;
    engine.updateStats = vi.fn();
    engine.checklistManager = new ChecklistManager({ checklistId: 'test' });
    engine.checklistManager.ownedCards = [];
    engine.checklistManager.isReadOnly = false;
    engine._renderFilters();
    engine.renderCards();
    return engine;
}

const bar = () => document.querySelector('.filter-bar');
const toggle = () => document.getElementById('filters-toggle');
const panel = () => document.getElementById('filters-panel');
const chips = () => [...document.querySelectorAll('.active-filter')];
const count = () => document.getElementById('filter-count');
const visible = (engine) => [...document.querySelectorAll('#sections-container .card')]
    .filter(el => !el.classList.contains('filter-hidden'))
    .map(el => engine._renderedCards[parseInt(el.dataset.cardIdx)].set);

beforeEach(() => {
    document.body.innerHTML = '<div id="filters-container"></div>'
        + '<div id="sections-container"></div>'
        // Permanent live region from #769; the no-matches state writes into it.
        + '<div class="no-matches-state" id="no-matches-state" role="status"></div>';
});

describe('the filter row holds only what is reached for constantly (#785)', () => {
    it('keeps search, sort and the narrowing disclosure - not the filters themselves', () => {
        makeEngine();

        // The panel is a descendant of the bar, so "is it inside .filter-bar"
        // would be true of everything. What matters is whether a control is on
        // the row itself or tucked into the panel.
        const onTheRow = el => el && el.closest('#filters-panel') === null;

        expect(onTheRow(document.getElementById('search'))).toBe(true);
        expect(onTheRow(toggle())).toBe(true);
        // Ordering, not narrowing - and rendered at all only because the fixture
        // offers more than one sort.
        expect(document.getElementById('sort-filter')).not.toBeNull();
        expect(onTheRow(document.getElementById('sort-filter'))).toBe(true);

        for (const id of ['status-filter', 'sport-filter', 'price-filter']) {
            expect(onTheRow(document.getElementById(id)), id).toBe(false);
        }
        expect(onTheRow(document.querySelector('.quick-filter-btn'))).toBe(false);
    });

    // The row is what the complaint was about, so pin its size directly.
    it('leaves the row at a handful of controls, not a wall of them', () => {
        makeEngine();

        const rowControls = [...bar().children]
            .filter(el => el.id !== 'reorder-btn' || el.style.display !== 'none');

        expect(rowControls.length).toBeLessThanOrEqual(4);
    });

    it('puts every narrowing control in the panel, ids intact', () => {
        makeEngine();

        for (const id of ['status-filter', 'sport-filter', 'price-filter', 'price-min-filter']) {
            expect(panel().querySelector(`#${id}`), id).not.toBeNull();
        }
        expect(panel().querySelector('.quick-filter-btn')).not.toBeNull();
    });

    // The row is a layout change; nothing about what the filters do moved.
    it('still filters from inside the panel', () => {
        const engine = makeEngine();

        const sport = document.getElementById('sport-filter');
        sport.value = 'nba';
        sport.dispatchEvent(new Event('change'));

        expect(visible(engine)).toEqual(['B']);
    });

    // Status is unconditional, so there is always something behind the button.
    // Named for what is actually true rather than for a gate that cannot fire.
    it('still offers the disclosure on the barest checklist, because Status is always there', () => {
        makeEngine([{ set: 'A', num: '1' }], { customFields: {}, customFilters: [] });

        expect(toggle()).not.toBeNull();
        expect(panel().querySelector('#status-filter')).not.toBeNull();
        // Nothing else earned a row: no priced cards, no custom fields.
        expect(panel().querySelectorAll('.filter-row')).toHaveLength(1);
    });

    it('heads a custom filter with its name, not with its All option', () => {
        makeEngine();

        const label = document.getElementById('sport-filter-label');
        expect(label.textContent).toBe('Sports');
        // And the select is actually named by it.
        expect(document.getElementById('sport-filter').getAttribute('aria-labelledby'))
            .toBe('sport-filter-label');
    });
});

describe('the disclosure behaves like a disclosure (#785)', () => {
    it('starts closed, and says so', () => {
        makeEngine();

        expect(toggle().getAttribute('aria-expanded')).toBe('false');
        expect(panel().hidden).toBe(true);
        expect(toggle().getAttribute('aria-controls')).toBe('filters-panel');
    });

    it('opens and closes on click', () => {
        makeEngine();

        toggle().click();
        expect(toggle().getAttribute('aria-expanded')).toBe('true');
        expect(panel().hidden).toBe(false);

        toggle().click();
        expect(panel().hidden).toBe(true);
    });

    // A working surface, not a menu: choosing one filter must not dismiss it.
    it('stays open when a control inside it is used', () => {
        makeEngine();
        toggle().click();

        panel().querySelector('.quick-filter-btn').click();

        expect(panel().hidden).toBe(false);
    });

    it('closes on a click outside', () => {
        makeEngine();
        toggle().click();

        document.body.click();

        expect(panel().hidden).toBe(true);
        expect(toggle().getAttribute('aria-expanded')).toBe('false');
    });

    it('closes on Escape, and takes focus with it', () => {
        makeEngine();
        toggle().click();

        document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

        expect(panel().hidden).toBe(true);
        expect(document.activeElement).toBe(toggle());
    });
});

describe('active filters stay visible outside the panel (#785)', () => {
    it('shows nothing while nothing is filtered', () => {
        makeEngine();

        expect(chips()).toHaveLength(0);
        expect(count().hidden).toBe(true);
    });

    it('names a chosen dropdown value', () => {
        const engine = makeEngine();
        const sport = document.getElementById('sport-filter');
        sport.value = 'nba';
        sport.dispatchEvent(new Event('change'));

        expect(chips().map(c => c.textContent.replace('×', ''))).toEqual(['NBA']);
        expect(count().textContent).toBe('1');
        expect(count().hidden).toBe(false);
    });

    it('names an active quick filter', () => {
        makeEngine();

        document.querySelector('.quick-filter-btn').click();

        expect(chips().map(c => c.textContent.replace('×', ''))).toEqual(['Auto']);
    });

    // One chip for a range, not two: separate min and max chips would read as
    // two filters that apply independently.
    it('shows one chip for the price range, however it was set', () => {
        makeEngine();
        const band = [...document.querySelectorAll('.price-band-btn')][0];
        band.click();

        expect(chips()).toHaveLength(1);
        expect(chips()[0].textContent).toContain(band.textContent);
    });

    it('describes a typed range that matches no band', () => {
        makeEngine();
        const max = document.getElementById('price-max-filter');
        max.value = '60';
        max.dispatchEvent(new Event('input'));

        expect(chips()[0].textContent).toContain('Under $60');
    });

    it('counts several at once', () => {
        makeEngine();
        const sport = document.getElementById('sport-filter');
        sport.value = 'nfl';
        sport.dispatchEvent(new Event('change'));
        document.querySelector('.quick-filter-btn').click();

        expect(chips()).toHaveLength(2);
        expect(count().textContent).toBe('2');
    });

    it('removes just the one whose chip was clicked', () => {
        const engine = makeEngine();
        const sport = document.getElementById('sport-filter');
        sport.value = 'nfl';
        sport.dispatchEvent(new Event('change'));
        const max = document.getElementById('price-max-filter');
        max.value = '60';
        max.dispatchEvent(new Event('input'));
        expect(chips()).toHaveLength(2);

        chips().find(c => c.textContent.includes('NFL')).click();

        expect(document.getElementById('sport-filter').value).toBe('all');
        expect(document.getElementById('price-max-filter').value).toBe('60');
        expect(chips()).toHaveLength(1);
        expect(visible(engine)).toEqual(['A', 'B']);
    });

    it('clears the lot from one button', () => {
        const engine = makeEngine();
        const sport = document.getElementById('sport-filter');
        sport.value = 'nfl';
        sport.dispatchEvent(new Event('change'));
        document.querySelector('.quick-filter-btn').click();

        document.getElementById('active-filters-clear').click();

        expect(chips()).toHaveLength(0);
        expect(count().hidden).toBe(true);
        expect(visible(engine)).toEqual(['A', 'B', 'C']);
    });

    // A min of 0 is the default, not a filter.
    it('raises no chip for a price floor of zero', () => {
        makeEngine();
        const min = document.getElementById('price-min-filter');
        min.value = '0';
        min.dispatchEvent(new Event('input'));

        expect(chips()).toHaveLength(0);
        expect(count().hidden).toBe(true);
    });

    // Clear all wipes the search box, so the chips have to account for it.
    it('shows the search term as a chip, since Clear all clears it', () => {
        makeEngine();
        const search = document.getElementById('search');
        search.value = 'prizm';
        search.dispatchEvent(new Event('input'));

        expect(chips().map(c => c.textContent.replace('×', ''))).toEqual(['"prizm"']);

        chips()[0].click();
        expect(document.getElementById('search').value).toBe('');
    });

    // The list is rebuilt wholesale, so the activated chip takes focus with it.
    it('moves focus somewhere real after a chip removes itself', () => {
        makeEngine();
        const sport = document.getElementById('sport-filter');
        sport.value = 'nba';
        sport.dispatchEvent(new Event('change'));

        chips()[0].click();

        expect(document.activeElement).toBe(document.getElementById('search'));
    });

    it('names the toggle for its count, since the badge is inside it', () => {
        makeEngine();
        expect(toggle().getAttribute('aria-label')).toBe('Filters');

        const sport = document.getElementById('sport-filter');
        sport.value = 'nba';
        sport.dispatchEvent(new Event('change'));

        expect(toggle().getAttribute('aria-label')).toBe('Filters, 1 active');
        expect(count().getAttribute('aria-hidden')).toBe('true');
    });

    it('names each chip for assistive tech, since the glyph carries the action', () => {
        makeEngine();
        const sport = document.getElementById('sport-filter');
        sport.value = 'nba';
        sport.dispatchEvent(new Event('change'));

        expect(chips()[0].getAttribute('aria-label')).toBe('Remove filter: NBA');
        expect(chips()[0].querySelector('.active-filter-x').getAttribute('aria-hidden')).toBe('true');
    });

    // The no-matches state has its own Clear button; both go through
    // _clearFilters, so neither can leave the chips behind.
    it('empties when the no-matches Clear button is used', () => {
        const engine = makeEngine();
        // A real filter as well as the search, or there are no chips to empty
        // and this only asserts that the cards came back.
        const sport = document.getElementById('sport-filter');
        sport.value = 'nfl';
        sport.dispatchEvent(new Event('change'));
        document.querySelector('.quick-filter-btn').click();
        expect(chips()).toHaveLength(2);

        document.getElementById('search').value = 'nothing matches this';
        document.getElementById('search').dispatchEvent(new Event('input'));
        expect(document.querySelector('.no-matches-clear')).not.toBeNull();

        document.querySelector('.no-matches-clear').click();

        expect(chips()).toHaveLength(0);
        expect(count().hidden).toBe(true);
        expect(visible(engine)).toEqual(['A', 'B', 'C']);
    });
});

describe('the bar finally has responsive rules (#785)', () => {
    const css = () => readFileSync(resolve(import.meta.dirname, '..', 'shared.css'), 'utf-8');

    // It had none at all: .filters was a bare flex-wrap, so 13 controls became a
    // wall on a phone. jsdom applies no cascade, so this is read from source.
    // Sliced to the block's own closing brace: to EOF, these would pass just as
    // well with the rules sitting outside the media query entirely.
    const block = (sheet, opener) => {
        const start = sheet.indexOf(opener);
        expect(start, opener).toBeGreaterThan(-1);
        let depth = 0;
        for (let i = sheet.indexOf('{', start); i < sheet.length; i++) {
            if (sheet[i] === '{') depth++;
            else if (sheet[i] === '}' && --depth === 0) return sheet.slice(start, i + 1);
        }
        throw new Error(`unbalanced ${opener}`);
    };

    it('stacks the row on a narrow screen', () => {
        const narrow = block(css(), '@media (max-width: 600px)');

        expect(narrow).toContain('.filter-bar .search-wrapper');
        expect(narrow).toContain('.filter-panel');
    });

    // With only four controls left in the row, an uncapped search box spans most
    // of a desktop screen and reads as a mistake.
    it('caps the search box on a wide screen, and uncaps it on a narrow one', () => {
        const sheet = css();
        const rule = sheet.slice(sheet.indexOf('.filter-bar .search-wrapper {'));

        expect(rule.slice(0, 140)).toContain('max-width: 360px');
        expect(block(sheet, '@media (max-width: 600px)')).toContain('max-width: none');
    });

    it('gives the panel and the chips real tap targets', () => {
        expect(block(css(), '@media (pointer: coarse)')).toContain('.active-filter');
    });

    // An author `display` beats the UA [hidden] rule, so the badge was an accent
    // dot beside "Filters" at all times. jsdom applies no cascade in the other
    // tests, so the attribute assertion there gave false confidence.
    it('actually hides the count badge, rather than only marking it hidden', () => {
        const sheet = css();
        const base = sheet.indexOf('.filter-count {');
        const override = sheet.indexOf('.filter-count[hidden]');

        expect(override).toBeGreaterThan(-1);
        expect(sheet.slice(override, override + 60)).toContain('display: none');
        // After the rule it overrides, like .filter-panel[hidden].
        expect(override).toBeGreaterThan(base);
    });
});
