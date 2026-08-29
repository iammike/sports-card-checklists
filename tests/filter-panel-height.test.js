import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// #792: the panel had no height limit, so a checklist with several custom
// filters rendered a 636px panel. Measured on a 375x553 phone, the Clear
// filters button sat 223px below the fold; at 320x568, 359px below.
//
// It was never unreachable - an absolutely positioned element extends the
// page's scroll range, and the measurements confirmed the button could always
// be scrolled to. The cost was that reaching it scrolled the page out from
// under the trigger that opened the panel, with the panel sliding away too.
//
// CSS cannot express the cap, because how much room the panel has depends on
// where the bar has scrolled to. Hence a measured max-height set on open, and
// an inner .filter-panel-body that takes the scrolling so the footer stays put.

const CONFIG = {
    dataShape: 'flat',
    customFields: { auto: { type: 'checkbox' } },
    cardDisplay: {},
    sortOptions: ['default', 'year'],
    customFilters: [{
        id: 'sport', allLabel: 'All Sports', cardField: 'sport',
        options: [{ value: 'nfl', label: 'NFL' }, { value: 'nba', label: 'NBA' }],
    }],
};

function makeEngine() {
    const engine = Object.create(globalThis.ChecklistEngine.prototype);
    engine.id = 'test';
    engine.config = CONFIG;
    engine.cards = [{ set: 'A', num: '1', sport: 'nfl', price: 1 }];
    engine._renderedCards = [];
    engine._reorderMode = false;
    engine.updateStats = vi.fn();
    engine.checklistManager = new globalThis.ChecklistManager({ checklistId: 'test' });
    engine.checklistManager.ownedCards = [];
    engine.checklistManager.isReadOnly = false;
    engine._renderFilters();
    return engine;
}

// jsdom lays nothing out, so the two inputs the cap is computed from are stubbed.
const setViewportHeight = (h) =>
    Object.defineProperty(window, 'innerHeight', { value: h, configurable: true });
const stubTop = (el, top) => {
    el.getBoundingClientRect = () => ({ top, bottom: top, left: 0, right: 0, width: 0, height: 0 });
};

const panel = () => document.getElementById('filters-panel');
const toggle = () => document.getElementById('filters-toggle');

beforeEach(() => {
    document.body.innerHTML = '<div id="filters-container"></div>'
        + '<div id="sections-container"></div>'
        + '<div class="no-matches-state" id="no-matches-state" role="status"></div>';
    setViewportHeight(768);
});

describe('the open panel is capped to the room beneath it (#792)', () => {
    it('leaves the viewport bottom clear by the margin', () => {
        const engine = makeEngine();
        setViewportHeight(600);
        panel().hidden = false;
        stubTop(panel(), 200);

        engine._sizeFilterPanel(panel());

        // 600 viewport - 200 top - 12 margin
        expect(panel().style.maxHeight).toBe('388px');
    });

    // A cap smaller than this leaves the filters scrolling inside a sliver,
    // which is worse than running past the fold.
    it('stops shrinking once there is almost no room', () => {
        const engine = makeEngine();
        setViewportHeight(600);
        panel().hidden = false;
        stubTop(panel(), 500);

        engine._sizeFilterPanel(panel());

        // room would be 88px
        expect(panel().style.maxHeight).toBe('220px');
    });

    it('measures again rather than reusing the first answer', () => {
        const engine = makeEngine();
        setViewportHeight(900);
        panel().hidden = false;
        stubTop(panel(), 100);
        engine._sizeFilterPanel(panel());
        expect(panel().style.maxHeight).toBe('788px');

        setViewportHeight(500);
        engine._sizeFilterPanel(panel());

        expect(panel().style.maxHeight).toBe('388px');
    });

    it('does nothing for a panel that is not open', () => {
        const engine = makeEngine();
        stubTop(panel(), 100);

        engine._sizeFilterPanel(panel());

        expect(panel().hidden).toBe(true);
        expect(panel().style.maxHeight).toBe('');
    });
});

describe('the cap is applied when it matters (#792)', () => {
    it('sizes the panel as it opens', () => {
        const engine = makeEngine();
        setViewportHeight(600);
        stubTop(panel(), 150);
        expect(panel().style.maxHeight).toBe('');

        toggle().click();

        expect(panel().hidden).toBe(false);
        expect(panel().style.maxHeight).toBe('438px');
        expect(engine).toBeTruthy();
    });

    // Turning a phone sideways halves the room under an open panel.
    it('re-sizes on resize while it is open', () => {
        makeEngine();
        setViewportHeight(600);
        stubTop(panel(), 150);
        toggle().click();
        expect(panel().style.maxHeight).toBe('438px');

        setViewportHeight(400);
        window.dispatchEvent(new Event('resize'));

        expect(panel().style.maxHeight).toBe('238px');
    });

    it('ignores a resize while it is closed', () => {
        makeEngine();
        stubTop(panel(), 150);

        setViewportHeight(400);
        window.dispatchEvent(new Event('resize'));

        expect(panel().hidden).toBe(true);
        expect(panel().style.maxHeight).toBe('');
    });
});

describe('the panel scrolls its filters, not its footer (#792)', () => {
    it('wraps the filter rows in a scrollable body', () => {
        makeEngine();
        const body = panel().querySelector('.filter-panel-body');

        expect(body).not.toBeNull();
        expect(body.querySelectorAll('.filter-row').length).toBeGreaterThan(0);
        // Every row is inside it, or the ones left behind never scroll.
        expect(panel().querySelectorAll('.filter-row').length)
            .toBe(body.querySelectorAll('.filter-row').length);
    });

    it('keeps the footer outside that body, so it does not scroll away', () => {
        makeEngine();
        const footer = panel().querySelector('.filter-panel-footer');

        expect(footer).not.toBeNull();
        expect(footer.closest('.filter-panel-body')).toBeNull();
        expect(footer.parentElement).toBe(panel());
    });
});

describe('the scrolling rules back it up (#792)', () => {
    const css = () => readFileSync(resolve(import.meta.dirname, '..', 'shared.css'), 'utf-8');
    const rule = (selector) => {
        const sheet = css();
        const start = sheet.indexOf(selector);
        expect(start, selector).toBeGreaterThan(-1);
        return sheet.slice(start, sheet.indexOf('}', start));
    };

    it('gives the body its own scrollbar', () => {
        expect(rule('.filter-panel-body {')).toContain('overflow-y: auto');
    });

    // Without this the body keeps its content height, the cap clips the panel,
    // and the footer is cut off instead of the filters scrolling.
    it('lets the body shrink below its content', () => {
        expect(rule('.filter-panel-body {')).toContain('min-height: 0');
    });

    it('stops the rows compressing in place of scrolling', () => {
        expect(rule('.filter-row {')).toContain('flex-shrink: 0');
    });

    it('pins the footer', () => {
        expect(rule('.filter-panel-footer {')).toContain('flex-shrink: 0');
    });
});
