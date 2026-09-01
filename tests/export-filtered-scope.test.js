import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fakeDoc } from './fake-jspdf.js';

const ChecklistExport = globalThis.ChecklistExport;
const ChecklistEngine = globalThis.ChecklistEngine;
const ChecklistManager = globalThis.ChecklistManager;

// #745: the visitor export always wrote the whole checklist. The card-show use
// case at the top of that issue is the opposite - "needed, under $50" should
// narrow the file the way it narrows the grid. Offered as a choice rather than
// applied silently, because the export deliberately ignores the visitor's sort
// on the grounds that a file should be the checklist and not one person's view
// of it; scope is the one axis where that stops being true on request.

const CARDS = [
    { set: 'A', num: '1', price: 5 },
    { set: 'B', num: '2', price: 50 },
    { set: 'C', num: '3', price: 500 },
];
const CONFIG = { dataShape: 'flat', cardDisplay: {}, sortOptions: ['default', 'year'] };

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

beforeEach(() => {
    document.body.innerHTML = '<div id="filters-container"></div>'
        + '<div id="sections-container"></div>'
        + '<div class="no-matches-state" id="no-matches-state" role="status"></div>';
});

afterEach(() => {
    document.querySelectorAll('.shopping-list-backdrop').forEach(el => el.remove());
    ChecklistExport.backdrop = null;
});

describe('ChecklistEngine._visibleCards (#745)', () => {
    it('is every card when nothing is filtered', () => {
        const engine = makeEngine();

        expect(engine._visibleCards().map(c => c.set)).toEqual(['A', 'B', 'C']);
    });

    it('narrows with the grid', () => {
        const engine = makeEngine();
        document.getElementById('search').value = 'B';
        document.getElementById('search').dispatchEvent(new Event('input'));

        expect(engine._visibleCards().map(c => c.set)).toEqual(['B']);
    });

    it('comes back empty when the filters match nothing', () => {
        const engine = makeEngine();
        document.getElementById('search').value = 'nothing matches';
        document.getElementById('search').dispatchEvent(new Event('input'));

        expect(engine._visibleCards()).toEqual([]);
    });

    // Read off the DOM, so it cannot disagree with what the visitor sees - a
    // second copy of the filter predicate would be free to drift.
    it('reports the cards the grid is actually showing', () => {
        const engine = makeEngine();
        document.getElementById('search').value = 'C';
        document.getElementById('search').dispatchEvent(new Event('input'));

        const shown = [...document.querySelectorAll('#sections-container .card')]
            .filter(el => !el.classList.contains('filter-hidden')).length;
        expect(engine._visibleCards()).toHaveLength(shown);
    });
});

describe('the export dialog offers the filtered scope (#745)', () => {
    const openWith = (labels, visible) => {
        ChecklistExport.open({
            id: 'test', title: 'Test', config: CONFIG, cards: CARDS,
            sort: (l) => l,
            filters: { labels: () => labels, visible: () => visible },
        });
        return ChecklistExport.backdrop;
    };

    const option = (b) => b.querySelector('#ce-filtered-option');

    it('hides the choice when no filter is on', () => {
        const b = openWith([], []);

        expect(option(b).style.display).toBe('none');
    });

    it('offers it once a filter is on', () => {
        const b = openWith(['Needed Only'], [CARDS[0]]);

        expect(option(b).style.display).toBe('');
        expect(b.querySelector('#ce-filtered').checked).toBe(false);
    });

    // The count and the filter names are the only warning of what the file will
    // leave out, and they have to be visible before the download, not after.
    it('names the filters and counts what they leave', () => {
        const b = openWith(['Needed Only', '$5-25'], [CARDS[0], CARDS[1]]);

        expect(b.querySelector('#ce-filtered-label').textContent)
            .toBe('Only what the filters show - 2 cards (Needed Only, $5-25)');
    });

    it('says card, not cards, for one', () => {
        const b = openWith(['"prizm"'], [CARDS[0]]);

        expect(b.querySelector('#ce-filtered-label').textContent)
            .toContain('1 card (');
    });

    // Reopening after clearing the filters must not leave the box ticked from
    // last time, or the next export silently narrows.
    it('resets the tick each time it opens', () => {
        const b = openWith(['Needed Only'], [CARDS[0]]);
        b.querySelector('#ce-filtered').checked = true;

        openWith(['Needed Only'], [CARDS[0]]);

        expect(b.querySelector('#ce-filtered').checked).toBe(false);
    });

    it('survives a context with no filters at all', () => {
        ChecklistExport.open({ id: 'test', title: 'Test', config: CONFIG, cards: CARDS, sort: (l) => l });

        expect(option(ChecklistExport.backdrop).style.display).toBe('none');
    });
});

describe('the exported file honours the scope (#745)', () => {
    let downloaded;

    const openWith = (visible) => {
        ChecklistExport.open({
            id: 'test', title: 'Test', config: CONFIG, cards: CARDS, sort: (l) => l,
            filters: { labels: () => ['Needed Only'], visible: () => visible },
        });
        return ChecklistExport.backdrop;
    };

    beforeEach(() => {
        downloaded = [];
        ChecklistExport.downloadCSV = (filename, content) => downloaded.push({ filename, content });
    });

    it('writes every card when the box is left unticked', async () => {
        openWith([CARDS[1]]);
        await ChecklistExport._onExport();

        expect(downloaded[0].filename).toBe('test-checklist.csv');
        expect(downloaded[0].content).toContain('A');
        expect(downloaded[0].content).toContain('C');
    });

    it('writes only the visible cards when it is ticked', async () => {
        const b = openWith([CARDS[1]]);
        b.querySelector('#ce-filtered').checked = true;
        await ChecklistExport._onExport();

        expect(downloaded[0].content).toContain('B');
        expect(downloaded[0].content).not.toContain('A,');
        expect(downloaded[0].content).not.toContain('C,');
    });

    // A CSV cannot carry a note without breaking the header row, so the
    // filename is where the scope survives being opened elsewhere.
    it('marks the filename so a partial file is not mistaken for the whole', async () => {
        const b = openWith([CARDS[1]]);
        b.querySelector('#ce-filtered').checked = true;
        await ChecklistExport._onExport();

        expect(downloaded[0].filename).toBe('test-checklist-filtered.csv');
    });
});

describe('the PDF says which filters made it (#745)', () => {
    const ShoppingList = globalThis.ShoppingList;
    let doc;
    let realLoad;

    beforeEach(() => {
        doc = fakeDoc();
        window.jspdf = { jsPDF: function () { return doc; } };
        realLoad = ShoppingList.loadJsPDF;
        ShoppingList.loadJsPDF = async () => {};
    });

    afterEach(() => {
        ShoppingList.loadJsPDF = realLoad;
        delete window.jspdf;
    });

    const strings = () => doc.calls.text.map(t => t.str);
    const ROW = { section: '', set: 'B', num: '2', name: '', variant: '', serial: '', price: 50 };

    // A printed sheet outlives the dialog that chose the scope, and nothing else
    // on the page distinguishes a partial checklist from a complete one.
    it('prints the filter list under the count', async () => {
        await ChecklistExport.buildPDF([ROW],
            { title: 'Test', filename: 'x.pdf', filters: ['Needed Only', '$25-100'] });

        expect(strings()).toContain('Filtered: Needed Only, $25-100');
    });

    it('prints nothing when the whole checklist was exported', async () => {
        await ChecklistExport.buildPDF([ROW], { title: 'Test', filename: 'x.pdf', filters: [] });

        expect(strings().some(t => t.startsWith('Filtered:'))).toBe(false);
    });

    it('prints nothing when no filters key was passed at all', async () => {
        await ChecklistExport.buildPDF([ROW], { title: 'Test', filename: 'x.pdf' });

        expect(strings().some(t => t.startsWith('Filtered:'))).toBe(false);
    });
});
