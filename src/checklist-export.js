/**
 * ChecklistExport - Download a checklist as CSV or a printable PDF.
 *
 * Distinct from ShoppingList, which exports what the *owner* still needs across
 * every checklist. This exports one checklist in full, carries no ownership, and
 * reads the engine's already-loaded cards rather than re-fetching the gist.
 */
const ChecklistExport = {
    CSV_COLUMNS: ['Section', 'Year', 'Set', 'Number', 'Name', 'Variant', 'Serial', 'Price', 'Owned'],

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
                    year: CardRenderer.getYear(card),
                    set: card.set || '',
                    num: card.num || '',
                    name: card.name || card.player || '',
                    variant: card.variant || '',
                    serial: card.serial || '',
                    price: card.price || 0,
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
        const lines = [this.CSV_COLUMNS.join(',')];
        rows.forEach(r => {
            lines.push([
                r.section,
                r.year || '',
                r.set,
                r.num,
                r.name,
                r.variant,
                r.serial,
                r.price || '',
                '', // Owned - the visitor's to fill in
            ].map(v => this._escapeCSV(v)).join(','));
        });
        return lines.join('\r\n');
    },
    // Whole dollars, except under $1 where rounding would print a real card as $0.
    _formatPrice(price) {
        const p = Number(price);
        return p < 1 ? p.toFixed(2) : p.toFixed(0);
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
        const margin = 12;
        const usableWidth = pageWidth - margin * 2;

        const boxSize = 3.2;
        const cols = [
            { label: '', width: 8 },
            { label: 'Set', width: 74 },
            { label: '#', width: 16 },
            { label: 'Name', width: 44 },
            { label: 'Variant', width: 34 },
            { label: 'Price', width: 16 },
        ];
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

            const values = ['', row.set, row.num, row.name, row.variant,
                row.price > 0 ? '$' + this._formatPrice(row.price) : ''];
            let x = margin + 2;
            values.forEach((v, i) => {
                if (v) doc.text(ShoppingList.truncateToWidth(doc, v, cols[i].width), x, y + 3);
                x += cols[i].width;
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

    // A blob download rather than a data: URI - card data runs to thousands of
    // rows and long data: URIs are truncated by some browsers.
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
                    '<div class="shopping-list-divider"></div>' +
                    '<div class="shopping-list-section-label">Options</div>' +
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
            if (e.key === 'Enter') backdrop.querySelector('#ce-export').click();
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
