import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const ChecklistEngine = globalThis.ChecklistEngine;
const ChecklistManager = globalThis.ChecklistManager;

// Mirrors the harness in tests/custom-filter-match.test.js and
// tests/price-range-and-quick-filters.test.js: a real ChecklistManager and a
// real DOM render, so filtering-before-export is exercised the way a user's
// clicks actually drive it, not a hand-built "visible cards" list.
function makeEngine(config, cards) {
    const engine = Object.create(ChecklistEngine.prototype);
    engine.id = 'test-checklist';
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
    engine.checklistManager = new ChecklistManager({ checklistId: 'test-checklist' });
    engine.checklistManager.ownedCards = [];
    engine.checklistManager.isReadOnly = false;
    return engine;
}

// Parses the exact CSV _downloadCSV was handed - a naive split(',') would
// break on any quoted cell containing a comma, which is precisely the case
// this format exists to handle correctly.
function parseCSV(csv) {
    return csv.split('\r\n').map(line => {
        const cells = [];
        let cell = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const c = line[i];
            if (inQuotes) {
                if (c === '"' && line[i + 1] === '"') { cell += '"'; i++; }
                else if (c === '"') { inQuotes = false; }
                else { cell += c; }
            } else if (c === '"') {
                inQuotes = true;
            } else if (c === ',') {
                cells.push(cell); cell = '';
            } else {
                cell += c;
            }
        }
        cells.push(cell);
        return cells;
    });
}

beforeEach(() => {
    document.body.innerHTML = '<div id="filters-container"></div><div id="sections-container"></div>';
    window.alert = vi.fn();
});

// The slider's raw <input> position isn't a dollar amount (see
// _priceAtSliderPosition) - inverts that same percentile mapping to find the
// raw position whose price is closest to `price`. Same helper as
// tests/price-range-and-quick-filters.test.js.
function rawForPrice(price, sortedPrices, resolution) {
    const n = sortedPrices.length;
    if (n === 0 || price <= 0) return 0;
    const points = [0, ...sortedPrices];
    if (price >= points[n]) return resolution;
    let i = 0;
    while (i < n && points[i + 1] < price) i++;
    const lo = points[i], hi = points[i + 1];
    const frac = hi === lo ? 0 : (price - lo) / (hi - lo);
    return ((i + frac) / n) * resolution;
}

describe('ChecklistEngine._csvCell', () => {
    it('leaves a plain value unquoted', () => {
        const engine = makeEngine({}, []);
        expect(engine._csvCell('Prizm')).toBe('Prizm');
    });

    it('quotes and escapes a value containing a comma', () => {
        const engine = makeEngine({}, []);
        expect(engine._csvCell('2024 Panini, Prizm')).toBe('"2024 Panini, Prizm"');
    });

    it('quotes and doubles internal quotes', () => {
        const engine = makeEngine({}, []);
        expect(engine._csvCell('18" rookie patch')).toBe('"18"" rookie patch"');
    });

    it('quotes a value containing a newline', () => {
        const engine = makeEngine({}, []);
        expect(engine._csvCell('line1\nline2')).toBe('"line1\nline2"');
    });

    it('renders null/undefined as an empty cell rather than the string "null"', () => {
        const engine = makeEngine({}, []);
        expect(engine._csvCell(null)).toBe('');
        expect(engine._csvCell(undefined)).toBe('');
    });

    it('stringifies a number', () => {
        const engine = makeEngine({}, []);
        expect(engine._csvCell(25)).toBe('25');
    });
});

describe('ChecklistEngine._getVisibleCards', () => {
    const cards = [
        { set: 'A', num: '1', price: 5 },
        { set: 'B', num: '2', price: 100 },
        { set: 'C', num: '3', noCard: true },
        { set: 'D', num: '4', collectionLink: 'other-checklist' },
    ];

    it('excludes noCard and collectionLink entries even when visible', () => {
        const engine = makeEngine({}, cards);
        engine._renderFilters();
        engine.renderCards();

        const visible = engine._getVisibleCards();
        expect(visible.map(c => c.set)).toEqual(['A', 'B']);
    });

    it('excludes cards hidden by the active filters', () => {
        const engine = makeEngine({}, cards);
        engine._renderFilters();
        engine.renderCards();
        const min = document.getElementById('price-min-filter');
        const sortedPrices = JSON.parse(document.getElementById('price-range-filter').dataset.prices);
        const resolution = parseFloat(min.max);
        min.value = rawForPrice(50, sortedPrices, resolution); // between A ($5) and B ($100)
        engine._applyFilters();

        const visible = engine._getVisibleCards();
        expect(visible.map(c => c.set)).toEqual(['B']);
    });
});

describe('ChecklistEngine._exportCSV', () => {
    it('alerts and does not attempt a download when nothing is visible', () => {
        const engine = makeEngine({}, []);
        engine._renderFilters();
        engine.renderCards();
        const download = vi.spyOn(engine, '_downloadCSV').mockImplementation(() => {});

        engine._exportCSV();

        expect(window.alert).toHaveBeenCalled();
        expect(download).not.toHaveBeenCalled();
    });

    it('downloads a file named after the checklist id', () => {
        const engine = makeEngine({}, [{ set: 'A', num: '1', player: 'Test Player' }]);
        engine._renderFilters();
        engine.renderCards();
        const download = vi.spyOn(engine, '_downloadCSV').mockImplementation(() => {});

        engine._exportCSV();

        expect(download).toHaveBeenCalledTimes(1);
        expect(download.mock.calls[0][1]).toBe('test-checklist.csv');
    });

    it('includes Player/Set/Number/Variant/Type/Price/Owned columns for a flat checklist', () => {
        const engine = makeEngine({}, [
            { set: '2024 Prizm', num: '10', variant: 'Silver', type: 'Base', player: 'Jayden Daniels', price: 45 },
        ]);
        engine._renderFilters();
        engine.renderCards();
        const download = vi.spyOn(engine, '_downloadCSV').mockImplementation(() => {});

        engine._exportCSV();

        const [csv] = download.mock.calls[0];
        const rows = parseCSV(csv);
        expect(rows[0]).toEqual(['Player', 'Set', 'Number', 'Variant', 'Type', 'Price', 'Owned']);
        expect(rows[1]).toEqual(['Jayden Daniels', '2024 Prizm', '10', 'Silver', 'Base', '45', 'No']);
    });

    it('reports Owned: Yes for a card the checklist manager has recorded as owned', () => {
        const card = { id: 'n1', set: 'Prizm', num: '10' };
        const engine = makeEngine({}, [card]);
        engine.checklistManager.ownedCards = [engine.getCardId(card)];
        engine._renderFilters();
        engine.renderCards();
        const download = vi.spyOn(engine, '_downloadCSV').mockImplementation(() => {});

        engine._exportCSV();

        const rows = parseCSV(download.mock.calls[0][0]);
        expect(rows[1][rows[0].indexOf('Owned')]).toBe('Yes');
    });

    it('leaves price blank for an unpriced card rather than printing 0', () => {
        const engine = makeEngine({}, [{ set: 'A', num: '1' }]);
        engine._renderFilters();
        engine.renderCards();
        const download = vi.spyOn(engine, '_downloadCSV').mockImplementation(() => {});

        engine._exportCSV();

        const rows = parseCSV(download.mock.calls[0][0]);
        expect(rows[1][rows[0].indexOf('Price')]).toBe('');
    });

    it('escapes a comma inside a set name so it stays one column', () => {
        const engine = makeEngine({}, [{ set: '2024 Panini, Prizm', num: '1' }]);
        engine._renderFilters();
        engine.renderCards();
        const download = vi.spyOn(engine, '_downloadCSV').mockImplementation(() => {});

        engine._exportCSV();

        const [csv] = download.mock.calls[0];
        const rows = parseCSV(csv);
        expect(rows[1][rows[0].indexOf('Set')]).toBe('2024 Panini, Prizm');
        // The raw CSV text must actually quote it - otherwise a naive parser
        // (or Excel) would split this one cell into two.
        expect(csv).toContain('"2024 Panini, Prizm"');
    });

    it('adds a Category column only for a category-shaped checklist', () => {
        const flatEngine = makeEngine({}, [{ set: 'A', num: '1' }]);
        flatEngine._renderFilters();
        flatEngine.renderCards();
        const flatDownload = vi.spyOn(flatEngine, '_downloadCSV').mockImplementation(() => {});
        flatEngine._exportCSV();
        expect(parseCSV(flatDownload.mock.calls[0][0])[0]).not.toContain('Category');

        const catEngine = makeEngine(
            { dataShape: 'categories', categories: [{ id: 'base' }] },
            { base: [{ set: 'A', num: '1' }] },
        );
        catEngine._renderFilters();
        catEngine.renderCards();
        const catDownload = vi.spyOn(catEngine, '_downloadCSV').mockImplementation(() => {});
        catEngine._exportCSV();
        expect(parseCSV(catDownload.mock.calls[0][0])[0][0]).toBe('Category');
    });

    it('includes attribute columns only when the checklist declares that customField', () => {
        const engine = makeEngine(
            { customFields: { auto: { type: 'checkbox' }, patch: { type: 'checkbox' } } },
            [{ set: 'A', num: '1', auto: true, patch: false, serial: '/99' }],
        );
        engine._renderFilters();
        engine.renderCards();
        const download = vi.spyOn(engine, '_downloadCSV').mockImplementation(() => {});

        engine._exportCSV();

        const rows = parseCSV(download.mock.calls[0][0]);
        // auto/patch declared -> columns present; serial not declared -> absent
        expect(rows[0]).toContain('Auto');
        expect(rows[0]).toContain('Patch');
        expect(rows[0]).not.toContain('Numbered');
        expect(rows[1][rows[0].indexOf('Auto')]).toBe('Yes');
        expect(rows[1][rows[0].indexOf('Patch')]).toBe(''); // false -> blank, not "No"
    });

    it('prints the serial value itself, not "Yes", for a numbered card', () => {
        const engine = makeEngine(
            { customFields: { serial: { type: 'text' } } },
            [{ set: 'A', num: '1', serial: '/99' }],
        );
        engine._renderFilters();
        engine.renderCards();
        const download = vi.spyOn(engine, '_downloadCSV').mockImplementation(() => {});

        engine._exportCSV();

        const rows = parseCSV(download.mock.calls[0][0]);
        expect(rows[1][rows[0].indexOf('Numbered')]).toBe('/99');
    });

    it('only exports what the active filters leave visible', () => {
        const engine = makeEngine({}, [
            { set: 'A', num: '1', price: 5 },
            { set: 'B', num: '2', price: 100 },
        ]);
        engine._renderFilters();
        engine.renderCards();
        const min = document.getElementById('price-min-filter');
        const sortedPrices = JSON.parse(document.getElementById('price-range-filter').dataset.prices);
        const resolution = parseFloat(min.max);
        min.value = rawForPrice(50, sortedPrices, resolution); // between A ($5) and B ($100)
        engine._applyFilters();
        const download = vi.spyOn(engine, '_downloadCSV').mockImplementation(() => {});

        engine._exportCSV();

        const rows = parseCSV(download.mock.calls[0][0]);
        expect(rows.length).toBe(2); // header + the one card still visible
        expect(rows[1][rows[0].indexOf('Set')]).toBe('B');
    });
});

describe('ChecklistEngine._downloadCSV', () => {
    it('triggers a Blob download named for the given filename', () => {
        const engine = makeEngine({}, []);
        const createObjectURL = vi.fn(() => 'blob:mock-url');
        const revokeObjectURL = vi.fn();
        const realCreate = URL.createObjectURL;
        const realRevoke = URL.revokeObjectURL;
        URL.createObjectURL = createObjectURL;
        URL.revokeObjectURL = revokeObjectURL;
        const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

        try {
            engine._downloadCSV('a,b\r\n1,2', 'my-checklist.csv');

            expect(createObjectURL).toHaveBeenCalledTimes(1);
            const blob = createObjectURL.mock.calls[0][0];
            expect(blob.type).toBe('text/csv;charset=utf-8;');
            expect(clickSpy).toHaveBeenCalledTimes(1);
            expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
        } finally {
            URL.createObjectURL = realCreate;
            URL.revokeObjectURL = realRevoke;
            clickSpy.mockRestore();
        }
    });
});

// The button moves rather than duplicating: a logged-out visitor has no nav
// menu to put it in, so the filter bar carries it; a logged-in user gets it
// from the nav dropdown instead, keeping the filter bar less cluttered for
// whoever sees it on every visit (same _exportCSV() handler either way).
describe('Export CSV moves between the filter bar and the nav menu based on login state', () => {
    let realGithubSync;

    beforeEach(() => {
        realGithubSync = window.githubSync;
    });

    afterEach(() => {
        window.githubSync = realGithubSync;
    });

    it('shows the filter-bar button for a logged-out visitor', () => {
        delete window.githubSync;
        const engine = makeEngine({}, [{ set: 'A', num: '1' }]);
        engine._renderFilters();

        expect(document.getElementById('export-csv-btn')).not.toBeNull();
    });

    it('hides the filter-bar button for a logged-in user', () => {
        window.githubSync = { isLoggedIn: () => true, getUser: () => ({ login: 'someone-else' }) };
        const engine = makeEngine({}, [{ set: 'A', num: '1' }]);
        engine._renderFilters();

        expect(document.getElementById('export-csv-btn')).toBeNull();
    });

    it('_initExportButton does nothing for a logged-out visitor', () => {
        delete window.githubSync;
        document.body.innerHTML += '<div class="nav-dropdown"><button id="auth-logout-btn"></button></div>';
        const engine = makeEngine({}, []);

        engine._initExportButton();

        expect(document.getElementById('nav-export-csv-btn')).toBeNull();
    });

    it('_initExportButton adds a nav item for a logged-in user, positioned before the delete divider', () => {
        window.githubSync = { isLoggedIn: () => true };
        document.body.innerHTML +=
            '<div class="nav-dropdown">' +
            '<div class="nav-dropdown-divider" id="delete-divider"></div>' +
            '<button id="checklist-delete-btn"></button>' +
            '<button id="auth-logout-btn"></button>' +
            '</div>';
        const engine = makeEngine({}, []);

        engine._initExportButton();

        const exportBtn = document.getElementById('nav-export-csv-btn');
        expect(exportBtn).not.toBeNull();
        expect(exportBtn.nextElementSibling.id).toBe('delete-divider'); // lands right before Delete's divider
    });

    it('_initExportButton falls back to landing before sign-out when there is no delete button', () => {
        window.githubSync = { isLoggedIn: () => true };
        document.body.innerHTML += '<div class="nav-dropdown"><button id="auth-logout-btn"></button></div>';
        const engine = makeEngine({}, []);

        engine._initExportButton();

        const exportBtn = document.getElementById('nav-export-csv-btn');
        expect(exportBtn.nextElementSibling.id).toBe('auth-logout-btn');
    });

    it('clicking the nav item closes the dropdown and triggers the same export', () => {
        window.githubSync = { isLoggedIn: () => true };
        document.body.innerHTML +=
            '<div class="nav-dropdown open"><button id="auth-logout-btn"></button></div>';
        const engine = makeEngine({}, [{ set: 'A', num: '1' }]);
        const exportSpy = vi.spyOn(engine, '_exportCSV').mockImplementation(() => {});

        engine._initExportButton();
        document.getElementById('nav-export-csv-btn').click();

        expect(exportSpy).toHaveBeenCalledTimes(1);
        expect(document.querySelector('.nav-dropdown').classList.contains('open')).toBe(false);
    });
});
