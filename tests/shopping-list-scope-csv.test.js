import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fakeDoc } from './fake-jspdf.js';

const ShoppingList = globalThis.ShoppingList;
const ChecklistExport = globalThis.ChecklistExport;
const DynamicNav = globalThis.DynamicNav;

// #745: the shopping list and the per-checklist export were two tools producing
// overlapping documents. Rather than adding a second export entry beside this
// one, this dialog grew the axes it was missing - Needed / Owned / All, and PDF
// or CSV - so "shopping list" is one of its outputs rather than the whole of it.

const CARDS = {
    cards: [
        { set: '2024 Prizm', num: '1', player: 'A', price: 10 },
        { set: '2024 Prizm', num: '2', player: 'B', price: 20 },
        { set: '2024 Select', num: '3', player: 'C', price: 5 },
    ],
};
const CONFIG = { dataShape: 'flat', cardDisplay: {} };

// Whatever generateCardId produces for card 2, so exactly one card is owned.
const ownedIdFor = num => ShoppingList.generateCardId(
    CARDS.cards.find(c => c.num === num), CONFIG,
);

describe('ShoppingList — scope and format (#745)', () => {
    let realSync, realRegistry, realLoad, realBuildPDF, realBuildCSV, doc;

    beforeEach(() => {
        doc = fakeDoc();
        window.jspdf = { jsPDF: function () { return doc; } };
        realLoad = ShoppingList.loadJsPDF;
        ShoppingList.loadJsPDF = async () => {};
        realBuildPDF = ShoppingList.buildPDF;
        realBuildCSV = ShoppingList.buildCSV;
        realRegistry = DynamicNav.loadRegistry;
        realSync = window.githubSync;

        DynamicNav.loadRegistry = async () => ({ checklists: [{ id: 'a', title: 'A' }] });
        window.githubSync = {
            clearDataCache: vi.fn(),
            loadData: async () => ({ checklists: { a: [ownedIdFor('2')] } }),
            loadPublicData: async () => null,
            loadChecklistConfig: async () => CONFIG,
            loadPublicChecklistConfig: async () => null,
            loadCardData: async () => CARDS,
            loadPublicCardData: async () => null,
        };
    });

    afterEach(() => {
        ShoppingList.loadJsPDF = realLoad;
        ShoppingList.buildPDF = realBuildPDF;
        ShoppingList.buildCSV = realBuildCSV;
        DynamicNav.loadRegistry = realRegistry;
        window.githubSync = realSync;
        delete window.jspdf;
    });

    const itemsFrom = async (options) => {
        const spy = vi.fn();
        ShoppingList.buildPDF = spy;
        ShoppingList.buildCSV = spy;
        await ShoppingList.generate(options);
        return spy.mock.calls[0][0];
    };

    it('defaults to the needed cards, as it always did', async () => {
        const items = await itemsFrom({});

        expect(items.map(i => i.num).sort()).toEqual(['1', '3']);
    });

    it('collects only the owned cards for the owned scope', async () => {
        const items = await itemsFrom({ scope: 'owned' });

        expect(items.map(i => i.num)).toEqual(['2']);
    });

    it('collects every card for the all scope', async () => {
        const items = await itemsFrom({ scope: 'all' });

        expect(items.map(i => i.num).sort()).toEqual(['1', '2', '3']);
    });

    // Without this the CSV's Owned column has nothing truthful to report.
    it('records each card own owned state', async () => {
        const items = await itemsFrom({ scope: 'all' });

        expect(items.find(i => i.num === '2').owned).toBe(true);
        expect(items.find(i => i.num === '1').owned).toBe(false);
    });

    it('routes to the CSV builder only when CSV is asked for', async () => {
        const pdf = vi.fn();
        const csv = vi.fn();
        ShoppingList.buildPDF = pdf;
        ShoppingList.buildCSV = csv;

        await ShoppingList.generate({ format: 'csv' });
        expect(csv).toHaveBeenCalledTimes(1);
        expect(pdf).not.toHaveBeenCalled();

        await ShoppingList.generate({});
        expect(pdf).toHaveBeenCalledTimes(1);
    });

    // jsPDF is the expensive import and the CSV path has no use for it.
    it('does not load jsPDF for a CSV export', async () => {
        const load = vi.fn(async () => {});
        ShoppingList.loadJsPDF = load;
        ShoppingList.buildCSV = vi.fn();

        await ShoppingList.generate({ format: 'csv' });

        expect(load).not.toHaveBeenCalled();
    });
});

describe('ShoppingList.buildCSV (#745)', () => {
    let downloaded;
    let realDownload;

    beforeEach(() => {
        downloaded = [];
        realDownload = ChecklistExport.downloadCSV;
        ChecklistExport.downloadCSV = (name, csv) => downloaded.push({ name, csv });
    });

    afterEach(() => {
        ChecklistExport.downloadCSV = realDownload;
    });

    const item = over => ({
        set: '2024 Prizm', num: '1', name: 'Daniels', variant: '',
        price: 10, checklist: 'A', owned: false, ...over,
    });

    it('writes the cross-checklist columns, not the single-checklist ones', () => {
        ShoppingList.buildCSV([item()], { scope: 'all' });

        const [header] = downloaded[0].csv.split('\r\n');
        expect(header).toBe('Checklist,Set,Number,Name,Variant,Price,Owned');
        // Section belongs to the per-checklist export; these rows span checklists.
        expect(header).not.toContain('Section');
    });

    // The single-checklist export hard-codes FALSE because it is a blank
    // checklist to fill in. This one is generated from the owner's collection.
    it('reports real ownership rather than a blank column', () => {
        ShoppingList.buildCSV([item({ owned: true }), item({ num: '2', owned: false })], { scope: 'all' });

        const rows = downloaded[0].csv.split('\r\n').slice(1);
        expect(rows[0].endsWith('TRUE')).toBe(true);
        expect(rows[1].endsWith('FALSE')).toBe(true);
    });

    it('names the file for the scope', () => {
        ShoppingList.buildCSV([item()], { scope: 'owned' });
        expect(downloaded[0].name).toBe('collection.csv');

        ShoppingList.buildCSV([item()], { scope: 'needed' });
        expect(downloaded[1].name).toBe('shopping-list.csv');
    });

    // Shared writer, shared escaping - a comma in a set name must not split a row.
    it('escapes through the same writer the checklist export uses', () => {
        ShoppingList.buildCSV([item({ set: 'Prizm, Silver' })], { scope: 'all' });

        expect(downloaded[0].csv).toContain('"Prizm, Silver"');
    });
});

describe('ShoppingList PDF — scope wording (#745)', () => {
    let doc, realLoad;

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
    const item = over => ({
        year: 2024, setName: 'prizm', set: '2024 Prizm', num: '1',
        name: 'D', variant: '', price: 10, checklist: 'a', owned: false, ...over,
    });

    it('titles and counts an owned export as a collection', () => {
        ShoppingList.buildPDF([item({ owned: true })], { scope: 'owned' });

        expect(strings()).toContain('Collection');
        expect(strings().some(t => t.includes('1 cards owned'))).toBe(true);
    });

    it('still says shopping list, and needed, by default', () => {
        ShoppingList.buildPDF([item()], {});

        expect(strings()).toContain('Shopping List');
        expect(strings().some(t => t.includes('1 cards needed'))).toBe(true);
    });
});

// The controls are only worth anything if _onGenerate actually reads them.
describe('ShoppingList modal — scope and format controls (#745)', () => {
    let realGenerate;

    beforeEach(() => {
        ShoppingList.backdrop = null;
        document.body.innerHTML = '';
        realGenerate = ShoppingList.generate;
        ShoppingList.generate = vi.fn(async () => {});
        ShoppingList.initModal();
        // _onGenerate refuses an empty selection before reading anything else.
        document.getElementById('sl-checklist-list').innerHTML =
            '<input type="checkbox" data-checklist-id="a" checked>';
    });

    afterEach(() => {
        ShoppingList.generate = realGenerate;
        ShoppingList.backdrop = null;
        document.body.innerHTML = '';
    });

    const optionsFrom = async () => {
        await ShoppingList._onGenerate();
        return ShoppingList.generate.mock.calls[0][0];
    };

    it('renders a control for every scope and format', () => {
        for (const id of ['sl-scope-needed', 'sl-scope-owned', 'sl-scope-all', 'sl-format-pdf', 'sl-format-csv']) {
            expect(document.getElementById(id), id).not.toBeNull();
        }
    });

    // Opening the dialog and pressing Export must still do what it always did.
    it('defaults to needed and PDF', async () => {
        const options = await optionsFrom();

        expect(options.scope).toBe('needed');
        expect(options.format).toBe('pdf');
    });

    it('reads the owned scope', async () => {
        document.getElementById('sl-scope-owned').checked = true;

        expect((await optionsFrom()).scope).toBe('owned');
    });

    it('reads the all scope', async () => {
        document.getElementById('sl-scope-all').checked = true;

        expect((await optionsFrom()).scope).toBe('all');
    });

    it('reads the CSV format', async () => {
        document.getElementById('sl-format-csv').checked = true;

        expect((await optionsFrom()).format).toBe('csv');
    });

    // Reopening must not carry the last run's choices back in. Driven through
    // the real showOptionsModal, which is where the resets live.
    it('resets to needed and PDF when reopened', async () => {
        document.getElementById('sl-scope-all').checked = true;
        document.getElementById('sl-format-csv').checked = true;

        const realRegistry = DynamicNav.loadRegistry;
        const realSync = window.githubSync;
        DynamicNav.loadRegistry = async () => ({ checklists: [{ id: 'a', title: 'A' }] });
        window.githubSync = { isLoggedIn: () => true };
        try {
            await ShoppingList.showOptionsModal();
        } finally {
            DynamicNav.loadRegistry = realRegistry;
            window.githubSync = realSync;
        }

        expect(document.getElementById('sl-scope-needed').checked).toBe(true);
        expect(document.getElementById('sl-format-pdf').checked).toBe(true);
        expect(document.getElementById('sl-scope-all').checked).toBe(false);
        expect(document.getElementById('sl-format-csv').checked).toBe(false);
    });
});
