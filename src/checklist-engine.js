/**
 * ChecklistEngine - Config-driven checklist renderer
 *
 * Reads ?id= from URL, loads config + card data from gist,
 * and renders a fully functional checklist page.
 */

// Fields whose absence from a submission really does mean the user cleared them.
// The first four because the card editor always renders them, so an empty one is
// a deliberate blank. The collection link trio is not always rendered, but earns
// the same treatment for a different reason: getFormData omits all three together
// whenever no link is selected, which is exactly when they should be gone. Every
// other clearable field is a custom field and is only trusted when this
// checklist's config declares it - see _clearEmptyFields.
const ENGINE_BUILTIN_CLEARABLE = new Set([
    'price', 'img', 'search', 'priceSearch',
    'collectionLink', 'stackImages', 'cardCount',
]);

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
        this._reorderMode = false;
        this._sortableInstances = [];
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
        this._backfillSyntheticIds();

        // Load stats for any linked checklists (e.g., collection link cards)
        await this._loadLinkedStats();

        // Set up ChecklistManager (re-renders auth UI with add/clear buttons)
        this.checklistManager = new ChecklistManager(this._managerOptions());
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

        this._initOwnedToggle();
        this._initCollectionLinkNav();
        this._initImageFallback();

        // Render
        this._renderFilters();
        this.cardContextMenu.init();
        this.cardEditor.init();
        this.renderCards();

        // Deep-link: scroll to card if URL has #card-{id} hash
        this._scrollToHashCard();

        // Refresh saved stats if stale (e.g. linked checklist progress changed)
        this._refreshStatsIfStale();
    }

    // The ChecklistManager options, factored out so tests can wire a manager the
    // way init() really does. A test that hand-mirrors this object cannot catch a
    // change to it. renderCards() ends in _applyFilters(), which calls
    // updateStats(), so this callback must NOT call updateStats itself.
    _managerOptions() {
        return {
            checklistId: this.id,
            ownerUsername: 'iammike',
            localStorageKey: `${this.id}-owned`,
            onOwnedChange: () => this.renderCards(),
            getStats: () => this.computeStats(),
        };
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
            DynamicNav.clearCache();
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
                DynamicNav.clearCache();
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
        // The optional chaining below guards only its own branch: with no module at
        // all the condition is false and the bare public read after the block still
        // runs. Failing to load is what that read failing already means here, so it
        // takes the existing exit rather than a ReferenceError.
        if (typeof githubSync === 'undefined') throw new Error('Failed to load card data');

        if (githubSync.isLoggedIn()) {
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

    // A no-card entry has nothing to hash - no set, num or variant - so it needs
    // an explicit id. A collection link card has nothing to hash either. The editor
    // assigns one on save, but entries created by hand-editing the gist have none,
    // and every one of them would hash to the same empty string, so edit and delete
    // would act on the first match rather than the row the user picked. Backfill at
    // load; persisted on the next save.
    _backfillSyntheticIds() {
        const arrays = this._isFlat() ? [this.cards] : Object.values(this.cards || {});
        const cards = arrays.filter(Array.isArray).flat().filter(Boolean);

        const taken = new Set(cards.map(c => c.id).filter(Boolean));
        cards.forEach(card => {
            // An unsafe id is ignored by getCardId, which would leave this entry
            // hashing to the empty string, so treat it as missing and replace it
            if (isSafeCardId(card.id)) return;
            // noCard wins over collectionLink, matching every other noCard check
            const build = card.noCard ? buildNoCardId : (card.collectionLink ? buildCollectionLinkId : null);
            if (!build) return;
            card.id = build(this._syntheticIdSource(card), taken);
            taken.add(card.id);
        });
    }

    // Name to derive a synthetic id from: the first top-position custom field
    // (usually player), matching what the editor uses, then set as a fallback, and
    // for a collection link card the id of the checklist it stands in for.
    _syntheticIdSource(card) {
        const topField = Object.entries(this.config.customFields || {})
            .find(([_, c]) => (c.position || 'top') === 'top');
        const named = (topField && card[topField[0]]) || card.player || card.set || '';
        return named || collectionLinkTargetId(card.collectionLink) || '';
    }

    async _loadLinkedStats() {
        // Same guard as _loadConfig: the stats reads below are bare references,
        // which throw rather than reading as undefined when the module was never
        // loaded. No stats to show is the same answer as no linked cards at all,
        // so it takes the same exit.
        if (typeof githubSync === 'undefined') {
            this._linkedStats = {};
            return;
        }

        // Find collection link cards that reference other checklists
        const allCards = this._isFlat() ? this.cards : this._getAllCardsFlat();
        const linkedIds = allCards
            .filter(c => c.collectionLink)
            .map(c => collectionLinkTargetId(c.collectionLink))
            .filter(Boolean);

        if (linkedIds.length === 0) {
            this._linkedStats = {};
            return;
        }

        const allStats = githubSync.isLoggedIn()
            ? await githubSync.loadAllStats()
            : await githubSync.loadPublicStats();

        this._linkedStats = {};
        this._savedStatsSnapshot = allStats[this.id] || null;
        linkedIds.forEach(id => {
            if (allStats[id]) this._linkedStats[id] = allStats[id];
        });
    }

    // The two fields on a collection link card that describe the linked checklist
    // rather than this card, filled in from the linked checklist itself. See the
    // editor's _refreshLinkedCardCount and _suggestStackImages for when each is used.
    //
    // No cache of its own: githubSync keeps the whole fetched gist in memory and
    // every file below comes out of it, so a repeat call is a JSON parse rather
    // than a round trip - and the page has already paid for that fetch loading its
    // own cards.
    async _loadLinkSuggestions(link) {
        // Same guard, and for the same reason, as _loadConfig: every githubSync
        // call below is a bare reference, which throws rather than reading as
        // undefined when the module was never loaded. Guarding once up here is why
        // they can stay bare.
        if (typeof githubSync === 'undefined') return null;

        const linkedId = collectionLinkTargetId(link);
        if (!linkedId) return null;

        const loggedIn = !!githubSync.isLoggedIn();

        // The count comes from the linked checklist's saved stats, not from
        // counting its cards. `total` there is the number the badge shows whenever
        // it can read those stats (see _renderCollectionLinkCard), so the stored
        // cardCount stays a faithful snapshot of the value it stands in for - it
        // cannot disagree with the live badge about what "N CARDS" means. Every
        // save to a checklist rewrites its stats, so the snapshot is current as of
        // that checklist's last edit.
        const allStats = loggedIn
            ? await githubSync.loadAllStats()
            : await githubSync.loadPublicStats();
        const linkedTotal = (allStats || {})[linkedId]?.total;

        const cardData = (loggedIn ? await githubSync.loadCardData(linkedId) : null)
            || await githubSync.loadPublicCardData(linkedId);

        return {
            cardCount: typeof linkedTotal === 'number' ? linkedTotal : null,
            stackImages: this._pickStackImages(cardData),
        };
    }

    // A starting point for the card stack: the first few of the linked checklist's
    // cards that have an image. Three, because that is how many the stack lays out
    // (.card-stack img:nth-child, in shared.css) - a fourth would sit unstyled on
    // top of the third.
    //
    // The linked checklist's config isn't read, so its data shape is worked out
    // from the file: a flat checklist stores `cards`, a categorized one stores
    // `categories`. Its own link cards are skipped - a stack of collection tiles is
    // not what this is for - as are noCard entries, which have nothing to show.
    _pickStackImages(cardData, limit = 3) {
        if (!cardData) return [];
        const lists = Array.isArray(cardData.cards)
            ? [cardData.cards]
            : Object.values(cardData.categories || {});

        return lists
            .filter(Array.isArray)
            .flat()
            .filter(card => card && !card.noCard && !card.collectionLink
                && typeof card.img === 'string' && card.img.trim() !== '')
            .slice(0, limit)
            .map(card => card.img.trim());
    }

    // Refresh saved stats if they're stale vs. computed (e.g. linked checklist progress changed).
    // Owner-only; safe to fire-and-forget.
    async _refreshStatsIfStale() {
        if (!window.githubSync?.isLoggedIn()) return;
        const user = githubSync.getUser();
        if (!user || user.login !== 'iammike') return;

        const current = this.computeStats();
        const saved = this._savedStatsSnapshot;
        if (this._statsEqual(saved, current)) return;

        try {
            await githubSync.saveChecklistStats(this.id, current);
        } catch (e) {
            console.warn('Failed to refresh stale stats:', e);
        }
    }

    _statsEqual(a, b) {
        if (!a || !b) return false;
        const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
        for (const k of keys) {
            if (a[k] !== b[k]) return false;
        }
        return true;
    }

    async _saveCardData() {
        // githubSync is a page-loaded global, not an import, so guard it the way
        // _loadConfig() does. Callers have already set the "Saving..." status, so
        // report this through the same path as any other failed save rather than
        // returning bare and leaving the status hanging.
        if (typeof githubSync === 'undefined') {
            return this._applySaveResult({ ok: false, reason: 'unavailable' });
        }

        // Merge with latest gist data to prevent overwriting external changes (#560)
        await this._mergeWithFreshGistData();

        if (this._isFlat()) {
            this.cardData.cards = this.cards;
        } else {
            this.cardData.categories = this.cards;
        }

        // Save card data and stats together in one PATCH (one request, not two).
        const stats = this.computeStats();

        // Try save with one automatic retry. Don't retry auth or rate-limit
        // failures - retrying those just burns more requests against the limit.
        const noRetry = reason => reason === 'auth_expired' || reason === 'rate_limited';
        let result = await githubSync.saveCardData(this.id, this.cardData, stats);
        if (!result.ok && !noRetry(result.reason)) {
            // Brief pause then retry once for transient failures
            await new Promise(r => setTimeout(r, 1500));
            result = await githubSync.saveCardData(this.id, this.cardData, stats);
        }

        return this._applySaveResult(result);
    }

    // Reflect a { ok, reason } save result in the sync status and error banner.
    // Returns whether the save succeeded, which is _saveCardData's return value.
    _applySaveResult(result) {
        if (result.ok) {
            this.checklistManager.setSyncStatus('synced', 'Saved');
        } else if (result.reason === 'auth_expired') {
            this.checklistManager.setSyncStatus('error', 'Session expired');
            this._showSaveError('Your session has expired.', 'Sign Out', () => {
                githubSync.logout();
                window.location.reload();
            });
        } else if (result.reason === 'rate_limited') {
            this.checklistManager.setSyncStatus('error', 'Rate limited');
            this._showSaveError('GitHub is temporarily rate-limiting writes. Your changes are saved in memory - wait a minute, then edit again to retry.');
        } else {
            this.checklistManager.setSyncStatus('error', 'Save failed');
            this._showSaveError('Save failed. Your changes are still in memory - try refreshing and editing again.');
        }
        return result.ok;
    }

    // Merge local cards with fresh gist data so external field additions aren't lost
    async _mergeWithFreshGistData() {
        // Guard outside the try: the catch below only warns and lets the save
        // proceed with local data, so a ReferenceError here would silently defeat
        // the overwrite protection this function exists to provide (#560).
        if (typeof githubSync === 'undefined') return;

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
            // An edit to set/num/variant changes the id, so the local card may not
            // have a fresh counterpart at all - it still needs the same marker
            // cleanup a merged card gets, just with nothing to merge against.
            if (!freshCard) return this._stripLocalOnlyMarkers({ ...localCard }, localCard);
            // Fresh as base preserves externally-added fields,
            // local overlay preserves user's in-session edits
            const merged = { ...freshCard, ...localCard };
            return this._stripLocalOnlyMarkers(merged, localCard);
        });
    }

    // Honor the deletion markers _updateCard leaves on the local card - they are
    // local to the in-progress edit and must not reach the gist. Mutates and
    // returns `merged` for convenience.
    _stripLocalOnlyMarkers(merged, localCard) {
        // _clearedKeys is ours and never belongs in the gist. It's non-enumerable
        // where we set it, so it isn't spread into `merged` in the first place;
        // deleted unconditionally so a hand-edited gist card that carries an
        // enumerable one can't round-trip it either.
        delete merged._clearedKeys;
        // Keys the edit cleared: the gist copy is the merge base, so its old
        // value has to be deleted explicitly (#686). Array-checked because a
        // hand-edited gist card could carry a _clearedKeys of any shape, and
        // throwing here would skip the merge for the whole checklist. Filtered by
        // _isManagedField for the same reason recording is: a marker read back from
        // gist data must not be able to name an arbitrary field for deletion.
        if (Array.isArray(localCard._clearedKeys)) {
            localCard._clearedKeys.forEach(key => {
                if (this._isManagedField(key)) delete merged[key];
            });
        }
        // img: '' means the image was removed
        if (localCard.img === '') delete merged.img;
        // noCard: false means an un-flagged entry must not pick the gist's
        // noCard: true back up, and the gist shouldn't store false
        if (localCard.noCard === false) delete merged.noCard;
        return merged;
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
            subtitle.style.display = '';
        } else {
            subtitle.textContent = '';
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
        // An explicit id wins - no-card entries have no set/num/variant to hash -
        // but only if it's a safe id (see isSafeCardId in shared.js)
        if (isSafeCardId(card.id)) return card.id;
        if (this.config.cardDisplay?.includePlayerInCardId) {
            // btoa throws on non-Latin-1 input, so replace those characters the
            // same way index.html and shopping-list.js do - all three must agree
            return btoa(((card.player || '') + (card.set || '') + (card.num || '') + (card.variant || '')).replace(/[^\x00-\xFF]/g, '_')).replace(/[^a-zA-Z0-9]/g, '');
        }
        return this.checklistManager.getCardId(card);
    }

    isOwned(cardId) {
        return this.checklistManager.isOwned(cardId);
    }

    // ========================================
    // Ownership
    // ========================================

    // One delegated change listener for every owned checkbox. renderCards() only
    // rewrites #sections-container's innerHTML and never replaces the element, so
    // this survives re-renders - attaching it per render would stack duplicates.
    _initOwnedToggle() {
        if (this._ownedToggleBound) return;
        const container = document.getElementById('sections-container');
        if (!container) return;
        this._ownedToggleBound = true;
        container.addEventListener('change', (e) => {
            const checkbox = e.target.closest?.('input[type="checkbox"][data-card-id]');
            if (!checkbox) return;
            this.setOwned(checkbox.dataset.cardId, checkbox.checked);
        });
    }

    // One delegated click listener for collection-link cards, replacing an inline
    // onclick that built a JS string from the link. Same re-render reasoning as
    // _initOwnedToggle.
    _initCollectionLinkNav() {
        if (this._collectionLinkNavBound) return;
        const container = document.getElementById('sections-container');
        if (!container) return;
        this._collectionLinkNavBound = true;
        container.addEventListener('click', (e) => {
            // The card holds real links (the "View Full Collection" anchor, and the
            // image's wrapping anchor); let the browser follow those rather than
            // navigating on top of them.
            if (e.target.closest?.('a')) return;
            const card = e.target.closest?.('.card.collection-link[data-collection-link]');
            if (!card) return;
            const link = card.dataset.collectionLink;
            if (link) window.location.href = link;
        });
    }

    // Restores what the card image's inline onerror used to do. Image error events
    // do not bubble, so unlike the other two delegated listeners this one has to
    // listen in the capture phase to see them from an ancestor.
    _initImageFallback() {
        if (this._imageFallbackBound) return;
        const container = document.getElementById('sections-container');
        if (!container) return;
        this._imageFallbackBound = true;
        container.addEventListener('error', (e) => {
            const img = e.target;
            if (img?.tagName !== 'IMG' || !img.classList.contains('card-image')) return;
            CardRenderer.replaceBrokenImage(img);
        }, true);
    }

    // toggleOwned synchronously calls onOwnedChange, which re-renders the cards
    // (re-applying the owned class from stored state) and updates the stats. So
    // there is deliberately nothing to do here beyond delegating - touching the
    // clicked checkbox afterwards would be operating on a detached node.
    setOwned(cardId, nowOwned) {
        this.checklistManager.toggleOwned(cardId, nowOwned);
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

    _playerNameHtml(card) {
        const posHtml = card.position
            ? ` <span class="player-position">${sanitizeText(card.position)}</span>`
            : '';
        return `<div class="player-name">${sanitizeText(card.player)}${posHtml}</div>`;
    }

    _subtitleLinesHtml(card) {
        const customFields = this.config.customFields || {};
        const subtitleFields = Object.entries(customFields)
            .filter(([key, c]) => c.position === 'bottom' && card[key]);
        if (subtitleFields.length === 0) return '';
        let html = '';
        subtitleFields.forEach(([key, config]) => {
            // Validate before _ensureContrast rather than trusting it to launder
            // the value: it parses six-digit hex, so anything else comes back as
            // '#04NaNNaN' and the subtitle loses its colour entirely. Its
            // returning only toHex() output is also what keeps this style
            // attribute injection-free today, and an early-out returning fgHex
            // unchanged would quietly undo that. See isSafeColor in shared.js.
            const fg = isSafeColor(config.color) ? config.color : '#888888';
            const color = this._ensureContrast(fg, this._cardBg || '#ffffff', 4.5);
            const r = parseInt(color.slice(1, 3), 16), g = parseInt(color.slice(3, 5), 16), b = parseInt(color.slice(5, 7), 16);
            const pillStyle = config.pill ? `;background:rgba(${r},${g},${b},0.12)` : '';
            const pillClass = config.pill ? ' pill' : '';
            html += `<div class="card-subtitle-line${pillClass}" style="color:${color}${pillStyle}">${sanitizeText(card[key])}</div>`;
        });
        return html;
    }

    createCardElement(card) {
        // Track rendered card for filter-only updates
        const cardIdx = this._renderedCards.length;
        this._renderedCards.push(card);

        // noCard wins over collectionLink, matching every other noCard check
        const isCollectionLink = card.collectionLink && !card.noCard;
        // A collection link card gets an id too, so the context menu can tell one
        // from another; its ownership is still derived, never stored.
        const cardId = this.getCardId(card);
        const owned = !isCollectionLink && cardId ? this.isOwned(cardId) : false;
        const price = this.getPrice(card);
        const showPlayer = this.config.cardDisplay?.showPlayerName !== false && card.player;
        const searchPrefix = card.player ? card.player :
            (this.config.cardDisplay?.showPlayerName === false && (this.config.searchPrefix || this.config.title) ? (this.config.searchPrefix || this.config.title) : '');
        const defaultSearch = encodeURIComponent(CardRenderer.buildDefaultSearch(card, searchPrefix));
        const searchUrl = CardRenderer.getEbayUrl(card.search || defaultSearch);
        const priceSearchTerm = card.priceSearch || defaultSearch;
        const scpUrl = CardRenderer.getScpUrl(priceSearchTerm);
        const thresholds = this.getPriceThresholds();

        // Clean up type display
        const displayType = (card.type || '').replace(/\s*RC\b/gi, '').replace(/\bBase\b/gi, '').trim();
        const displayVariant = card.variant || '';

        // No-card entries: person is on the list but no card exists
        if (card.noCard) {
            const safeId = sanitizeAttr(cardId);
            let noCardHtml = `<div class="card no-card" id="card-${safeId}" data-card-id="${safeId}" data-card-idx="${cardIdx}">`;
            noCardHtml += `<div class="card-image-wrapper">`;
            noCardHtml += CardRenderer.renderNoCardBadge(this.config.noCardLabel);
            noCardHtml += `</div>`;
            if (showPlayer) {
                noCardHtml += this._playerNameHtml(card);
            } else {
                // Without a player name there is no image to identify the tile by,
                // so fall back to the first field that names the entry
                const label = card.set || card.player || card.num || '';
                if (label) noCardHtml += `<div class="card-title">${sanitizeText(label)}</div>`;
            }
            noCardHtml += this._subtitleLinesHtml(card);
            // No owned control and no search links: there is no card to own, and
            // an eBay or price lookup for one that was never printed is always empty.
            noCardHtml += `</div>`;
            return noCardHtml;
        }

        // Collection link cards (special type)
        if (isCollectionLink) {
            return this._renderCollectionLinkCard(card, cardIdx, cardId);
        }

        const cardClass = `card ${owned ? 'owned' : ''}`.trim();

        let html = `<div class="${cardClass}" id="card-${sanitizeAttr(cardId)}" data-card-idx="${cardIdx}" data-price="${sanitizeAttr(price)}"${card.sport ? ` data-sport="${sanitizeAttr(card.sport)}"` : ''}${card.era ? ` data-era="${sanitizeAttr(card.era)}"` : ''} data-type="${sanitizeAttr(card.type || '')}">`;
        html += `<div class="card-image-wrapper">`;
        html += CardRenderer.renderAttributeBadges(card, this.config.customFields);
        html += CardRenderer.renderPriceBadge(price, thresholds);
        html += CardRenderer.renderCardImage(card.img, card.set, searchUrl);
        html += `</div>`;

        // Player name (JMU, Washington QBs) with optional position
        if (showPlayer) html += this._playerNameHtml(card);

        // Custom subtitle lines (config-driven)
        html += this._subtitleLinesHtml(card);

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

    _renderCollectionLinkCard(card, cardIdx, cardId) {
        // Scheme-checked so a 'javascript:' link cannot execute from the href or
        // from the delegated navigation, then attribute-escaped so a quote in it
        // cannot close the attribute.
        const link = sanitizeLinkUrl(card.collectionLink);
        const safeLink = sanitizeAttr(link);
        // Omitted rather than emitted empty when the card has yet to be backfilled:
        // two id-less cards would otherwise share one document id.
        const safeId = sanitizeAttr(cardId);
        const idAttrs = cardId ? ` id="card-${safeId}" data-card-id="${safeId}"` : '';

        // Badge: show linked checklist stats if available, else cardCount.
        // All three values land in a text node and all three come from the gist -
        // the counts from the stats file, cardCount from the card - so all three
        // are escaped. The editor now writes cardCount through parseInt, but a
        // hand-edited gist can still put anything there.
        let badgeHtml = '';
        const linkedId = collectionLinkTargetId(card.collectionLink);
        const linkedStats = linkedId ? (this._linkedStats || {})[linkedId] : null;
        if (linkedStats && typeof linkedStats.owned === 'number') {
            badgeHtml = `<span class="collection-badge">${sanitizeText(linkedStats.owned)} / ${sanitizeText(linkedStats.total)} CARDS</span>`;
        } else if (card.cardCount) {
            badgeHtml = `<span class="collection-badge">${sanitizeText(card.cardCount)} CARDS</span>`;
        }

        // Image: card stack, or a single image when there is no usable stack.
        //
        // Each stack entry becomes a fetch target, so it gets the same scheme
        // check every other URL in the render path gets. This field is editable
        // from the card editor's Stack Images box, so the values are no longer
        // only ever hand-written gist JSON. An entry that fails the check is
        // dropped rather than emitted as src="", which renders a broken-image
        // icon; a stack left empty by that filter falls through to the
        // single-image path, exactly as a card with no stack at all does.
        // Array-checked because a hand-edited gist could hold a bare string,
        // which has a length but no map.
        const stackSrcs = (Array.isArray(card.stackImages) ? card.stackImages : [])
            .map(src => sanitizeLinkUrl(src))
            .filter(Boolean);

        let imageHtml;
        if (stackSrcs.length > 0) {
            const imgs = stackSrcs.map(src =>
                `<img src="${sanitizeAttr(src)}" alt="" loading="lazy">`
            ).join('');
            imageHtml = `<div class="card-stack">${imgs}</div>`;
        } else {
            // renderCardImage escapes its own arguments, so pass the unescaped link
            imageHtml = CardRenderer.renderCardImage(card.img, card.player, link);
        }

        // The whole card navigates, but via one delegated click listener
        // (_initCollectionLinkNav) reading data-collection-link. There is no inline
        // handler, so a quote in the link has no JS string to break out of.
        // data-card-id is what the context menu reads to know which card was
        // right-clicked; without it, Edit resolves to the empty id and finds
        // nothing, which is why these cards were previously gist-only to edit.
        return `<div class="card collection-link"${idAttrs} data-card-idx="${cardIdx}" data-collection-link="${safeLink}">
            <div class="card-image-wrapper">
                ${badgeHtml}
                ${imageHtml}
            </div>
            <div class="player-name">${sanitizeText(card.player)}</div>
            <a href="${safeLink}" class="collection-cta">View Full Collection</a>
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
                html += `<option value="${sanitizeAttr(s)}">${sanitizeText(label)}</option>`;
            });
            html += `</select>`;
        }

        // Custom filter dropdowns (sport, era, etc.)
        customFilters.forEach(f => {
            html += `<select id="${sanitizeAttr(f.id)}-filter">`;
            html += `<option value="all">${sanitizeText(f.allLabel || 'All')}</option>`;
            f.options.forEach(opt => {
                html += `<option value="${sanitizeAttr(opt.value)}">${sanitizeText(opt.label)}</option>`;
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
        html += `<span class="search-wrapper"><input type="text" id="search" placeholder="Search cards..." aria-label="Search cards"><button class="search-clear" type="button" aria-label="Clear search">&times;</button></span>`;

        // Reorder button (visible when sort=Manual and user is owner)
        html += `<button id="reorder-btn" class="filter-btn" style="display:none">Reorder</button>`;

        container.innerHTML = html;

        // Bind events
        container.querySelectorAll('select').forEach(sel => {
            sel.addEventListener('change', () => this._onFilterChange());
        });
        container.querySelector('#search')?.addEventListener('input', () => this._onFilterChange());
        container.querySelector('.search-clear')?.addEventListener('click', () => {
            const input = container.querySelector('#search');
            if (input) { input.value = ''; input.focus(); this._onFilterChange(); }
        });
        container.querySelector('#reorder-btn')?.addEventListener('click', () => this._toggleReorderMode());

        // Show reorder button if applicable
        this._updateReorderButton();
    }

    _getSortLabel(key) {
        if (key === 'default') {
            const ds = this.config.defaultSortMode;
            if (ds) {
                const inner = this._getSortLabel(ds).replace('Sort: ', '');
                return `Sort: ${inner} (Default)`;
            }
            return 'Sort: Manual';
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
        // Exit reorder mode if active when filters change
        if (this._reorderMode) this._exitReorderMode();
        this._updateReorderButton();

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
    // Deep Linking
    // ========================================

    _scrollToHashCard() {
        const hash = window.location.hash;
        if (!hash || !hash.startsWith('#card-')) return;

        const elementId = hash.slice(1); // Remove leading #
        const cardEl = document.getElementById(elementId);
        if (!cardEl) return;

        // Expand collapsed section if the card is inside one
        const collapsibleContent = cardEl.closest('.collapsible-content');
        if (collapsibleContent && collapsibleContent.classList.contains('collapsed')) {
            // Find the associated header and click it to expand
            const section = collapsibleContent.closest('.section');
            const header = section
                ? section.querySelector('.section-header.collapsed, .group-header.collapsed')
                : collapsibleContent.previousElementSibling;
            if (header) header.click();
        }

        // Scroll to card, then highlight after scroll finishes
        requestAnimationFrame(() => {
            cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            // Delay highlight so the scroll brings the card into view first
            setTimeout(() => cardEl.classList.add('card-highlight'), 600);
        });
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
        // Rebuilding the DOM destroys the grids SortableJS is bound to, so leave
        // reorder mode first to avoid a stale state (e.g. after editing a card).
        if (this._reorderMode) this._exitReorderMode();

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

    // Normalize one side of a custom-filter comparison. Everything present
    // compares as a string; a missing field keeps the null sentinel so it can
    // never collide with an option value.
    static _filterKey(value) {
        return value == null ? null : String(value);
    }

    _filterCard(card, statusFilter, searchTerm, customFilterValues) {
        // Status filter
        if (statusFilter !== 'all') {
            // No-card entries are neither owned nor obtainable
            if (card.noCard) return false;
            const owned = card.collectionLink
                ? this._collectionLinkOwned(card)
                : this.isOwned(this.getCardId(card));
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
            // filterValue always arrives as a string (it is a <select> element's
            // value), so a card field stored as a number or boolean would never
            // match its own option under ===. Compare the string forms instead.
            // A missing field stays the null sentinel rather than becoming
            // "null"/"undefined", so it never matches a real option value.
            const cardValue = ChecklistEngine._filterKey(card[cardField]);

            // Multi-value match (e.g., sport filter matching "football" to both "nfl" and "usfl")
            if (filterDef.multiMatch && filterDef.multiMatch[filterValue]) {
                const allowed = filterDef.multiMatch[filterValue].map(v => ChecklistEngine._filterKey(v));
                if (!allowed.includes(cardValue)) return false;
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

    _collectionLinkOwned(card) {
        if (!card.collectionLink) return false;
        const linkedId = collectionLinkTargetId(card.collectionLink);
        const stats = linkedId ? (this._linkedStats || {})[linkedId] : null;
        return !!(stats && stats.owned > 0);
    }

    _sectionProgress(cards) {
        if (!cards || cards.length === 0) return null;
        const real = cards.filter(c => !c.noCard);
        if (real.length === 0) return null;
        let owned = 0;
        real.forEach(card => {
            if (card.collectionLink) {
                if (this._collectionLinkOwned(card)) owned++;
            } else if (this.isOwned(this.getCardId(card))) {
                owned++;
            }
        });
        return { owned, total: real.length };
    }

    _sectionHeaderHtml(label, cssClass, allCards) {
        const progress = this._sectionProgress(allCards);
        let badge = '';
        if (progress) {
            const complete = progress.owned === progress.total;
            // The checkmark a complete section picks up is a bare glyph, and the
            // "9/9" beside it reads as "9 slash 9". Name the badge so it announces
            // as figures instead; the role hides the glyph behind that name.
            const badgeLabel = complete
                ? `all ${progress.total} owned`
                : `${progress.owned} of ${progress.total} owned`;
            badge = `<span class="section-progress${complete ? ' complete' : ''}" role="img" aria-label="${sanitizeAttr(badgeLabel)}">${complete ? '&#10003; ' : ''}${progress.owned}/${progress.total}</span>`;
        }
        // Escaped at the sink rather than in each caller: callers compose cssClass
        // from a literal plus a config-supplied category id.
        return `<div class="${sanitizeAttr(cssClass)}">${sanitizeText(label)}${badge}</div>`;
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
                    html += `<div class="card-grid" id="${sanitizeAttr(child.id)}-cards">${sorted.map(c => this.createCardElement(c)).join('')}</div>`;
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
                    html += `<div class="section ${sectionClass}" id="${sanitizeAttr(cat.id)}-section">`;
                    html += this._sectionHeaderHtml(cat.label, headerClass, catCards);
                    html += `<div class="inserts-note">${sanitizeText(cat.note)}</div>`;
                    html += `<div class="card-grid" id="${sanitizeAttr(cat.id)}-cards">${sorted.map(c => this.createCardElement(c)).join('')}</div>`;
                    html += `</div>`;
                } else {
                    html += `<div class="section ${sectionClass}">`;
                    html += this._sectionHeaderHtml(cat.label, headerClass, catCards);
                    html += `<div class="card-grid" id="${sanitizeAttr(cat.id)}-cards">${sorted.map(c => this.createCardElement(c)).join('')}</div>`;
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
            let ownedCount = 0, totalCount = 0, totalValue = 0, ownedValue = 0, neededValue = 0;
            this.cards.forEach(card => {
                if (card.noCard) return;
                totalCount++;
                if (card.collectionLink) {
                    if (this._collectionLinkOwned(card)) ownedCount++;
                    return;
                }
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
                total: totalCount,
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

        // Category-based: count main categories, or all categories if none are set to count
        const countedCats = mainCats.length > 0 ? mainCats : categories;
        let ownedCount = 0, totalCount = 0, totalValue = 0, ownedValue = 0, neededValue = 0;
        countedCats.forEach(cat => {
            getCardsForCategory(cat).forEach(card => {
                if (card.noCard) return;
                totalCount++;
                if (card.collectionLink) {
                    if (this._collectionLinkOwned(card)) ownedCount++;
                    return;
                }
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
        });

        // Sum owned value from extra (non-main) categories so Est. Value
        // reflects every owned card, not just the base/target set. Skip when
        // there are no main categories: countedCats falls back to all
        // categories above, so extras are already in ownedValue (avoids
        // double-counting on hand-edited configs).
        let extraOwnedValue = 0;
        if (mainCats.length > 0) {
            extraCats.forEach(cat => {
                getCardsForCategory(cat).forEach(card => {
                    if (card.noCard) return;
                    if (card.collectionLink) return;
                    if (this.isOwned(this.getCardId(card))) {
                        extraOwnedValue += this.getPrice(card);
                    }
                });
            });
        }

        const stats = {
            owned: ownedCount,
            total: totalCount,
            ownedValue: Math.round(ownedValue + extraOwnedValue),
            neededValue: Math.round(neededValue),
        };

        // Add extra category stats (owned counts per extra category)
        extraCats.forEach(cat => {
            const catCards = getCardsForCategory(cat).filter(c => !c.noCard);
            const label = cat.statLabel || `${cat.id}Owned`;
            stats[label] = catCards.filter(c => {
                if (c.collectionLink) return this._collectionLinkOwned(c);
                return this.isOwned(this.getCardId(c));
            }).length;
            stats[`${cat.id}Total`] = catCards.length;
        });

        return stats;
    }

    updateStats() {
        const stats = this.computeStats();
        const isComplete = stats.total > 0 && stats.owned >= stats.total;
        StatsAnimator.animateStats({
            owned: { el: document.getElementById('owned-count'), value: stats.owned },
            total: { el: document.getElementById('total-count'), value: stats.total },
            totalValue: { el: document.getElementById('total-value'), value: stats.ownedValue },
            neededValue: {
                el: document.getElementById('needed-value'),
                value: stats.neededValue,
                text: isComplete ? 'Collection complete!' : null,
            },
        });
        const header = document.getElementById('page-header');
        if (header) header.classList.toggle('complete', isComplete);
    }

    // ========================================
    // Reorder Mode (drag-and-drop)
    // ========================================

    _isManualSort() {
        const sortBy = document.getElementById('sort-filter')?.value || 'default';
        return sortBy === 'default' && !this.config.defaultSortMode;
    }

    _updateReorderButton() {
        const btn = document.getElementById('reorder-btn');
        if (!btn) return;
        const isOwner = this.checklistManager?.isOwner();
        btn.style.display = (this._isManualSort() && isOwner) ? '' : 'none';
    }

    _toggleReorderMode() {
        if (this._reorderMode) {
            this._exitReorderMode();
        } else {
            this._enterReorderMode();
        }
    }

    _enterReorderMode() {
        if (typeof Sortable === 'undefined') return;
        this._reorderMode = true;

        const container = document.getElementById('sections-container');
        container.classList.add('reorder-mode');

        const btn = document.getElementById('reorder-btn');
        if (btn) {
            btn.textContent = 'Done';
            btn.classList.add('active');
        }

        // Init SortableJS on each card-grid
        this._sortableInstances = [];
        container.querySelectorAll('.card-grid').forEach(grid => {
            this._sortableInstances.push(this._initSortable(grid));
        });
    }

    _exitReorderMode() {
        this._reorderMode = false;

        const container = document.getElementById('sections-container');
        container.classList.remove('reorder-mode');

        const btn = document.getElementById('reorder-btn');
        if (btn) {
            btn.textContent = 'Reorder';
            btn.classList.remove('active');
        }

        // Destroy Sortable instances
        this._sortableInstances.forEach(s => s.destroy());
        this._sortableInstances = [];
    }

    _initSortable(gridEl) {
        return new Sortable(gridEl, {
            animation: 150,
            ghostClass: 'sortable-ghost',
            dragClass: 'sortable-drag',
            onEnd: (evt) => this._onReorderEnd(evt, gridEl),
        });
    }

    _onReorderEnd(evt, gridEl) {
        const { oldIndex, newIndex } = evt;
        if (oldIndex === newIndex) return;

        // Determine which card array to reorder
        let arr;
        if (this._isFlat()) {
            arr = this.cards;
        } else {
            // Grid elements have id like "{categoryId}-cards"
            const gridId = gridEl.id;
            const catId = gridId ? gridId.replace(/-cards$/, '') : null;
            if (catId && this.cards[catId]) {
                arr = this.cards[catId];
            } else {
                // Fallback: single merged grid (shouldn't happen in manual sort)
                return;
            }
        }

        // Splice card from old to new position
        const [moved] = arr.splice(oldIndex, 1);
        arr.splice(newIndex, 0, moved);

        // Save to gist
        this.checklistManager.setSyncStatus('syncing', 'Saving...');
        this._saveCardData();
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
        // When no position field, player should be full-width (nothing to pair with)
        if (!customFields.position && customFields.player && !customFields.player.fullWidth) {
            customFields.player = { ...customFields.player, fullWidth: true };
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
            getExistingIds: () => this._getAllCardsFlat().map(c => this.getCardId(c)),
            // Registry entries this card may stand in for. Read from whatever
            // DynamicNav already has - init() kicks the fetch off without awaiting
            // it, and the session cache covers the rest. A checklist cannot link to
            // itself, so it is never offered.
            getLinkTargets: () => DynamicNav.listChecklists()
                .filter(entry => entry.id !== this.id)
                .map(entry => ({ value: DynamicNav.getUrl(entry), label: entry.navLabel || entry.title })),
            getLinkSuggestions: (link) => this._loadLinkSuggestions(link),
            // Same story as setOwned: toggleOwned synchronously calls the
            // manager's onOwnedChange, which re-renders the cards from stored
            // state and updates the stats. Nothing to do here but delegate.
            onOwnedChange: (cardData, nowOwned) => {
                this.checklistManager.toggleOwned(this.getCardId(cardData), nowOwned);
            },
            onSave: async (cardId, cardData, isNew) => {
                const newId = this.getCardId(cardData);
                if (isNew) {
                    this._addCard(cardData);
                } else if (cardData.noCard || cardData.collectionLink) {
                    // Neither carries stored ownership - a no-card entry can never be
                    // owned, and a collection link card derives it from the linked
                    // checklist - so drop it rather than transferring it to the new id
                    if (this.checklistManager.isOwned(cardId)) {
                        this.checklistManager.toggleOwned(cardId, false);
                    }
                    if (newId !== cardId && this.checklistManager.isOwned(newId)) {
                        this.checklistManager.toggleOwned(newId, false);
                    }
                    this._updateCard(cardId, cardData);
                } else {
                    // Transfer owned status if card ID changed (e.g. variant/set/num edit)
                    if (cardId !== newId && this.checklistManager.isOwned(cardId)) {
                        this.checklistManager.toggleOwned(cardId, false);
                        this.checklistManager.toggleOwned(newId, true);
                    }
                    this._updateCard(cardId, cardData);
                }
                this.renderCards();
                // Scroll to the card (find by matching card ID in rendered cards)
                const cardIdx = this._renderedCards.findIndex(c => c && this.getCardId(c) === newId);
                if (cardIdx !== -1) {
                    const cardEl = document.querySelector(`.card[data-card-idx="${cardIdx}"]`);
                    if (cardEl) {
                        cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        if (isNew) cardEl.classList.add('card-highlight');
                    }
                }
                this.checklistManager.setSyncStatus('syncing', 'Saving...');
                await this._saveCardData();
            },
            onDelete: async (cardId) => {
                this._removeCard(cardId);
                this.renderCards();
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
        // A new card has no gist copy to clear, so the noCard: false marker is just noise
        if (!cardData.noCard) delete cardData.noCard;

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
            const before = { ...card };
            Object.assign(card, cardData);
            if (cardData.ebay) { card.search = cardData.ebay; delete card.ebay; }
            this._clearEmptyFields(card, cardData, before);
            // Re-sort (skip in manual sort so the edited card keeps its position)
            if (!this._isManualSort()) {
                this.cards.splice(found.index, 1);
                this._insertCardSorted(this.cards, card);
            }
        } else {
            const { card, category: oldCategory, index } = found;
            const newCategory = cardData.category || oldCategory;
            delete cardData.category;
            const before = { ...card };
            Object.assign(card, cardData);
            if (cardData.ebay) { card.search = cardData.ebay; delete card.ebay; }
            this._clearEmptyFields(card, cardData, before);
            if (newCategory === oldCategory) {
                // Re-sort within category (skip in manual sort to keep position)
                if (!this._isManualSort()) {
                    this.cards[oldCategory].splice(index, 1);
                    this._insertCardSorted(this.cards[oldCategory], card);
                }
            } else {
                // Category changed: move to the new category
                this.cards[oldCategory].splice(index, 1);
                if (!this.cards[newCategory]) this.cards[newCategory] = [];
                if (this._isManualSort()) {
                    this.cards[newCategory].push(card);
                } else {
                    this._insertCardSorted(this.cards[newCategory], card);
                }
            }
        }
    }

    // Is `key` a field this checklist's editor actually renders? An empty form
    // field only means "the user cleared this" for one that is. auto/patch/serial/
    // variant are custom fields a config may not enable, and rc isn't in the editor
    // at all - for those the key is absent from every submission, so treating its
    // absence as a clear would delete legacy data from the gist.
    // Used at both ends of the clear-tracking, recording and honoring, so the
    // invariant "this can only ever delete a field the editor manages" holds even
    // when the marker arrives as stored gist data rather than from an edit.
    _isManagedField(key) {
        return ENGINE_BUILTIN_CLEARABLE.has(key) || key in (this.config?.customFields || {});
    }

    // Drop the optional fields the form left empty. Deleting them from the local
    // card isn't enough on its own: _mergeCardArrays merges over the gist copy,
    // and a key the local card no longer has can't override it, so the old value
    // would come straight back. Keys the form genuinely cleared are recorded on
    // the card for the merge to delete (#686).
    // `before` is the card as it was prior to Object.assign(card, cardData).
    _clearEmptyFields(card, cardData, before) {
        const cleared = [];
        // Only claim a key was cleared if it had a value to clear - otherwise a
        // field added to the gist externally would be wiped by an unrelated edit
        const clear = key => {
            delete card[key];
            // variant is both in the list below and a custom field, so guard the dup
            if (before[key] && this._isManagedField(key) && !cleared.includes(key)) cleared.push(key);
        };

        if (cardData.priceSearch) { card.priceSearch = cardData.priceSearch; } else { clear('priceSearch'); }

        // img keeps '' as its own deletion marker, see _stripLocalOnlyMarkers.
        // The collection link trio is absent from the form data whenever no link is
        // selected, which is exactly when it should be gone from the card too.
        ['price', 'img', 'auto', 'rc', 'patch', 'serial', 'variant', 'search',
            'collectionLink', 'stackImages', 'cardCount'].forEach(key => {
            if (!(key in cardData) || !cardData[key]) {
                if (key === 'img' && key in cardData) { card[key] = ''; } else { clear(key); }
            }
        });

        // Empty-string custom text fields. Checkboxes are skipped: an unchecked box
        // is simply absent from the form data, so there's nothing to compare against.
        const customFields = this.config.customFields || {};
        for (const [key, config] of Object.entries(customFields)) {
            if (config.type === 'checkbox') continue;
            if (key in cardData && !cardData[key]) clear(key);
        }

        this._recordClearedKeys(card, cleared);
    }

    // Record the keys this edit cleared so _mergeCardArrays can delete them from
    // the merged card. Non-enumerable so the marker can never be spread into a
    // merged copy or serialized into the gist - including when the fresh-data
    // fetch fails and no merge runs at all.
    _recordClearedKeys(card, cleared) {
        // Only a successful merge clears the marker (it returns fresh objects). If
        // the merge bailed, an earlier edit's cleared key is still missing from the
        // card and still needs deleting, so carry it forward - otherwise the next
        // merge restores the gist's old value. Keys this edit repopulated drop out.
        // A merge that succeeds but whose PATCH then fails still drops the marker,
        // so a repeat of the same edit loses the clear; the user gets a retry banner
        // for the failed save, and this is no worse than before the fix.
        const previous = Array.isArray(card._clearedKeys) ? card._clearedKeys : [];
        const carried = previous.filter(key => !(key in card) && !cleared.includes(key));

        Object.defineProperty(card, '_clearedKeys', {
            value: cleared.concat(carried), enumerable: false, writable: true, configurable: true,
        });
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
