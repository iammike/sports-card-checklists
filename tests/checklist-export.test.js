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

    // The sort callback is how the export matches the checklist's own ordering.
    // Without a test it can be dropped, ignored or handed the wrong mode and
    // nothing notices - only the row order changes.
    it('applies the sort callback to each section', () => {
        const cards = {
            base: [{ set: 'B', num: '2' }, { set: 'A', num: '1' }],
            inserts: [{ set: 'D', num: '4' }, { set: 'C', num: '3' }],
        };
        const config = {
            categories: [
                { id: 'base', label: 'Base', isMain: true },
                { id: 'inserts', label: 'Inserts', isMain: false },
            ],
        };
        const seen = [];
        const sort = (list) => { seen.push(list.length); return [...list].sort((a, b) => a.num.localeCompare(b.num)); };

        const rows = ChecklistExport.collectRows(cards, config, true, sort);

        // Called once per section, not once for the whole checklist.
        expect(seen).toEqual([2, 2]);
        expect(rows.map(r => r.num)).toEqual(['1', '2', '3', '4']);
    });

    it('keeps the stored order when no sort callback is given', () => {
        const cards = [{ set: 'B', num: '2' }, { set: 'A', num: '1' }];

        expect(ChecklistExport.collectRows(cards, { dataShape: 'flat' }, true).map(r => r.num))
            .toEqual(['2', '1']);
    });

    it('maps the card fields an importer needs', () => {
        const cards = [{
            set: '2024 Panini Prizm', num: '17', player: 'Jayden Daniels',
            variant: 'Silver', serial: '/99', price: 45,
        }];

        const [row] = ChecklistExport.collectRows(cards, { dataShape: 'flat' }, true);

        expect(row).toMatchObject({
            set: '2024 Panini Prizm', num: '17',
            name: 'Jayden Daniels', variant: 'Silver', serial: '/99', price: 45,
        });
    });

    // Gist prices are hand-edited and can be strings or garbage - getPrice in the
    // engine says so explicitly. Without coercion a junk value lands in the CSV
    // verbatim and an importing spreadsheet inherits it.
    it('coerces a non-numeric price to zero', () => {
        const cards = [{ set: '2024 Prizm', num: '1', price: 'ask' }];

        expect(ChecklistExport.collectRows(cards, { dataShape: 'flat' }, true)[0].price).toBe(0);
    });

    it('keeps a numeric string price as a number', () => {
        const cards = [{ set: '2024 Prizm', num: '1', price: '45' }];

        expect(ChecklistExport.collectRows(cards, { dataShape: 'flat' }, true)[0].price).toBe(45);
    });

    // Set is exported exactly as stored. No year extraction, so none of the
    // year-shaped traps apply: a season span and a year that is part of the set's
    // own name both survive untouched.
    it('exports the set name exactly as stored', () => {
        const cards = [
            { set: '2012-13 Panini Prizm', num: '1' },
            { set: '2024 Leaf Pro Set 1989', num: '2' },
            { set: 'Topps Pro Set 1989', num: '3' },
        ];

        const rows = ChecklistExport.collectRows(cards, { dataShape: 'flat' }, true);

        expect(rows.map(r => r.set)).toEqual([
            '2012-13 Panini Prizm', '2024 Leaf Pro Set 1989', 'Topps Pro Set 1989',
        ]);
    });

    it('prefers an explicit card name over the player', () => {
        const cards = [{ set: '2024 Prizm', num: '1', name: 'Team Card' }];

        expect(ChecklistExport.collectRows(cards, { dataShape: 'flat' }, true)[0].name)
            .toBe('Team Card');
    });
});

describe('ChecklistExport.toCSV', () => {
    const row = (over = {}) => ({
        section: 'Base', set: '2024 Prizm', num: '1',
        name: 'Jayden Daniels', variant: '', serial: '', price: 0, ...over,
    });

    it('starts with a header row naming every column', () => {
        const header = ChecklistExport.toCSV([row({ name: 'A' }), row({ name: 'B' })]).split('\r\n')[0];

        expect(header).toBe('Section,Set,Number,Name,Variant,Serial,Price,Owned');
    });

    // Every row of a single-player checklist repeats the same name.
    it('drops the Name column when every card names the same player', () => {
        const csv = ChecklistExport.toCSV([row(), row({ num: '2' })]);

        expect(csv.split('\r\n')[0]).toBe('Section,Set,Number,Variant,Serial,Price,Owned');
        expect(csv).not.toContain('Jayden Daniels');
    });

    it('keeps the Name column when only some cards are named', () => {
        const csv = ChecklistExport.toCSV([row({ name: '' }), row({ num: '2', name: 'Team Card' })]);

        expect(csv.split('\r\n')[0]).toContain('Name');
        expect(csv).toContain('Team Card');
    });

    it('keeps the Name column as soon as one card names someone else', () => {
        const csv = ChecklistExport.toCSV([row(), row({ num: '2', name: 'Team Card' })]);

        expect(csv.split('\r\n')[0]).toContain('Name');
        expect(csv).toContain('Team Card');
        expect(csv).toContain('Jayden Daniels');
    });

    // The Owned column is the importable equivalent of a blank checkbox - the
    // visitor's own tracking, never the site owner's ownership. Asserting the full
    // field array rather than a trailing comma: with an empty Price in the fixture
    // a trailing comma is satisfied even when the Owned field is gone entirely,
    // and dropping it silently shifts every column left of it.
    it('emits one field per declared column, with Owned last and empty', () => {
        const rows = [row({ variant: 'Silver', serial: '/99', price: 45 }), row({ num: '2', name: 'Other' })];
        const fields = ChecklistExport.toCSV(rows).split('\r\n')[1].split(',');

        expect(fields).toEqual(['Base', '2024 Prizm', '1', 'Jayden Daniels', 'Silver', '/99', '45', '']);
        expect(fields).toHaveLength(ChecklistExport.CSV_COLUMNS.length);
    });

    it('keeps field order matching the header', () => {
        const rows = [row({ num: 'NUM', name: 'NAME', variant: 'VAR', serial: 'SER' }), row({ name: 'Other' })];
        const csv = ChecklistExport.toCSV(rows);
        const header = csv.split('\r\n')[0].split(',');
        const fields = csv.split('\r\n')[1].split(',');

        expect(fields[header.indexOf('Number')]).toBe('NUM');
        expect(fields[header.indexOf('Name')]).toBe('NAME');
        expect(fields[header.indexOf('Variant')]).toBe('VAR');
        expect(fields[header.indexOf('Serial')]).toBe('SER');
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
        const csv = ChecklistExport.toCSV([row({ set: 'Line one\nLine two' })]);

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
        const header = csv.split('\r\n')[0].split(',');
        const fields = csv.split('\r\n')[1].split(',');

        // Index off the EMITTED header, not CSV_COLUMNS: this fixture is one
        // player so Name is dropped, and the declared index then points at Owned,
        // which is empty by construction and passes whatever Price does.
        expect(fields[header.indexOf('Price')]).toBe('');
    });

    // A lone CR is as capable of breaking a record as a LF.
    it('quotes a value containing a carriage return', () => {
        const csv = ChecklistExport.toCSV([row({ set: 'One\rTwo' })]);

        expect(csv).toContain('"One\rTwo"');
    });
});

describe('ChecklistExport.CSV_FIELDS', () => {
    // A column without an accessor throws a TypeError inside the click handler,
    // which the CSV branch does not catch - the modal would just sit there.
    it('has an accessor for every declared column', () => {
        ChecklistExport.CSV_COLUMNS.forEach(c => {
            expect(typeof ChecklistExport.CSV_FIELDS[c]).toBe('function');
        });
        expect(Object.keys(ChecklistExport.CSV_FIELDS).sort())
            .toEqual([...ChecklistExport.CSV_COLUMNS].sort());
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

        // Excel on Windows needs the BOM to decode accented names correctly.
        expect(downloads[0].content.startsWith('\uFEFF')).toBe(true);
        const lines = downloads[0].content.slice(1).split('\r\n');
        // One player throughout, so Name is dropped.
        expect(lines[0]).toBe('Section,Set,Number,Variant,Serial,Price,Owned');
        expect(lines).toHaveLength(3);
        const cols = lines[0].split(',').length;
        lines.slice(1).forEach(l => expect(l.split(',')).toHaveLength(cols));
    });

    it('drops extra categories when the box is unchecked', () => {
        ChecklistExport.open(CONTEXT());
        document.getElementById('ce-include-extra').checked = false;
        document.getElementById('ce-export').click();

        const lines = downloads[0].content.slice(1).split('\r\n');
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

    // The modal is created once and reused, so a stale checkbox from a previous
    // open would otherwise persist. Every other test here gets a fresh backdrop.
    it('resets the options each time it is opened', () => {
        ChecklistExport.open(CONTEXT());
        document.getElementById('ce-include-extra').checked = false;
        document.getElementById('ce-format-pdf').checked = true;
        ChecklistExport.close();

        ChecklistExport.open(CONTEXT());

        expect(document.getElementById('ce-include-extra').checked).toBe(true);
        expect(document.getElementById('ce-format-pdf').checked).toBe(false);
        expect(document.getElementById('ce-format-csv').checked).toBe(true);
    });

    // Both ends of the sort were pinned but not the seam: dropping the argument
    // in _onExport silently exported gist storage order and passed every test.
    it('forwards the context sort into the exported rows', () => {
        const ctx = CONTEXT();
        ctx.cards = { base: [{ set: 'B', num: '2' }, { set: 'A', num: '1' }] };
        ctx.config = { categories: [{ id: 'base', label: 'Base Set', isMain: true }] };
        ctx.sort = (list) => [...list].sort((a, b) => a.num.localeCompare(b.num));

        ChecklistExport.open(ctx);
        document.getElementById('ce-export').click();

        const lines = downloads[0].content.slice(1).split('\r\n');
        expect(lines[1]).toContain(',1,');
        expect(lines[2]).toContain(',2,');
    });

    // Enter is forwarded so the radios and checkbox submit, but buttons already
    // activate natively - forwarding those exported from Cancel.
    it('does not export when Enter is pressed on a button', () => {
        ChecklistExport.open(CONTEXT());
        const cancel = document.getElementById('ce-cancel');
        cancel.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

        expect(downloads).toHaveLength(0);
    });

    it('exports when Enter is pressed on an option control', () => {
        ChecklistExport.open(CONTEXT());
        const box = document.getElementById('ce-include-extra');
        box.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

        expect(downloads).toHaveLength(1);
    });

    // eagles-legends marks every category isMain:false. Unchecking there yields a
    // header-only CSV with no explanation, so the option is not offered.
    it('hides the extras option when no category is a main one', () => {
        const ctx = CONTEXT();
        ctx.config = { categories: [{ id: 'a', label: 'A', isMain: false }, { id: 'b', label: 'B', isMain: false }] };

        ChecklistExport.open(ctx);

        const row = document.getElementById('ce-include-extra').closest('.shopping-list-option');
        expect(row.style.display).toBe('none');
    });

    // An absent isMain means main - the convention collectRows and the engine both
    // rely on. Every other fixture declares it explicitly.
    it('treats a category with no isMain as a main one', () => {
        const ctx = CONTEXT();
        ctx.config = { categories: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B', isMain: false }] };

        ChecklistExport.open(ctx);

        const row = document.getElementById('ce-include-extra').closest('.shopping-list-option');
        expect(row.style.display).not.toBe('none');
    });

    it('hides the Options heading along with its only option', () => {
        const ctx = CONTEXT();
        ctx.config = { categories: [{ id: 'a', label: 'A', isMain: false }] };

        ChecklistExport.open(ctx);

        expect(document.getElementById('ce-options-label').style.display).toBe('none');
        expect(document.getElementById('ce-options-divider').style.display).toBe('none');
    });

    it('offers the extras option when a main category exists', () => {
        ChecklistExport.open(CONTEXT());

        const row = document.getElementById('ce-include-extra').closest('.shopping-list-option');
        expect(row.style.display).not.toBe('none');
        // Without these, hiding the section unconditionally passes.
        expect(document.getElementById('ce-options-label').style.display).not.toBe('none');
        expect(document.getElementById('ce-options-divider').style.display).not.toBe('none');
    });

    // The modal is a singleton, so a checklist with a hidden section followed by a
    // normal one must get the section back.
    it('restores the options section on a later checklist that has main categories', () => {
        const hidden = CONTEXT();
        hidden.config = { categories: [{ id: 'a', label: 'A', isMain: false }] };
        ChecklistExport.open(hidden);
        ChecklistExport.close();

        ChecklistExport.open(CONTEXT());

        // All three parts, or a guard on any single line survives.
        expect(document.getElementById('ce-options-label').style.display).not.toBe('none');
        expect(document.getElementById('ce-options-divider').style.display).not.toBe('none');
        expect(document.getElementById('ce-include-extra')
            .closest('.shopping-list-option').style.display).not.toBe('none');
    });

    // N4: closing after a CSV download was untested, so it could regress into
    // "click Export, nothing appears to happen".
    it('closes after a CSV download', () => {
        ChecklistExport.open(CONTEXT());
        document.getElementById('ce-export').click();

        expect(ChecklistExport.backdrop.classList.contains('active')).toBe(false);
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
    // Models the jsPDF surface the builder actually uses, including getTextWidth
    // and setPage. A stub that omits those only looks faithful while the code
    // never asks for them - which is how the fork of this layout lost truncation.
    // Width is ~2mm per character, close enough to 8pt Helvetica to exercise the
    // column limits.
    function fakeDoc() {
        const calls = { text: [], strokedRects: [], filledRects: [], saved: null, pages: 1, page: 1 };
        return {
            calls,
            setFont() {}, setFontSize() {}, setTextColor() {}, setFillColor() {},
            setDrawColor() {}, setLineWidth() {},
            getTextWidth(t) { return String(t).length * 2; },
            rect(x, y, w, h, style) {
                (style === 'S' ? calls.strokedRects : calls.filledRects).push({ x, y, w, h });
            },
            text(str, x, y) { calls.text.push({ str: String(str), x, y, page: calls.page }); },
            addPage() { calls.pages++; calls.page = calls.pages; },
            setPage(p) { calls.page = p; },
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

    const strings = () => doc.calls.text.map(t => t.str);

    const ROWS = [
        { section: 'Base Set', set: '2024 Prizm', num: '1', name: 'Daniels', variant: '', serial: '', price: 45 },
        { section: 'Base Set', set: '2024 Prizm', num: '2', name: 'Daniels', variant: '', serial: '', price: 0 },
        { section: 'Inserts', set: '2024 Kaboom', num: 'K1', name: 'Daniels', variant: '', serial: '', price: 120 },
        // Sub-dollar: rounding this to whole dollars is what printed a real card
        // as $0, and without it the $0 assertion below never exercises the sink.
        { section: 'Inserts', set: '2024 Wave', num: 'W1', name: 'Daniels', variant: '', serial: '', price: 0.4 },
    ];

    const manyRows = (n) => Array.from({ length: n }, (_, i) => ({
        section: 'Base Set', set: '2024 Prizm', num: String(i + 1),
        name: 'Daniels', variant: '', serial: '', price: 0,
    }));

    it('draws one empty checkbox per card', async () => {
        await ChecklistExport.buildPDF(ROWS, { title: 'Jayden Daniels', filename: 'x.pdf' });

        expect(doc.calls.strokedRects).toHaveLength(4);
    });

    it('saves under the requested filename', async () => {
        await ChecklistExport.buildPDF(ROWS, { title: 'Jayden Daniels', filename: 'jd-checklist.pdf' });

        expect(doc.calls.saved).toBe('jd-checklist.pdf');
    });

    it('heads the document with the checklist title and a plain card count', async () => {
        await ChecklistExport.buildPDF(ROWS, { title: 'Jayden Daniels', filename: 'x.pdf' });

        const text = strings().join('|');
        expect(text).toContain('Jayden Daniels');
        expect(text).toContain('4 cards');
        // This is not the shopping list: nothing is "needed" and no cost is totalled.
        expect(text).not.toContain('needed');
        expect(text).not.toContain('Est. cost');
    });

    it('writes a section header per category', async () => {
        await ChecklistExport.buildPDF(ROWS, { title: 'T', filename: 'x.pdf' });

        expect(strings().filter(t => t === 'Base Set')).toHaveLength(1);
        expect(strings().filter(t => t === 'Inserts')).toHaveLength(1);
    });

    // Without this, a PDF of checkboxes and headers containing no card data at all
    // still passes every other test in this block.
    it('writes each card\'s values into its own column', async () => {
        await ChecklistExport.buildPDF(ROWS, { title: 'T', filename: 'x.pdf' });

        // ROWS is one player throughout, so Name is dropped: Set | # | Variant |
        // Price, left to right.
        expect(strings()).not.toContain('Daniels');
        const setX = doc.calls.text.filter(t => t.str === '2024 Prizm')[0].x;
        const numX = doc.calls.text.find(t => t.str === '1').x;
        expect(setX).toBeLessThan(numX);
        expect(strings()).toContain('$45');
        // A zero price is blank, and a sub-dollar one keeps its cents rather than
        // rounding down to $0.
        expect(strings()).not.toContain('$0');
        expect(strings()).toContain('$0.40');
    });

    it('repeats the column header on every page of a long checklist', async () => {
        await ChecklistExport.buildPDF(manyRows(120), { title: 'T', filename: 'x.pdf' });

        expect(doc.calls.pages).toBeGreaterThan(1);
        const headerPages = new Set(doc.calls.text.filter(t => t.str === 'Set').map(t => t.page));
        expect(headerPages.size).toBe(doc.calls.pages);
    });

    it('numbers every page once the total is known', async () => {
        await ChecklistExport.buildPDF(manyRows(120), { title: 'T', filename: 'x.pdf' });

        const total = doc.calls.pages;
        const numbered = strings().filter(t => /^Page \d+ of \d+$/.test(t));
        expect(numbered).toContain(`Page 1 of ${total}`);
        expect(numbered).toContain(`Page ${total} of ${total}`);
    });

    // ShoppingList.truncateToWidth is shared for exactly this: a long parallel name
    // running into the price column is the failure this layout is prone to.
    it('truncates a value too wide for its column', async () => {
        const wide = [{ ...ROWS[0], variant: 'Green Shimmer Prizm Autograph Refractor' }];

        await ChecklistExport.buildPDF(wide, { title: 'T', filename: 'x.pdf' });

        expect(strings()).not.toContain('Green Shimmer Prizm Autograph Refractor');
        expect(strings().some(t => t.startsWith('Green Shimmer') && t.endsWith('..'))).toBe(true);
    });

    it('drops the Name column when every card names the same player', async () => {
        await ChecklistExport.buildPDF(ROWS, { title: 'Jayden Daniels', filename: 'x.pdf' });

        expect(strings()).not.toContain('Name');
        expect(strings()).toContain('Set');
    });

    it('keeps the Name column as soon as one card names someone else', async () => {
        const mixed = [...ROWS, { ...ROWS[0], num: '9', name: 'Team Card' }];

        await ChecklistExport.buildPDF(mixed, { title: 'T', filename: 'x.pdf' });

        expect(strings()).toContain('Name');
        expect(strings()).toContain('Team Card');
    });

    // Neither layout was pinned: widening Set to 188mm, shrinking Variant to 8mm
    // and reordering all passed.
    it('lays out both column sets across the same usable width', async () => {
        await ChecklistExport.buildPDF(ROWS, { title: 'T', filename: 'x.pdf' });
        // Header cells advance strictly left to right and stay on the page.
        const headers = doc.calls.text.filter(t => ['Set', '#', 'Variant', 'Price'].includes(t.str));
        const xs = [...new Set(headers.map(h => h.x))].sort((a, b) => a - b);
        expect(xs).toHaveLength(4);
        expect(xs).toEqual([...xs].sort((a, b) => a - b));
        expect(Math.max(...xs)).toBeLessThan(215.9 - (215.9 - ChecklistExport.USABLE_WIDTH) / 2);
    });

    it('keeps every column ordered when Name is present', async () => {
        const mixed = [...ROWS, { ...ROWS[0], num: '9', name: 'Team Card' }];

        await ChecklistExport.buildPDF(mixed, { title: 'T', filename: 'x.pdf' });

        const order = ['Set', '#', 'Name', 'Variant', 'Price']
            .map(l => doc.calls.text.find(t => t.str === l));
        expect(order.every(Boolean)).toBe(true);
        const xs = order.map(h => h.x);
        expect(xs).toEqual([...xs].sort((a, b) => a - b));
        expect(Math.max(...xs)).toBeLessThan(215.9 - (215.9 - ChecklistExport.USABLE_WIDTH) / 2);
    });

    // USABLE_WIDTH was only ever compared against itself, so the margin could
    // drift away from it and every band, row and column would move together
    // while the arithmetic test stayed green.
    it('draws the header band across exactly the usable width', async () => {
        await ChecklistExport.buildPDF(ROWS, { title: 'T', filename: 'x.pdf' });

        const bands = doc.calls.filledRects.filter(r => Math.abs(r.w - ChecklistExport.USABLE_WIDTH) < 0.01);
        expect(bands.length).toBeGreaterThan(0);
        // Both edges: a smaller margin keeps the band on the page while shifting
        // the whole content block off centre, and the right-edge check alone
        // passes for that.
        const m = (215.9 - ChecklistExport.USABLE_WIDTH) / 2;
        expect(bands.every(r => Math.abs(r.x - m) < 0.01)).toBe(true);
        expect(doc.calls.filledRects.every(r => r.x + r.w <= 215.9 - m + 0.01)).toBe(true);
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

describe('ChecklistExport._formatPrice', () => {
    // Rounding to whole dollars printed a real 40c card as $0.
    it('keeps cents below a dollar', () => {
        expect(ChecklistExport._formatPrice(0.4)).toBe('0.40');
    });

    it('rounds to whole dollars at a dollar and above', () => {
        expect(ChecklistExport._formatPrice(45.6)).toBe('46');
        expect(ChecklistExport._formatPrice(1)).toBe('1');
    });
});

describe('ChecklistExport.columnLayout', () => {
    const total = (cols) => cols.reduce((sum, c) => sum + c.width, 0);

    // A collapsed or over-wide column still draws headers in ascending order and
    // still fits on the page, so only the arithmetic catches it.
    it('spans exactly the usable width with and without Name', () => {
        expect(total(ChecklistExport.columnLayout(true))).toBeCloseTo(ChecklistExport.USABLE_WIDTH, 5);
        expect(total(ChecklistExport.columnLayout(false))).toBeCloseTo(ChecklistExport.USABLE_WIDTH, 5);
    });

    it('gives Name\'s width to Set and Variant when it is dropped', () => {
        const withName = ChecklistExport.columnLayout(true);
        const without = ChecklistExport.columnLayout(false);
        const w = (cols, key) => cols.find(c => c.key === key).width;

        expect(without.some(c => c.key === 'name')).toBe(false);
        expect(w(without, 'set')).toBeGreaterThan(w(withName, 'set'));
        expect(w(without, 'variant')).toBeGreaterThan(w(withName, 'variant'));
    });

    // Minimums alone leave a hole: a sum-preserving swap between two columns can
    // satisfy every threshold and still collapse one. The layouts are a design
    // decision sized from real data, so pin them exactly - any change is then
    // deliberate and visible in the diff rather than silently absorbed.
    it('lays out the with-Name columns at their designed widths', () => {
        expect(ChecklistExport.columnLayout(true).map(c => [c.key, c.width])).toEqual([
            [null, 8], ['set', 63], ['num', 23], ['name', 40], ['variant', 42], ['price', 15.9],
        ]);
    });

    it('lays out the no-Name columns at their designed widths', () => {
        expect(ChecklistExport.columnLayout(false).map(c => [c.key, c.width])).toEqual([
            [null, 8], ['set', 89], ['num', 23], ['variant', 56], ['price', 15.9],
        ]);
    });

    // 215.9mm is US Letter, the one physical fact here. The positional bounds all
    // derive from USABLE_WIDTH, so widening it *and* the columns together leaves
    // every one of them satisfied while the margin goes negative and the content
    // block hangs off both paper edges.
    it('leaves a printable margin on a letter page', () => {
        expect((215.9 - ChecklistExport.USABLE_WIDTH) / 2).toBeGreaterThanOrEqual(10);
    });

    // Every threshold is a raw text width measured over the live gist at Helvetica
    // 8pt - w() has already taken off the 2mm gutter truncateToWidth reserves.
    // Widest number is "#34 / 139 / 174" (18.7mm), not a prefixed code.
    it('fits the longest real values in each column', () => {
        const w = (showName, key) => ChecklistExport.columnLayout(showName).find(c => c.key === key).width - 2;

        expect(w(false, 'set')).toBeGreaterThanOrEqual(78);      // 77.2
        expect(w(true, 'set')).toBeGreaterThanOrEqual(50);       // 49.1
        expect(w(true, 'num')).toBeGreaterThanOrEqual(19);       // 18.7
        expect(w(false, 'num')).toBeGreaterThanOrEqual(17);      // 16.2
        expect(w(false, 'variant')).toBeGreaterThanOrEqual(52);  // 51.3
        expect(w(true, 'variant')).toBeGreaterThanOrEqual(36);   // 34.9
        expect(w(true, 'name')).toBeGreaterThanOrEqual(33);      // 32.2
    });
});
