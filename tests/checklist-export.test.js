import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const ChecklistExport = globalThis.ChecklistExport;
const ShoppingList = globalThis.ShoppingList;

// The logged-out export reads the engine's already-loaded cards and config rather
// than re-fetching, so these fixtures are the in-memory shapes _loadCardData
// produces: a flat array for dataShape 'flat', a {catId: [...]} map otherwise.

describe('ChecklistExport.collectRows', () => {
    it('returns every card for a flat checklist', () => {
        const cards = [
            { set: '2024 Prizm', num: '1', player: 'Jayden Daniels' },
            { set: '2024 Select', num: '2', player: 'Jayden Daniels' },
        ];

        const rows = ChecklistExport.collectRows(cards, { dataShape: 'flat' }, true);

        expect(rows.map(r => r.num)).toEqual(['1', '2']);
    });

    // Neither is a real card: one is a navigation tile, the other a placeholder for
    // a player with no card. ShoppingList.flattenCards drops both and so must this.
    it('drops collection links and no-card entries', () => {
        const cards = [
            { set: '2024 Prizm', num: '1' },
            { set: 'Other checklist', collectionLink: true },
            { player: 'Nobody', noCard: true },
        ];

        const rows = ChecklistExport.collectRows(cards, { dataShape: 'flat' }, true);

        expect(rows).toHaveLength(1);
        expect(rows[0].num).toBe('1');
    });

    it('labels each row with its category and keeps config order', () => {
        const cards = {
            base: [{ set: '2024 Prizm', num: '1' }],
            inserts: [{ set: '2024 Kaboom', num: 'K1' }],
        };
        const config = {
            categories: [
                { id: 'base', label: 'Base Set', isMain: true },
                { id: 'inserts', label: 'Inserts', isMain: false },
            ],
        };

        const rows = ChecklistExport.collectRows(cards, config, true);

        expect(rows.map(r => [r.section, r.num])).toEqual([
            ['Base Set', '1'],
            ['Inserts', 'K1'],
        ]);
    });

    it('omits extra categories when includeExtra is false', () => {
        const cards = {
            base: [{ set: '2024 Prizm', num: '1' }],
            inserts: [{ set: '2024 Kaboom', num: 'K1' }],
        };
        const config = {
            categories: [
                { id: 'base', label: 'Base Set', isMain: true },
                { id: 'inserts', label: 'Inserts', isMain: false },
            ],
        };

        const rows = ChecklistExport.collectRows(cards, config, false);

        expect(rows.map(r => r.num)).toEqual(['1']);
    });

    // isMain lives on the parent, but the section label a reader wants is the
    // child's - that is what the page itself renders as the section header.
    it('uses child labels for a parent category, gated on the parent isMain', () => {
        const cards = {
            rookies: [{ set: '2024 Prizm', num: '1' }],
            vets: [{ set: '2024 Prizm', num: '2' }],
            parallels: [{ set: '2024 Silver', num: '3' }],
        };
        const config = {
            categories: [
                { id: 'base', label: 'Base', children: [
                    { id: 'rookies', label: 'Rookies' },
                    { id: 'vets', label: 'Veterans' },
                ] },
                { id: 'parallels', label: 'Parallels', isMain: false },
            ],
        };

        expect(ChecklistExport.collectRows(cards, config, false).map(r => r.section))
            .toEqual(['Rookies', 'Veterans']);
        expect(ChecklistExport.collectRows(cards, config, true).map(r => r.section))
            .toEqual(['Rookies', 'Veterans', 'Parallels']);
    });

    it('maps the card fields an importer needs', () => {
        const cards = [{
            set: '2024 Panini Prizm', num: '17', player: 'Jayden Daniels',
            variant: 'Silver', serial: '/99', price: 45,
        }];

        const [row] = ChecklistExport.collectRows(cards, { dataShape: 'flat' }, true);

        expect(row).toMatchObject({
            year: 2024, set: '2024 Panini Prizm', num: '17',
            name: 'Jayden Daniels', variant: 'Silver', serial: '/99', price: 45,
        });
    });

    it('falls back to name when a card has no player', () => {
        const cards = [{ set: '2024 Prizm', num: '1', name: 'Team Card' }];

        expect(ChecklistExport.collectRows(cards, { dataShape: 'flat' }, true)[0].name)
            .toBe('Team Card');
    });
});

describe('ChecklistExport.toCSV', () => {
    const row = (over = {}) => ({
        section: 'Base', year: 2024, set: '2024 Prizm', num: '1',
        name: 'Jayden Daniels', variant: '', serial: '', price: 0, ...over,
    });

    it('starts with a header row naming every column', () => {
        const header = ChecklistExport.toCSV([]).split('\r\n')[0];

        expect(header).toBe('Section,Year,Set,Number,Name,Variant,Serial,Price,Owned');
    });

    // The Owned column is the importable equivalent of a blank checkbox - the
    // visitor's own tracking, never the site owner's ownership.
    it('leaves Owned empty on every row', () => {
        const lines = ChecklistExport.toCSV([row(), row({ num: '2' })]).split('\r\n');

        expect(lines[1].endsWith(',')).toBe(true);
        expect(lines[2].endsWith(',')).toBe(true);
    });

    it('quotes a value containing a comma', () => {
        const csv = ChecklistExport.toCSV([row({ set: 'Topps Chrome, Update' })]);

        expect(csv).toContain('"Topps Chrome, Update"');
    });

    it('doubles embedded quotes and wraps the value', () => {
        const csv = ChecklistExport.toCSV([row({ variant: '6" tall' })]);

        expect(csv).toContain('"6"" tall"');
    });

    it('quotes a value containing a newline rather than breaking the row', () => {
        const csv = ChecklistExport.toCSV([row({ name: 'Line one\nLine two' })]);

        expect(csv).toContain('"Line one\nLine two"');
        // Header plus one record: the embedded newline must not split the record.
        expect(csv.split('\r\n')).toHaveLength(2);
    });

    it('writes empty strings for absent values rather than undefined', () => {
        const csv = ChecklistExport.toCSV([{ set: '2024 Prizm' }]);

        expect(csv).not.toContain('undefined');
    });

    it('omits a zero price rather than printing 0', () => {
        const csv = ChecklistExport.toCSV([row({ price: 0 })]);

        expect(csv.split('\r\n')[1]).toContain(',,');
    });
});

describe('ChecklistExport dialog', () => {
    const CONTEXT = () => ({
        id: 'jayden-daniels',
        title: 'Jayden Daniels',
        config: {
            categories: [
                { id: 'base', label: 'Base Set', isMain: true },
                { id: 'inserts', label: 'Inserts', isMain: false },
            ],
        },
        cards: {
            base: [{ set: '2024 Prizm', num: '1', player: 'Jayden Daniels' }],
            inserts: [{ set: '2024 Kaboom', num: 'K1', player: 'Jayden Daniels' }],
        },
    });

    let downloads;
    beforeEach(() => {
        document.body.innerHTML = '';
        ChecklistExport.backdrop = null;
        downloads = [];
        ChecklistExport._download = (filename, content) => downloads.push({ filename, content });
    });

    const openAndExport = (ctx = CONTEXT()) => {
        ChecklistExport.open(ctx);
        document.getElementById('ce-export').click();
    };

    it('defaults to CSV with extra categories included', () => {
        ChecklistExport.open(CONTEXT());

        expect(document.getElementById('ce-format-csv').checked).toBe(true);
        expect(document.getElementById('ce-format-pdf').checked).toBe(false);
        expect(document.getElementById('ce-include-extra').checked).toBe(true);
    });

    it('downloads a CSV named after the checklist', () => {
        openAndExport();

        expect(downloads).toHaveLength(1);
        expect(downloads[0].filename).toBe('jayden-daniels-checklist.csv');
    });

    it('includes every card, owned or not, with an empty Owned column', () => {
        openAndExport();

        const lines = downloads[0].content.split('\r\n');
        expect(lines[0]).toBe('Section,Year,Set,Number,Name,Variant,Serial,Price,Owned');
        expect(lines).toHaveLength(3);
        expect(lines.every((l, i) => i === 0 || l.endsWith(','))).toBe(true);
    });

    it('drops extra categories when the box is unchecked', () => {
        ChecklistExport.open(CONTEXT());
        document.getElementById('ce-include-extra').checked = false;
        document.getElementById('ce-export').click();

        const lines = downloads[0].content.split('\r\n');
        expect(lines).toHaveLength(2);
        expect(lines[1]).toContain('Base Set');
    });

    it('routes to the PDF builder when PDF is chosen', async () => {
        const realBuild = ChecklistExport.buildPDF;
        const calls = [];
        ChecklistExport.buildPDF = async (rows, meta) => { calls.push({ rows, meta }); };

        ChecklistExport.open(CONTEXT());
        document.getElementById('ce-format-pdf').checked = true;
        document.getElementById('ce-format-csv').checked = false;
        document.getElementById('ce-export').click();
        await new Promise(r => setTimeout(r, 0));

        ChecklistExport.buildPDF = realBuild;
        expect(downloads).toHaveLength(0);
        expect(calls).toHaveLength(1);
        expect(calls[0].rows).toHaveLength(2);
        expect(calls[0].meta.title).toBe('Jayden Daniels');
    });

    it('closes without exporting when cancelled', () => {
        ChecklistExport.open(CONTEXT());
        document.getElementById('ce-cancel').click();

        expect(downloads).toHaveLength(0);
        expect(ChecklistExport.backdrop.classList.contains('active')).toBe(false);
    });

    it('escapes the checklist title rather than injecting it as markup', () => {
        const ctx = CONTEXT();
        ctx.title = '<img src=x onerror=alert(1)>';

        ChecklistExport.open(ctx);

        expect(ChecklistExport.backdrop.querySelector('img')).toBeNull();
    });
});

describe('ChecklistExport.buildPDF', () => {
    // Records what was drawn. Asserting on jsPDF calls is the only way to check a
    // PDF's content without parsing one, and it keeps the checkbox count - the
    // whole point of this document - directly observable.
    function fakeDoc() {
        const calls = { text: [], strokedRects: [], saved: null, pages: 1 };
        return {
            calls,
            setFont() {}, setFontSize() {}, setTextColor() {}, setFillColor() {},
            setDrawColor() {}, setLineWidth() {},
            rect(x, y, w, h, style) { if (style === 'S') calls.strokedRects.push({ x, y, w, h }); },
            text(str) { calls.text.push(String(str)); },
            addPage() { calls.pages++; },
            save(name) { calls.saved = name; },
            internal: {
                pageSize: { getWidth: () => 215.9, getHeight: () => 279.4 },
                getNumberOfPages: () => calls.pages,
            },
        };
    }

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

    const ROWS = [
        { section: 'Base Set', year: 2024, set: '2024 Prizm', num: '1', name: 'Daniels', variant: '', serial: '', price: 45 },
        { section: 'Base Set', year: 2024, set: '2024 Prizm', num: '2', name: 'Daniels', variant: '', serial: '', price: 0 },
        { section: 'Inserts', year: 2024, set: '2024 Kaboom', num: 'K1', name: 'Daniels', variant: '', serial: '', price: 120 },
    ];

    it('draws one empty checkbox per card', async () => {
        await ChecklistExport.buildPDF(ROWS, { title: 'Jayden Daniels', filename: 'x.pdf' });

        expect(doc.calls.strokedRects).toHaveLength(3);
    });

    it('saves under the requested filename', async () => {
        await ChecklistExport.buildPDF(ROWS, { title: 'Jayden Daniels', filename: 'jd-checklist.pdf' });

        expect(doc.calls.saved).toBe('jd-checklist.pdf');
    });

    it('heads the document with the checklist title and a plain card count', async () => {
        await ChecklistExport.buildPDF(ROWS, { title: 'Jayden Daniels', filename: 'x.pdf' });

        const text = doc.calls.text.join('|');
        expect(text).toContain('Jayden Daniels');
        expect(text).toContain('3 cards');
        // This is not the shopping list: nothing is "needed" and no cost is totalled.
        expect(text).not.toContain('needed');
        expect(text).not.toContain('Est. cost');
    });

    it('writes a section header per category', async () => {
        await ChecklistExport.buildPDF(ROWS, { title: 'T', filename: 'x.pdf' });

        const text = doc.calls.text;
        expect(text.filter(t => t === 'Base Set')).toHaveLength(1);
        expect(text.filter(t => t === 'Inserts')).toHaveLength(1);
    });

    it('loads jsPDF before building', async () => {
        let loaded = false;
        ShoppingList.loadJsPDF = async () => { loaded = true; };

        await ChecklistExport.buildPDF(ROWS, { title: 'T', filename: 'x.pdf' });

        expect(loaded).toBe(true);
    });

    it('still produces a document when the checklist is empty', async () => {
        await ChecklistExport.buildPDF([], { title: 'T', filename: 'x.pdf' });

        expect(doc.calls.saved).toBe('x.pdf');
        expect(doc.calls.strokedRects).toHaveLength(0);
    });
});
