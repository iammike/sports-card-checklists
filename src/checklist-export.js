/**
 * ChecklistExport - Download a checklist as CSV or a printable PDF.
 *
 * Distinct from ShoppingList, which exports what the *owner* still needs across
 * every checklist. This exports one checklist in full, carries no ownership, and
 * reads the engine's already-loaded cards rather than re-fetching the gist.
 */
const ChecklistExport = {
    CSV_COLUMNS: ['Section', 'Set', 'Number', 'Name', 'Variant', 'Serial', 'Price', 'Owned'],

    // Column -> value, so a header and its data cannot drift apart. Reordering or
    // removing a column is one edit to the list above, not two that must agree.
    CSV_FIELDS: {
        Section: r => r.section,
        Set: r => r.set,
        Number: r => r.num,
        Name: r => r.name,
        Variant: r => r.variant,
        Serial: r => r.serial,
        Price: r => r.price || '',
        // FALSE, not blank: select the column in Google Sheets and Insert -> Checkbox
        // and these become real unticked boxes. Always the visitor's own tracking,
        // never the owner's ownership.
        Owned: () => 'FALSE',
    },

    // A checklist for one player repeats that name on every row. Dropped from both
    // formats: it is in the document title, and in the PDF it costs roughly a
    // fifth of the line. Any card naming someone else - a team card, a dual auto - brings
    // the column back, so this follows the data rather than a config flag.
    _namesVary(rows) {
        return new Set(rows.map(r => r.name || '')).size > 1;
    },

    columnsFor(rows) {
        return this._namesVary(rows) ? this.CSV_COLUMNS : this.CSV_COLUMNS.filter(c => c !== 'Name');
    },

    // Flatten the engine's in-memory cards into export rows, in config order.
    // `cards` is a flat array or a {categoryId: [...]} map, matching dataShape.
    collectRows(cards, config, includeExtra, sort) {
        const rows = [];
        const isFlat = (config?.dataShape || 'categories') === 'flat';

        const push = (section, list) => {
            (sort ? sort(list || []) : (list || [])).forEach(card => {
                if (card.collectionLink || card.noCard) return;
                rows.push({
                    section,
                    set: card.set || '',
                    num: card.num || '',
                    // No live card carries `name` today; `player` is the populated
                    // field. Both are read so a renamed entry is not silently blank.
                    name: card.name || card.player || '',
                    variant: card.variant || '',
                    serial: card.serial || '',
                    // Normalized here so the CSV column and the PDF column
                    // cannot disagree - the PDF formats through
                    // CardRenderer.formatPrice, the CSV emits this straight (#761).
                    price: CardRenderer.normalizePrice(card.price),
                });
            });
        };

        if (isFlat) {
            push('', cards);
            return rows;
        }

        (config?.categories || []).forEach(cat => {
            if (!includeExtra && cat.isMain === false) return;
            if (cat.children && cat.children.length > 0) {
                // The parent carries isMain, but each child is its own section on
                // the page, so the child's label is the one a reader recognises.
                cat.children.forEach(child => push(child.label || child.id, cards?.[child.id]));
            } else {
                push(cat.label || cat.id, cards?.[cat.id]);
            }
        });
        return rows;
    },

    // RFC 4180: quote anything containing a delimiter, quote or newline, and
    // double the quotes inside. Formula injection is deliberately not escaped:
    // only the site owner can write these values, and anyone who could inject one
    // already has arbitrary content on the page itself, so the CSV adds no surface.
    // Prefixing would also corrupt legitimate values like a negative card number.
    _escapeCSV(value) {
        const str = value === null || value === undefined ? '' : String(value);
        return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    },

    toCSV(rows) {
        const cols = this.columnsFor(rows);
        const lines = [cols.join(',')];
        rows.forEach(r => {
            lines.push(cols.map(c => this._escapeCSV(this.CSV_FIELDS[c](r))).join(','));
        });
        return lines.join('\r\n');
    },

    // The content block. buildPDF derives its horizontal margin from this, so both
    // layouts span exactly this width or one of them runs off the page.
    //
    // Columns are sized from the longest values in the live gist at Helvetica 8pt,
    // per layout - the widest number and the widest set live on different ones:
    //   set      77.2mm no-Name / 49.1mm with-Name
    //   number   16.2mm no-Name / 18.7mm with-Name ("#34 / 139 / 174")
    //   variant  51.3mm no-Name / 34.9mm with-Name
    //   name     32.2mm (with-Name only)
    // Truncating a card number costs the reader the identifier, so # is deliberately
    // over-provisioned - though it still ends up the tightest column in absolute
    // terms (2.3mm spare), because its longest value is close to its width.
    USABLE_WIDTH: 191.9,

    // No Serial column: it matters to an importer, but on paper the print run is
    // already on the card and the width is better spent on Set.
    columnLayout(showName) {
        return showName
            ? [
                { key: null, label: '', width: 8 },
                { key: 'set', label: 'Set', width: 63 },
                { key: 'num', label: '#', width: 23 },
                { key: 'name', label: 'Name', width: 40 },
                { key: 'variant', label: 'Variant', width: 42 },
                { key: 'price', label: 'Price', width: 15.9 },
            ]
            : [
                { key: null, label: '', width: 8 },
                { key: 'set', label: 'Set', width: 89 },
                { key: 'num', label: '#', width: 23 },
                { key: 'variant', label: 'Variant', width: 56 },
                { key: 'price', label: 'Price', width: 15.9 },
            ];
    },

    // A separate builder from ShoppingList.buildPDF rather than a mode flag on it.
    // The documents differ in title, summary, column set and grouping axis, so
    // parameterising would thread branches through the export the owner relies on.
    // Only the page footer is shared.
    async buildPDF(rows, meta) {
        await ShoppingList.loadJsPDF();
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ unit: 'mm', format: 'letter' });
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        // Derived, so USABLE_WIDTH stays load-bearing: a margin that disagreed with
        // it would move every band and column together and look fine in isolation.
        const usableWidth = this.USABLE_WIDTH;
        const margin = (pageWidth - usableWidth) / 2;

        const boxSize = 3.2;
        // Both layouts sum to USABLE_WIDTH; dropping Name gives its space to Set and
        // Variant, the two that actually run long.
        const showName = this._namesVary(rows);
        const cols = this.columnLayout(showName);
        const rowHeight = 5.5;
        const headerHeight = 7;
        const sectionHeaderHeight = 7;
        let y = margin;

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(14);
        doc.text(meta.title, margin, y + 5);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.text(
            new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
            pageWidth - margin, y + 5, { align: 'right' },
        );
        y += 12;
        doc.setFontSize(9);
        doc.text(rows.length + (rows.length === 1 ? ' card' : ' cards'), margin, y);
        y += 8;

        const drawHeader = () => {
            doc.setFillColor(50, 50, 50);
            doc.rect(margin, y, usableWidth, headerHeight, 'F');
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(8);
            doc.setTextColor(255, 255, 255);
            let x = margin + 2;
            for (const col of cols) {
                if (col.label) doc.text(col.label, x, y + 5);
                x += col.width;
            }
            doc.setTextColor(0, 0, 0);
            doc.setFont('helvetica', 'normal');
            y += headerHeight + 1;
        };

        const newPage = () => {
            doc.addPage();
            y = margin;
        };

        const drawSectionHeader = (name) => {
            if (y + sectionHeaderHeight + headerHeight + rowHeight > pageHeight - margin - 10) newPage();
            doc.setFillColor(80, 80, 80);
            doc.rect(margin, y, usableWidth, sectionHeaderHeight, 'F');
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(9);
            doc.setTextColor(255, 255, 255);
            doc.text(name, margin + 4, y + 5);
            doc.setTextColor(0, 0, 0);
            doc.setFont('helvetica', 'normal');
            y += sectionHeaderHeight + 1;
        };

        let currentSection = null;
        let rowIndex = 0;
        if (!rows.length || !rows[0].section) drawHeader();
        doc.setFontSize(8);

        for (const row of rows) {
            if (row.section && row.section !== currentSection) {
                currentSection = row.section;
                rowIndex = 0;
                drawSectionHeader(currentSection);
                drawHeader();
                doc.setFontSize(8);
            }
            if (y + rowHeight > pageHeight - margin - 10) {
                newPage();
                drawHeader();
                doc.setFontSize(8);
                rowIndex = 0;
            }
            if (rowIndex % 2 === 0) {
                doc.setFillColor(245, 245, 245);
                doc.rect(margin, y - 1, usableWidth, rowHeight, 'F');
            }

            // Blank by design: the visitor's own tracking, never the owner's.
            doc.setDrawColor(90, 90, 90);
            doc.setLineWidth(0.3);
            doc.rect(margin + 2, y - 0.2, boxSize, boxSize, 'S');

            let x = margin + 2;
            cols.forEach(col => {
                const v = col.key === 'price'
                    ? (row.price > 0 ? '$' + CardRenderer.formatPrice(row.price) : '')
                    : (col.key ? (row[col.key] || '') : '');
                if (v) doc.text(ShoppingList.truncateToWidth(doc, String(v), col.width), x, y + 3);
                x += col.width;
            });
            y += rowHeight;
            rowIndex++;
        }

        const totalPages = doc.internal.getNumberOfPages();
        for (let p = 1; p <= totalPages; p++) {
            doc.setPage(p);
            ShoppingList.drawPageFooter(doc, pageWidth, pageHeight, margin, p, totalPages);
        }
        doc.save(meta.filename);
    },

    backdrop: null,

    // A blob download rather than a data: URI, which some browsers truncate.
    _download(filename, content, mime = 'text/csv;charset=utf-8') {
        const blob = new Blob([content], { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
    },

    _initModal() {
        if (this.backdrop) return;
        const backdrop = document.createElement('div');
        backdrop.className = 'card-editor-backdrop shopping-list-backdrop';
        backdrop.innerHTML =
            '<div class="card-editor-modal shopping-list-modal">' +
                '<div class="card-editor-header">' +
                    '<div class="card-editor-header-left">' +
                        '<div class="card-editor-title">EXPORT CHECKLIST</div>' +
                        '<div class="card-editor-subtitle" id="ce-subtitle"></div>' +
                    '</div>' +
                    '<button class="card-editor-close" title="Close">&times;</button>' +
                '</div>' +
                '<div class="card-editor-body">' +
                    '<div class="shopping-list-section-label">Format</div>' +
                    '<div class="shopping-list-option">' +
                        '<input type="radio" name="ce-format" id="ce-format-csv" checked>' +
                        '<label for="ce-format-csv">CSV - for spreadsheets and collection trackers</label>' +
                    '</div>' +
                    '<div class="shopping-list-option">' +
                        '<input type="radio" name="ce-format" id="ce-format-pdf">' +
                        '<label for="ce-format-pdf">PDF - printable, with a blank checkbox per card</label>' +
                    '</div>' +
                    '<div class="shopping-list-divider" id="ce-options-divider"></div>' +
                    '<div class="shopping-list-section-label" id="ce-options-label">Options</div>' +
                    '<div class="shopping-list-option">' +
                        '<input type="checkbox" id="ce-include-extra" checked>' +
                        '<label for="ce-include-extra">Include inserts, parallels and other extra categories</label>' +
                    '</div>' +
                '</div>' +
                '<div class="card-editor-footer">' +
                    '<button class="card-editor-btn cancel" id="ce-cancel">Cancel</button>' +
                    '<button class="card-editor-btn save" id="ce-export">Export</button>' +
                '</div>' +
            '</div>';

        const close = () => this.close();
        backdrop.querySelector('.card-editor-close').onclick = close;
        backdrop.querySelector('#ce-cancel').onclick = close;
        backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && backdrop.classList.contains('active')) close();
        });
        backdrop.querySelector('#ce-export').onclick = () => this._onExport();
        backdrop.querySelector('.card-editor-modal').addEventListener('keydown', (e) => {
            // Buttons activate on Enter natively; forwarding those would fire
            // Export twice, or fire it when Cancel had focus.
            if (e.key === 'Enter' && !e.target.closest('button')) {
                backdrop.querySelector('#ce-export').click();
            }
        });

        document.body.appendChild(backdrop);
        this.backdrop = backdrop;
    },

    open(context) {
        this._context = context;
        this._initModal();
        this.backdrop.querySelector('#ce-subtitle').textContent = context.title || context.id;
        this.backdrop.querySelector('#ce-format-csv').checked = true;
        this.backdrop.querySelector('#ce-format-pdf').checked = false;
        this.backdrop.querySelector('#ce-include-extra').checked = true;

        // Some checklists mark every category as extra (eagles-legends does).
        // Unchecking there exports nothing, so offer no choice that can only
        // produce an empty file.
        const cats = context.config?.categories || [];
        const canFilter = cats.some(c => c.isMain !== false);
        const display = canFilter ? '' : 'none';
        this.backdrop.querySelector('#ce-include-extra').closest('.shopping-list-option')
            .style.display = display;
        // The heading and divider too, or the section is an empty "Options".
        this.backdrop.querySelector('#ce-options-divider').style.display = display;
        this.backdrop.querySelector('#ce-options-label').style.display = display;

        this.backdrop.classList.add('active');
    },

    close() {
        if (this.backdrop) this.backdrop.classList.remove('active');
    },

    async _onExport() {
        const ctx = this._context;
        const btn = this.backdrop.querySelector('#ce-export');
        const includeExtra = this.backdrop.querySelector('#ce-include-extra').checked;
        const asPdf = this.backdrop.querySelector('#ce-format-pdf').checked;
        const rows = this.collectRows(ctx.cards, ctx.config, includeExtra, ctx.sort);
        const base = `${ctx.id}-checklist`;

        if (!asPdf) {
            // Excel on Windows ignores the Blob's charset and uses the system
            // codepage; the BOM is what makes an accented name survive.
            this._download(`${base}.csv`, '\uFEFF' + this.toCSV(rows));
            this.close();
            return;
        }

        const originalText = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Generating...';
        try {
            await this.buildPDF(rows, { title: ctx.title || ctx.id, filename: `${base}.pdf` });
            this.close();
        } catch (e) {
            console.error('Checklist PDF failed:', e);
            alert('Failed to build the PDF: ' + e.message);
        } finally {
            btn.disabled = false;
            btn.textContent = originalText;
        }
    },
};

window.ChecklistExport = ChecklistExport;
