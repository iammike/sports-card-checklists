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
    // Includes the variant unless it is the "Base" variant, plus "Auto" for
    // autographed cards - but only when set/variant don't already say so
    // (e.g. "Rookie Signatures", "Autographics"). eBay's search ANDs every
    // keyword, so appending "Auto" on top of wording that doesn't literally
    // contain that word would require a token the real listing may lack.
    buildDefaultSearch(card, prefix = '') {
        const variant = (card.variant && card.variant !== 'Base') ? card.variant : '';
        const base = `${prefix} ${card.set || ''} ${card.num || ''} ${variant}`;
        const alreadySaysAuto = /\b(auto|autos|autographs?|autographics|signatures?|signed)\b/i.test(base);
        const auto = (card.auto && !alreadySaysAuto) ? 'Auto' : '';
        return `${base} ${auto}`.replace(/\s+/g, ' ').trim();
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

    // Get set name without the leading year. Season sets are written
    // "2012-13 Panini Prizm" or "1980-1981 Topps", so the second half has to go
    // too or the name collates under "-". The anchor is load-bearing: a set like
    // "2024 Leaf Pro Set 1989" carries a trailing year that is part of its name.
    getSetName(card) {
        return (card.set || '').replace(/^\d{4}(?:-\d{2,4})?\s*/, '').toLowerCase();
    },

    // The one place the whole-dollar rule lives (#761). Prices are stored as
    // whole dollars; cents are deliberately not supported.
    //
    // A positive value under a dollar can only be gist data edited by hand, and
    // it normalizes UP to the smallest supported price rather than down to zero.
    // Rounding it to zero is what the editor used to do, and zero does not mean
    // "cheap" anywhere in this app - getPrice, renderPriceBadge and the shopping
    // list all read it as "no price at all", so a 40c card silently became an
    // unpriced one on the next unrelated edit.
    //
    // Every path that reads or shows a price runs through this - the editor on
    // blur and on save, formatPrice, and the engine's getPrice - so the badge,
    // the filter, the sort, the totals and the exports cannot disagree about
    // what a card is worth.
    normalizePrice(price) {
        const p = Number(price) || 0;
        if (p <= 0) return 0;
        return Math.max(1, Math.round(p));
    },

    // Whole dollars, no decimal point. Aggregate totals are sums of already
    // normalized per-card prices (computeStats), so they agree by construction.
    formatPrice(price) {
        return String(this.normalizePrice(price));
    },

    // What a human typed in a price box turned into a stored price. The field is
    // type="text" with a literal "$" as its label, so a leading $ or a thousands
    // comma is entirely ordinary input - and parseFloat alone reads "$0.40" as
    // NaN (price silently deleted) and "1,200" as 1 (a 1000x loss). The editor's
    // blur handler and its save path must both come through here, or Enter-to-
    // save - which never fires blur - disagrees with what the box was showing.
    parsePriceInput(raw) {
        const cleaned = String(raw ?? '').trim().replace(/[^0-9.]/g, '');
        if (cleaned === '' || cleaned === '.') return 0;
        return this.normalizePrice(parseFloat(cleaned));
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
        const displayPrice = this.formatPrice(price);
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
    //
    // imgSrc passes through two helpers and neither one replaces the other:
    //
    //   sanitizeAttr is what actually contains a hostile value. It escapes the
    //   quotes, so nothing can close the src attribute and add a sibling one.
    //   Do not drop it on the belief that the scheme check covers this - a payload
    //   like `x"'><img src=x onerror=alert(1)>` resolves against document.baseURI
    //   to a valid relative http: URL and sails straight through sanitizeLinkUrl.
    //
    //   sanitizeLinkUrl only rejects the scheme, i.e. 'javascript:' and 'data:'.
    //   Neither executes in an <img src> in any current browser, so this buys
    //   consistency with every other URL sink (#692, #701, #706) rather than
    //   closing a live hole.
    //
    // A rejected scheme falls through to the same "No image" placeholder an empty
    // card.img gets. Emitting src="" instead would render a broken-image icon, and
    // emitting nothing would drop the anchor to the search along with the image.
    renderCardImage(imgSrc, alt, searchUrl) {
        const href = sanitizeAttr(searchUrl);
        const safeSrc = sanitizeLinkUrl(imgSrc);
        if (safeSrc) {
            return `<a href="${href}" target="_blank" rel="noopener noreferrer"><img class="card-image" src="${sanitizeAttr(safeSrc)}" alt="${sanitizeAttr(alt)}" loading="lazy"></a>`;
        }
        return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="card-image placeholder">No image</a>`;
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
            return `<span class="search-links"><a href="${ebay}" target="_blank" rel="noopener noreferrer" class="search-link">eBay</a> · <a href="${sanitizeAttr(scpUrl)}" target="_blank" rel="noopener noreferrer" class="search-link">Prices</a></span>`;
        }
        return `<a href="${ebay}" target="_blank" rel="noopener noreferrer" class="search-link">eBay</a>`;
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
