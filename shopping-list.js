/**
 * ShoppingList - Generate a PDF of all unowned cards across every checklist
 */
const ShoppingList = {
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

    flattenCards(cardData, config) {
        if (config.dataShape === 'flat') {
            // Exclude collection link cards (not real cards)
            return (cardData.cards || []).filter(c => !c.collectionLink);
        }
        // Category-based: only include main categories
        const categories = config.categories || [];
        const mainCatIds = new Set();
        categories.filter(c => c.isMain !== false).forEach(cat => {
            if (cat.children && cat.children.length > 0) {
                cat.children.forEach(child => mainCatIds.add(child.id));
            } else {
                mainCatIds.add(cat.id);
            }
        });
        const all = [];
        for (const [catId, cards] of Object.entries(cardData.categories || {})) {
            if (mainCatIds.size === 0 || mainCatIds.has(catId)) {
                cards.forEach(c => { if (!c.collectionLink) all.push(c); });
            }
        }
        return all;
    },

    async generate() {
        const btn = document.getElementById('shopping-list-btn');
        if (!btn || !window.githubSync) return;

        const originalHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zM17.99 9l-1.41-1.42-6.59 6.59-2.58-2.57-1.42 1.41 4 3.99z"/></svg> Generating...';

        try {
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
                const config = await githubSync.loadChecklistConfig(id)
                    || await githubSync.loadPublicChecklistConfig(id);
                if (!config) continue;

                const cardData = await githubSync.loadCardData(id)
                    || await githubSync.loadPublicCardData(id);
                if (!cardData) continue;

                const allCards = this.flattenCards(cardData, config);
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
                const hasYearA = a.year > 0 ? 0 : 1;
                const hasYearB = b.year > 0 ? 0 : 1;
                if (hasYearA !== hasYearB) return hasYearA - hasYearB;
                if (a.year !== b.year) return a.year - b.year;
                if (a.setName !== b.setName) return a.setName.localeCompare(b.setName);
                const numA = parseInt(a.num) || 0;
                const numB = parseInt(b.num) || 0;
                return numA - numB;
            });

            this.buildPDF(shoppingItems);
        } catch (e) {
            console.error('Shopping list generation failed:', e);
            alert('Failed to generate shopping list: ' + e.message);
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    },

    buildPDF(items) {
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

        drawHeader();

        // Data rows
        doc.setFontSize(fontSize);
        for (let i = 0; i < items.length; i++) {
            if (y + rowHeight > pageHeight - margin - 10) {
                // Footer on current page
                this.drawPageFooter(doc, pageWidth, pageHeight, margin, doc.internal.getNumberOfPages());
                doc.addPage();
                y = margin;
                drawHeader();
                doc.setFontSize(fontSize);
            }

            // Alternating row shading
            if (i % 2 === 0) {
                doc.setFillColor(245, 245, 245);
                doc.rect(margin, y - 1, usableWidth, rowHeight, 'F');
            }

            const item = items[i];
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
