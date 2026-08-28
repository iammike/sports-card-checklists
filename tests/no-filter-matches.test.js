import { describe, it, expect, beforeEach, vi } from 'vitest';

const ChecklistEngine = globalThis.ChecklistEngine;
const ChecklistManager = globalThis.ChecklistManager;

// #769: _applyFilters only ever toggled .filter-hidden, and
// _updateSectionVisibility then hid every section, group header and note with
// nothing left in it. A filter combination matching nothing left the page blank,
// which reads as broken rather than as an empty result - and gave no way back
// out except undoing each filter by hand.
//
// These drive the real _applyFilters and the real _filterCard; stubbing either
// would test the harness rather than the filtering.

const CARDS = [
    { set: '2024 Prizm', num: '1', player: 'Jayden Daniels', price: 5, sport: 'football' },
    { set: '2024 Select', num: '2', player: 'Terry McLaurin', price: 50, sport: 'football' },
];

function makeEngine(cards = CARDS, config = {}) {
    const engine = Object.create(ChecklistEngine.prototype);
    engine.id = 'test';
    engine.config = {
        dataShape: 'flat',
        customFields: {},
        cardDisplay: {},
        ...config,
    };
    engine.cards = cards;
    engine._renderedCards = [];
    engine._reorderMode = false;
    engine.updateStats = vi.fn();
    engine.checklistManager = {
        getCardId: ChecklistManager.prototype.getCardId,
        isOwned: () => false,
        toggleOwned: () => {},
        setSyncStatus: () => {},
        isOwner: () => false,
        isReadOnly: true,
    };
    engine._renderFilters();
    engine.renderCards();
    return engine;
}

const container = () => document.getElementById('sections-container');
// The region is permanent, so "showing" means it has contents - not that it exists.
const region = () => document.getElementById('no-matches-state');
const banner = () => (region()?.childElementCount ? region() : null);
const clearBtn = () => region().querySelector('.no-matches-clear');
const visibleCards = () => [...container().querySelectorAll('.card:not(.filter-hidden)')];

beforeEach(() => {
    document.body.innerHTML = '<div id="filters-container"></div>'
        + '<div id="sections-container"></div>'
        + '<div class="no-matches-state" id="no-matches-state" role="status"></div>';
    localStorage.clear();
});

describe('ChecklistEngine — the no-matches state (#769)', () => {
    it('shows nothing extra while cards still match', () => {
        makeEngine();

        expect(visibleCards().length).toBe(2);
        expect(banner()).toBeNull();
    });

    it('appears once a search matches no card', () => {
        const engine = makeEngine();

        document.getElementById('search').value = 'nobody named this';
        engine._applyFilters();

        expect(visibleCards()).toHaveLength(0);
        expect(banner()).not.toBeNull();
        expect(banner().textContent).toMatch(/no cards match/i);
        // The pattern this mirrors: permanent node, in the tree before it speaks.
        expect(region().getAttribute('role')).toBe('status');
    });

    it('goes away again when a filter change brings cards back', () => {
        const engine = makeEngine();
        const search = document.getElementById('search');

        search.value = 'nobody named this';
        engine._applyFilters();
        expect(banner()).not.toBeNull();

        search.value = 'jayden';
        engine._applyFilters();

        expect(banner()).toBeNull();
        expect(visibleCards()).toHaveLength(1);
    });

    // The genuinely-empty checklist has its own state, rendered instead of the
    // sections. Showing "no cards match these filters" over it would be wrong.
    it('stays out of the way of a checklist with no cards at all', () => {
        makeEngine([]);

        expect(banner()).toBeNull();
        expect(container().querySelector('.empty-state-card')).not.toBeNull();
    });

    it('stays quiet while a quick filter still matches something', () => {
        const engine = makeEngine(
            [...CARDS, { set: '2024 Prizm', num: '3', player: 'Signed Card', price: 10, auto: true }],
            { customFields: { auto: {} } },
        );
        document.querySelector('.quick-filter-btn').classList.add('active');
        engine._applyFilters();

        expect(visibleCards()).toHaveLength(1);
        expect(banner()).toBeNull();
    });

    // The category shape is where sections, group headers and .section-group all
    // live; every other test here uses the flat shape.
    it('lands after the last section on a category-shaped checklist', () => {
        // categories is an array of { id, label } - not a keyed object. Read
        // _renderCategoryCards before touching this fixture.
        const engine = makeEngine(
            { rookies: [CARDS[0]], inserts: [CARDS[1]] },
            {
                dataShape: 'categories',
                categories: [
                    { id: 'rookies', label: 'Rookies' },
                    { id: 'inserts', label: 'Inserts' },
                ],
            },
        );
        expect(visibleCards()).toHaveLength(2);

        document.getElementById('search').value = 'nobody named this';
        engine._applyFilters();

        expect(banner()).not.toBeNull();
        expect(container().querySelectorAll('.section:not([style*="display: none"])')).toHaveLength(0);

        clearBtn().click();
        expect(visibleCards()).toHaveLength(2);
    });

    // Rebuilding on every keystroke would drop focus from the Clear button.
    it('keeps the same node across re-filters while it stays empty', () => {
        const engine = makeEngine();
        document.getElementById('search').value = 'nobody named this';
        engine._applyFilters();

        const first = clearBtn();
        // Identity alone is not enough twice over: banner() is null before the
        // feature exists, and a querySelector holds its identity even with a
        // second copy stacked behind it. Pin the count, and pin the button rather
        // than the region - the region is permanent, so only its contents move.
        expect(first).not.toBeNull();

        engine._applyFilters();
        engine._applyFilters();

        expect(region().querySelectorAll('.no-matches-clear')).toHaveLength(1);
        expect(region().querySelectorAll('.no-matches-text')).toHaveLength(1);
        expect(clearBtn()).toBe(first);
    });
});

describe('ChecklistEngine._clearFilters (#769)', () => {
    it('brings every card back from a search that hid them all', () => {
        const engine = makeEngine();
        document.getElementById('search').value = 'nobody named this';
        engine._applyFilters();

        clearBtn().click();

        expect(document.getElementById('search').value).toBe('');
        expect(visibleCards()).toHaveLength(2);
        expect(banner()).toBeNull();
    });

    it('resets the status filter', () => {
        const engine = makeEngine();
        const status = document.getElementById('status-filter');
        status.value = 'owned'; // nothing is owned in this fixture
        engine._applyFilters();
        expect(visibleCards()).toHaveLength(0);

        engine._clearFilters();

        expect(status.value).toBe('all');
        expect(visibleCards()).toHaveLength(2);
    });

    it('resets a custom filter dropdown', () => {
        const engine = makeEngine(CARDS, {
            customFilters: [{
                id: 'sport',
                options: [{ value: 'football', label: 'Football' }, { value: 'baseball', label: 'Baseball' }],
            }],
        });
        const sport = document.getElementById('sport-filter');
        sport.value = 'baseball';
        engine._applyFilters();
        expect(visibleCards()).toHaveLength(0);

        engine._clearFilters();

        expect(sport.value).toBe('all');
        expect(visibleCards()).toHaveLength(2);
    });

    // The default fixture declares no customFields, so _quickFilterDefs renders
    // nothing and a test written against it would assert against an empty list -
    // pin the count first, or this passes without exercising anything.
    it('releases the quick-filter buttons, and their aria-pressed with them', () => {
        const engine = makeEngine(CARDS, { customFields: { auto: {} } });
        const buttons = [...document.querySelectorAll('.quick-filter-btn')];
        expect(buttons).toHaveLength(1);

        const btn = buttons[0];
        btn.classList.add('active');
        btn.setAttribute('aria-pressed', 'true');
        engine._applyFilters();
        // Neither fixture card carries `auto`, so this hides everything.
        expect(visibleCards()).toHaveLength(0);
        expect(banner()).not.toBeNull();

        clearBtn().click();

        expect(btn.classList.contains('active')).toBe(false);
        expect(btn.getAttribute('aria-pressed')).toBe('false');
        expect(visibleCards()).toHaveLength(2);
        expect(banner()).toBeNull();
    });

    // Empty, not zero: blank is what "no bound" means to _applyFilters, and a 0
    // left in the min box would read as a filter the user did not set (#772).
    it('empties the price fields rather than zeroing them', () => {
        const engine = makeEngine();
        const min = document.getElementById('price-min-filter');
        const max = document.getElementById('price-max-filter');

        min.value = '100';
        max.value = '200';
        max.dispatchEvent(new Event('input'));
        expect(visibleCards()).toHaveLength(0);
        expect(banner()).not.toBeNull();

        engine._clearFilters();

        expect(min.value).toBe('');
        expect(max.value).toBe('');
        expect(visibleCards()).toHaveLength(2);
    });

    it('releases the active price band with the range it set', () => {
        const engine = makeEngine();
        const band = [...document.querySelectorAll('.price-band-btn')]
            .find(b => b.textContent === '$25+');
        band.click();
        // Both sides asserted: checking only the post-clear false would pass
        // just as well if the class were never applied in the first place.
        expect(band.getAttribute('aria-pressed')).toBe('true');
        expect(band.classList.contains('active')).toBe(true);
        expect(document.getElementById('price-min-filter').value).toBe('25');

        engine._clearFilters();

        expect(band.getAttribute('aria-pressed')).toBe('false');
        expect(band.classList.contains('active')).toBe(false);
        expect(document.getElementById('price-min-filter').value).toBe('');
    });

    // The button removes itself as part of clearing, so without a deliberate
    // move focus lands on <body> and a keyboard user is dumped to the top.
    // (Unrelated to the price filter - deleted as collateral when the slider
    // tests went, and still passing, so restored.)
    it('moves focus to the search box instead of dropping it on the body', () => {
        const engine = makeEngine();
        document.getElementById('search').value = 'nobody named this';
        engine._applyFilters();

        const btn = clearBtn();
        btn.focus();
        expect(document.activeElement).toBe(btn);

        btn.click();

        expect(document.activeElement).toBe(document.getElementById('search'));
    });

    // Sorting is not filtering; clearing filters should not discard the order.
    it('leaves the sort dropdown alone', () => {
        const engine = makeEngine();
        const sort = document.getElementById('sort-filter');
        sort.value = 'price-high';

        engine._clearFilters();

        expect(sort.value).toBe('price-high');
    });
});
