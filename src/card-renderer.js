/**
 * Filter utilities
 */
const FilterUtils = {
    // Apply status and search filters to cards
    applyFilters(options = {}) {
        const statusFilter = document.getElementById('status-filter')?.value || 'all';
        const searchEl = document.getElementById('search');
        const searchTerm = searchEl ? searchEl.value.toLowerCase() : '';

        document.querySelectorAll('.card').forEach(card => {
            const owned = card.classList.contains('owned');
            const cardText = card.textContent.toLowerCase();
            let show = true;

            // Status filter
            if (statusFilter === 'owned' && !owned) show = false;
            if (statusFilter === 'need' && owned) show = false;

            // Search filter
            if (searchTerm && !cardText.includes(searchTerm)) show = false;

            // Custom filter function
            if (options.customFilter && !options.customFilter(card)) show = false;

            card.style.display = show ? '' : 'none';
        });

        // Hide sections with no visible cards
        if (options.sections) {
            options.sections.forEach(sectionId => {
                const section = document.getElementById(sectionId);
                if (section) {
                    const cards = section.querySelectorAll('.card');
                    const hasVisible = Array.from(cards).some(c => c.style.display !== 'none');
                    section.style.display = hasVisible ? '' : 'none';
                }
            });
        }

        // Call update callback if provided
        if (options.onFilter) options.onFilter();
    }
};

/**
 * Card rendering utilities
 */
const CardRenderer = {
    // Default price thresholds for badge styling
    defaultThresholds: { mid: 3, high: 10 },

    // Parse serial string (e.g., "/99", "99", "1/1") to numeric print run
    parseSerial(serial) {
        if (!serial) return null;
        const slashMatch = serial.match(/\/(\d+)/);
        if (slashMatch) return parseInt(slashMatch[1], 10);
        const bareMatch = serial.match(/^(\d+)$/);
        return bareMatch ? parseInt(bareMatch[1], 10) : null;
    },

    // Build the default (unencoded) search string from card fields.
    // prefix is the resolved player name or configured fallback (may be empty).
    // Includes the variant unless it is the "Base" variant.
    buildDefaultSearch(card, prefix = '') {
        const variant = (card.variant && card.variant !== 'Base') ? card.variant : '';
        return `${prefix} ${card.set || ''} ${card.num || ''} ${variant}`.replace(/\s+/g, ' ').trim();
    },

    // Generate eBay search URL
    getEbayUrl(searchTerm) {
        return `https://www.ebay.com/sch/i.html?_nkw=${searchTerm.replace(/"/g, '%22')}&_sop=15&LH_BIN=1`;
    },

    // Generate SportsCardsPro search URL
    getScpUrl(searchTerm) {
        return `https://www.sportscardspro.com/search-products?q=${searchTerm.replace(/\+/g, '+')}&type=prices`;
    },

    // Get year from set name
    getYear(card) {
        const match = card.set?.match(/^(\d{4})/);
        return match ? parseInt(match[1]) : 0;
    },

    // Get set name without year
    getSetName(card) {
        return (card.set || '').replace(/^\d{4}\s*/, '').toLowerCase();
    },

    // Get price badge CSS class based on thresholds
    getPriceClass(price, thresholds = this.defaultThresholds) {
        if (price < thresholds.mid) return '';
        if (price < thresholds.high) return 'mid';
        return 'high';
    },

    // Render price badge HTML
    renderPriceBadge(price, thresholds = this.defaultThresholds) {
        if (!price || price <= 0) return '';
        const priceClass = this.getPriceClass(price, thresholds);
        const displayPrice = Math.round(price);
        return `<span class="price-badge ${priceClass}">$${displayPrice}</span>`;
    },

    // Render auto badge HTML (for autographed cards)
    renderAutoBadge(card) {
        if (!card.auto) return '';
        return `<span class="auto-badge">AUTO</span>`;
    },

    // Render patch badge HTML (for relic/patch cards)
    renderPatchBadge(card) {
        if (!card.patch) return '';
        return `<span class="patch-badge">PATCH</span>`;
    },

    // Render serial badge HTML (for numbered cards, e.g. "/99")
    renderSerialBadge(card) {
        if (!card.serial) return '';
        const display = card.serial.startsWith('/') ? card.serial : '/' + card.serial;
        return `<span class="serial-badge">${sanitizeText(display)}</span>`;
    },

    // Render the "no card exists" placeholder that replaces the card image
    renderNoCardBadge(label) {
        // Coerce: a hand-edited gist can put a number here, which has no .trim()
        const text = String(label ?? '').trim() || 'NO CARD';
        return `<div class="card-image placeholder no-card-badge">${sanitizeText(text)}</div>`;
    },

    // Render all attribute badges for a card (only those enabled in customFields)
    renderAttributeBadges(card, customFields) {
        let html = '';
        if (!customFields || customFields.auto) html += this.renderAutoBadge(card);
        if (!customFields || customFields.patch) html += this.renderPatchBadge(card);
        if (!customFields || customFields.serial) html += this.renderSerialBadge(card);
        return html;
    },

    // Render card image with fallback.
    //
    // The fallback used to be an inline onerror that built an anchor as a JS string
    // inside an HTML attribute, hand-escaping the quotes around the search URL - one
    // unescaped quote in that URL broke out of the string. There is no inline handler
    // now: a broken image is swapped for the placeholder by a delegated capture-phase
    // listener (ChecklistEngine._initImageFallback). The image is already wrapped in
    // an anchor to the search, so the placeholder does not need to carry the URL.
    renderCardImage(imgSrc, alt, searchUrl) {
        const href = sanitizeAttr(searchUrl);
        if (imgSrc) {
            return `<a href="${href}" target="_blank"><img class="card-image" src="${sanitizeAttr(imgSrc)}" alt="${sanitizeAttr(alt)}" loading="lazy"></a>`;
        }
        return `<a href="${href}" target="_blank" class="card-image placeholder">No image</a>`;
    },

    // Swap a card image that failed to load for the "No image" placeholder. Only
    // the <img> is replaced; its wrapping anchor still links to the search, which
    // is what the old inline onerror rebuilt by hand.
    replaceBrokenImage(img) {
        if (!img || !img.parentNode) return;
        const placeholder = document.createElement('span');
        placeholder.className = 'card-image placeholder';
        placeholder.textContent = 'No image';
        img.replaceWith(placeholder);
    },

    // Render owned checkbox or badge based on read-only state.
    // The checkbox carries its card id in data-card-id; a single delegated change
    // listener on #sections-container reads it (ChecklistEngine._initOwnedToggle).
    // No inline handler, so a quote in the id has no JS string to break out of.
    renderOwnedControl(cardId, owned, isReadOnly) {
        if (!isReadOnly) {
            const id = sanitizeAttr(cardId);
            return `<div class="checkbox-wrapper">
                <input type="checkbox" id="${id}" ${owned ? 'checked' : ''} data-card-id="${id}">
                <label for="${id}">Owned</label>
            </div>`;
        }
        return owned ? '<span class="owned-badge">✓ Owned</span>' : '';
    },

    // Render search links (eBay only, or eBay + SCP)
    renderSearchLinks(searchUrl, scpUrl = null) {
        // Both are built from card fields: getEbayUrl percent-encodes only double
        // quotes and getScpUrl escapes nothing, so neither arrives attribute-safe.
        const ebay = sanitizeAttr(searchUrl);
        if (scpUrl) {
            return `<span class="search-links"><a href="${ebay}" target="_blank" class="search-link">eBay</a> · <a href="${sanitizeAttr(scpUrl)}" target="_blank" class="search-link">Prices</a></span>`;
        }
        return `<a href="${ebay}" target="_blank" class="search-link">eBay</a>`;
    },

    // Render achievement badges
    renderAchievements(badges) {
        if (!badges || badges.length === 0) return '';
        const text = Array.isArray(badges) ? badges.join(', ') : badges;
        return `<span class="achievement">${text}</span>`;
    }
};

/**
 * Stats animation utilities
 */
const StatsAnimator = {
    hasAnimated: false,

    // Animate a number counting up
    animateValue(element, start, end, duration, prefix = '', suffix = '') {
        const startTime = performance.now();
        const update = (currentTime) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            // Ease out cubic for satisfying deceleration
            const easeOut = 1 - Math.pow(1 - progress, 3);
            const current = Math.round(start + (end - start) * easeOut);
            element.textContent = prefix + current + suffix;
            if (progress < 1) {
                requestAnimationFrame(update);
            }
        };
        requestAnimationFrame(update);
    },

    // Animate all stats on first load
    animateStats(stats) {
        if (this.hasAnimated) {
            // Just update without animation
            if (stats.owned) stats.owned.el.textContent = stats.owned.value;
            if (stats.total) stats.total.el.textContent = stats.total.value;
            if (stats.totalValue) stats.totalValue.el.textContent = '$' + stats.totalValue.value;
            if (stats.ownedValue) stats.ownedValue.el.textContent = '$' + stats.ownedValue.value + ' owned';
            if (stats.neededValue) stats.neededValue.el.textContent = stats.neededValue.text || ('$' + stats.neededValue.value + ' to complete');
            return;
        }

        this.hasAnimated = true;

        // Staggered animations
        if (stats.owned) {
            setTimeout(() => this.animateValue(stats.owned.el, 0, stats.owned.value, 1200), 100);
        }
        if (stats.total) {
            setTimeout(() => this.animateValue(stats.total.el, 0, stats.total.value, 1200), 250);
        }
        if (stats.totalValue) {
            setTimeout(() => this.animateValue(stats.totalValue.el, 0, stats.totalValue.value, 1400, '$'), 400);
        }
        if (stats.neededValue) {
            setTimeout(() => {
                if (stats.ownedValue) this.animateValue(stats.ownedValue.el, 0, stats.ownedValue.value, 1000, '$', ' owned');
                if (stats.neededValue.text) {
                    stats.neededValue.el.textContent = stats.neededValue.text;
                } else {
                    this.animateValue(stats.neededValue.el, 0, stats.neededValue.value, 1000, '$', ' to complete');
                }
            }, 550);
        }
    },

    // Reset animation state (useful for testing)
    reset() {
        this.hasAnimated = false;
    }
};


window.FilterUtils = FilterUtils;
window.CardRenderer = CardRenderer;
window.StatsAnimator = StatsAnimator;
