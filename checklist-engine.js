/**
 * ChecklistEngine - Config-driven checklist renderer
 *
 * Reads ?id= from URL, loads config + card data from gist,
 * and renders a fully functional checklist page.
 */
class ChecklistEngine {
    constructor() {
        this.id = new URLSearchParams(window.location.search).get('id');
        this.config = null;
        this.cardData = null;     // Raw card data from gist
        this.cards = null;        // categories object or flat cards array
        this.checklistManager = null;
        this.cardEditor = null;
        this.cardContextMenu = null;
        this.addCardButton = null;
        this._renderedSortBy = null;  // Sort used for current DOM
        this._renderedCards = [];     // Card data in DOM render order
    }

    // ========================================
    // Initialization
    // ========================================

    async init() {
        if (!this.id) {
            throw new Error('No checklist ID specified. Use ?id=your-checklist');
        }

        // Initialize auth UI early so the dropdown exists even if loading fails
        if (window.githubSync) {
            await githubSync.handleCallback();
            AuthUI.update();
        }

        // Dynamic nav (non-blocking)
        DynamicNav.init();

        // Set up delete button early so it's available even if loading fails
        this._initDeleteButton();

        // Load config
        this.config = await this._loadConfig();
        if (!this.config) {
            throw new Error(`Checklist config not found for "${this.id}"`);
        }

        // Apply theme and page metadata
        this._applyTheme();
        this._setPageMeta();

        // Load card data
        await this._loadCardData();

        // Load stats for any linked checklists (e.g., collection link cards)
        await this._loadLinkedStats();

        // Set up ChecklistManager (re-renders auth UI with add/clear buttons)
        this.checklistManager = new ChecklistManager({
            checklistId: this.id,
            ownerUsername: 'iammike',
            localStorageKey: `${this.id}-owned`,
            onOwnedChange: () => { this.renderCards(); this.updateStats(); },
            getStats: () => this.computeStats(),
        });
        await this.checklistManager.init();

        // Re-add delete and settings buttons (ChecklistManager.init re-renders the dropdown)
        this._initDeleteButton();
        this._initSettingsButton();

        // Set up CardContextMenu
        this.cardContextMenu = new CardContextMenu(this.checklistManager);

        // Set up CardEditorModal
        this._initCardEditor();

        // Wire up context menu
        this.cardContextMenu.onEdit = (cardId, cardElement) => {
            const found = this._findCardWithLocation(cardId);
            if (found) {
                this.cardEditor.open(cardId, found.editData);
            }
        };
        this.cardContextMenu.onDelete = async (cardId) => {
            this._removeCard(cardId);
            this.renderCards();
            this.checklistManager.setSyncStatus('syncing', 'Saving...');
            await this._saveCardData();
        };
        this.cardContextMenu.onAddCard = () => {
            const defaultCat = this._getDefaultCategory();
            this.cardEditor.openNew(defaultCat);
        };

        // Expose global toggleOwned for inline onchange handlers
        window.toggleOwned = (cardId, checkbox) => {
            const nowOwned = checkbox ? checkbox.checked : !this.isOwned(cardId);
            this.checklistManager.toggleOwned(cardId, nowOwned);
            const cardEl = checkbox ? checkbox.closest('.card') : null;
            if (cardEl) cardEl.classList.toggle('owned', nowOwned);
            this.updateStats();
        };

        // Render
        this._renderFilters();
        this.cardContextMenu.init();
        this.cardEditor.init();
        this.renderCards();
    }

    // ========================================
    // Settings
    // ========================================

    // Delete button - available even if checklist fails to load
    _initDeleteButton() {
        if (!window.githubSync || !githubSync.isLoggedIn()) return;
        const user = githubSync.getUser();
        if (!user || user.login !== 'iammike') return;

        const dropdown = document.querySelector('.nav-dropdown');
        if (!dropdown) return;
        const logoutBtn = document.getElementById('auth-logout-btn');
        if (!logoutBtn) return;

        const divider = document.createElement('div');
        divider.className = 'nav-dropdown-divider';
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'nav-dropdown-item danger';
        deleteBtn.id = 'checklist-delete-btn';
        deleteBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg> Delete Checklist';
        deleteBtn.onclick = async () => {
            dropdown.classList.remove('open');
            const title = this.config?.title || this.id;
            if (!confirm(`Delete "${title}"? This will permanently remove the checklist, all its cards, and stats. This cannot be undone.`)) return;
            const success = await githubSync.deleteChecklist(this.id);
            // Always clear nav cache so phantom entries disappear
            DynamicNav._registry = null;
            sessionStorage.removeItem(DynamicNav._sessionKey);
            if (success) {
                window.location.href = 'index.html';
            } else {
                alert('Failed to delete checklist. Please try again.');
            }
        };
        dropdown.insertBefore(divider, logoutBtn);
        dropdown.insertBefore(deleteBtn, logoutBtn);
    }

    _initSettingsButton() {
        if (!this.checklistManager.isOwner()) return;

        const creator = new ChecklistCreatorModal({
            onCreated: async (updatedConfig) => {
                const shapeMigrated = this._migrateDataShape(updatedConfig);
                this.config = updatedConfig;
                this._applyTheme();
                this._setPageMeta();
                this._renderFilters();
                this._initCardEditor();
                this.renderCards();
                this.updateStats();
                DynamicNav._registry = null;
                sessionStorage.removeItem(DynamicNav._sessionKey);
                DynamicNav.init();
                if (shapeMigrated) {
                    this.checklistManager.setSyncStatus('syncing', 'Migrating cards...');
                    await this._saveCardData();
                }
            }
        });

        const dropdown = document.querySelector('.nav-dropdown');
        if (!dropdown) return;
        // Insert before the delete button's divider
        const deleteBtn = document.getElementById('checklist-delete-btn');
        const insertBefore = deleteBtn?.previousElementSibling || document.getElementById('auth-logout-btn');
        if (!insertBefore) return;

        const settingsBtn = document.createElement('button');
        settingsBtn.className = 'nav-dropdown-item';
        settingsBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.49.49 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 00-.48-.41h-3.84a.48.48 0 00-.48.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 00-.59.22L2.74 8.87a.48.48 0 00.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.26.41.48.41h3.84c.24 0 .44-.17.48-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1115.6 12 3.6 3.6 0 0112 15.6z"/></svg> Checklist Settings';
        settingsBtn.onclick = () => {
            dropdown.classList.remove('open');
            creator.openEdit(this.config);
        };
        dropdown.insertBefore(settingsBtn, insertBefore);
    }

    // ========================================
    // Config & Data Loading
    // ========================================

    async _loadConfig() {
        if (typeof githubSync === 'undefined') return null;

        // Try authenticated gist first, fall back to public gist
        const config = await githubSync.loadChecklistConfig(this.id);
        if (config) { config.id = this.id; return config; }

        const publicConfig = await githubSync.loadPublicChecklistConfig(this.id);
        if (publicConfig) publicConfig.id = this.id;
        return publicConfig;
    }

    async _loadCardData() {
        if (window.githubSync?.isLoggedIn()) {
            const data = await githubSync.loadCardData(this.id);
            if (data) {
                this.cardData = data;
                this.cards = this._isFlat() ? (data.cards || []) : (data.categories || {});
                return;
            }
        }

        const publicData = await githubSync.loadPublicCardData(this.id);
        if (publicData) {
            this.cardData = publicData;
            this.cards = this._isFlat() ? (publicData.cards || []) : (publicData.categories || {});
            return;
        }

        throw new Error('Failed to load card data');
    }

    async _loadLinkedStats() {
        // Find collection link cards that reference other checklists
        const allCards = this._isFlat() ? this.cards : this._getAllCardsFlat();
        const linkedIds = allCards
            .filter(c => c.collectionLink)
            .map(c => {
                const match = c.collectionLink.match(/[?&]id=([^&]+)/);
                return match ? match[1] : null;
            })
            .filter(Boolean);

        if (linkedIds.length === 0) {
            this._linkedStats = {};
            return;
        }

        const allStats = window.githubSync?.isLoggedIn()
            ? await githubSync.loadAllStats()
            : await githubSync.loadPublicStats();

        this._linkedStats = {};
        linkedIds.forEach(id => {
            if (allStats[id]) this._linkedStats[id] = allStats[id];
        });
    }

    async _saveCardData() {
        // Merge with latest gist data to prevent overwriting external changes (#560)
        await this._mergeWithFreshGistData();

        if (this._isFlat()) {
            this.cardData.cards = this.cards;
        } else {
            this.cardData.categories = this.cards;
        }

        // Try save with one automatic retry
        let result = await githubSync.saveCardData(this.id, this.cardData);
        if (!result.ok && result.reason !== 'auth_expired') {
            // Brief pause then retry once for transient failures
            await new Promise(r => setTimeout(r, 1500));
            result = await githubSync.saveCardData(this.id, this.cardData);
        }

        if (result.ok) {
            this.checklistManager.setSyncStatus('synced', 'Saved');
            const stats = this.computeStats();
            await githubSync.saveChecklistStats(this.id, stats);
        } else if (result.reason === 'auth_expired') {
            this.checklistManager.setSyncStatus('error', 'Session expired');
            this._showSaveError('Your session has expired.', 'Sign Out', () => {
                githubSync.logout();
                window.location.reload();
            });
        } else {
            this.checklistManager.setSyncStatus('error', 'Save failed');
            this._showSaveError('Save failed. Your changes are still in memory - try refreshing and editing again.');
        }
        return result.ok;
    }

    // Merge local cards with fresh gist data so external field additions aren't lost
    async _mergeWithFreshGistData() {
        try {
            // Clear cache to get truly fresh data
            githubSync._gistCache = null;
            githubSync._publicGistCache = null;

            const freshData = await githubSync.loadCardData(this.id)
                || await githubSync.loadPublicCardData(this.id);
            if (!freshData) return;

            const freshCards = this._isFlat() ? freshData.cards : freshData.categories;
            if (!freshCards) return;

            if (this._isFlat()) {
                this.cards = this._mergeCardArrays(this.cards, freshCards);
            } else {
                for (const catId of Object.keys(this.cards)) {
                    if (freshCards[catId]) {
                        this.cards[catId] = this._mergeCardArrays(this.cards[catId], freshCards[catId]);
                    }
                }
            }
        } catch (e) {
            // Non-fatal: proceed with save using local data if merge fails
            console.warn('Failed to merge with fresh gist data:', e);
        }
    }

    // Merge two card arrays: fresh fields as base, local fields overlay
    _mergeCardArrays(localCards, freshCards) {
        const freshMap = new Map();
        freshCards.forEach(c => freshMap.set(this.getCardId(c), c));

        return localCards.map(localCard => {
            const id = this.getCardId(localCard);
            const freshCard = freshMap.get(id);
            if (!freshCard) return localCard;
            // Fresh as base preserves externally-added fields,
            // local overlay preserves user's in-session edits
            return { ...freshCard, ...localCard };
        });
    }

    _showSaveError(message, actionLabel, actionFn) {
        // Show a dismissible error banner at the top of the page
        const existing = document.querySelector('.save-error-banner');
        if (existing) existing.remove();
        const banner = document.createElement('div');
        banner.className = 'save-error-banner';

        const span = document.createElement('span');
        span.textContent = message;
        banner.appendChild(span);

        if (actionLabel && actionFn) {
            const actionBtn = document.createElement('button');
            actionBtn.className = 'save-error-action';
            actionBtn.textContent = actionLabel;
            actionBtn.addEventListener('click', actionFn);
            banner.appendChild(actionBtn);
        }

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '\u00d7';
        closeBtn.addEventListener('click', () => banner.remove());
        banner.appendChild(closeBtn);

        document.body.prepend(banner);
    }

    // ========================================
    // Theme & Page Setup
    // ========================================

    _applyTheme() {
        const theme = this.config.theme || {};
        const primary = theme.primaryColor || '#667eea';
        const dark = theme.darkColor || '#764ba2';
        const accent = theme.accentColor || primary;
        const isDark = theme.darkTheme || false;

        // Derive text colors with sufficient contrast against the effective card background
        const cardBg = isDark ? '#1a1a1a' : '#ffffff';
        this._cardBg = cardBg;
        const linkColor = this._ensureContrast(primary, cardBg, 4.5);
        const accentText = this._ensureContrast(accent, cardBg, 3);
        const textColor = this._ensureContrast(isDark ? '#cccccc' : '#333333', cardBg, 7);
        const textMuted = this._ensureContrast(isDark ? '#999999' : '#666666', cardBg, 4.5);
        const textLight = this._ensureContrast(isDark ? '#777777' : '#999999', cardBg, 3);
        // Header text: ensure contrast against the primary/dark gradient used for section headers
        const headerText = this._ensureContrast('#ffffff', primary, 3);

        let css = `:root {
            --color-primary: ${primary};
            --color-primary-dark: ${dark};
            --color-accent: ${accent};
            --color-link: ${linkColor};
            --color-accent-text: ${accentText};
            --color-text: ${textColor};
            --color-text-muted: ${textMuted};
            --color-text-light: ${textLight};
            --color-header-text: ${headerText};
        }\n`;

        if (isDark) {
            css += `
            :root {
                --color-background: linear-gradient(135deg, ${dark} 0%, #1a1a1a 100%);
                --color-surface: rgba(255,255,255,0.05);
                --auth-bg: rgba(0,0,0,0.2);
                --stat-bg: rgba(255,255,255,0.1);
                --stat-value-color: ${accent};
                --stat-label-color: ${textMuted};
                --card-border: transparent;
                --card-hover-color: rgba(255,255,255,0.2);
                --card-owned-bg: rgba(255,255,255,0.1);
                --card-owned-border: ${accent};
                --nav-bg: linear-gradient(180deg, ${dark} 0%, #1a1a1a 100%);
            }
            body {
                background: linear-gradient(135deg, ${dark} 0%, #1a1a1a 100%);
                min-height: 100vh;
                color: ${textColor};
            }
            .page-header {
                background: rgba(0,0,0,0.3);
                padding: 20px 20px 24px;
                margin-bottom: 24px;
                position: relative;
            }
            .page-header::after {
                content: '';
                position: absolute;
                bottom: 0; left: 0; right: 0;
                height: 3px;
                background: linear-gradient(90deg, transparent, ${accent}, transparent);
            }
            h1 {
                background: linear-gradient(180deg, #d0d0d0 0%, ${accent} 100%);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                background-clip: text;
            }
            .subtitle { color: ${textLight}; }
            .stat {
                background: rgba(0,0,0,0.3);
                border: 1px solid rgba(255,255,255,0.08);
            }
            .stat-value { color: ${textMuted}; }
            .stat-value.highlight { color: ${accent}; }
            .group-header {
                background: linear-gradient(135deg, ${dark} 0%, #1a1a1a 100%);
                border-bottom-color: ${accent};
            }
            .section-group {
                background: rgba(255,255,255,0.03);
            }
            select, input[type="text"] {
                border: 1px solid rgba(255,255,255,0.2);
                background: rgba(0,0,0,0.3);
                color: ${textColor};
            }
            .filters {
                background: rgba(255,255,255,0.03);
                box-shadow: none;
                border: 1px solid rgba(255,255,255,0.05);
            }
            .card {
                background: rgba(255,255,255,0.05);
                border: 2px solid transparent;
            }
            .card:hover {
                border-color: rgba(255,255,255,0.2);
                box-shadow: 0 10px 30px rgba(0,0,0,0.3);
            }
            .card.owned {
                border-color: ${accent};
                background: rgba(255,255,255,0.1);
            }
            .player-name { color: ${textColor}; }
            .card-image-wrapper {
                border-radius: 8px;
            }
            .card-image.placeholder {
                border-color: rgba(255,255,255,0.15);
                color: rgba(255,255,255,0.4);
            }
            .card-image.placeholder:hover {
                background: rgba(255,255,255,0.05);
            }
            `;
        } else {
            // Light theme overrides - keep it clean, let colors come through in accents
            css += `
            .page-header::after {
                content: '';
                position: absolute;
                bottom: 0; left: 0; right: 0;
                height: 3px;
                background: linear-gradient(90deg, transparent, ${accent}, transparent);
            }
            h1 {
                background: linear-gradient(180deg, #e0e0e0 0%, ${accent} 100%);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                background-clip: text;
            }
            .stat-value.highlight { color: ${accent}; }
            .card.owned {
                border-color: ${accent};
            }
            .player-name { color: ${linkColor}; font-size: 14px; font-weight: bold; margin-bottom: 4px; }
            .group-header {
                border-bottom-color: ${accent};
            }
            `;
        }

        // Position abbreviation (both themes)
        css += `
            .player-position { font-size: 10px; font-weight: 400; opacity: 0.3; margin-left: -3px; letter-spacing: 0.5px; }
            .player-position::before { content: '\\00B7'; margin: 0 1px; opacity: 0.5; }
        `;

        // Category-specific header colors (including subcategories)
        if (this.config.categories) {
            const headerTextColor = (gradient) => {
                const colors = gradient.match(/#[0-9a-fA-F]{6}/g) || [];
                if (colors.length === 0) return '';
                // Use the first gradient color (where text sits) for contrast check
                const hex = colors[0];
                const r = parseInt(hex.slice(1, 3), 16) / 255;
                const g = parseInt(hex.slice(3, 5), 16) / 255;
                const b = parseInt(hex.slice(5, 7), 16) / 255;
                const toLinear = (c) => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
                const lum = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
                return lum > 0.4 ? ' color: #1a1a1a;' : ' color: #ffffff;';
            };
            this.config.categories.forEach(cat => {
                if (cat.gradient) {
                    const selector = cat.children ? `.group-header.cat-${cat.id}` : `.section-header.cat-${cat.id}`;
                    css += `${selector} { background: ${cat.gradient};${headerTextColor(cat.gradient)} }\n`;
                }
                if (cat.children) {
                    cat.children.forEach(child => {
                        if (child.gradient) {
                            css += `.section-header.cat-${child.id} { background: ${child.gradient};${headerTextColor(child.gradient)} }\n`;
                        }
                    });
                }
            });
        }

        // Page-specific custom CSS
        if (this.config.customCss) {
            css += this.config.customCss;
        }

        document.getElementById('dynamic-theme').textContent = css;
    }

    // Adjusts a color (darken or lighten) until it meets the target contrast ratio against bg
    _ensureContrast(fgHex, bgHex, targetRatio) {
        const parse = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
        const toHex = (r, g, b) => `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
        const luminance = ([r, g, b]) => {
            const toLinear = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
            return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
        };
        const contrast = (l1, l2) => (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        const bgL = luminance(parse(bgHex));
        let [r, g, b] = parse(fgHex);
        // Lighten for dark backgrounds, darken for light backgrounds
        const lighten = bgL < 0.5;
        const factor = lighten ? 1.18 : 0.85;
        for (let i = 0; i < 25; i++) {
            if (contrast(luminance([r, g, b]), bgL) >= targetRatio) return toHex(r, g, b);
            if (lighten) {
                r = Math.min(255, Math.round(r * factor + (255 - r) * 0.1));
                g = Math.min(255, Math.round(g * factor + (255 - g) * 0.1));
                b = Math.min(255, Math.round(b * factor + (255 - b) * 0.1));
            } else {
                r = Math.round(r * factor);
                g = Math.round(g * factor);
                b = Math.round(b * factor);
            }
        }
        return toHex(r, g, b);
    }

    _setPageMeta() {
        document.title = this.config.title || 'Checklist';
        document.getElementById('page-title').textContent = this.config.title || '';
        const subtitle = document.getElementById('page-subtitle');
        if (this.config.subtitle) {
            subtitle.textContent = this.config.subtitle;
        } else {
            subtitle.style.display = 'none';
        }

        // Intro text
        const introEl = document.getElementById('page-intro');
        if (this.config.introHtml) {
            introEl.innerHTML = `<div class="intro-text">${this.config.introHtml}</div>`;
        }

        // Total label
        const totalLabel = document.getElementById('total-label');
        if (this.config.totalLabel) {
            totalLabel.textContent = this.config.totalLabel;
        }
    }

    // ========================================
    // Data Shape Helpers
    // ========================================

    _isFlat() {
        return this.config.dataShape === 'flat';
    }

    _getDefaultCategory() {
        if (this._isFlat()) return null;
        const cats = this.config.categories || [];
        const main = cats.find(c => c.isMain !== false) || cats[0];
        if (!main) return null;
        // If the category has children, default to first child
        if (main.children && main.children.length > 0) return main.children[0].id;
        return main.id;
    }

    // Migrate card data when dataShape changes. Must be called BEFORE updating this.config.
    _migrateDataShape(newConfig) {
        const oldShape = this.config.dataShape || 'categories';
        const newShape = newConfig.dataShape || 'categories';
        if (oldShape === newShape) return false;

        if (newShape === 'flat') {
            // Categories → Flat: flatten all category arrays into a single array
            const allCards = [];
            const categories = this.config.categories || [];
            categories.forEach(cat => {
                if (cat.children && cat.children.length > 0) {
                    cat.children.forEach(child => {
                        (this.cards[child.id] || []).forEach(c => allCards.push(c));
                    });
                } else {
                    (this.cards[cat.id] || []).forEach(c => allCards.push(c));
                }
            });
            this.cards = allCards;
            this.cardData = { cards: allCards };
        } else {
            // Flat → Categories: put all cards into the first category
            const catMap = {};
            (newConfig.categories || []).forEach(cat => {
                if (cat.children && cat.children.length > 0) {
                    cat.children.forEach(child => { catMap[child.id] = []; });
                } else {
                    catMap[cat.id] = [];
                }
            });
            const cats = newConfig.categories || [];
            const main = cats.find(c => c.isMain !== false) || cats[0];
            const defaultCat = main?.children?.[0]?.id || main?.id;
            if (defaultCat && this.cards.length > 0) {
                catMap[defaultCat] = [...this.cards];
            }
            this.cards = catMap;
            this.cardData = { categories: catMap };
        }
        return true;
    }

    // ========================================
    // Card ID
    // ========================================

    getCardId(card) {
        if (this.config.cardDisplay?.includePlayerInCardId) {
            return btoa((card.player || '') + (card.set || '') + (card.num || '') + (card.variant || '')).replace(/[^a-zA-Z0-9]/g, '');
        }
        return this.checklistManager.getCardId(card);
    }

    isOwned(cardId) {
        return this.checklistManager.isOwned(cardId);
    }

    // ========================================
    // Price
    // ========================================

    getPrice(card) {
        return card.price || 0;
    }

    getPriceThresholds() {
        return this.config.cardDisplay?.priceThresholds || { mid: 3, high: 10 };
    }

    // ========================================
    // Card Rendering
    // ========================================

    createCardElement(card) {
        // Track rendered card for filter-only updates
        const cardIdx = this._renderedCards.length;
        this._renderedCards.push(card);

        const cardId = card.collectionLink ? null : this.getCardId(card);
        const owned = cardId ? this.isOwned(cardId) : false;
        const price = this.getPrice(card);
        const showPlayer = this.config.cardDisplay?.showPlayerName !== false && card.player;
        const playerForSearch = card.player ? card.player + ' ' : '';
        const defaultSearch = encodeURIComponent(`${playerForSearch}${card.set || ''} ${card.num || ''}`.trim());
        const searchUrl = CardRenderer.getEbayUrl(card.search || defaultSearch);
        const priceSearchTerm = card.priceSearch || defaultSearch;
        const scpUrl = CardRenderer.getScpUrl(priceSearchTerm);
        const thresholds = this.getPriceThresholds();

        // Clean up type display
        const displayType = (card.type || '').replace(/\s*RC\b/gi, '').replace(/\bBase\b/gi, '').trim();
        const displayVariant = card.variant || '';

        // Collection link cards (special type)
        if (card.collectionLink) {
            return this._renderCollectionLinkCard(card, cardIdx);
        }

        const cardClass = `card ${owned ? 'owned' : ''}`.trim();

        let html = `<div class="${cardClass}" data-card-idx="${cardIdx}" data-price="${price}"${card.sport ? ` data-sport="${card.sport}"` : ''}${card.era ? ` data-era="${card.era}"` : ''} data-type="${card.type || ''}">`;
        html += `<div class="card-image-wrapper">`;
        html += CardRenderer.renderAttributeBadges(card, this.config.customFields);
        html += CardRenderer.renderPriceBadge(price, thresholds);
        html += CardRenderer.renderCardImage(card.img, card.set, searchUrl);
        html += `</div>`;

        // Player name (JMU, Washington QBs) with optional position
        if (showPlayer) {
            const posHtml = card.position ? ` <span class="player-position">${sanitizeText(card.position)}</span>` : '';
            html += `<div class="player-name">${sanitizeText(card.player)}${posHtml}</div>`;
        }

        // Custom subtitle lines (config-driven)
        const customFields = this.config.customFields || {};
        const subtitleFields = Object.entries(customFields)
            .filter(([_, c]) => c.position === 'bottom' && card[_]);
        if (subtitleFields.length > 0) {
            subtitleFields.forEach(([key, config]) => {
                const color = this._ensureContrast(config.color || '#888888', this._cardBg || '#ffffff', 4.5);
                const r = parseInt(color.slice(1, 3), 16), g = parseInt(color.slice(3, 5), 16), b = parseInt(color.slice(5, 7), 16);
                const pillStyle = config.pill ? `;background:rgba(${r},${g},${b},0.12)` : '';
                const pillClass = config.pill ? ' pill' : '';
                html += `<div class="card-subtitle-line${pillClass}" style="color:${color}${pillStyle}">${sanitizeText(card[key])}</div>`;
            });
        }

        // Card info (set, number, variant)
        if (card.set) {
            let titleHtml = sanitizeText(card.set);
            if (card.num) {
                const num = card.num.startsWith('#') ? card.num : '#' + card.num;
                titleHtml += ` <span class="card-number">${sanitizeText(num)}</span>`;
            }
            html += `<div class="card-title">${titleHtml}</div>`;
        }
        if (displayVariant) html += `<div class="card-variant">${sanitizeText(displayVariant)}</div>`;
        if (displayType) {
            html += `<div class="card-type">${sanitizeText(displayType)}</div>`;
        }

        // Card actions
        const isReadOnly = this.checklistManager.isReadOnly;
        html += `<div class="card-actions${isReadOnly && !owned ? ' links-only' : ''}">`;
        html += CardRenderer.renderOwnedControl(cardId, owned, isReadOnly);
        html += CardRenderer.renderSearchLinks(searchUrl, scpUrl);
        html += `</div>`;

        html += `</div>`;
        return html;
    }

    _renderCollectionLinkCard(card, cardIdx) {
        const link = sanitizeText(card.collectionLink);

        // Badge: show linked checklist stats if available, else cardCount
        let badgeHtml = '';
        const linkedMatch = card.collectionLink.match(/[?&]id=([^&]+)/);
        const linkedId = linkedMatch ? linkedMatch[1] : null;
        const linkedStats = linkedId ? (this._linkedStats || {})[linkedId] : null;
        if (linkedStats && typeof linkedStats.owned === 'number') {
            badgeHtml = `<span class="collection-badge">${linkedStats.owned} / ${linkedStats.total} CARDS</span>`;
        } else if (card.cardCount) {
            badgeHtml = `<span class="collection-badge">${card.cardCount} CARDS</span>`;
        }

        // Image: card stack (multiple images) or single image
        let imageHtml;
        if (card.stackImages && card.stackImages.length > 0) {
            const imgs = card.stackImages.map(src =>
                `<img src="${sanitizeText(src)}" alt="" loading="lazy">`
            ).join('');
            imageHtml = `<div class="card-stack">${imgs}</div>`;
        } else {
            imageHtml = CardRenderer.renderCardImage(card.img, card.player, link);
        }

        return `<div class="card collection-link" data-card-idx="${cardIdx}" onclick="window.location.href='${link}'">
            <div class="card-image-wrapper">
                ${badgeHtml}
                ${imageHtml}
            </div>
            <div class="player-name">${sanitizeText(card.player)}</div>
            <a href="${link}" class="collection-cta">View Full Collection</a>
        </div>`;
    }

    // ========================================
    // Filters
    // ========================================

    _renderFilters() {
        const container = document.getElementById('filters-container');
        let sorts = this.config.sortOptions || ['default', 'year', 'set', 'price-low', 'price-high', 'owned', 'needed'];
        const defaultSort = this.config.defaultSortMode;
        // Remove the defaultSortMode from the list since "Default" already applies it
        if (defaultSort) {
            sorts = sorts.filter(s => s !== defaultSort);
        }
        const customFilters = this.config.customFilters || [];

        let html = '';

        // Sort dropdown
        if (sorts.length > 1) {
            html += `<select id="sort-filter">`;
            sorts.forEach(s => {
                const label = this._getSortLabel(s);
                html += `<option value="${s}">${label}</option>`;
            });
            html += `</select>`;
        }

        // Custom filter dropdowns (sport, era, etc.)
        customFilters.forEach(f => {
            html += `<select id="${f.id}-filter">`;
            html += `<option value="all">${sanitizeText(f.allLabel || 'All')}</option>`;
            f.options.forEach(opt => {
                html += `<option value="${opt.value}">${sanitizeText(opt.label)}</option>`;
            });
            html += `</select>`;
        });

        // Status filter
        html += `<select id="status-filter">
            <option value="all">All Cards</option>
            <option value="owned">Owned Only</option>
            <option value="need">Needed Only</option>
        </select>`;

        // Search
        html += `<input type="text" id="search" placeholder="Search cards...">`;

        container.innerHTML = html;

        // Bind events
        container.querySelectorAll('select').forEach(sel => {
            sel.addEventListener('change', () => this._onFilterChange());
        });
        container.querySelector('#search')?.addEventListener('input', () => this._onFilterChange());
    }

    _getSortLabel(key) {
        if (key === 'default') {
            const ds = this.config.defaultSortMode;
            if (ds) {
                const inner = this._getSortLabel(ds).replace('Sort: ', '');
                return `Sort: ${inner} (Default)`;
            }
            return 'Sort: As Entered';
        }
        const labels = {
            'alphabetical': 'Sort: Alphabetical',
            'year': 'Sort: Year',
            'set': 'Sort: Set/Brand',
            'price-low': 'Sort: Price (Low to High)',
            'price-high': 'Sort: Price (High to Low)',
            'owned': 'Sort: Owned First',
            'needed': 'Sort: Needed First',
            'winpct': 'Sort: Win %',
            'wins': 'Sort: Games Won',
            'games': 'Sort: Games Played',
            'superbowl': 'Sort: Super Bowl Winners',
            'scarcity': 'Sort: Scarcity',
        };
        if (labels[key]) return labels[key];
        // Custom field sort (e.g. 'field:years-active')
        if (key.startsWith('field:')) {
            const fieldKey = key.slice(6);
            const field = (this.config.customFields || {})[fieldKey];
            return field ? `Sort: ${field.label}` : `Sort: ${fieldKey}`;
        }
        return `Sort: ${key}`;
    }

    _onFilterChange() {
        const sortBy = document.getElementById('sort-filter')?.value || 'default';
        if (sortBy === this._renderedSortBy && this._renderedCards.length > 0) {
            // Sort unchanged - just toggle visibility on existing DOM elements
            this._applyFilters();
        } else {
            // Sort changed - full DOM rebuild needed
            this.renderCards();
        }
    }

    // ========================================
    // Sorting
    // ========================================

    _getYear(card) {
        const match = (card.set || '').match(/(\d{4})/);
        return match ? parseInt(match[1]) : 9999;
    }

    _getSetName(card) {
        return (card.set || '').replace(/^\d{4}\s*/, '').toLowerCase();
    }

    sortCards(cardsToSort, sortBy) {
        const sorted = [...cardsToSort];
        switch (sortBy) {
            case 'alphabetical':
                sorted.sort((a, b) => {
                    const aName = a.player || a.set || '';
                    const bName = b.player || b.set || '';
                    const aLast = aName.split(' ').slice(-1)[0];
                    const bLast = bName.split(' ').slice(-1)[0];
                    return aLast.localeCompare(bLast) || aName.localeCompare(bName);
                });
                break;
            case 'year':
                sorted.sort((a, b) => this._getYear(a) - this._getYear(b) || this._getSetName(a).localeCompare(this._getSetName(b)));
                break;
            case 'set':
                sorted.sort((a, b) => this._getSetName(a).localeCompare(this._getSetName(b)));
                break;
            case 'price-low':
                sorted.sort((a, b) => {
                    const ap = this.getPrice(a), bp = this.getPrice(b);
                    if (!ap && !bp) return 0;
                    if (!ap) return 1;
                    if (!bp) return -1;
                    return ap - bp;
                });
                break;
            case 'price-high':
                sorted.sort((a, b) => {
                    const ap = this.getPrice(a), bp = this.getPrice(b);
                    if (!ap && !bp) return 0;
                    if (!ap) return 1;
                    if (!bp) return -1;
                    return bp - ap;
                });
                break;
            case 'scarcity':
                sorted.sort((a, b) => {
                    const aRun = window.CardRenderer.parseSerial(a.serial);
                    const bRun = window.CardRenderer.parseSerial(b.serial);
                    if (aRun && bRun) return aRun - bRun;
                    if (aRun) return -1;
                    if (bRun) return 1;
                    return 0;
                });
                break;
            case 'winpct':
                sorted.sort((a, b) => this._getWinPct(b) - this._getWinPct(a));
                break;
            case 'wins':
                sorted.sort((a, b) => this._getWins(b) - this._getWins(a));
                break;
            case 'games':
                sorted.sort((a, b) => this._getGamesPlayed(b) - this._getGamesPlayed(a));
                break;
            case 'owned':
                sorted.sort((a, b) => {
                    const aOwned = this.isOwned(this.getCardId(a)) ? 1 : 0;
                    const bOwned = this.isOwned(this.getCardId(b)) ? 1 : 0;
                    return bOwned - aOwned;
                });
                break;
            case 'needed':
                sorted.sort((a, b) => {
                    const aOwned = this.isOwned(this.getCardId(a)) ? 1 : 0;
                    const bOwned = this.isOwned(this.getCardId(b)) ? 1 : 0;
                    return aOwned - bOwned;
                });
                break;
            case 'superbowl':
                sorted.sort((a, b) => (b.superBowl ? 1 : 0) - (a.superBowl ? 1 : 0));
                break;
            default:
                // Custom field sort (e.g. 'field:years-active')
                if (sortBy.startsWith('field:')) {
                    const fieldKey = sortBy.slice(6);
                    sorted.sort((a, b) => (a[fieldKey] || '').localeCompare(b[fieldKey] || ''));
                }
                break;
        }
        return sorted;
    }

    _parseRecord(card) {
        if (!card.record || card.record === '-') return null;
        const clean = card.record.split(/\s*·/)[0].trim();
        const parts = clean.split('-');
        if (parts.length < 2) return null;
        return { wins: parseInt(parts[0]) || 0, losses: parseInt(parts[1]) || 0 };
    }

    _getWinPct(card) {
        const r = this._parseRecord(card);
        if (!r) return 0;
        const total = r.wins + r.losses;
        return total > 0 ? r.wins / total : 0;
    }

    _getWins(card) {
        const r = this._parseRecord(card);
        return r ? r.wins : 0;
    }

    _getGamesPlayed(card) {
        const r = this._parseRecord(card);
        return r ? r.wins + r.losses : 0;
    }

    // ========================================
    // Rendering
    // ========================================

    renderCards() {
        const container = document.getElementById('sections-container');
        const sortBy = document.getElementById('sort-filter')?.value || 'default';

        // Reset card tracking for this render
        this._renderedCards = [];

        const totalCards = this._getAllCardsFlat().length;
        if (totalCards === 0) {
            this._renderEmptyState(container);
        } else if (this._isFlat()) {
            this._renderFlatCards(container, sortBy);
        } else {
            this._renderCategoryCards(container, sortBy);
        }

        this._renderedSortBy = sortBy;
        this._applyFilters();
        CollapsibleSections.init({ persist: true, storageKey: `${this.id}-collapsed` });
    }

    // Toggle visibility on existing DOM elements without rebuilding
    _applyFilters() {
        const container = document.getElementById('sections-container');
        const statusFilter = document.getElementById('status-filter')?.value || 'all';
        const searchTerm = (document.getElementById('search')?.value || '').toLowerCase();
        const customFilterValues = {};
        (this.config.customFilters || []).forEach(f => {
            const el = document.getElementById(`${f.id}-filter`);
            if (el) customFilterValues[f.id] = el.value;
        });

        // Toggle visibility on individual cards
        container.querySelectorAll('.card').forEach(cardEl => {
            const idx = parseInt(cardEl.dataset.cardIdx);
            const card = this._renderedCards[idx];
            if (!card) return;
            const visible = this._filterCard(card, statusFilter, searchTerm, customFilterValues);
            cardEl.classList.toggle('filter-hidden', !visible);
        });

        // Update section visibility
        this._updateSectionVisibility(container);
        this.updateStats();
    }

    // Hide sections and group headers when all their cards are filtered out
    _updateSectionVisibility(container) {
        // Hide sections with no visible cards
        container.querySelectorAll('.section').forEach(section => {
            const hasVisible = section.querySelector('.card:not(.filter-hidden)') !== null;
            section.style.display = hasVisible ? '' : 'none';
        });

        // Hide group headers + section groups when all child sections are hidden
        container.querySelectorAll('.section-group').forEach(group => {
            const hasVisibleSection = group.querySelector('.section:not([style*="display: none"])') !== null;
            group.style.display = hasVisibleSection ? '' : 'none';
            // Hide associated group header and note
            let prev = group.previousElementSibling;
            while (prev && (prev.classList.contains('group-header') || prev.classList.contains('inserts-note'))) {
                prev.style.display = hasVisibleSection ? '' : 'none';
                prev = prev.previousElementSibling;
            }
        });
    }

    _filterCard(card, statusFilter, searchTerm, customFilterValues) {
        // Status filter
        if (statusFilter !== 'all') {
            const cardId = card.collectionLink ? null : this.getCardId(card);
            const owned = cardId ? this.isOwned(cardId) : false;
            if (statusFilter === 'owned' && !owned) return false;
            if (statusFilter === 'need' && owned) return false;
            if (statusFilter === 'needed' && owned) return false;
        }

        // Search
        if (searchTerm) {
            const cardText = [card.player, card.set, card.num, card.variant, card.type].filter(Boolean).join(' ').toLowerCase();
            if (!cardText.includes(searchTerm)) return false;
        }

        // Custom filters
        for (const [filterId, filterValue] of Object.entries(customFilterValues)) {
            if (filterValue === 'all') continue;
            const filterDef = (this.config.customFilters || []).find(f => f.id === filterId);
            if (!filterDef) continue;
            const cardField = filterDef.cardField || filterId;
            const cardValue = card[cardField];

            // Multi-value match (e.g., sport filter matching "football" to both "nfl" and "usfl")
            if (filterDef.multiMatch && filterDef.multiMatch[filterValue]) {
                if (!filterDef.multiMatch[filterValue].includes(cardValue)) return false;
            } else {
                if (cardValue !== filterValue) return false;
            }
        }

        return true;
    }

    _renderEmptyState(container) {
        const isOwner = this.checklistManager.isOwner();
        if (isOwner) {
            container.innerHTML = `<div class="card-grid">
                <div class="empty-state-card">
                    <div class="empty-state-icon">+</div>
                    <div class="empty-state-text">Add your first card</div>
                </div>
            </div>`;
            container.querySelector('.empty-state-card').addEventListener('click', () => {
                this.cardEditor.openNew(this._getDefaultCategory());
            });
        } else {
            container.innerHTML = `<div class="card-grid">
                <div class="empty-state-card empty-state-readonly">
                    <div class="empty-state-text">No cards yet</div>
                </div>
            </div>`;
        }
    }

    _renderFlatCards(container, sortBy) {
        // Flat data shape - simple card list with no sections
        let cards = [...this.cards];
        const defaultSort = this.config.defaultSortMode;
        if (sortBy !== 'default') {
            cards = this.sortCards(cards, sortBy);
        } else if (defaultSort) {
            cards = this.sortCards(cards, defaultSort);
        }
        container.innerHTML = `<div class="card-grid">${cards.map(c => this.createCardElement(c)).join('')}</div>`;
    }

    _sectionProgress(cards) {
        if (!cards || cards.length === 0) return null;
        const countable = cards.filter(c => !c.collectionLink);
        if (countable.length === 0) return null;
        let owned = 0;
        countable.forEach(card => {
            if (this.isOwned(this.getCardId(card))) owned++;
        });
        return { owned, total: countable.length };
    }

    _sectionHeaderHtml(label, cssClass, allCards) {
        const progress = this._sectionProgress(allCards);
        let badge = '';
        if (progress) {
            const complete = progress.owned === progress.total;
            badge = `<span class="section-progress${complete ? ' complete' : ''}">${complete ? '&#10003; ' : ''}${progress.owned}/${progress.total}</span>`;
        }
        return `<div class="${cssClass}">${sanitizeText(label)}${badge}</div>`;
    }

    _renderCategoryCards(container, sortBy) {
        // Category data shape (like Jayden Daniels, JMU)
        const categories = this.config.categories || [];

        if (sortBy !== 'default') {
            // Flatten all cards, sort (filtering handled by _applyFilters)
            const allCards = this._getAllCardsFlat();
            const sorted = this.sortCards(allCards, sortBy);
            container.innerHTML = `
                <div class="section">
                    ${this._sectionHeaderHtml('All Cards', 'section-header', allCards)}
                    <div class="card-grid">${sorted.map(c => this.createCardElement(c)).join('')}</div>
                </div>`;
            return;
        }

        // Default: render each category as a section (filtering handled by _applyFilters)
        const defaultSort = this.config.defaultSortMode;
        let html = '';
        categories.forEach(cat => {
            if (cat.children && cat.children.length > 0) {
                // Parent with subcategories - render as group-header + section-group
                const groupCards = cat.children.flatMap(child => this.cards[child.id] || []);
                html += this._sectionHeaderHtml(cat.label, `group-header cat-${cat.id}`, groupCards);
                if (cat.note) {
                    html += `<div class="inserts-note">${sanitizeText(cat.note)}</div>`;
                }
                html += `<div class="section-group">`;
                cat.children.forEach(child => {
                    const childCards = this.cards[child.id] || [];
                    if (childCards.length === 0) return;
                    let sorted = defaultSort ? this.sortCards([...childCards], defaultSort) : childCards;
                    const childSectionClass = cat.isMain !== false ? 'default-section' : '';
                    html += `<div class="section ${childSectionClass}">`;
                    html += this._sectionHeaderHtml(child.label, `section-header cat-${child.id}`, childCards);
                    html += `<div class="card-grid" id="${child.id}-cards">${sorted.map(c => this.createCardElement(c)).join('')}</div>`;
                    html += `</div>`;
                });
                html += `</div>`;
            } else {
                // Simple category (no children)
                const catCards = this.cards[cat.id] || [];
                if (catCards.length === 0) return;
                let sorted = defaultSort ? this.sortCards([...catCards], defaultSort) : catCards;

                const sectionClass = cat.isMain !== false ? 'default-section' : '';
                const headerClass = `section-header cat-${cat.id}`;

                if (cat.note) {
                    html += `<div class="section ${sectionClass}" id="${cat.id}-section">`;
                    html += this._sectionHeaderHtml(cat.label, headerClass, catCards);
                    html += `<div class="inserts-note">${sanitizeText(cat.note)}</div>`;
                    html += `<div class="card-grid" id="${cat.id}-cards">${sorted.map(c => this.createCardElement(c)).join('')}</div>`;
                    html += `</div>`;
                } else {
                    html += `<div class="section ${sectionClass}">`;
                    html += this._sectionHeaderHtml(cat.label, headerClass, catCards);
                    html += `<div class="card-grid" id="${cat.id}-cards">${sorted.map(c => this.createCardElement(c)).join('')}</div>`;
                    html += `</div>`;
                }
            }
        });

        container.innerHTML = html;
    }

    _getAllCardsFlat() {
        if (this._isFlat()) return [...this.cards];

        const categories = this.config.categories || [];
        const allCards = [];
        categories.forEach((cat, idx) => {
            if (cat.children && cat.children.length > 0) {
                cat.children.forEach(child => {
                    const childCards = this.cards[child.id] || [];
                    childCards.forEach(c => {
                        allCards.push({ ...c, _category: child.id, _sortOrder: idx });
                    });
                });
            } else {
                const catCards = this.cards[cat.id] || [];
                catCards.forEach(c => {
                    allCards.push({ ...c, _category: cat.id, _sortOrder: idx });
                });
            }
        });
        return allCards;
    }

    // ========================================
    // Stats
    // ========================================

    computeStats() {
        const categories = this.config.categories || [];
        const mainCats = categories.filter(c => c.isMain !== false);
        const extraCats = categories.filter(c => c.isMain === false);

        if (this._isFlat()) {
            // Flat: count all non-collectionLink cards
            const countable = this.cards.filter(c => !c.collectionLink);
            let ownedCount = 0, totalValue = 0, ownedValue = 0, neededValue = 0;
            countable.forEach(card => {
                const price = this.getPrice(card);
                const owned = this.isOwned(this.getCardId(card));
                totalValue += price;
                if (owned) {
                    ownedCount++;
                    ownedValue += price;
                } else {
                    neededValue += price;
                }
            });
            return {
                owned: ownedCount,
                total: countable.length,
                ownedValue: Math.round(ownedValue),
                neededValue: Math.round(neededValue),
            };
        }

        // Helper to get all cards for a category (handles children)
        const getCardsForCategory = (cat) => {
            if (cat.children && cat.children.length > 0) {
                const all = [];
                cat.children.forEach(child => all.push(...(this.cards[child.id] || [])));
                return all;
            }
            return this.cards[cat.id] || [];
        };

        // Category-based: count only main categories
        let ownedCount = 0, totalCount = 0, totalValue = 0, ownedValue = 0, neededValue = 0;
        mainCats.forEach(cat => {
            getCardsForCategory(cat).forEach(card => {
                const price = this.getPrice(card);
                const owned = this.isOwned(this.getCardId(card));
                totalCount++;
                totalValue += price;
                if (owned) {
                    ownedCount++;
                    ownedValue += price;
                } else {
                    neededValue += price;
                }
            });
        });

        const stats = {
            owned: ownedCount,
            total: totalCount,
            ownedValue: Math.round(ownedValue),
            neededValue: Math.round(neededValue),
        };

        // Add extra category stats
        extraCats.forEach(cat => {
            const catCards = getCardsForCategory(cat);
            const label = cat.statLabel || `${cat.id}Owned`;
            stats[label] = catCards.filter(c => this.isOwned(this.getCardId(c))).length;
            stats[`${cat.id}Total`] = catCards.length;
        });

        return stats;
    }

    updateStats() {
        const stats = this.computeStats();
        StatsAnimator.animateStats({
            owned: { el: document.getElementById('owned-count'), value: stats.owned },
            total: { el: document.getElementById('total-count'), value: stats.total },
            totalValue: { el: document.getElementById('total-value'), value: stats.ownedValue },
            neededValue: { el: document.getElementById('needed-value'), value: stats.neededValue },
        });
    }

    // ========================================
    // Card Editor Setup
    // ========================================

    _initCardEditor() {
        const categories = this.config.categories || [];
        const customFields = this.config.customFields || {};

        // Normalize: position field should be next to player name (top), not after-num
        if (customFields.position?.position === 'after-num') {
            customFields.position = { ...customFields.position, position: undefined };
        }
        // When position field exists alongside player, player shouldn't be full-width
        if (customFields.position && customFields.player?.fullWidth) {
            customFields.player = { ...customFields.player, fullWidth: false };
        }
        // Position field should always be narrow for proper row pairing
        if (customFields.position && !customFields.position.narrow) {
            customFields.position = { ...customFields.position, narrow: true };
        }

        // Build categories list for dropdown (with optgroup for subcategories)
        let editorCategories;
        if (this._isFlat()) {
            editorCategories = null; // No category dropdown for flat data
        } else {
            editorCategories = [];
            categories.forEach(c => {
                if (c.children && c.children.length > 0) {
                    editorCategories.push({
                        group: c.label,
                        children: c.children.map(child => ({
                            value: child.id,
                            label: child.label,
                        })),
                    });
                } else {
                    editorCategories.push({ value: c.id, label: c.label });
                }
            });
        }

        this.cardEditor = new CardEditorModal({
            customFields: customFields,
            imageFolder: `images/${this.id}`,
            categories: editorCategories,
            cardTypes: [],
            isOwned: (cardId) => this.checklistManager.isOwned(cardId),
            onOwnedChange: (cardData, nowOwned) => {
                const id = this.getCardId(cardData);
                this.checklistManager.toggleOwned(id, nowOwned);
                const cardEl = document.querySelector(`.card[data-id="${id}"]`);
                if (cardEl) {
                    cardEl.classList.toggle('owned', nowOwned);
                    const checkbox = cardEl.querySelector(`input[type="checkbox"]`);
                    if (checkbox) checkbox.checked = nowOwned;
                }
                this.updateStats();
            },
            onSave: async (cardId, cardData, isNew) => {
                const newId = this.getCardId(cardData);
                if (isNew) {
                    this._addCard(cardData);
                } else {
                    // Transfer owned status if card ID changed (e.g. variant/set/num edit)
                    if (cardId !== newId && this.checklistManager.isOwned(cardId)) {
                        this.checklistManager.toggleOwned(cardId, false);
                        this.checklistManager.toggleOwned(newId, true);
                    }
                    this._updateCard(cardId, cardData);
                }
                this.renderCards();
                this.updateStats();
                // Scroll to the card
                const cardEl = document.querySelector(`.card[data-id="${newId}"]`);
                if (cardEl) {
                    cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    if (isNew) cardEl.classList.add('card-highlight');
                }
                this.checklistManager.setSyncStatus('syncing', 'Saving...');
                await this._saveCardData();
            },
            onDelete: async (cardId) => {
                this._removeCard(cardId);
                this.renderCards();
                this.updateStats();
                this.checklistManager.setSyncStatus('syncing', 'Saving...');
                await this._saveCardData();
            },
        });
        this.cardEditor.init();
    }

    // ========================================
    // Card CRUD
    // ========================================

    _findCardWithLocation(cardId) {
        if (this._isFlat()) {
            const idx = this.cards.findIndex(c => this.getCardId(c) === cardId);
            if (idx === -1) return null;
            return {
                card: this.cards[idx],
                index: idx,
                editData: { ...this.cards[idx] },
            };
        }

        // Category-based (search children too)
        for (const cat of (this.config.categories || [])) {
            const idsToSearch = (cat.children && cat.children.length > 0)
                ? cat.children.map(c => c.id)
                : [cat.id];
            for (const searchId of idsToSearch) {
                const catCards = this.cards[searchId] || [];
                const idx = catCards.findIndex(c => this.getCardId(c) === cardId);
                if (idx !== -1) {
                    return {
                        card: catCards[idx],
                        category: searchId,
                        index: idx,
                        editData: { ...catCards[idx], category: searchId },
                    };
                }
            }
        }
        return null;
    }

    _addCard(cardData) {
        // Use custom ebay search if provided, otherwise keep the search term
        // already generated by CardEditorModal.save()
        if (cardData.ebay) {
            cardData.search = cardData.ebay;
            delete cardData.ebay;
        }

        if (this._isFlat()) {
            // Extract category-like fields that belong on the card directly
            delete cardData.category;
            this._insertCardSorted(this.cards, cardData);
        } else {
            const category = cardData.category || this._getDefaultCategory();
            delete cardData.category;
            if (!this.cards[category]) this.cards[category] = [];
            this._insertCardSorted(this.cards[category], cardData);
        }
    }

    _updateCard(cardId, cardData) {
        const found = this._findCardWithLocation(cardId);
        if (!found) return;

        if (this._isFlat()) {
            const card = found.card;
            Object.assign(card, cardData);
            if (cardData.ebay) { card.search = cardData.ebay; delete card.ebay; }
            if (cardData.priceSearch) { card.priceSearch = cardData.priceSearch; } else { delete card.priceSearch; }
            // Clean up falsy optional fields
            ['price', 'img', 'auto', 'rc', 'patch', 'serial', 'variant'].forEach(key => {
                if (!(key in cardData) || !cardData[key]) delete card[key];
            });
            this._cleanupCustomFields(card, cardData);
            // Re-sort
            this.cards.splice(found.index, 1);
            this._insertCardSorted(this.cards, card);
        } else {
            const { card, category: oldCategory, index } = found;
            const newCategory = cardData.category || oldCategory;
            delete cardData.category;
            Object.assign(card, cardData);
            if (cardData.ebay) { card.search = cardData.ebay; delete card.ebay; }
            if (cardData.priceSearch) { card.priceSearch = cardData.priceSearch; } else { delete card.priceSearch; }
            // Clean up falsy optional fields
            ['price', 'img', 'auto', 'rc', 'patch', 'serial', 'variant'].forEach(key => {
                if (!(key in cardData) || !cardData[key]) delete card[key];
            });
            this._cleanupCustomFields(card, cardData);
            // Remove from old category, insert into new
            this.cards[oldCategory].splice(index, 1);
            if (!this.cards[newCategory]) this.cards[newCategory] = [];
            this._insertCardSorted(this.cards[newCategory], card);
        }
    }

    // Remove empty-string custom text fields from saved card data
    _cleanupCustomFields(card, cardData) {
        const customFields = this.config.customFields || {};
        for (const [key, config] of Object.entries(customFields)) {
            if (config.type === 'checkbox') continue;
            if (key in cardData && !cardData[key]) delete card[key];
        }
    }

    _removeCard(cardId) {
        if (this._isFlat()) {
            const idx = this.cards.findIndex(c => this.getCardId(c) === cardId);
            if (idx !== -1) this.cards.splice(idx, 1);
            return;
        }

        for (const cat of (this.config.categories || [])) {
            const idsToSearch = (cat.children && cat.children.length > 0)
                ? cat.children.map(c => c.id)
                : [cat.id];
            for (const searchId of idsToSearch) {
                const catCards = this.cards[searchId] || [];
                const idx = catCards.findIndex(c => this.getCardId(c) === cardId);
                if (idx !== -1) {
                    catCards.splice(idx, 1);
                    return;
                }
            }
        }
    }

    _insertCardSorted(arr, card) {
        const idx = arr.findIndex(c => {
            if (c.set > card.set) return true;
            if (c.set === card.set) {
                const numA = parseInt((card.num || '').replace(/\D/g, '')) || 0;
                const numB = parseInt((c.num || '').replace(/\D/g, '')) || 0;
                return numB > numA;
            }
            return false;
        });
        if (idx === -1) arr.push(card);
        else arr.splice(idx, 0, card);
    }
}

// Export
window.ChecklistEngine = ChecklistEngine;
