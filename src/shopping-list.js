/**
 * ShoppingList - Generate a PDF of all unowned cards across every checklist
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
        if (card.id) return card.id;
        const includePlayer = config?.cardDisplay?.includePlayerInCardId;
        const str = (includePlayer ? (card.player || '') : '')
            + (card.set || '') + (card.num || '') + (card.variant || '');
        const safe = str.replace(/[^\x00-\xFF]/g, '_');
        return btoa(safe).replace(/[^a-zA-Z0-9]/g, '');
    },

    flattenCards(cardData, config, includeExtra) {
        if (config.dataShape === 'flat') {
            // Exclude collection link cards (not real cards)
            return (cardData.cards || []).filter(c => !c.collectionLink);
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
                cards.forEach(c => { if (!c.collectionLink) all.push(c); });
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
                        '<div class="card-editor-title">SHOPPING LIST</div>' +
                        '<div class="card-editor-subtitle">Select options for PDF export</div>' +
                    '</div>' +
                    '<button class="card-editor-close" title="Close">&times;</button>' +
                '</div>' +
                '<div class="card-editor-body">' +
                    '<div class="shopping-list-section-label">Checklists</div>' +
                    '<button class="shopping-list-toggle-all" id="sl-toggle-all">Select None</button>' +
                    '<div class="shopping-list-checklist-list" id="sl-checklist-list"></div>' +
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
                    '<button class="card-editor-btn save" id="sl-generate">Generate PDF</button>' +
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
            if (e.key === 'Enter') {
                backdrop.querySelector('#sl-generate').click();
            }
        });

        backdrop.querySelector('#sl-toggle-all').onclick = () => {
            const checkboxes = backdrop.querySelectorAll('#sl-checklist-list input[type="checkbox"]');
            const allChecked = Array.from(checkboxes).every(cb => cb.checked);
            checkboxes.forEach(cb => { cb.checked = !allChecked; });
            backdrop.querySelector('#sl-toggle-all').textContent = allChecked ? 'Select All' : 'Select None';
        };

        backdrop.querySelector('#sl-generate').onclick = () => this._onGenerate();

        document.body.appendChild(backdrop);
        this.backdrop = backdrop;
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

        // Reset toggle text
        this.backdrop.querySelector('#sl-toggle-all').textContent = 'Select None';

        // Reset options to defaults
        this.backdrop.querySelector('#sl-include-extra').checked = false;
        this.backdrop.querySelector('#sl-group-by').checked = false;

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

            if (selectedChecklists.size === 0) {
                alert('Select at least one checklist.');
                return;
            }

            await this.generate({ selectedChecklists, includeExtra, groupByChecklist });
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

        await this.loadJsPDF();

        // Load registry (use DynamicNav which has session caching)
        const registryData = await DynamicNav.loadRegistry();
        const checklists = registryData?.checklists || [];
        if (!checklists.length) {
            alert('No checklists found.');
            return;
        }

        // Force fresh load (page-load cache may be stale)
        githubSync._cachedData = null;
        const data = await githubSync.loadData() || await githubSync.loadPublicData();
        const ownedByChecklist = data?.checklists || {};

        // Collect all unowned cards
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
                // Skip cards with no set name (incomplete data)
                if (!card.set) continue;
                const cardId = this.generateCardId(card, config);
                if (!owned.includes(cardId)) {
                    shoppingItems.push({
                        year: CardRenderer.getYear(card),
                        setName: CardRenderer.getSetName(card),
                        set: card.set || '',
                        num: card.num || '',
                        name: card.name || card.player
                            || (entry.navLabel || entry.title || '').toLowerCase().replace(/\b\w/g, c => c.toUpperCase()),
                        variant: card.variant || '',
                        price: card.price || 0,
                        checklist: entry.title || id
                    });
                }
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

        this.buildPDF(shoppingItems, { groupByChecklist });
    },

    buildPDF(items, options) {
        const groupByChecklist = options?.groupByChecklist || false;
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ unit: 'mm', format: 'letter' });
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const margin = 12;
        const usableWidth = pageWidth - margin * 2;

        // Column layout: Set | # | Name | Variant | Price
        const cols = [
            { label: 'Set', width: 76 },
            { label: '#', width: 16 },
            { label: 'Name', width: 56 },
            { label: 'Variant', width: 28 },
            { label: 'Price', width: 18 }
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
        doc.text('Shopping List', margin, y + 5);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        doc.text(dateStr, pageWidth - margin, y + 5, { align: 'right' });
        y += 12;

        // Summary line
        const totalPrice = items.reduce((sum, item) => sum + item.price, 0);
        const priceCount = items.filter(i => i.price > 0).length;
        let summary = items.length + ' cards needed';
        if (priceCount > 0) {
            summary += '  |  Est. cost: $' + totalPrice.toFixed(2) + ' (' + priceCount + ' priced)';
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

            const truncate = (text, maxWidth) => {
                if (!text) return '';
                let t = text;
                while (doc.getTextWidth(t) > maxWidth - 2 && t.length > 0) {
                    t = t.slice(0, -1);
                }
                return t.length < text.length ? t + '..' : t;
            };

            doc.text(truncate(item.set, cols[0].width), x, y + 3);
            x += cols[0].width;

            doc.text(String(item.num), x, y + 3);
            x += cols[1].width;

            doc.text(truncate(item.name, cols[2].width), x, y + 3);
            x += cols[2].width;

            doc.text(truncate(item.variant, cols[3].width), x, y + 3);
            x += cols[3].width;

            if (item.price > 0) {
                doc.text('$' + item.price.toFixed(0), x, y + 3);
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

        doc.save('shopping-list.pdf');
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
