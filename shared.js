// Sports Card Checklists - Shared JavaScript Utilities

// Standard card types used across all checklists
const CARD_TYPES = ['Base', 'Base RC', 'Parallel', 'Insert', 'Insert SSP', 'Chase SSP'];

// Sanitization helpers for XSS prevention
function sanitizeText(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}

function sanitizeUrl(url) {
    if (!url) return '';
    try {
        const parsed = new URL(url);
        return ['http:', 'https:'].includes(parsed.protocol) ? url : '';
    } catch {
        return '';
    }
}

/**
 * Shared Auth UI helpers (for pages without ChecklistManager)
 */
const AuthUI = {
    update(logoutFn = () => { githubSync.logout(); location.reload(); }) {
        const authContent = document.getElementById('auth-content');
        if (!authContent || !window.githubSync) return;

        if (githubSync.isLoggedIn()) {
            const user = githubSync.getUser();
            const safeAvatarUrl = sanitizeUrl(user.avatar_url);
            const safeLogin = sanitizeText(user.login);
            authContent.innerHTML = `
                <div class="nav-user">
                    <img src="${safeAvatarUrl}" alt="">
                    <span>${safeLogin}</span>
                </div>
                <button class="nav-btn logout" id="auth-logout-btn">Sign out</button>
            `;
            document.getElementById('auth-logout-btn').onclick = logoutFn;
        } else {
            authContent.innerHTML = '';
        }
    }
};

/**
 * Checklist Manager - handles owned state, sync, and auth
 */
class ChecklistManager {
    constructor(config) {
        this.checklistId = config.checklistId;
        this.ownerUsername = config.ownerUsername || 'iammike';
        this.localStorageKey = config.localStorageKey;
        this.ownedCards = [];
        this.isReadOnly = true;
        this.onOwnedChange = config.onOwnedChange || (() => {});
        this.getStats = config.getStats || null; // Optional: return stats object for combined save
    }

    // Generate unique card ID from card data
    getCardId(card) {
        // Allow custom ID field, otherwise generate from set+num+name
        if (card.id) return card.id;
        const str = (card.set || '') + (card.num || '') + (card.name || '');
        return btoa(str).replace(/[^a-zA-Z0-9]/g, '');
    }

    // Check if current user is the owner
    isOwner() {
        if (!window.githubSync || !githubSync.isLoggedIn()) return false;
        const user = githubSync.getUser();
        return user && user.login === this.ownerUsername;
    }

    // Check if a card is owned
    isOwned(cardId) {
        return this.ownedCards.includes(cardId);
    }

    // Toggle owned state for a card
    toggleOwned(cardId, owned) {
        if (owned) {
            if (!this.ownedCards.includes(cardId)) {
                this.ownedCards.push(cardId);
            }
        } else {
            this.ownedCards = this.ownedCards.filter(id => id !== cardId);
        }
        this.saveOwned();
        this.onOwnedChange();
    }

    // Load owned cards from GitHub or localStorage
    async loadOwned() {
        try {
            // Try GitHub first if logged in
            if (window.githubSync && githubSync.isLoggedIn()) {
                this.setSyncStatus('syncing', 'Loading...');
                const cloudOwned = await githubSync.loadChecklist(this.checklistId);
                if (cloudOwned && cloudOwned.length > 0) {
                    this.ownedCards = cloudOwned;
                    // Also save to localStorage as backup
                    if (this.localStorageKey) {
                        localStorage.setItem(this.localStorageKey, JSON.stringify(this.ownedCards));
                    }
                    this.setSyncStatus('synced', 'Synced');
                    return;
                }
                this.setSyncStatus('synced', 'Synced');
            } else if (window.githubSync) {
                // Load from public gist for visitors
                const publicOwned = await githubSync.loadPublicChecklist(this.checklistId);
                if (publicOwned && publicOwned.length > 0) {
                    this.ownedCards = publicOwned;
                    return;
                }
            }
        } catch (error) {
            console.error('Failed to load from cloud:', error);
            this.setSyncStatus('error', 'Load failed - using cached data');
        }
        // Fall back to localStorage
        if (this.localStorageKey) {
            try {
                this.ownedCards = JSON.parse(localStorage.getItem(this.localStorageKey) || '[]');
            } catch (e) {
                console.error('Failed to parse localStorage:', e);
                this.ownedCards = [];
            }
        }
    }

    // Save owned cards to GitHub and localStorage
    async saveOwned() {
        // Always save to localStorage as backup
        if (this.localStorageKey) {
            localStorage.setItem(this.localStorageKey, JSON.stringify(this.ownedCards));
        }

        // Sync to GitHub if logged in
        if (window.githubSync && githubSync.isLoggedIn()) {
            this.setSyncStatus('syncing', 'Syncing...');
            // Get stats if callback provided (saves both atomically to avoid race condition)
            const stats = this.getStats ? this.getStats() : null;
            const success = await githubSync.saveChecklist(this.checklistId, this.ownedCards, stats);
            if (success) {
                this.setSyncStatus('synced', 'Synced');
            } else {
                this.setSyncStatus('error', 'Sync failed');
            }
        }
    }

    // Update sync status display
    setSyncStatus(status, text) {
        const el = document.getElementById('sync-status');
        if (!el) return;
        el.className = 'sync-status ' + status;
        el.textContent = text;
        if (status === 'synced') {
            setTimeout(() => { el.textContent = ''; }, 2000);
        }
    }

    // Update nav auth UI
    updateAuthUI() {
        const authContent = document.getElementById('auth-content');
        if (!authContent || !window.githubSync) return;

        if (githubSync.isLoggedIn()) {
            const user = githubSync.getUser();
            const safeAvatarUrl = sanitizeUrl(user.avatar_url);
            const safeLogin = sanitizeText(user.login);
            authContent.innerHTML = `
                <div class="nav-user">
                    <img src="${safeAvatarUrl}" alt="">
                    <span>${safeLogin}</span>
                </div>
                <button class="nav-btn logout" onclick="checklistManager.logout()">Sign out</button>
            `;
        } else {
            authContent.innerHTML = '';
        }
    }

    // Handle logout
    logout() {
        if (window.githubSync) {
            githubSync.logout();
        }
        location.reload();
    }

    // Update read-only UI state
    updateReadOnlyUI() {
        this.isReadOnly = !this.isOwner();

        // Hide clear button in read-only mode
        const clearBtn = document.querySelector('.clear-btn');
        if (clearBtn) clearBtn.style.display = this.isReadOnly ? 'none' : '';

        // Show read-only notice
        const authBar = document.getElementById('auth-bar');
        const existingNotice = document.querySelector('.read-only-notice');
        if (this.isReadOnly && !existingNotice && authBar) {
            const notice = document.createElement('span');
            notice.className = 'read-only-notice';
            notice.textContent = `Viewing ${this.ownerUsername}'s collection`;
            const rightSection = authBar.querySelector('.right-section');
            if (rightSection) {
                authBar.insertBefore(notice, rightSection);
            }
        } else if (!this.isReadOnly && existingNotice) {
            existingNotice.remove();
        }
    }

    // Clear all owned cards (with confirmation)
    clearAll() {
        const input = prompt('Type "CLEAR" to confirm clearing all checkmarks:');
        if (input === 'CLEAR') {
            this.ownedCards = [];
            this.saveOwned();
            document.querySelectorAll('.card').forEach(c => c.classList.remove('owned'));
            document.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
            this.onOwnedChange();
        } else if (input !== null) {
            alert('Incorrect. Type "CLEAR" exactly to confirm.');
        }
    }

    // Initialize the manager
    async init() {
        // Handle OAuth callback
        if (window.githubSync) {
            await githubSync.handleCallback();
            this.isReadOnly = !this.isOwner();
            this.updateAuthUI();
            githubSync.onAuthChange = async (loggedIn) => {
                this.isReadOnly = !this.isOwner();
                this.updateAuthUI();
                if (loggedIn) {
                    await this.loadOwned();
                    this.onOwnedChange();
                }
            };
        } else {
            this.isReadOnly = true;
        }

        await this.loadOwned();
        this.updateReadOnlyUI();
    }
}

/**
 * Price estimation utilities
 */
const PriceUtils = {
    // Default price guide by card type
    priceGuide: {
        'Base': 1, 'Base RC': 1.5, 'Base Rookie': 1.5,
        'Parallel': 5, 'Insert': 4, 'Insert SSP': 50,
        'Chase SSP': 100,
    },

    // Set-specific price modifiers
    setMods: {
        'Score': 0.5, 'Donruss': 0.8, 'Prizm': 2, 'Select': 1.5, 'Mosaic': 1.2,
        'Optic': 1.8, 'Chrome': 2.5, 'Origins': 2, 'Contenders': 1.5, 'Phoenix': 1.2,
        'Leaf': 0.5, 'SAGE': 0.3, 'Wild Card': 0.4, 'Bowman': 1, 'Topps Now': 3,
        'Cosmic Chrome': 2, 'Certified': 1, 'Luminance': 1, 'Prestige': 0.8,
        'Chronicles': 0.8, 'Absolute': 1, 'Zenith': 1, 'Rookies & Stars': 1,
        'Totally Certified': 1, 'Gold Standard': 1.5, 'Illusions': 1
    },

    // Estimate price for a card
    estimate(card) {
        // If card has explicit price, use it
        if (card.price !== undefined) return card.price;

        let base = this.priceGuide[card.type] || 2;

        // Check set modifiers
        for (const [setKey, mod] of Object.entries(this.setMods)) {
            if (card.set && card.set.includes(setKey)) {
                base *= mod;
                break;
            }
        }

        // Numbered cards are pricier
        if (card.name && card.name.includes('/')) {
            const match = card.name.match(/\/(\d+)/);
            if (match) base *= Math.max(3, 100 / parseInt(match[1]));
        }

        // Special types
        if (card.name) {
            if (card.name.includes('Silver') || card.name.includes('Refractor')) base *= 3;
            if (card.name.includes('Holo')) base *= 2;
            if (card.name.includes('Downtown')) base = 60;
            if (card.name.includes('Gold') && card.name.includes('/')) base *= 5;
        }

        return Math.round(base * 10) / 10;
    },

    // Get price badge CSS class
    getPriceClass(price) {
        if (price < 3) return '';
        if (price < 10) return 'mid';
        return 'high';
    }
};

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

    // Generate eBay search URL
    getEbayUrl(searchTerm) {
        return `https://www.ebay.com/sch/i.html?_nkw=${searchTerm}&_sop=15&LH_BIN=1`;
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
        const priceClass = this.getPriceClass(price, thresholds);
        const displayPrice = Math.max(1, Math.round(price));
        return `<span class="price-badge ${priceClass}">$${displayPrice}</span>`;
    },

    // Render card image with fallback
    renderCardImage(imgSrc, alt, searchUrl) {
        if (imgSrc) {
            return `<a href="${searchUrl}" target="_blank"><img class="card-image" src="${imgSrc}" alt="${alt}" loading="lazy" onerror="this.outerHTML='<a href=\\'${searchUrl}\\' target=\\'_blank\\' class=\\'card-image placeholder\\'>Click to view</a>'"></a>`;
        }
        return `<a href="${searchUrl}" target="_blank" class="card-image placeholder">Click to view on eBay</a>`;
    },

    // Render owned checkbox or badge based on read-only state
    renderOwnedControl(cardId, owned, isReadOnly, onchangeFn = 'toggleOwned') {
        if (!isReadOnly) {
            return `<div class="checkbox-wrapper">
                <input type="checkbox" id="${cardId}" ${owned ? 'checked' : ''} onchange="${onchangeFn}('${cardId}', this)">
                <label for="${cardId}">Owned</label>
            </div>`;
        }
        return owned ? '<span class="owned-badge">✓ Owned</span>' : '';
    },

    // Render search links (eBay only, or eBay + SCP)
    renderSearchLinks(searchUrl, scpUrl = null) {
        if (scpUrl) {
            return `<span class="search-links"><a href="${searchUrl}" target="_blank" class="search-link">eBay</a> · <a href="${scpUrl}" target="_blank" class="search-link">Prices</a></span>`;
        }
        return `<a href="${searchUrl}" target="_blank" class="search-link">eBay</a>`;
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
            if (stats.neededValue) stats.neededValue.el.textContent = '$' + stats.neededValue.value + ' needed';
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
        if (stats.ownedValue && stats.neededValue) {
            setTimeout(() => {
                this.animateValue(stats.ownedValue.el, 0, stats.ownedValue.value, 1000, '$', ' owned');
                this.animateValue(stats.neededValue.el, 0, stats.neededValue.value, 1000, '$', ' needed');
            }, 550);
        }
    },

    // Reset animation state (useful for testing)
    reset() {
        this.hasAnimated = false;
    }
};

/**
 * Edit Mode Manager - handles edit mode state and UI
 */
class EditModeManager {
    constructor(checklistManager) {
        this.checklistManager = checklistManager;
        this.isEditMode = false;
        this.onEditModeChange = null;
        this.editButton = null;
    }

    // Initialize edit mode UI (call after checklistManager.init())
    init() {
        this.createEditButton();
        this.updateEditButton();

        // Listen for auth changes to show/hide edit button
        if (this.checklistManager) {
            const originalOnAuthChange = window.githubSync?.onAuthChange;
            if (window.githubSync) {
                window.githubSync.onAuthChange = async (loggedIn) => {
                    if (originalOnAuthChange) await originalOnAuthChange(loggedIn);
                    this.updateEditButton();
                    // Exit edit mode if logged out
                    if (!loggedIn && this.isEditMode) {
                        this.toggleEditMode();
                    }
                };
            }
        }
    }

    // Create the edit button in the nav
    createEditButton() {
        const navAuth = document.querySelector('.nav-auth');
        if (!navAuth || document.getElementById('edit-mode-btn')) return;

        this.editButton = document.createElement('button');
        this.editButton.id = 'edit-mode-btn';
        this.editButton.className = 'nav-btn edit-btn';
        this.editButton.innerHTML = '✏️ Edit';
        this.editButton.style.display = 'none';
        this.editButton.onclick = () => this.toggleEditMode();

        // Insert before auth content
        const authContent = document.getElementById('auth-content');
        if (authContent) {
            navAuth.insertBefore(this.editButton, authContent);
        } else {
            navAuth.appendChild(this.editButton);
        }
    }

    // Show/hide edit button based on owner status
    updateEditButton() {
        if (!this.editButton) return;

        const isOwner = this.checklistManager?.isOwner() || false;
        this.editButton.style.display = isOwner ? '' : 'none';

        // Update button text based on current mode
        this.editButton.innerHTML = this.isEditMode ? '✓ Done' : '✏️ Edit';
        this.editButton.classList.toggle('active', this.isEditMode);
    }

    // Toggle edit mode on/off
    toggleEditMode() {
        if (!this.checklistManager?.isOwner()) return;

        this.isEditMode = !this.isEditMode;
        document.body.classList.toggle('edit-mode', this.isEditMode);
        this.updateEditButton();

        // Update card elements to show edit controls
        this.updateCardEditControls();

        // Fire callback
        if (this.onEditModeChange) {
            this.onEditModeChange(this.isEditMode);
        }
    }

    // Add/remove edit controls on cards
    updateCardEditControls() {
        document.querySelectorAll('.card').forEach(card => {
            const existingBtn = card.querySelector('.card-edit-btn');

            if (this.isEditMode) {
                // Add edit button if not exists
                if (!existingBtn) {
                    const editBtn = document.createElement('button');
                    editBtn.className = 'card-edit-btn';
                    editBtn.innerHTML = '✏️';
                    editBtn.title = 'Edit card';
                    editBtn.onclick = (e) => {
                        e.stopPropagation();
                        this.onCardEdit(card);
                    };
                    card.appendChild(editBtn);
                }
            } else {
                // Remove edit button
                if (existingBtn) {
                    existingBtn.remove();
                }
            }
        });
    }

    // Handle card edit click (to be overridden by page)
    onCardEdit(cardElement) {
        // Get card ID from the checkbox or data attribute
        const checkbox = cardElement.querySelector('input[type="checkbox"]');
        const cardId = checkbox?.id || cardElement.dataset.cardId;
        console.log('Edit card:', cardId);

        // This will be overridden to open the editor modal
        if (this.onCardEditClick) {
            this.onCardEditClick(cardId, cardElement);
        }
    }
}

/**
 * Card Editor Modal - handles card editing UI
 */
class CardEditorModal {
    constructor(options = {}) {
        this.onSave = options.onSave || (() => {});
        this.onDelete = options.onDelete || (() => {});
        this.cardTypes = options.cardTypes || CARD_TYPES;
        this.showPlayerField = options.showPlayerField !== false; // default true
        this.currentCard = null;
        this.currentCardId = null;
        this.isDirty = false;
        this.backdrop = null;
        this.isNewCard = false;
    }

    // Initialize - create modal DOM
    init() {
        if (document.querySelector('.card-editor-backdrop')) return;

        const backdrop = document.createElement('div');
        backdrop.className = 'card-editor-backdrop';
        backdrop.innerHTML = `
            <div class="card-editor-modal">
                <div class="card-editor-header">
                    <h2 class="card-editor-title">EDIT CARD</h2>
                    <div class="card-editor-subtitle">Update card details</div>
                    <button class="card-editor-close" title="Close">×</button>
                </div>
                <div class="card-editor-body">
                    <div class="card-editor-grid">
                        ${this.showPlayerField ? `<div class="card-editor-field full-width">
                            <label class="card-editor-label">Player Name</label>
                            <input type="text" class="card-editor-input" id="editor-player" placeholder="Player name">
                        </div>` : ''}
                        <div class="card-editor-field full-width">
                            <label class="card-editor-label">Set Name</label>
                            <input type="text" class="card-editor-input" id="editor-set" placeholder="2024 Panini Prizm">
                        </div>
                        <div class="card-editor-field">
                            <label class="card-editor-label">Card Number</label>
                            <input type="text" class="card-editor-input" id="editor-num" placeholder="123">
                        </div>
                        <div class="card-editor-field">
                            <label class="card-editor-label">Card Type</label>
                            <select class="card-editor-select" id="editor-type">
                                ${this.cardTypes.map(t => `<option value="${t}">${t}</option>`).join('')}
                            </select>
                        </div>
                        <div class="card-editor-field">
                            <label class="card-editor-label">Autographed</label>
                            <label class="card-editor-checkbox">
                                <input type="checkbox" id="editor-auto">
                                <span>Auto</span>
                            </label>
                        </div>
                        <div class="card-editor-field full-width">
                            <label class="card-editor-label">Card Name / Variant</label>
                            <input type="text" class="card-editor-input" id="editor-name" placeholder="Silver Prizm /199">
                        </div>
                        <div class="card-editor-field full-width">
                            <label class="card-editor-label">Achievements</label>
                            <input type="text" class="card-editor-input" id="editor-achievement" placeholder="Pro Bowl, Super Bowl Champion">
                        </div>
                        <div class="card-editor-field">
                            <label class="card-editor-label">Price ($)</label>
                            <input type="number" class="card-editor-input" id="editor-price" placeholder="Auto-estimate" step="0.01" min="0">
                        </div>
                        <div class="card-editor-field">
                            <label class="card-editor-label">eBay Search Term</label>
                            <input type="text" class="card-editor-input" id="editor-ebay" placeholder="Auto-generate">
                        </div>
                        <div class="card-editor-field full-width card-editor-image-section">
                            <label class="card-editor-label">Image URL</label>
                            <input type="text" class="card-editor-input" id="editor-img" placeholder="https://...">
                            <div class="card-editor-image-preview">
                                <span class="placeholder">No image</span>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="card-editor-footer">
                    <button class="card-editor-btn delete">Delete</button>
                    <button class="card-editor-btn cancel">Cancel</button>
                    <button class="card-editor-btn save">Save Changes</button>
                </div>
            </div>
        `;

        document.body.appendChild(backdrop);
        this.backdrop = backdrop;

        // Bind events
        this.bindEvents();
    }

    // Bind modal events
    bindEvents() {
        const modal = this.backdrop.querySelector('.card-editor-modal');

        // Close button
        this.backdrop.querySelector('.card-editor-close').onclick = () => this.close();

        // Backdrop click to close
        this.backdrop.onclick = (e) => {
            if (e.target === this.backdrop) this.close();
        };

        // Cancel button
        this.backdrop.querySelector('.card-editor-btn.cancel').onclick = () => this.close();

        // Save button
        this.backdrop.querySelector('.card-editor-btn.save').onclick = () => this.save();

        // Delete button
        this.backdrop.querySelector('.card-editor-btn.delete').onclick = () => this.delete();

        // Track dirty state on input
        modal.querySelectorAll('input, select').forEach(input => {
            input.oninput = () => this.setDirty(true);
        });

        // Image preview on URL change
        this.backdrop.querySelector('#editor-img').oninput = (e) => {
            this.updateImagePreview(e.target.value);
        };

        // Escape key to close
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.backdrop.classList.contains('active')) {
                this.close();
            }
        });
    }

    // Update image preview
    updateImagePreview(url) {
        const preview = this.backdrop.querySelector('.card-editor-image-preview');
        if (url && url.startsWith('http')) {
            preview.innerHTML = `<img src="${sanitizeUrl(url)}" alt="Preview" onerror="this.outerHTML='<span class=\\'placeholder\\'>Failed to load</span>'">`;
        } else {
            preview.innerHTML = '<span class="placeholder">No image</span>';
        }
    }

    // Set dirty state
    setDirty(dirty) {
        this.isDirty = dirty;
        this.backdrop.querySelector('.card-editor-modal').classList.toggle('dirty', dirty);
    }

    // Open modal for editing existing card
    open(cardId, cardData) {
        this.init();
        this.currentCardId = cardId;
        this.currentCard = cardData;
        this.isNewCard = false;

        // Update title
        this.backdrop.querySelector('.card-editor-title').textContent = 'EDIT CARD';
        this.backdrop.querySelector('.card-editor-subtitle').textContent = 'Update card details';
        this.backdrop.querySelector('.card-editor-btn.save').textContent = 'Save Changes';
        this.backdrop.querySelector('.card-editor-btn.delete').style.display = '';

        // Populate form
        const playerField = this.backdrop.querySelector('#editor-player');
        if (playerField) playerField.value = cardData.player || '';
        this.backdrop.querySelector('#editor-set').value = cardData.set || '';
        // Strip # from card number for editing
        this.backdrop.querySelector('#editor-num').value = (cardData.num || '').replace(/^#/, '');
        this.backdrop.querySelector('#editor-name').value = cardData.name || '';
        this.backdrop.querySelector('#editor-type').value = cardData.type || 'Base';
        this.backdrop.querySelector('#editor-auto').checked = cardData.auto || false;
        this.backdrop.querySelector('#editor-achievement').value = Array.isArray(cardData.achievement)
            ? cardData.achievement.join(', ')
            : (cardData.achievement || '');
        this.backdrop.querySelector('#editor-price').value = cardData.price !== undefined ? cardData.price : '';
        this.backdrop.querySelector('#editor-ebay').value = cardData.ebay || cardData.search || '';
        this.backdrop.querySelector('#editor-img').value = cardData.img || '';

        this.updateImagePreview(cardData.img);
        this.setDirty(false);

        // Show modal
        this.backdrop.classList.add('active');
        // Focus first field
        const firstField = playerField || this.backdrop.querySelector('#editor-set');
        firstField.focus();
    }

    // Open modal for adding new card
    openNew(category = null) {
        this.init();
        this.currentCardId = null;
        this.currentCard = { category };
        this.isNewCard = true;

        // Update title
        this.backdrop.querySelector('.card-editor-title').textContent = 'ADD NEW CARD';
        this.backdrop.querySelector('.card-editor-subtitle').textContent = category ? `Adding to ${category}` : 'Create a new card';
        this.backdrop.querySelector('.card-editor-btn.save').textContent = 'Add Card';
        this.backdrop.querySelector('.card-editor-btn.delete').style.display = 'none';

        // Clear form
        this.backdrop.querySelectorAll('input').forEach(input => input.value = '');
        this.backdrop.querySelector('#editor-type').value = 'Base';
        this.updateImagePreview('');
        this.setDirty(false);

        // Show modal
        this.backdrop.classList.add('active');
        this.backdrop.querySelector('#editor-set').focus();
    }

    // Close modal
    close() {
        if (this.isDirty) {
            if (!confirm('You have unsaved changes. Close anyway?')) return;
        }
        this.backdrop.classList.remove('active');
        this.currentCard = null;
        this.currentCardId = null;
        this.isNewCard = false;
    }

    // Gather form data
    getFormData() {
        // Add # prefix to card number if not present
        let num = this.backdrop.querySelector('#editor-num').value.trim();
        if (num && !num.startsWith('#')) {
            num = '#' + num;
        }

        const data = {
            set: this.backdrop.querySelector('#editor-set').value.trim(),
            num: num,
            name: this.backdrop.querySelector('#editor-name').value.trim(),
            type: this.backdrop.querySelector('#editor-type').value,
            img: this.backdrop.querySelector('#editor-img').value.trim()
        };

        // Player - only include if field exists and has value
        const playerField = this.backdrop.querySelector('#editor-player');
        if (playerField && playerField.value.trim()) {
            data.player = playerField.value.trim();
        }

        // Auto - only include if checked
        if (this.backdrop.querySelector('#editor-auto').checked) {
            data.auto = true;
        }

        // Achievement - parse comma-separated, only include if set
        const achievementVal = this.backdrop.querySelector('#editor-achievement').value.trim();
        if (achievementVal) {
            data.achievement = achievementVal.split(',').map(a => a.trim()).filter(a => a);
        };

        // Price - only include if explicitly set
        const priceVal = this.backdrop.querySelector('#editor-price').value.trim();
        if (priceVal !== '') {
            data.price = parseFloat(priceVal);
        }

        // eBay search term - only include if explicitly set
        const ebayVal = this.backdrop.querySelector('#editor-ebay').value.trim();
        if (ebayVal !== '') {
            data.ebay = ebayVal;
        }

        // Preserve category if editing
        if (this.currentCard && this.currentCard.category) {
            data.category = this.currentCard.category;
        }

        return data;
    }

    // Validate form
    validate() {
        const data = this.getFormData();
        if (!data.set) {
            alert('Set name is required');
            this.backdrop.querySelector('#editor-set').focus();
            return false;
        }
        if (!data.num) {
            alert('Card number is required');
            this.backdrop.querySelector('#editor-num').focus();
            return false;
        }
        return true;
    }

    // Save card
    save() {
        if (!this.validate()) return;

        const data = this.getFormData();

        if (this.isNewCard) {
            this.onSave(null, data, true);
        } else {
            this.onSave(this.currentCardId, data, false);
        }

        this.setDirty(false);
        this.backdrop.classList.remove('active');
    }

    // Delete card
    delete() {
        if (!this.currentCardId) return;

        const confirmText = prompt('Type "DELETE" to confirm removing this card:');
        if (confirmText === 'DELETE') {
            this.onDelete(this.currentCardId);
            this.setDirty(false);
            this.backdrop.classList.remove('active');
        } else if (confirmText !== null) {
            alert('Type "DELETE" exactly to confirm.');
        }
    }
}

/**
 * Add Card Button - floating button to add new cards in edit mode
 */
class AddCardButton {
    constructor(options = {}) {
        this.onClick = options.onClick || (() => {});
        this.button = null;
    }

    init() {
        if (document.querySelector('.add-card-fab')) return;

        const btn = document.createElement('button');
        btn.className = 'add-card-fab';
        btn.innerHTML = '+ Add Card';
        btn.title = 'Add new card';
        btn.style.display = 'none';
        btn.onclick = () => this.onClick();

        document.body.appendChild(btn);
        this.button = btn;
    }

    show() {
        if (!this.button) this.init();
        this.button.style.display = '';
    }

    hide() {
        if (this.button) {
            this.button.style.display = 'none';
        }
    }
}

// Export for use in pages
window.CARD_TYPES = CARD_TYPES;
window.ChecklistManager = ChecklistManager;
window.PriceUtils = PriceUtils;
window.FilterUtils = FilterUtils;
window.CardRenderer = CardRenderer;
window.StatsAnimator = StatsAnimator;
window.EditModeManager = EditModeManager;
window.CardEditorModal = CardEditorModal;
window.AddCardButton = AddCardButton;
