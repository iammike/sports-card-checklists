/**
 * ShoppingList - Export cards across every checklist, as PDF or CSV.
 *
 * Named for what it produced when it only did one thing. It now picks a scope
 * too - needed, owned, or all - so a shopping list is one of its outputs rather
 * than the whole of it (#745). The element id and this file name stayed put
 * because several modules anchor on them; the user-facing labels did not.
 *
 * Distinct from ChecklistExport, which exports one checklist in full for a
 * visitor and carries no ownership.
 */
const ShoppingList = {
    backdrop: null,

    async loadJsPDF() {
        if (window.jspdf) return;
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
            script.onload = resolve;
            script.onerror = () => reject(new Error('Failed to load jsPDF'));
            document.head.appendChild(script);
        });
    },

    generateCardId(card, config) {
        // Only a safe-charset id is honored - see isSafeCardId in shared.js
        if (isSafeCardId(card.id)) return card.id;
        const includePlayer = config?.cardDisplay?.includePlayerInCardId;
        const str = (includePlayer ? (card.player || '') : '')
            + (card.set || '') + (card.num || '') + (card.variant || '');
        const safe = str.replace(/[^\x00-\xFF]/g, '_');
        return btoa(safe).replace(/[^a-zA-Z0-9]/g, '');
    },

    flattenCards(cardData, config, includeExtra) {
        if (config.dataShape === 'flat') {
            // Exclude collection link cards and no-card entries (not real cards)
            return (cardData.cards || []).filter(c => !c.collectionLink && !c.noCard);
        }
        // Category-based: filter by main or all categories
        const categories = config.categories || [];
        const includedCatIds = new Set();
        const filter = includeExtra ? () => true : (c => c.isMain !== false);
        categories.filter(filter).forEach(cat => {
            if (cat.children && cat.children.length > 0) {
                cat.children.forEach(child => includedCatIds.add(child.id));
            } else {
                includedCatIds.add(cat.id);
            }
        });
        const all = [];
        for (const [catId, cards] of Object.entries(cardData.categories || {})) {
            if (includedCatIds.size === 0 || includedCatIds.has(catId)) {
                cards.forEach(c => { if (!c.collectionLink && !c.noCard) all.push(c); });
            }
        }
        return all;
    },

    initModal() {
        if (this.backdrop) return;

        const backdrop = document.createElement('div');
        backdrop.className = 'card-editor-backdrop shopping-list-backdrop';
        backdrop.innerHTML =
            '<div class="card-editor-modal shopping-list-modal">' +
                '<div class="card-editor-header">' +
                    '<div class="card-editor-header-left">' +
                        '<div class="card-editor-title">EXPORT</div>' +
                        '<div class="card-editor-subtitle">Cards from the checklists you pick</div>' +
                    '</div>' +
                    '<button class="card-editor-close" title="Close">&times;</button>' +
                '</div>' +
                '<div class="card-editor-body">' +
                    '<div class="shopping-list-section-label">Checklists</div>' +
                    '<button class="shopping-list-toggle-all" id="sl-toggle-all">Select None</button>' +
                    '<div class="shopping-list-checklist-list" id="sl-checklist-list"></div>' +
                    '<div class="shopping-list-divider"></div>' +
                    '<div class="shopping-list-section-label">Cards</div>' +
                    '<div class="shopping-list-option">' +
                        '<input type="radio" name="sl-scope" id="sl-scope-needed" checked>' +
                        '<label for="sl-scope-needed">Needed - what is still missing, to shop from</label>' +
                    '</div>' +
                    '<div class="shopping-list-option">' +
                        '<input type="radio" name="sl-scope" id="sl-scope-owned">' +
                        '<label for="sl-scope-owned">Owned - what is in the collection, and what it is worth</label>' +
                    '</div>' +
                    '<div class="shopping-list-option">' +
                        '<input type="radio" name="sl-scope" id="sl-scope-all">' +
                        '<label for="sl-scope-all">All - every card, with an owned column</label>' +
                    '</div>' +
                    '<div class="shopping-list-divider"></div>' +
                    '<div class="shopping-list-section-label">Format</div>' +
                    '<div class="shopping-list-option">' +
                        '<input type="radio" name="sl-format" id="sl-format-pdf" checked>' +
                        '<label for="sl-format-pdf">PDF - printable, grouped and priced</label>' +
                    '</div>' +
                    '<div class="shopping-list-option">' +
                        '<input type="radio" name="sl-format" id="sl-format-csv">' +
                        '<label for="sl-format-csv">CSV - for spreadsheets and collection trackers</label>' +
                    '</div>' +
                    '<div class="shopping-list-divider"></div>' +
                    '<div class="shopping-list-section-label">Options</div>' +
                    '<div class="shopping-list-option">' +
                        '<input type="checkbox" id="sl-include-extra">' +
                        '<label for="sl-include-extra">Include extra categories (inserts, parallels, etc.)</label>' +
                    '</div>' +
                    '<div class="shopping-list-option">' +
                        '<input type="checkbox" id="sl-group-by">' +
                        '<label for="sl-group-by">Group cards by checklist</label>' +
                    '</div>' +
                '</div>' +
                '<div class="card-editor-footer">' +
                    '<button class="card-editor-btn cancel" id="sl-cancel">Cancel</button>' +
                    '<button class="card-editor-btn save" id="sl-generate">Export</button>' +
                '</div>' +
            '</div>';

        backdrop.querySelector('.card-editor-close').onclick = () => this.closeModal();
        backdrop.querySelector('#sl-cancel').onclick = () => this.closeModal();
        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) this.closeModal();
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && backdrop.classList.contains('active')) {
                this.closeModal();
            }
        });

        const modal = backdrop.querySelector('.card-editor-modal');
        modal.addEventListener('keydown', (e) => {
            // Buttons activate on Enter natively; forwarding those would fire
            // Generate twice, or fire it when Cancel had focus.
            if (e.key === 'Enter' && !e.target.closest('button')) {
                backdrop.querySelector('#sl-generate').click();
            }
        });

        const updateToggleText = () => {
            const checkboxes = backdrop.querySelectorAll('#sl-checklist-list input[type="checkbox"]');
            const allChecked = Array.from(checkboxes).every(cb => cb.checked);
            backdrop.querySelector('#sl-toggle-all').textContent = allChecked ? 'Select None' : 'Select All';
        };

        backdrop.querySelector('#sl-toggle-all').onclick = () => {
            const checkboxes = backdrop.querySelectorAll('#sl-checklist-list input[type="checkbox"]');
            const allChecked = Array.from(checkboxes).every(cb => cb.checked);
            checkboxes.forEach(cb => { cb.checked = !allChecked; });
            updateToggleText();
        };

        // Est. Value on the site spans every owned card, extras included
        // (computeStats in checklist-engine.js), so an Owned or All export has
        // to as well or its total silently disagrees with the number the owner
        // is comparing it against. Ticked on their behalf, not forced: they can
        // still untick it for a main-set-only view.
        backdrop.querySelectorAll('input[name="sl-scope"]').forEach(radio => {
            radio.addEventListener('change', () => {
                if (radio.id !== 'sl-scope-needed' && radio.checked) {
                    backdrop.querySelector('#sl-include-extra').checked = true;
                }
            });
        });

        // Update toggle text when individual checkboxes change
        backdrop.querySelector('#sl-checklist-list').addEventListener('change', updateToggleText);

        backdrop.querySelector('#sl-generate').onclick = () => this._onGenerate();

        document.body.appendChild(backdrop);
        this.backdrop = backdrop;
        this._updateToggleText = updateToggleText;
    },

    async showOptionsModal() {
        if (!window.githubSync) return;
        this.initModal();

        // Populate checklist checkboxes
        const list = this.backdrop.querySelector('#sl-checklist-list');
        list.innerHTML = '';

        const registryData = await DynamicNav.loadRegistry();
        const checklists = (registryData?.checklists || []).filter(e => !e.hidden);

        for (const entry of checklists) {
            const item = document.createElement('div');
            item.className = 'shopping-list-checklist-item';
            const id = 'sl-cl-' + entry.id;
            item.innerHTML =
                '<input type="checkbox" id="' + id + '" data-checklist-id="' + entry.id + '" checked>' +
                '<label for="' + id + '">' + sanitizeText(entry.title || entry.id) + '</label>';
            list.appendChild(item);
        }

        // Update toggle text based on checkbox state
        this._updateToggleText();

        // Reset options to defaults
        this.backdrop.querySelector('#sl-include-extra').checked = false;
        this.backdrop.querySelector('#sl-group-by').checked = false;
        // Needed + PDF is what this dialog produced before it had either
        // control, so opening it and pressing Export still does that.
        this.backdrop.querySelector('#sl-scope-needed').checked = true;
        this.backdrop.querySelector('#sl-format-pdf').checked = true;

        this.backdrop.classList.add('active');
    },

    closeModal() {
        if (this.backdrop) {
            this.backdrop.classList.remove('active');
        }
    },

    async _onGenerate() {
        const genBtn = this.backdrop.querySelector('#sl-generate');
        const originalText = genBtn.textContent;
        genBtn.disabled = true;
        genBtn.textContent = 'Generating...';

        try {
            // Gather selected options
            const checkboxes = this.backdrop.querySelectorAll('#sl-checklist-list input[type="checkbox"]:checked');
            const selectedChecklists = new Set(Array.from(checkboxes).map(cb => cb.dataset.checklistId));
            const includeExtra = this.backdrop.querySelector('#sl-include-extra').checked;
            const groupByChecklist = this.backdrop.querySelector('#sl-group-by').checked;
            const scope = this.backdrop.querySelector('#sl-scope-owned').checked ? 'owned'
                : this.backdrop.querySelector('#sl-scope-all').checked ? 'all'
                : 'needed';
            const format = this.backdrop.querySelector('#sl-format-csv').checked ? 'csv' : 'pdf';

            if (selectedChecklists.size === 0) {
                alert('Select at least one checklist.');
                return;
            }

            await this.generate({ selectedChecklists, includeExtra, groupByChecklist, scope, format });
            this.closeModal();
        } catch (e) {
            console.error('Shopping list generation failed:', e);
            alert('Failed to generate shopping list: ' + e.message);
        } finally {
            genBtn.disabled = false;
            genBtn.textContent = originalText;
        }
    },

    async generate(options) {
        if (!window.githubSync) return;

        const selectedChecklists = options?.selectedChecklists || null;
        const includeExtra = options?.includeExtra || false;
        const groupByChecklist = options?.groupByChecklist || false;
        // 'needed' is what this tool has always produced, and stays the default
        // for every caller that does not ask (#745).
        const scope = options?.scope || 'needed';
        const format = options?.format || 'pdf';

        // Only the CSV path can skip it, and it is the expensive import. Phrased
        // against 'csv' so it matches the routing below - an unrecognised format
        // falls through to the PDF in both places rather than skipping the load
        // and then throwing on window.jspdf.
        if (format !== 'csv') await this.loadJsPDF();

        // Load registry (use DynamicNav which has session caching)
        const registryData = await DynamicNav.loadRegistry();
        const checklists = registryData?.checklists || [];
        if (!checklists.length) {
            alert('No checklists found.');
            return;
        }

        // Force fresh load (page-load cache may be stale)
        githubSync.clearDataCache();
        const data = await githubSync.loadData() || await githubSync.loadPublicData();
        const ownedByChecklist = data?.checklists || {};

        // Every card the scope asks for, across the selected checklists.
        const shoppingItems = [];

        for (const entry of checklists.filter(e => !e.hidden)) {
            const id = entry.id;

            // Skip checklists not in selected set
            if (selectedChecklists && !selectedChecklists.has(id)) continue;

            const config = await githubSync.loadChecklistConfig(id)
                || await githubSync.loadPublicChecklistConfig(id);
            if (!config) continue;

            const cardData = await githubSync.loadCardData(id)
                || await githubSync.loadPublicCardData(id);
            if (!cardData) continue;

            const allCards = this.flattenCards(cardData, config, includeExtra);
            const owned = ownedByChecklist[id] || [];

            for (const card of allCards) {
                // Skip cards with no set name (incomplete data). Note this and
                // flattenCards' collectionLink drop both make an Owned export's
                // card *count* fall short of the site's owned count. Neither
                // affects the money: computeStats returns before adding a
                // collection link's price, and a card with no set has nothing to
                // identify it in an export anyway.
                if (!card.set) continue;
                const cardId = this.generateCardId(card, config);
                const isOwned = owned.includes(cardId);
                if (scope === 'needed' ? isOwned : (scope === 'owned' && !isOwned)) continue;
                shoppingItems.push({
                    owned: isOwned,
                    year: CardRenderer.getYear(card),
                    setName: CardRenderer.getSetName(card),
                    set: card.set || '',
                    num: card.num || '',
                    name: card.name || card.player
                        || (entry.navLabel || entry.title || '').toLowerCase().replace(/\b\w/g, c => c.toUpperCase()),
                    variant: card.variant || '',
                    // Normalized here, which coerces as well as applying the
                    // whole-dollar rule (#761). The coercion is what keeps a
                    // hand-edited string price from making the summary's
                    // reduce concatenate instead of add - one quoted price
                    // used to kill the whole export with a TypeError in an
                    // alert that named no card. The whole-dollar half is what
                    // keeps the total agreeing with the rows it totals.
                    price: CardRenderer.normalizePrice(card.price),
                    checklist: entry.title || id
                });
            }
        }

        // Sort by year, set name, card number (cards without year go last)
        shoppingItems.sort((a, b) => {
            if (groupByChecklist) {
                const cmp = a.checklist.localeCompare(b.checklist);
                if (cmp !== 0) return cmp;
            }
            const hasYearA = a.year > 0 ? 0 : 1;
            const hasYearB = b.year > 0 ? 0 : 1;
            if (hasYearA !== hasYearB) return hasYearA - hasYearB;
            if (a.year !== b.year) return a.year - b.year;
            if (a.setName !== b.setName) return a.setName.localeCompare(b.setName);
            const numA = parseInt(a.num) || 0;
            const numB = parseInt(b.num) || 0;
            return numA - numB;
        });

        if (format === 'csv') {
            this.buildCSV(shoppingItems, { scope });
            return;
        }
        this.buildPDF(shoppingItems, { groupByChecklist, scope });
    },

    // What each scope is called, in file names and on the page.
    SCOPE_LABELS: {
        needed: 'Shopping List',
        owned: 'Collection',
        all: 'Every Card',
    },

    // Deliberately not ChecklistExport's column set: that one exports a single
    // checklist and carries a Section, while these rows span checklists and
    // carry the one they came from. The writer, the escaping and the BOM are
    // shared - only the columns differ (#745).
    //
    // Passed to toCSV as an explicit list, so columnsFor's drop-Name-when-nobody-
    // has-one rule does not apply. That rule suits a document a person reads; a
    // file meant for a spreadsheet or a re-import wants the same header every
    // time. Name is never empty here anyway - it falls back to the checklist's
    // own label when a card has neither name nor player.
    CSV_FIELDS: {
        Checklist: r => r.checklist,
        Set: r => r.set,
        Number: r => r.num,
        Name: r => r.name,
        Variant: r => r.variant,
        Price: r => r.price || '',
        // The real state, unlike the single-checklist export's blank column:
        // this file is generated by the owner from their own collection, and a
        // scope of 'all' is meaningless without it.
        Owned: r => (r.owned ? 'TRUE' : 'FALSE'),
    },

    // File name, from the same source as the heading. Both formats go through
    // here, or a collection export downloads as shopping-list.pdf.
    _scopeSlug(scope) {
        return (this.SCOPE_LABELS[scope] || 'export').toLowerCase().replace(/\s+/g, '-');
    },

    buildCSV(items, options) {
        const scope = options?.scope || 'needed';
        const cols = Object.keys(this.CSV_FIELDS);
        const csv = ChecklistExport.toCSV(items, this.CSV_FIELDS, cols);
        ChecklistExport.downloadCSV(`${this._scopeSlug(scope)}.csv`, csv);
    },

    buildPDF(items, options) {
        const groupByChecklist = options?.groupByChecklist || false;
        const scope = options?.scope || 'needed';
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ unit: 'mm', format: 'letter' });
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const margin = 12;
        const usableWidth = pageWidth - margin * 2;

        // Column layout: Set | # | Name | Variant | Price, plus Owned when the
        // rows can differ on it. A 'needed' export is entirely unowned and an
        // 'owned' one entirely owned, so the column would be a constant; only
        // 'all' mixes them, and without it that PDF prints an owned and an
        // unowned card identically. The width comes off Set, the widest column.
        const showOwned = scope === 'all';
        const cols = [
            { label: 'Set', width: showOwned ? 66 : 76 },
            { label: '#', width: 16 },
            { label: 'Name', width: 42 },
            { label: 'Variant', width: 42 },
            { label: 'Price', width: 18 },
            ...(showOwned ? [{ label: 'Owned', width: 10 }] : []),
        ];

        const rowHeight = 5.5;
        const sectionHeaderHeight = 7;
        const headerHeight = 7;
        const fontSize = 8;
        const headerFontSize = 8;
        let y = margin;

        // Title
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(14);
        doc.text(this.SCOPE_LABELS[scope] || 'Shopping List', margin, y + 5);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        doc.text(dateStr, pageWidth - margin, y + 5, { align: 'right' });
        y += 12;

        // Summary line
        // Normalized here as well as at the source: the line items above render
        // through CardRenderer.formatPrice, which normalizes whatever it is
        // given, so a total summing raw values contradicts the rows it is
        // totalling. A single 40c card printed a "$1" row over "Est. cost: $0"
        // (#761).
        const totalPrice = items.reduce((sum, item) => sum + CardRenderer.normalizePrice(item.price), 0);
        const priceCount = items.filter(i => CardRenderer.normalizePrice(i.price) > 0).length;
        const noun = { needed: ' cards needed', owned: ' cards owned', all: ' cards' }[scope] || ' cards';
        let summary = items.length + noun;
        if (priceCount > 0) {
            // Whole dollars, like every line item above it (#761) - this used to
            // print "Est. cost: $0.40" under a line item reading "$1".
            const moneyLabel = scope === 'needed' ? 'Est. cost' : 'Est. value';
            summary += '  |  ' + moneyLabel + ': $' + totalPrice + ' (' + priceCount + ' priced)';
        }
        doc.setFontSize(9);
        doc.text(summary, margin, y);
        y += 8;

        const drawHeader = () => {
            // Header background
            doc.setFillColor(50, 50, 50);
            doc.rect(margin, y, usableWidth, headerHeight, 'F');
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(headerFontSize);
            doc.setTextColor(255, 255, 255);

            let x = margin + 2;
            for (const col of cols) {
                doc.text(col.label, x, y + 5);
                x += col.width;
            }
            doc.setTextColor(0, 0, 0);
            doc.setFont('helvetica', 'normal');
            y += headerHeight + 1;
        };

        const drawSectionHeader = (name) => {
            // Check if we need a new page for section header + at least one row
            if (y + sectionHeaderHeight + headerHeight + rowHeight > pageHeight - margin - 10) {
                this.drawPageFooter(doc, pageWidth, pageHeight, margin, doc.internal.getNumberOfPages());
                doc.addPage();
                y = margin;
            }
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

        let currentGroup = null;

        if (!groupByChecklist) {
            drawHeader();
        }

        // Data rows
        doc.setFontSize(fontSize);
        let rowIndex = 0;
        for (let i = 0; i < items.length; i++) {
            const item = items[i];

            // Group-by-checklist: draw section header when group changes
            if (groupByChecklist && item.checklist !== currentGroup) {
                currentGroup = item.checklist;
                rowIndex = 0;
                drawSectionHeader(currentGroup);
                drawHeader();
                doc.setFontSize(fontSize);
            }

            if (y + rowHeight > pageHeight - margin - 10) {
                // Footer on current page
                this.drawPageFooter(doc, pageWidth, pageHeight, margin, doc.internal.getNumberOfPages());
                doc.addPage();
                y = margin;
                drawHeader();
                doc.setFontSize(fontSize);
                // Reset row index for alternating shading after page break
                rowIndex = 0;
            }

            // Alternating row shading
            if (rowIndex % 2 === 0) {
                doc.setFillColor(245, 245, 245);
                doc.rect(margin, y - 1, usableWidth, rowHeight, 'F');
            }

            let x = margin + 2;

            const truncate = (text, w) => this.truncateToWidth(doc, text, w);

            doc.text(truncate(item.set, cols[0].width), x, y + 3);
            x += cols[0].width;

            doc.text(truncate(String(item.num), cols[1].width), x, y + 3);
            x += cols[1].width;

            doc.text(truncate(item.name, cols[2].width), x, y + 3);
            x += cols[2].width;

            doc.text(truncate(item.variant, cols[3].width), x, y + 3);
            x += cols[3].width;

            if (item.price > 0) {
                // Shared with the checklist export so a 40c card does not print as $0.
                doc.text('$' + CardRenderer.formatPrice(item.price), x, y + 3);
            }
            x += cols[4].width;

            if (showOwned) {
                // A tick, not a checkbox: this reports what is owned rather than
                // offering something to fill in.
                doc.text(item.owned ? '\u2713' : '', x, y + 3);
            }

            y += rowHeight;
            rowIndex++;
        }

        // Footer on last page
        const totalPages = doc.internal.getNumberOfPages();
        for (let p = 1; p <= totalPages; p++) {
            doc.setPage(p);
            this.drawPageFooter(doc, pageWidth, pageHeight, margin, p, totalPages);
        }

        doc.save(`${this._scopeSlug(scope)}.pdf`);
    },

    // Shared with ChecklistExport's builder: a column that silently overruns its
    // neighbour is the failure mode a fork of this layout loses first.
    truncateToWidth(doc, text, maxWidth) {
        if (!text) return '';
        const str = String(text);
        let t = str;
        while (doc.getTextWidth(t) > maxWidth - 2 && t.length > 0) {
            t = t.slice(0, -1);
        }
        return t.length < str.length ? t + '..' : t;
    },

    drawPageFooter(doc, pageWidth, pageHeight, margin, page, totalPages) {
        doc.setFontSize(7);
        doc.setTextColor(150, 150, 150);
        const footerY = pageHeight - margin + 2;
        doc.text('cards.iammike.org', margin, footerY);
        if (totalPages) {
            doc.text('Page ' + page + ' of ' + totalPages, pageWidth - margin, footerY, { align: 'right' });
        }
        doc.setTextColor(0, 0, 0);
    }
};

window.ShoppingList = ShoppingList;
