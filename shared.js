// Sports Card Checklists - Shared JavaScript Utilities

// R2 image storage base URL
const R2_IMAGE_BASE = 'https://cards-oauth.iammikec.workers.dev/images/';

// Standard card types used across all checklists
const CARD_TYPES = ['Base', 'Insert', 'Chase'];

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
 * Collapsible Sections - Makes section headers clickable to expand/collapse
 * Usage: CollapsibleSections.init() or CollapsibleSections.init({ persist: true, storageKey: 'myPage' })
 */
const CollapsibleSections = {
    init(options = {}) {
        const { persist = false, storageKey = 'collapsedSections' } = options;

        // Find all section and group headers
        const headers = document.querySelectorAll('.section-header, .group-header');

        headers.forEach(header => {
            // Skip if already has onclick handler or explicitly marked non-collapsible
            if (header.onclick || header.dataset.noCollapse) return;

            // Add collapsible class for styling
            header.classList.add('collapsible');

            // Find the associated content and wrap it for animation
            const section = header.closest('.section, [class*="-section"]');
            const sectionId = header.textContent.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
            const wrapper = this.wrapContent(header, section);

            // Restore collapsed state from localStorage (instant, no animation on load)
            if (persist) {
                const collapsed = this.getCollapsedState(storageKey);
                if (collapsed.includes(sectionId)) {
                    header.classList.add('collapsed');
                    if (section) section.classList.remove('expanded');
                    if (wrapper) {
                        wrapper.style.transition = 'none';
                        wrapper.classList.add('collapsed');
                        // Re-enable transition after layout
                        requestAnimationFrame(() => {
                            wrapper.style.transition = '';
                        });
                    }
                }
            }

            // Add click handler
            header.addEventListener('click', () => {
                const isCollapsing = !header.classList.contains('collapsed');
                header.classList.toggle('collapsed');

                if (section) {
                    section.classList.toggle('expanded', !isCollapsing);
                }

                // Toggle content with animation
                if (wrapper) {
                    wrapper.classList.toggle('collapsed', isCollapsing);
                }

                // Persist state
                if (persist) {
                    this.saveCollapsedState(storageKey, sectionId, isCollapsing);
                }
            });
        });
    },

    wrapContent(header, section) {
        // Find content elements to wrap
        const elements = this.getContentElements(header, section);
        if (elements.length === 0) return null;

        // Save insertion point BEFORE moving elements
        const firstElement = elements[0];
        const parent = firstElement.parentNode;

        // Create wrapper for animation
        const wrapper = document.createElement('div');
        wrapper.className = 'collapsible-content';

        // Create inner div (needed for grid animation)
        const inner = document.createElement('div');
        wrapper.appendChild(inner);

        // Insert wrapper right before first element (while it's still in DOM)
        parent.insertBefore(wrapper, firstElement);

        // Now move elements into the inner div
        elements.forEach(el => inner.appendChild(el));

        return wrapper;
    },

    getContentElements(header, section) {
        const elements = [];

        // Check for note immediately after header
        let sibling = header.nextElementSibling;
        if (sibling && (sibling.classList.contains('section-note') || sibling.className.includes('-note'))) {
            elements.push(sibling);
            sibling = sibling.nextElementSibling;
        }

        // Find main content
        if (section) {
            const content = section.querySelector('.section-group, .card-grid');
            if (content && !elements.includes(content)) {
                elements.push(content);
            }
        } else {
            // Walk siblings to find content
            while (sibling) {
                if (sibling.classList.contains('section-group') || sibling.classList.contains('card-grid')) {
                    elements.push(sibling);
                    break;
                }
                if (sibling.classList.contains('section-header') || sibling.classList.contains('group-header')) {
                    break;
                }
                sibling = sibling.nextElementSibling;
            }
        }

        return elements;
    },

    getCollapsedState(key) {
        try {
            return JSON.parse(localStorage.getItem(key)) || [];
        } catch {
            return [];
        }
    },

    saveCollapsedState(key, sectionId, isCollapsed) {
        const collapsed = this.getCollapsedState(key);
        const index = collapsed.indexOf(sectionId);
        if (isCollapsed && index === -1) {
            collapsed.push(sectionId);
        } else if (!isCollapsed && index !== -1) {
            collapsed.splice(index, 1);
        }
        localStorage.setItem(key, JSON.stringify(collapsed));
    }
};

/**
 * Shared Auth UI helpers (for pages without ChecklistManager)
 */
const AuthUI = {
    ICON_LOGOUT: '<svg viewBox="0 0 24 24"><path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/></svg>',
    ICON_SYNC: '<svg viewBox="0 0 24 24"><path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/></svg>',

    update(logoutFn = () => { githubSync.logout(); location.reload(); }) {
        const authContent = document.getElementById('auth-content');
        if (!authContent || !window.githubSync) return;

        if (githubSync.isLoggedIn()) {
            const user = githubSync.getUser();
            const safeAvatarUrl = sanitizeUrl(user.avatar_url);
            const safeLogin = sanitizeText(user.login);
            const isPreview = githubSync.isPreview();
            const syncButton = isPreview ? `
                    <button class="nav-dropdown-item" id="sync-from-prod-btn">
                        ${this.ICON_SYNC}
                        Sync from Production
                    </button>
                    <div class="nav-dropdown-divider"></div>` : '';
            authContent.innerHTML = `
                <button class="nav-avatar-btn" id="nav-avatar-btn">
                    <img src="${safeAvatarUrl}" alt="${safeLogin}">
                </button>
                <div class="nav-dropdown" id="nav-dropdown">
                    <div class="nav-dropdown-header">
                        <img src="${safeAvatarUrl}" alt="">
                        <span>${safeLogin}</span>
                    </div>
                    ${syncButton}
                    <button class="nav-dropdown-item" id="auth-logout-btn">
                        ${this.ICON_LOGOUT}
                        Sign out
                    </button>
                    <div class="nav-dropdown-footer" id="commit-hash"></div>
                </div>
            `;
            // Toggle dropdown
            const avatarBtn = document.getElementById('nav-avatar-btn');
            const dropdown = document.getElementById('nav-dropdown');
            avatarBtn.onclick = (e) => {
                e.stopPropagation();
                avatarBtn.classList.toggle('menu-open');
                dropdown.classList.toggle('open');
            };
            // Close on outside click
            document.addEventListener('click', () => {
                avatarBtn.classList.remove('menu-open');
                dropdown.classList.remove('open');
            });
            document.getElementById('auth-logout-btn').onclick = logoutFn;
            // Sync button (preview only)
            const syncBtn = document.getElementById('sync-from-prod-btn');
            if (syncBtn) {
                syncBtn.onclick = async () => {
                    if (!confirm('This will overwrite all preview data with production data. Continue?')) return;
                    syncBtn.disabled = true;
                    syncBtn.innerHTML = `${this.ICON_SYNC} Syncing...`;
                    try {
                        await githubSync.syncFromProduction();
                        alert('Preview data synced from production!');
                        location.reload();
                    } catch (e) {
                        alert('Sync failed: ' + e.message);
                        syncBtn.disabled = false;
                        syncBtn.innerHTML = `${this.ICON_SYNC} Sync from Production`;
                    }
                };
            }
            this.loadCommitHash();
        } else {
            authContent.innerHTML = '';
        }
    },

    async loadCommitHash() {
        try {
            const response = await fetch('version.json');
            const data = await response.json();
            const el = document.getElementById('commit-hash');
            if (el) {
                el.innerHTML = `<a href="${data.url}" target="_blank">${data.commit}</a>`;
            }
        } catch (e) {
            // Silently fail - version.json may not exist locally
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
        // Allow custom ID field, otherwise generate from set+num+variant
        if (card.id) return card.id;
        const str = (card.set || '') + (card.num || '') + (card.variant || '');
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

    // Update nav auth UI with dropdown menu
    updateAuthUI() {
        const authContent = document.getElementById('auth-content');
        if (!authContent || !window.githubSync) return;

        if (githubSync.isLoggedIn()) {
            const user = githubSync.getUser();
            const safeAvatarUrl = sanitizeUrl(user.avatar_url);
            const safeLogin = sanitizeText(user.login);
            const isOwner = this.isOwner();
            const isPreview = githubSync.isPreview();

            const ownerItemsHtml = isOwner ? `
                <button class="nav-dropdown-item" id="add-card-btn">
                    <svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
                    Add card
                </button>
                <button class="nav-dropdown-item danger" id="clear-all-btn">
                    <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                    Clear All
                </button>
                <div class="nav-dropdown-divider"></div>
            ` : '';

            const syncButtonHtml = isPreview ? `
                <button class="nav-dropdown-item" id="sync-from-prod-btn">
                    <svg viewBox="0 0 24 24"><path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/></svg>
                    Sync from Production
                </button>
                <div class="nav-dropdown-divider"></div>
            ` : '';

            authContent.innerHTML = `
                <button class="nav-avatar-btn" id="nav-avatar-btn">
                    <img src="${safeAvatarUrl}" alt="${safeLogin}">
                </button>
                <div class="nav-dropdown" id="nav-dropdown">
                    <div class="nav-dropdown-header">
                        <img src="${safeAvatarUrl}" alt="">
                        <span>${safeLogin}</span>
                    </div>
                    ${ownerItemsHtml}
                    ${syncButtonHtml}
                    <button class="nav-dropdown-item" id="auth-logout-btn">
                        <svg viewBox="0 0 24 24"><path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/></svg>
                        Sign out
                    </button>
                    <div class="nav-dropdown-footer" id="commit-hash"></div>
                </div>
            `;

            // Fetch commit hash
            this.loadCommitHash();

            // Toggle dropdown
            const avatarBtn = document.getElementById('nav-avatar-btn');
            const dropdown = document.getElementById('nav-dropdown');
            avatarBtn.onclick = (e) => {
                e.stopPropagation();
                avatarBtn.classList.toggle('menu-open');
                dropdown.classList.toggle('open');
            };
            // Close on outside click
            document.addEventListener('click', () => {
                avatarBtn.classList.remove('menu-open');
                dropdown.classList.remove('open');
            });
            document.getElementById('auth-logout-btn').onclick = () => this.logout();
            const clearAllBtn = document.getElementById('clear-all-btn');
            if (clearAllBtn) clearAllBtn.onclick = () => this.clearAll();
            // Sync button (preview only)
            const syncBtn = document.getElementById('sync-from-prod-btn');
            if (syncBtn) {
                syncBtn.onclick = async () => {
                    if (!confirm('This will overwrite all preview data with production data. Continue?')) return;
                    syncBtn.disabled = true;
                    syncBtn.textContent = 'Syncing...';
                    try {
                        await githubSync.syncFromProduction();
                        alert('Preview data synced from production!');
                        location.reload();
                    } catch (e) {
                        alert('Sync failed: ' + e.message);
                        syncBtn.disabled = false;
                        syncBtn.textContent = 'Sync from Production';
                    }
                };
            }
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

    // Load and display commit hash in dropdown
    async loadCommitHash() {
        try {
            const response = await fetch('version.json');
            const data = await response.json();
            const el = document.getElementById('commit-hash');
            if (el) {
                el.innerHTML = `<a href="${data.url}" target="_blank">${data.commit}</a>`;
            }
        } catch (e) {
            // Silently fail - version.json may not exist locally
        }
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
        const input = prompt('This will clear all ownership data for this checklist.\n\nType "CLEAR" to confirm:');
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
        'Base': 1, 'Insert': 4, 'Chase': 15,
    },

    // Set-specific price modifiers (longest names first to avoid partial matches)
    setMods: [
        ['Donruss Optic', 1.3], ['Donruss Elite', 1.5], ['Cosmic Chrome', 2],
        ['Topps Chrome', 2.5], ['Topps Now', 3], ['Totally Certified', 1],
        ['Rookies & Stars', 1], ['Gold Standard', 1.5], ['Wild Card', 0.4],
        ['Prizm', 2], ['Select', 1.5], ['Mosaic', 1.2], ['Donruss', 0.8],
        ['Optic', 1.3], ['Chrome', 2.5], ['Origins', 5], ['Contenders', 2.5],
        ['Phoenix', 1.2], ['Absolute', 0.7], ['Score', 0.5], ['Leaf', 0.5],
        ['SAGE', 0.3], ['Bowman', 1], ['Certified', 1], ['Luminance', 1],
        ['Prestige', 0.8], ['Chronicles', 0.8], ['Zenith', 1],
        ['Illusions', 1],
    ],

    // High-value variant/insert overrides (checked against set name)
    variantPricing: [
        [/Color Blast/i, 500], [/Kaboom/i, 200], [/Downtown/i, 60],
        [/Stained Glass/i, 40],
    ],

    // Parse serial string (e.g., "/99", "99", "1/1") to numeric print run
    parseSerial(serial) {
        if (!serial) return null;
        // Try "/99" format first, then bare number "99"
        const slashMatch = serial.match(/\/(\d+)/);
        if (slashMatch) return parseInt(slashMatch[1], 10);
        const bareMatch = serial.match(/^(\d+)$/);
        return bareMatch ? parseInt(bareMatch[1], 10) : null;
    },

    // Estimate price for a card
    estimate(card) {
        // If card has explicit price, use it
        if (card.price !== undefined) return card.price;

        let base = this.priceGuide[card.type] || 1;

        // Check set modifiers (ordered longest-first to avoid partial matches)
        for (const [setKey, mod] of this.setMods) {
            if (card.set && card.set.includes(setKey)) {
                base *= mod;
                break;
            }
        }

        // Numbered cards
        const printRun = this.parseSerial(card.serial);
        if (printRun) {
            if (printRun === 1) {
                base *= 200;
            } else {
                base *= Math.max(3, Math.pow(100 / printRun, 1.3));
            }
        }

        // Patch/relic cards (check flag or detect from variant)
        const variantStr = card.variant || '';
        if (card.patch || /Swatch|Jersey|Relic|Memorabilia|Patch/i.test(variantStr)) {
            base *= 2;
        }

        // Autographed cards
        if (card.auto) {
            base *= 5;
        }

        // RC multiplier
        if (card.rc) {
            base *= 1.5;
        }

        // High-value variant/insert overrides (check set name for insert names)
        const checkStr = (card.variant || '') + ' ' + (card.set || '');
        for (const [pattern, price] of this.variantPricing) {
            if (pattern.test(checkStr)) {
                base = Math.max(base, price);
                break;
            }
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

    // Render all attribute badges for a card (only those enabled in customFields)
    renderAttributeBadges(card, customFields) {
        let html = '';
        if (!customFields || customFields.auto) html += this.renderAutoBadge(card);
        if (!customFields || customFields.patch) html += this.renderPatchBadge(card);
        if (!customFields || customFields.serial) html += this.renderSerialBadge(card);
        return html;
    },

    // Render card image with fallback
    renderCardImage(imgSrc, alt, searchUrl) {
        if (imgSrc) {
            return `<a href="${searchUrl}" target="_blank"><img class="card-image" src="${imgSrc}" alt="${alt}" loading="lazy" onerror="this.outerHTML='<a href=\\'${searchUrl}\\' target=\\'_blank\\' class=\\'card-image placeholder\\'>No image</a>'"></a>`;
        }
        return `<a href="${searchUrl}" target="_blank" class="card-image placeholder">No image</a>`;
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
 * Card Context Menu - right-click menu for editing/deleting cards
 */
class CardContextMenu {
    constructor(checklistManager) {
        this.checklistManager = checklistManager;
        this.menu = null;
        this.currentCard = null;
        this.currentCardId = null;
        this.onEdit = null;
        this.onDelete = null;
        this.onAddCard = null;
    }

    // SVG icons
    static ICON_EDIT = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';
    static ICON_DELETE = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';

    // Initialize context menu
    init() {
        this.createMenu();
        this.attachCardListeners();
        this.attachAddCardButton();
    }

    // Create the context menu element
    createMenu() {
        this.menu = document.createElement('div');
        this.menu.className = 'card-context-menu';
        this.menu.innerHTML = `
            <button class="context-menu-item" data-action="edit">
                ${CardContextMenu.ICON_EDIT}
                <span>Edit card</span>
            </button>
            <button class="context-menu-item danger" data-action="delete">
                ${CardContextMenu.ICON_DELETE}
                <span>Delete card</span>
            </button>
        `;
        document.body.appendChild(this.menu);

        // Handle menu item clicks
        this.menu.addEventListener('click', (e) => {
            const item = e.target.closest('.context-menu-item');
            if (!item) return;

            const action = item.dataset.action;
            if (action === 'edit' && this.onEdit) {
                this.onEdit(this.currentCardId, this.currentCard);
            } else if (action === 'delete' && this.onDelete) {
                if (confirm('Delete this card?')) {
                    this.onDelete(this.currentCardId);
                }
            }
            this.hide();
        });
    }

    // Attach right-click and long-press listeners to cards (uses event delegation)
    attachCardListeners() {
        // Right-click (desktop)
        document.addEventListener('contextmenu', (e) => {
            if (!this.checklistManager?.isOwner()) return;

            const card = e.target.closest('.card');
            if (!card) return;

            e.preventDefault();
            this.show(e.clientX, e.clientY, card);
        });

        // Long-press (mobile) - 500ms touch and hold
        let longPressTimer = null;
        let touchStartPos = null;
        const LONG_PRESS_DURATION = 500;
        const MOVE_THRESHOLD = 10; // pixels

        document.addEventListener('touchstart', (e) => {
            if (!this.checklistManager?.isOwner()) return;

            const card = e.target.closest('.card');
            if (!card) return;

            const touch = e.touches[0];
            touchStartPos = { x: touch.clientX, y: touch.clientY };

            longPressTimer = setTimeout(() => {
                // Vibrate if supported (haptic feedback)
                if (navigator.vibrate) navigator.vibrate(50);
                this.show(touch.clientX, touch.clientY, card);
                longPressTimer = null;
            }, LONG_PRESS_DURATION);
        }, { passive: true });

        document.addEventListener('touchmove', (e) => {
            if (!longPressTimer || !touchStartPos) return;

            const touch = e.touches[0];
            const dx = Math.abs(touch.clientX - touchStartPos.x);
            const dy = Math.abs(touch.clientY - touchStartPos.y);

            // Cancel if finger moved too far
            if (dx > MOVE_THRESHOLD || dy > MOVE_THRESHOLD) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
            }
        }, { passive: true });

        document.addEventListener('touchend', () => {
            if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
            }
        });

        // Hide menu on click/tap outside or ESC
        document.addEventListener('click', (e) => {
            if (!this.menu.contains(e.target)) {
                this.hide();
            }
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this.hide();
        });
    }

    // Show menu at position
    show(x, y, cardElement) {
        // Get card ID from checkbox or data attribute
        const checkbox = cardElement.querySelector('input[type="checkbox"]');
        this.currentCardId = checkbox?.id || cardElement.dataset.cardId;
        this.currentCard = cardElement;

        // Position menu
        this.menu.style.left = `${x}px`;
        this.menu.style.top = `${y}px`;
        this.menu.classList.add('visible');

        // Adjust if menu goes off screen
        requestAnimationFrame(() => {
            const rect = this.menu.getBoundingClientRect();
            if (rect.right > window.innerWidth) {
                this.menu.style.left = `${x - rect.width}px`;
            }
            if (rect.bottom > window.innerHeight) {
                this.menu.style.top = `${y - rect.height}px`;
            }
        });
    }

    // Hide menu
    hide() {
        if (this.menu) {
            this.menu.classList.remove('visible');
        }
        this.currentCard = null;
        this.currentCardId = null;
    }

    // Attach Add Card button in nav dropdown
    attachAddCardButton() {
        const addBtn = document.getElementById('add-card-btn');
        if (!addBtn) return;

        addBtn.onclick = (e) => {
            e.stopPropagation();
            // Close dropdown
            document.getElementById('nav-avatar-btn')?.classList.remove('menu-open');
            document.getElementById('nav-dropdown')?.classList.remove('open');
            // Trigger add card
            if (this.onAddCard) {
                this.onAddCard();
            }
        };
    }
}

/**
 * Image Processor - handles fetching, resizing, and converting images
 */
class ImageProcessor {
    constructor() {
        this.proxyUrl = 'https://cards-oauth.iammikec.workers.dev/proxy-image';
        this.maxSize = 800;      // Max width/height in pixels
        this.quality = 0.6;      // WebP quality (0-1)
        this.sharpen = 0.5;      // Sharpen amount (0-1)
        this.smooth = 0.2;       // Smooth/anti-alias amount (0-1)
        this.resizeQuality = 'high'; // Canvas resize quality
        this.allowedDomains = ['ebay', 'beckett'];
    }

    // Check if URL is from a supported image domain
    isProcessableUrl(url) {
        if (!url) return false;
        try {
            const parsed = new URL(url);
            return this.allowedDomains.some(domain => parsed.hostname.includes(domain));
        } catch {
            return false;
        }
    }

    // Fetch image via proxy to bypass CORS
    async fetchViaProxy(url) {
        const response = await fetch(this.proxyUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to fetch image');
        }

        return response.json(); // { base64, contentType }
    }

    // Load image from base64 data
    loadImage(base64, contentType) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('Failed to load image'));
            img.src = `data:${contentType};base64,${base64}`;
        });
    }

    // Sharpen filter (unsharp mask)
    sharpenCanvas(ctx, width, height, amount) {
        if (amount <= 0) return;

        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;
        const copy = new Uint8ClampedArray(data);

        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const i = (y * width + x) * 4;
                for (let c = 0; c < 3; c++) {
                    const idx = i + c;
                    const top = copy[idx - width * 4];
                    const bottom = copy[idx + width * 4];
                    const left = copy[idx - 4];
                    const right = copy[idx + 4];
                    const center = copy[idx];
                    const blur = (top + bottom + left + right) / 4;
                    const sharpened = center + amount * (center - blur);
                    data[idx] = Math.max(0, Math.min(255, sharpened));
                }
            }
        }
        ctx.putImageData(imageData, 0, 0);
    }

    // Smooth/anti-alias filter
    smoothCanvas(ctx, width, height, amount) {
        if (amount <= 0) return;

        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;
        const copy = new Uint8ClampedArray(data);

        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const i = (y * width + x) * 4;
                for (let c = 0; c < 3; c++) {
                    const idx = i + c;
                    const tl = copy[idx - width * 4 - 4];
                    const t  = copy[idx - width * 4];
                    const tr = copy[idx - width * 4 + 4];
                    const l  = copy[idx - 4];
                    const center = copy[idx];
                    const r  = copy[idx + 4];
                    const bl = copy[idx + width * 4 - 4];
                    const b  = copy[idx + width * 4];
                    const br = copy[idx + width * 4 + 4];
                    const avg = (tl + t + tr + l + center + r + bl + b + br) / 9;
                    const smoothed = center * (1 - amount) + avg * amount;
                    data[idx] = Math.max(0, Math.min(255, smoothed));
                }
            }
        }
        ctx.putImageData(imageData, 0, 0);
    }

    // Resize and convert to WebP using canvas
    async processImage(img) {
        // Calculate new dimensions maintaining aspect ratio
        let width = img.width;
        let height = img.height;

        if (width > this.maxSize || height > this.maxSize) {
            if (width > height) {
                height = Math.round(height * (this.maxSize / width));
                width = this.maxSize;
            } else {
                width = Math.round(width * (this.maxSize / height));
                height = this.maxSize;
            }
        }

        // Create canvas and draw resized image
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = this.resizeQuality;
        ctx.drawImage(img, 0, 0, width, height);

        // Apply sharpen then smooth
        this.sharpenCanvas(ctx, width, height, this.sharpen);
        this.smoothCanvas(ctx, width, height, this.smooth);

        // Convert to WebP
        const dataUrl = canvas.toDataURL('image/webp', this.quality);
        // Extract base64 content (remove data URL prefix)
        const base64 = dataUrl.split(',')[1];

        return { base64, width, height };
    }

    // Generate filename from card data
    generateFilename(cardData, addTimestamp = false) {
        const parts = [];

        // Set name (required)
        if (cardData.set) {
            parts.push(cardData.set.toLowerCase().replace(/\s+/g, '_'));
        }

        // Card name/variant if present
        if (cardData.name) {
            parts.push(cardData.name.toLowerCase().replace(/\s+/g, '_').replace(/\//g, '-'));
        }

        // Card number
        if (cardData.num) {
            parts.push(cardData.num.replace('#', ''));
        }

        // Add short timestamp suffix to avoid filename collisions when re-uploading
        if (addTimestamp) {
            parts.push(Date.now().toString(36));
        }

        // Create filename, sanitize for filesystem
        const name = parts.join('_').replace(/[^a-z0-9_-]/g, '');
        return `${name}.webp`;
    }

    // Full pipeline: fetch, process, return base64 content (for committing)
    async processFromUrl(url) {
        // Fetch via proxy
        const { base64: rawBase64, contentType } = await this.fetchViaProxy(url);

        // Load into image element
        const img = await this.loadImage(rawBase64, contentType);

        // Resize and convert to WebP
        const { base64 } = await this.processImage(img);

        // Return base64 content (not data URL) for GitHub commit
        return base64;
    }

    // Process a local/existing image URL (for conversion script)
    async processFromLocalUrl(url) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = async () => {
                try {
                    const { base64 } = await this.processImage(img);
                    resolve(`data:image/webp;base64,${base64}`);
                } catch (e) {
                    reject(e);
                }
            };
            img.onerror = () => reject(new Error('Failed to load image'));
            img.src = url;
        });
    }
}

/**
 * Perspective transform math - 4-point homography with bilinear interpolation
 */
const PerspectiveTransform = {
    // Solve 8x8 system via Gaussian elimination for homography coefficients
    computeHomography(src, dst) {
        // Build 8x9 augmented matrix (Ah = 0, with h8 = 1)
        const A = [];
        for (let i = 0; i < 4; i++) {
            const sx = src[i].x, sy = src[i].y, dx = dst[i].x, dy = dst[i].y;
            A.push([sx, sy, 1, 0, 0, 0, -dx * sx, -dx * sy, dx]);
            A.push([0, 0, 0, sx, sy, 1, -dy * sx, -dy * sy, dy]);
        }
        // Gaussian elimination with partial pivoting
        for (let col = 0; col < 8; col++) {
            let maxRow = col, maxVal = Math.abs(A[col][col]);
            for (let row = col + 1; row < 8; row++) {
                if (Math.abs(A[row][col]) > maxVal) { maxVal = Math.abs(A[row][col]); maxRow = row; }
            }
            [A[col], A[maxRow]] = [A[maxRow], A[col]];
            const pivot = A[col][col];
            if (Math.abs(pivot) < 1e-10) return null;
            for (let j = col; j < 9; j++) A[col][j] /= pivot;
            for (let row = 0; row < 8; row++) {
                if (row === col) continue;
                const factor = A[row][col];
                for (let j = col; j < 9; j++) A[row][j] -= factor * A[col][j];
            }
        }
        return [A[0][8], A[1][8], A[2][8], A[3][8], A[4][8], A[5][8], A[6][8], A[7][8], 1];
    },

    applyHomography(H, x, y) {
        const w = H[6] * x + H[7] * y + H[8];
        return { x: (H[0] * x + H[1] * y + H[2]) / w, y: (H[3] * x + H[4] * y + H[5]) / w };
    },

    bilinearSample(data, w, h, x, y) {
        const x0 = Math.floor(x), y0 = Math.floor(y);
        if (x0 < 0 || y0 < 0 || x0 >= w || y0 >= h) return [0, 0, 0, 0];
        const x1 = Math.min(x0 + 1, w - 1), y1 = Math.min(y0 + 1, h - 1);
        const fx = x - x0, fy = y - y0;
        const i00 = (y0 * w + x0) * 4, i10 = (y0 * w + x1) * 4;
        const i01 = (y1 * w + x0) * 4, i11 = (y1 * w + x1) * 4;
        const d = data;
        return [0, 1, 2, 3].map(c =>
            (1 - fx) * (1 - fy) * d[i00 + c] + fx * (1 - fy) * d[i10 + c] +
            (1 - fx) * fy * d[i01 + c] + fx * fy * d[i11 + c]
        );
    },

    // Apply perspective correction: srcCorners (4 points on source) -> rectangular output
    transform(srcCanvas, srcCorners) {
        const sw = srcCanvas.width, sh = srcCanvas.height;
        const srcCtx = srcCanvas.getContext('2d');
        const srcData = srcCtx.getImageData(0, 0, sw, sh).data;

        // Compute output dimensions from corner distances
        const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
        const outW = Math.round(Math.max(dist(srcCorners[0], srcCorners[1]), dist(srcCorners[3], srcCorners[2])));
        const outH = Math.round(Math.max(dist(srcCorners[0], srcCorners[3]), dist(srcCorners[1], srcCorners[2])));

        const dstCorners = [{ x: 0, y: 0 }, { x: outW, y: 0 }, { x: outW, y: outH }, { x: 0, y: outH }];
        const H = this.computeHomography(dstCorners, srcCorners);
        if (!H) return null;

        const outCanvas = document.createElement('canvas');
        outCanvas.width = outW;
        outCanvas.height = outH;
        const outCtx = outCanvas.getContext('2d');
        const outImg = outCtx.createImageData(outW, outH);

        for (let y = 0; y < outH; y++) {
            for (let x = 0; x < outW; x++) {
                const s = this.applyHomography(H, x, y);
                const pixel = this.bilinearSample(srcData, sw, sh, s.x, s.y);
                const idx = (y * outW + x) * 4;
                outImg.data[idx] = pixel[0];
                outImg.data[idx + 1] = pixel[1];
                outImg.data[idx + 2] = pixel[2];
                outImg.data[idx + 3] = pixel[3];
            }
        }

        outCtx.putImageData(outImg, 0, 0);
        return outCanvas;
    }
};

/**
 * Image Editor Modal - crop and rotate images before processing
 * Uses Cropper.js for crop functionality
 */
class ImageEditorModal {
    constructor() {
        this.backdrop = null;
        this.cropper = null;
        this.currentImage = null;
        this.resolvePromise = null;
        this.rejectPromise = null;
        this.rotation = 0;
        // Perspective mode state
        this.mode = 'crop'; // 'crop' | 'perspective'
        this.perspectiveCanvas = null;
        this.perspectiveOverlay = null;
        this.cornerHandles = [];
        this.cornerPositions = []; // normalized 0-1 coordinates
        this.prePerspectiveSrc = null;
    }

    // Load Cropper.js from CDN if not already loaded
    async loadCropperJS() {
        if (window.Cropper) return;

        // Load CSS
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.6.1/cropper.min.css';
        document.head.appendChild(link);

        // Load JS
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.6.1/cropper.min.js';
            script.onload = resolve;
            script.onerror = () => reject(new Error('Failed to load Cropper.js'));
            document.head.appendChild(script);
        });
    }

    // Initialize - create modal DOM
    init() {
        if (document.querySelector('.image-editor-backdrop')) return;

        const backdrop = document.createElement('div');
        backdrop.className = 'image-editor-backdrop';
        backdrop.innerHTML = `
            <div class="image-editor-modal">
                <div class="image-editor-header">
                    <h2 class="image-editor-title">EDIT IMAGE</h2>
                    <div class="image-editor-subtitle">Crop and rotate before saving</div>
                    <button class="image-editor-close" title="Cancel">×</button>
                </div>
                <div class="image-editor-body">
                    <div class="image-editor-canvas">
                        <img id="image-editor-img" src="" alt="Edit">
                    </div>
                    <div class="image-editor-controls">
                        <div class="image-editor-controls-row">
                            <button class="image-editor-tool" data-action="rotate-left" title="Rotate 90° Left">
                                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M7.11 8.53L5.7 7.11C4.8 8.27 4.24 9.61 4.07 11h2.02c.14-.87.49-1.72 1.02-2.47zM6.09 13H4.07c.17 1.39.72 2.73 1.62 3.89l1.41-1.42c-.52-.75-.87-1.59-1.01-2.47zm1.01 5.32c1.16.9 2.51 1.44 3.9 1.61V17.9c-.87-.15-1.71-.49-2.46-1.03L7.1 18.32zM13 4.07V1L8.45 5.55 13 10V6.09c2.84.48 5 2.94 5 5.91s-2.16 5.43-5 5.91v2.02c3.95-.49 7-3.85 7-7.93s-3.05-7.44-7-7.93z"/></svg>
                            </button>
                            <button class="image-editor-tool" data-action="rotate-right" title="Rotate 90° Right">
                                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M15.55 5.55L11 1v3.07C7.06 4.56 4 7.92 4 12s3.05 7.44 7 7.93v-2.02c-2.84-.48-5-2.94-5-5.91s2.16-5.43 5-5.91V10l4.55-4.45zM19.93 11c-.17-1.39-.72-2.73-1.62-3.89l-1.42 1.42c.54.75.88 1.6 1.02 2.47h2.02zM13 17.9v2.02c1.39-.17 2.74-.71 3.9-1.61l-1.44-1.44c-.75.54-1.59.89-2.46 1.03zm3.89-2.42l1.42 1.41c.9-1.16 1.45-2.5 1.62-3.89h-2.02c-.14.87-.48 1.72-1.02 2.48z"/></svg>
                            </button>
                            <button class="image-editor-step-btn" id="rotate-minus" title="Decrease 0.1°">−</button>
                            <input type="range" class="image-editor-slider" id="image-editor-rotate" min="-45" max="45" value="0" step="0.1">
                            <button class="image-editor-step-btn" id="rotate-plus" title="Increase 0.1°">+</button>
                            <button class="image-editor-tool" data-action="flip-h" title="Flip Horizontal">
                                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M15 21h2v-2h-2v2zm4-12h2V7h-2v2zM3 5v14c0 1.1.9 2 2 2h4v-2H5V5h4V3H5c-1.1 0-2 .9-2 2zm16-2v2h2c0-1.1-.9-2-2-2zm-8 20h2V1h-2v22zm8-6h2v-2h-2v2zM15 5h2V3h-2v2zm4 8h2v-2h-2v2zm0 8c1.1 0 2-.9 2-2h-2v2z"/></svg>
                            </button>
                            <button class="image-editor-tool" data-action="flip-v" title="Flip Vertical">
                                <svg viewBox="0 0 24 24" fill="currentColor" style="transform: rotate(90deg)"><path d="M15 21h2v-2h-2v2zm4-12h2V7h-2v2zM3 5v14c0 1.1.9 2 2 2h4v-2H5V5h4V3H5c-1.1 0-2 .9-2 2zm16-2v2h2c0-1.1-.9-2-2-2zm-8 20h2V1h-2v22zm8-6h2v-2h-2v2zM15 5h2V3h-2v2zm4 8h2v-2h-2v2zm0 8c1.1 0 2-.9 2-2h-2v2z"/></svg>
                            </button>
                        </div>
                        <div class="image-editor-controls-row">
                            <input type="text" class="image-editor-rotation-input" id="image-editor-rotate-value" value="0°" inputmode="decimal">
                        </div>
                    </div>
                    <div class="perspective-controls">
                        <div class="perspective-hint">Drag the corners to match the card edges</div>
                    </div>
                </div>
                <div class="image-editor-footer">
                    <button class="image-editor-tool" data-action="reset" title="Reset All">
                        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/></svg>
                    </button>
                    <button class="image-editor-tool" data-action="perspective" title="Perspective Correction">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 3L19 1L21 21L3 23Z"/><circle cx="5" cy="3" r="1.5" fill="currentColor" stroke="none"/><circle cx="19" cy="1" r="1.5" fill="currentColor" stroke="none"/><circle cx="21" cy="21" r="1.5" fill="currentColor" stroke="none"/><circle cx="3" cy="23" r="1.5" fill="currentColor" stroke="none"/></svg>
                    </button>
                    <div class="image-editor-footer-spacer"></div>
                    <button class="image-editor-btn cancel">Cancel</button>
                    <button class="image-editor-btn confirm">Apply & Continue</button>
                </div>
            </div>
        `;

        document.body.appendChild(backdrop);
        this.backdrop = backdrop;

        this.bindEvents();
    }

    // Bind modal events
    bindEvents() {
        // Close button
        this.backdrop.querySelector('.image-editor-close').onclick = () => this.cancel();

        // Backdrop click to close
        this.backdrop.onclick = (e) => {
            if (e.target === this.backdrop) this.cancel();
        };

        // Cancel button
        this.backdrop.querySelector('.image-editor-btn.cancel').onclick = () => this.cancel();

        // Confirm button
        this.backdrop.querySelector('.image-editor-btn.confirm').onclick = () => this.confirm();

        // Toolbar buttons
        this.backdrop.querySelectorAll('.image-editor-tool').forEach(btn => {
            btn.onclick = () => this.handleToolAction(btn.dataset.action);
        });

        // Rotation slider for fine-grained straightening
        // Track fine rotation value and base rotation separately
        this.fineRotation = 0;
        this.baseRotation = 0;
        const rotateSlider = this.backdrop.querySelector('#image-editor-rotate');
        const rotateInput = this.backdrop.querySelector('#image-editor-rotate-value');
        if (rotateSlider && rotateInput) {
            // Set fine rotation (relative to base from 90° buttons)
            const setFineRotation = (val, updateInput = true) => {
                // Strip ° if present, then parse and round to 1 decimal
                const numVal = parseFloat(String(val).replace('°', '')) || 0;
                const rounded = Math.round(numVal * 10) / 10;
                const clamped = Math.max(-45, Math.min(45, rounded));

                this.fineRotation = clamped;
                rotateSlider.value = clamped;
                if (updateInput) rotateInput.value = clamped + '°';

                // Apply total rotation (base + fine)
                if (this.cropper) {
                    this.cropper.rotateTo(this.baseRotation + this.fineRotation);
                }
            };
            // Store for use in handleToolAction
            this.setFineRotation = setFineRotation;

            // Slider input - update in real-time
            rotateSlider.oninput = () => setFineRotation(rotateSlider.value);

            // Text input - only apply on blur/enter to allow typing "-" and "."
            rotateInput.onchange = () => setFineRotation(rotateInput.value);
            rotateInput.onkeydown = (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    setFineRotation(rotateInput.value);
                    rotateInput.blur();
                }
            };
            // Select all on focus for easy replacement
            rotateInput.onfocus = () => rotateInput.select();

            // Double-click slider to reset
            rotateSlider.ondblclick = () => setFineRotation(0);

            // +/- buttons for fine adjustment
            this.backdrop.querySelector('#rotate-minus').onclick = () => setFineRotation(parseFloat(rotateSlider.value) - 0.1);
            this.backdrop.querySelector('#rotate-plus').onclick = () => setFineRotation(parseFloat(rotateSlider.value) + 0.1);
        }

        // Escape key to close
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.backdrop.classList.contains('active')) {
                this.cancel();
            }
        });
    }

    // Handle toolbar actions
    handleToolAction(action) {
        if (action === 'perspective') {
            if (this.mode === 'crop') this.enterPerspectiveMode();
            else this.exitPerspectiveMode();
            return;
        }
        if (action === 'reset' && this.mode === 'perspective') {
            this.resetCornerHandles();
            return;
        }
        if (!this.cropper) return;

        switch (action) {
            case 'rotate-left':
                this.baseRotation -= 90;
                this.fineRotation = 0;
                if (this.setFineRotation) this.setFineRotation(0);
                break;
            case 'rotate-right':
                this.baseRotation += 90;
                this.fineRotation = 0;
                if (this.setFineRotation) this.setFineRotation(0);
                break;
            case 'flip-h':
                this.cropper.scaleX(-this.cropper.getData().scaleX || -1);
                break;
            case 'flip-v':
                this.cropper.scaleY(-this.cropper.getData().scaleY || -1);
                break;
            case 'reset':
                this.baseRotation = 0;
                this.fineRotation = 0;
                this.cropper.reset();
                if (this.setFineRotation) this.setFineRotation(0);
                break;
        }
    }

    // Open editor with image URL or data URL
    async open(imageSrc) {
        await this.loadCropperJS();
        this.init();

        // Destroy existing cropper
        if (this.cropper) {
            this.cropper.destroy();
            this.cropper = null;
        }

        // Reset state
        this.mode = 'crop';
        this.originalImageSrc = imageSrc;
        this.baseRotation = 0;
        this.fineRotation = 0;
        this.updateToolbarForMode();
        const slider = this.backdrop.querySelector('#image-editor-rotate');
        const input = this.backdrop.querySelector('#image-editor-rotate-value');
        if (slider) slider.value = 0;
        if (input) input.value = '0°';

        // Set image source (crossOrigin needed for R2 images so canvas isn't tainted)
        // Cache-bust http(s) URLs to avoid browser serving a cached non-CORS response
        // from the regular <img> tag that loaded the same URL without crossOrigin
        const img = this.backdrop.querySelector('#image-editor-img');
        img.crossOrigin = 'anonymous';
        const isHttpUrl = imageSrc.startsWith('http');
        img.src = isHttpUrl ? imageSrc + (imageSrc.includes('?') ? '&' : '?') + '_cb=1' : imageSrc;

        // Show modal
        this.backdrop.classList.add('active');

        // Wait for image to load, then initialize cropper
        return new Promise((resolve, reject) => {
            this.resolvePromise = resolve;
            this.rejectPromise = reject;

            img.onload = () => {
                this.cropper = new Cropper(img, {
                    ...this.cropperOptions,
                    ready: () => this.enterPerspectiveMode(),
                });
            };
            img.onerror = () => {
                this.close();
                reject(new Error('Failed to load image'));
            };
        });
    }

    // Confirm - return cropped/edited image (or apply perspective)
    confirm() {
        if (this.mode === 'perspective') {
            this.applyPerspective();
            return;
        }

        console.log('ImageEditor: confirm() called, cropper:', !!this.cropper);

        if (!this.cropper) {
            // Cropper not initialized - reject with error
            console.error('ImageEditor: No cropper instance');
            const reject = this.rejectPromise;
            this.close();
            if (reject) {
                reject(new Error('Image editor not ready'));
            }
            return;
        }

        try {
            console.log('ImageEditor: Getting cropped canvas...');
            // Get cropped canvas
            const canvas = this.cropper.getCroppedCanvas({
                maxWidth: 1200,
                maxHeight: 1200,
            });

            console.log('ImageEditor: Canvas result:', !!canvas, canvas?.width, canvas?.height);

            if (!canvas) {
                throw new Error('Failed to get cropped image');
            }

            // Convert to data URL
            console.log('ImageEditor: Converting to data URL...');
            const dataUrl = canvas.toDataURL('image/png');
            console.log('ImageEditor: Data URL length:', dataUrl?.length);

            // Save resolve function before close() clears it
            const resolve = this.resolvePromise;
            this.close();
            console.log('ImageEditor: Resolving promise...');
            if (resolve) {
                resolve(dataUrl);
                console.log('ImageEditor: Promise resolved');
            } else {
                console.error('ImageEditor: No resolvePromise!');
            }
        } catch (error) {
            console.error('ImageEditor: Error in confirm():', error);
            const reject = this.rejectPromise;
            this.close();
            if (reject) {
                reject(error);
            }
        }
    }

    // Cancel - reject promise
    cancel() {
        if (this.mode === 'perspective') {
            this.exitPerspectiveMode();
            return;
        }
        const reject = this.rejectPromise;
        this.close();
        if (reject) {
            reject(new Error('Cancelled'));
        }
    }

    // Cropper.js config (shared between open() and exitPerspectiveMode())
    get cropperOptions() {
        return {
            viewMode: 1, dragMode: 'move', aspectRatio: NaN, autoCropArea: 1,
            restore: false, guides: true, center: true, highlight: false,
            cropBoxMovable: true, cropBoxResizable: true, toggleDragModeOnDblclick: false, background: true,
        };
    }

    // Enter perspective correction mode
    enterPerspectiveMode() {
        if (this.mode === 'perspective') return;

        // Capture current Cropper state (bakes in any rotation/crop/flip)
        const croppedCanvas = this.cropper.getCroppedCanvas({ maxWidth: 1200, maxHeight: 1200 });
        this.prePerspectiveSrc = croppedCanvas.toDataURL('image/png');

        // Destroy Cropper
        this.cropper.destroy();
        this.cropper = null;

        // Hide the img element
        const img = this.backdrop.querySelector('#image-editor-img');
        img.style.display = 'none';

        const container = this.backdrop.querySelector('.image-editor-canvas');

        // Create perspective canvas
        this.perspectiveCanvas = document.createElement('canvas');
        this.perspectiveCanvas.className = 'perspective-canvas';
        this.perspectiveCanvas.width = croppedCanvas.width;
        this.perspectiveCanvas.height = croppedCanvas.height;
        this.perspectiveCanvas.getContext('2d').drawImage(croppedCanvas, 0, 0);
        container.appendChild(this.perspectiveCanvas);

        // Create overlay canvas for guide lines
        this.perspectiveOverlay = document.createElement('canvas');
        this.perspectiveOverlay.className = 'perspective-overlay';
        container.appendChild(this.perspectiveOverlay);

        // Initialize corner positions and create handles
        this.resetCornerHandles();
        this.cornerHandles = [];
        for (let i = 0; i < 4; i++) {
            const handle = document.createElement('div');
            handle.className = 'perspective-handle';
            handle.dataset.index = i;
            container.appendChild(handle);
            this.cornerHandles.push(handle);
            this.makeHandleDraggable(handle, i);
        }

        this.mode = 'perspective';
        this.updateToolbarForMode();
        this.updateHandlePositions();
        this.drawGuideLines();
    }

    // Reset corner handles to default inset positions
    resetCornerHandles() {
        const inset = 0;
        this.cornerPositions = [
            { x: inset, y: inset },
            { x: 1 - inset, y: inset },
            { x: 1 - inset, y: 1 - inset },
            { x: inset, y: 1 - inset },
        ];
        if (this.cornerHandles.length) {
            this.updateHandlePositions();
            this.drawGuideLines();
        }
    }

    // Make a corner handle draggable with pointer events
    makeHandleDraggable(handle, index) {
        handle.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            handle.setPointerCapture(e.pointerId);
            handle.classList.add('dragging');

            // Record offset between handle position and corner position
            const offset = this.getHandleOffset(index);
            const corner = this.cornerPositions[index];
            const diffX = offset.x - corner.x;
            const diffY = offset.y - corner.y;

            const onMove = (e) => {
                const canvasRect = this.perspectiveCanvas.getBoundingClientRect();
                // Mouse is on the offset handle; subtract diff to get actual corner
                const mx = (e.clientX - canvasRect.left) / canvasRect.width;
                const my = (e.clientY - canvasRect.top) / canvasRect.height;
                const x = Math.max(0, Math.min(1, mx - diffX));
                const y = Math.max(0, Math.min(1, my - diffY));
                this.cornerPositions[index] = { x, y };
                this.updateHandlePositions();
                this.drawGuideLines();
            };

            const onUp = () => {
                handle.classList.remove('dragging');
                handle.removeEventListener('pointermove', onMove);
                handle.removeEventListener('pointerup', onUp);
            };

            handle.addEventListener('pointermove', onMove);
            handle.addEventListener('pointerup', onUp);
        });
    }

    // Compute the offset handle position (inward from corner toward quad center)
    getHandleOffset(cornerIdx) {
        const pos = this.cornerPositions[cornerIdx];
        // Center of the quad
        const cx = this.cornerPositions.reduce((s, p) => s + p.x, 0) / 4;
        const cy = this.cornerPositions.reduce((s, p) => s + p.y, 0) / 4;
        // Direction from corner toward center
        const dx = cx - pos.x, dy = cy - pos.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 0.001) return { x: pos.x, y: pos.y };
        // Offset by a fixed pixel distance (30px), converted to normalized coords
        const rect = this.perspectiveCanvas?.getBoundingClientRect();
        if (!rect || !rect.width) return { x: pos.x, y: pos.y };
        const offsetPx = 30;
        const offsetX = (dx / len) * offsetPx / rect.width;
        const offsetY = (dy / len) * offsetPx / rect.height;
        return { x: pos.x + offsetX, y: pos.y + offsetY };
    }

    // Position handles on screen based on normalized coordinates (offset inward)
    updateHandlePositions() {
        if (!this.perspectiveCanvas) return;
        const rect = this.perspectiveCanvas.getBoundingClientRect();
        const containerRect = this.perspectiveCanvas.parentElement.getBoundingClientRect();

        this.cornerHandles.forEach((handle, i) => {
            const offset = this.getHandleOffset(i);
            handle.style.left = (rect.left - containerRect.left + offset.x * rect.width) + 'px';
            handle.style.top = (rect.top - containerRect.top + offset.y * rect.height) + 'px';
        });
    }

    // Draw guide lines connecting the 4 corners on the overlay
    drawGuideLines() {
        if (!this.perspectiveOverlay || !this.perspectiveCanvas) return;
        const rect = this.perspectiveCanvas.getBoundingClientRect();
        const containerRect = this.perspectiveCanvas.parentElement.getBoundingClientRect();

        this.perspectiveOverlay.width = containerRect.width;
        this.perspectiveOverlay.height = containerRect.height;
        this.perspectiveOverlay.style.width = containerRect.width + 'px';
        this.perspectiveOverlay.style.height = containerRect.height + 'px';

        const ctx = this.perspectiveOverlay.getContext('2d');
        ctx.clearRect(0, 0, this.perspectiveOverlay.width, this.perspectiveOverlay.height);

        const offsetX = rect.left - containerRect.left;
        const offsetY = rect.top - containerRect.top;
        const points = this.cornerPositions.map(p => ({
            x: offsetX + p.x * rect.width,
            y: offsetY + p.y * rect.height,
        }));

        // Fill the quadrilateral
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < 4; i++) ctx.lineTo(points[i].x, points[i].y);
        ctx.closePath();
        ctx.fillStyle = 'rgba(102, 126, 234, 0.08)';
        ctx.fill();

        // Draw edges
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < 4; i++) ctx.lineTo(points[i].x, points[i].y);
        ctx.closePath();
        ctx.strokeStyle = 'rgba(102, 126, 234, 0.7)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Draw arm lines from offset handles to actual corner points + corner dots
        for (let i = 0; i < 4; i++) {
            const offset = this.getHandleOffset(i);
            const hx = offsetX + offset.x * rect.width;
            const hy = offsetY + offset.y * rect.height;

            // Arm line
            ctx.beginPath();
            ctx.moveTo(hx, hy);
            ctx.lineTo(points[i].x, points[i].y);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            // Corner dot
            ctx.beginPath();
            ctx.arc(points[i].x, points[i].y, 3, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
            ctx.fill();
        }
    }

    // Apply the perspective transform and return to crop mode
    applyPerspective() {
        const srcCorners = this.cornerPositions.map(p => ({
            x: p.x * this.perspectiveCanvas.width,
            y: p.y * this.perspectiveCanvas.height,
        }));

        const resultCanvas = PerspectiveTransform.transform(this.perspectiveCanvas, srcCorners);
        if (!resultCanvas) {
            console.error('Perspective transform failed');
            return;
        }

        const resultUrl = resultCanvas.toDataURL('image/png');
        this.exitPerspectiveMode(resultUrl);
    }

    // Exit perspective mode and return to Cropper.js
    exitPerspectiveMode(newImageSrc) {
        this.cleanupPerspective();

        const img = this.backdrop.querySelector('#image-editor-img');
        img.style.display = '';
        img.src = newImageSrc || this.prePerspectiveSrc;

        this.mode = 'crop';
        this.baseRotation = 0;
        this.fineRotation = 0;
        if (this.setFineRotation) this.setFineRotation(0);
        this.updateToolbarForMode();

        img.onload = () => {
            this.cropper = new Cropper(img, this.cropperOptions);
        };
    }

    // Clean up perspective mode DOM elements
    cleanupPerspective() {
        this.cornerHandles.forEach(h => h.remove());
        this.cornerHandles = [];
        if (this.perspectiveCanvas) { this.perspectiveCanvas.remove(); this.perspectiveCanvas = null; }
        if (this.perspectiveOverlay) { this.perspectiveOverlay.remove(); this.perspectiveOverlay = null; }
    }

    // Toggle UI between crop and perspective modes
    updateToolbarForMode() {
        if (!this.backdrop) return;
        const isPerspective = this.mode === 'perspective';

        // Toggle controls visibility
        const cropControls = this.backdrop.querySelector('.image-editor-controls');
        const perspControls = this.backdrop.querySelector('.perspective-controls');
        if (cropControls) cropControls.style.display = isPerspective ? 'none' : '';
        if (perspControls) perspControls.style.display = isPerspective ? 'flex' : 'none';

        // Update subtitle
        const subtitle = this.backdrop.querySelector('.image-editor-subtitle');
        if (subtitle) subtitle.textContent = isPerspective
            ? 'Straighten card perspective'
            : 'Crop and rotate before saving';

        // Toggle active state on perspective button
        const perspBtn = this.backdrop.querySelector('[data-action="perspective"]');
        if (perspBtn) perspBtn.classList.toggle('active', isPerspective);

        // Update confirm button text
        const confirmBtn = this.backdrop.querySelector('.image-editor-btn.confirm');
        if (confirmBtn) confirmBtn.textContent = isPerspective ? 'Apply Correction' : 'Apply & Continue';
    }

    // Close modal
    close() {
        if (!this.backdrop) return;
        this.backdrop.classList.remove('active');
        if (this.cropper) {
            this.cropper.destroy();
            this.cropper = null;
        }
        this.cleanupPerspective();
        this.mode = 'crop';
        this.resolvePromise = null;
        this.rejectPromise = null;
    }
}

// Singleton instance
const imageEditor = new ImageEditorModal();

/**
 * Card Editor Modal - handles card editing UI
 */
class CardEditorModal {
    constructor(options = {}) {
        this.onSave = options.onSave || (() => {});
        this.onDelete = options.onDelete || (() => {});
        this.cardTypes = options.cardTypes || CARD_TYPES;
        this.categories = options.categories || null; // e.g., ['panini', 'topps', 'inserts', 'premium']
        this.imageFolder = options.imageFolder || 'images'; // folder for processed images
        this.playerName = options.playerName || ''; // player name for search term generation
        this.isOwned = options.isOwned || (() => false); // callback to check if card is owned
        this.onOwnedChange = options.onOwnedChange || null; // callback when owned state changes
        this.currentCard = null;
        this.currentCardId = null;
        this.isDirty = false;
        this.backdrop = null;
        this.isNewCard = false;
        this.imageProcessor = new ImageProcessor();
        this.ebayManuallyEdited = false; // Track if user manually edited eBay search term
        this._initialOwned = false; // Track initial owned state to detect changes

        // Schema-driven custom fields
        // Format: { fieldName: { label, type, options?, placeholder?, fullWidth? } }
        // Types: 'text', 'select', 'checkbox'
        // For select: options is array of { value, label } or just strings
        this.customFields = options.customFields || {};
        // priceInAttributes is now always true - price renders in the compact attributes row
        this.priceInAttributes = true;
    }

    // Generate eBay search term from card data
    generateSearchTerm(set, num, variant, player) {
        const parts = [player || this.playerName, set];
        // Add card number without # prefix
        if (num) {
            parts.push(num.replace(/^#/, ''));
        }
        // Add variant if not "Base"
        if (variant && variant !== 'Base') {
            parts.push(variant);
        }
        return parts.filter(Boolean).join('+').toLowerCase().replace(/\s+/g, '+');
    }

    // Check if running on a preview site (not production)
    isPreviewSite() {
        const hostname = window.location.hostname;
        // Preview sites are on .pages.dev but not the main domain
        if (hostname.endsWith('.pages.dev') && !hostname.startsWith('sports-card-checklists.')) {
            return true;
        }
        return false;
    }

    // Generate HTML for custom fields based on schema
    // position: 'top' (before set), 'after-num' (after card number), 'attributes' (horizontal row), 'bottom' (after attributes)
    generateCustomFieldsHtml(position = 'top') {
        const fields = Object.entries(this.customFields)
            .filter(([_, config]) => (config.position || 'top') === position);

        if (fields.length === 0 && position !== 'attributes') return '';

        // Attributes position renders as a compact horizontal row with price
        if (position === 'attributes') {
            // fullWidth fields (e.g. variant) are rendered inline in the template grid, not here
            const rowFields = fields.filter(([_, c]) => !c.fullWidth);

            const innerHtml = rowFields.map(([fieldName, config]) => {
                const id = `editor-${fieldName}`;
                if (config.type === 'checkbox') {
                    return `<label class="card-editor-attr-checkbox">
                        <input type="checkbox" id="${id}">
                        <span>${config.label}</span>
                    </label>`;
                } else {
                    // Text/number field (e.g., serial)
                    const extraAttrs = config.inputType === 'number' ? ' inputmode="numeric"' : '';
                    return `<div class="card-editor-attr-text">
                        <label for="${id}">${config.label}:</label>
                        <input type="text" class="card-editor-input" id="${id}" placeholder="${config.placeholder || ''}"${extraAttrs}>
                    </div>`;
                }
            }).join('');
            const priceHtml = `
                    <div class="card-editor-attr-text card-editor-attr-price">
                        <label for="editor-price">Price:</label>
                        <input type="text" class="card-editor-input" id="editor-price" placeholder="$" inputmode="numeric">
                    </div>`;
            return `<div class="card-editor-field full-width card-editor-attributes">
                <label class="card-editor-label">Attributes</label>
                <div class="card-editor-attr-row">
                    ${innerHtml}
                    ${priceHtml}
                </div>
            </div>`;
        }

        const fieldHtml = fields.map(([fieldName, config]) => {
            const id = `editor-${fieldName}`;
            const fullWidth = config.fullWidth ? ' full-width' : '';
            const placeholder = config.placeholder || '';

            if (config.type === 'select') {
                const options = (config.options || []).map(opt => {
                    const value = typeof opt === 'string' ? opt : opt.value;
                    const label = typeof opt === 'string' ? opt : opt.label;
                    return `<option value="${value}">${label}</option>`;
                }).join('');
                return `<div class="card-editor-field${fullWidth}">
                    <label class="card-editor-label">${config.label}</label>
                    <select class="card-editor-select" id="${id}">${options}</select>
                </div>`;
            } else if (config.type === 'checkbox') {
                return `<div class="card-editor-field${fullWidth}">
                    <label class="card-editor-label">${config.label}</label>
                    <label class="card-editor-checkbox">
                        <input type="checkbox" id="${id}">
                        <span>${config.checkboxLabel || 'Yes'}</span>
                    </label>
                </div>`;
            } else {
                // Default: text input
                const colorHint = config.color ? `<span class="card-editor-color-hint" style="background:${config.color}"></span>` : '';
                return `<div class="card-editor-field${fullWidth}">
                    <label class="card-editor-label">${config.label}${colorHint}</label>
                    <input type="text" class="card-editor-input" id="${id}" placeholder="${placeholder}">
                </div>`;
            }
        }).join('');

        // Bottom fields get their own equal-column grid
        if (position === 'bottom') {
            const cols = fields.length === 1 ? '1fr' : 'repeat(2, 1fr)';
            return `<div class="card-editor-field full-width" style="display:grid;grid-template-columns:${cols};gap:16px;">
                ${fieldHtml}
            </div>`;
        }

        return fieldHtml;
    }

    // Populate custom fields from card data
    populateCustomFields(cardData) {
        for (const [fieldName, config] of Object.entries(this.customFields)) {
            const el = this.backdrop.querySelector(`#editor-${fieldName}`);
            if (!el) continue;

            const value = cardData[fieldName];
            if (config.type === 'checkbox') {
                el.checked = !!value;
            } else if (config.type === 'select') {
                el.value = value || (config.options?.[0]?.value ?? config.options?.[0] ?? '');
            } else {
                // Text field - handle arrays (like achievements)
                if (Array.isArray(value)) {
                    el.value = value.join(', ');
                } else {
                    el.value = value || '';
                }
            }
        }
    }

    // Clear custom fields for new card
    clearCustomFields() {
        for (const [fieldName, config] of Object.entries(this.customFields)) {
            const el = this.backdrop.querySelector(`#editor-${fieldName}`);
            if (!el) continue;

            if (config.type === 'checkbox') {
                el.checked = false;
            } else if (config.type === 'select') {
                el.value = config.options?.[0]?.value ?? config.options?.[0] ?? '';
            } else {
                el.value = '';
            }
        }
    }

    // Gather custom field values
    getCustomFieldData() {
        const data = {};
        for (const [fieldName, config] of Object.entries(this.customFields)) {
            const el = this.backdrop.querySelector(`#editor-${fieldName}`);
            if (!el) continue;

            if (config.type === 'checkbox') {
                if (el.checked) data[fieldName] = true;
            } else if (config.type === 'select') {
                data[fieldName] = el.value;
            } else {
                const val = el.value.trim();
                // Parse comma-separated values if configured
                if (config.parseArray) {
                    data[fieldName] = val ? val.split(',').map(v => v.trim()).filter(v => v) : [];
                } else {
                    // Always include the value (even empty string) so calling code can clear fields
                    data[fieldName] = val;
                }
            }
        }
        return data;
    }

    // Initialize - create modal DOM
    init() {
        // Remove existing card editor backdrop so re-init works after settings changes
        // Use :not(.checklist-creator-backdrop) to avoid removing the creator modal
        const existing = document.querySelector('.card-editor-backdrop:not(.checklist-creator-backdrop)');
        if (existing) existing.remove();

        const backdrop = document.createElement('div');
        backdrop.className = 'card-editor-backdrop';
        backdrop.innerHTML = `
            <div class="card-editor-modal">
                <div class="card-editor-header">
                    <div class="card-editor-header-left">
                        <h2 class="card-editor-title">EDIT CARD</h2>
                        <div class="card-editor-subtitle">Update card details</div>
                    </div>
                    <label class="card-editor-owned-toggle" id="editor-owned-toggle">
                        <input type="checkbox" id="editor-owned">
                        <span class="owned-toggle-label">Owned</span>
                    </label>
                    <button class="card-editor-close" title="Close">×</button>
                </div>
                <div class="card-editor-body">
                    <div class="card-editor-grid">
                        ${this.generateCustomFieldsHtml('top')}
                        <div class="card-editor-field">
                            <label class="card-editor-label">Set Name</label>
                            <input type="text" class="card-editor-input" id="editor-set" placeholder="2024 Panini Prizm">
                        </div>
                        <div class="card-editor-field">
                            <label class="card-editor-label">Card Number</label>
                            <input type="text" class="card-editor-input" id="editor-num" placeholder="123">
                        </div>
                        ${this.cardTypes.length > 0 ? `<div class="card-editor-field">
                            <label class="card-editor-label">Card Type</label>
                            <select class="card-editor-select" id="editor-type">
                                ${this.cardTypes.map(t => `<option value="${t}">${t}</option>`).join('')}
                            </select>
                        </div>` : ''}
                        ${this.generateCustomFieldsHtml('after-num')}
                        ${Object.entries(this.customFields)
                            .filter(([_, c]) => (c.position || 'top') === 'attributes' && c.fullWidth)
                            .map(([name, c]) => `<div class="card-editor-field">
                            <label class="card-editor-label">${c.label}</label>
                            <input type="text" class="card-editor-input" id="editor-${name}" placeholder="${c.placeholder || ''}">
                        </div>`).join('')}
                        ${this.categories ? `<div class="card-editor-field">
                            <label class="card-editor-label">Section</label>
                            <select class="card-editor-select" id="editor-category">
                                ${this.categories.map(c => {
                                    if (c.group) {
                                        return `<optgroup label="${c.group}">${c.children.map(child =>
                                            `<option value="${child.value}">${child.label}</option>`
                                        ).join('')}</optgroup>`;
                                    }
                                    const label = typeof c === 'string' ? c.charAt(0).toUpperCase() + c.slice(1) : c.label;
                                    const value = typeof c === 'string' ? c : c.value;
                                    return `<option value="${value}">${label}</option>`;
                                }).join('')}
                            </select>
                        </div>` : ''}
                        ${this.generateCustomFieldsHtml('attributes')}
                        ${this.generateCustomFieldsHtml('bottom')}
                        <div class="card-editor-field full-width card-editor-advanced-toggle">
                            <button type="button" class="card-editor-toggle-btn" id="editor-toggle-advanced">Advanced</button>
                        </div>
                        <div class="card-editor-advanced-fields" style="display: none;">
                            <div class="card-editor-field full-width">
                                <label class="card-editor-label">eBay Search Term</label>
                                <input type="text" class="card-editor-input" id="editor-ebay" placeholder="Defaults to player + set + number">
                            </div>
                            <div class="card-editor-field full-width">
                                <label class="card-editor-label">Price Search Term</label>
                                <input type="text" class="card-editor-input" id="editor-price-search" placeholder="Defaults to player + set + number">
                            </div>
                        </div>
                        <div class="card-editor-field full-width card-editor-image-section">
                            <label class="card-editor-label">Image</label>
                            <div class="card-editor-image-input-row">
                                <input type="text" class="card-editor-input" id="editor-img" placeholder="URL or upload file...">
                                <input type="file" id="editor-img-file" accept="image/*" style="display: none;">
                                <button type="button" class="card-editor-upload-btn" id="editor-upload-img" title="Upload local image">
                                    <span class="upload-text">Upload</span>
                                    <span class="upload-spinner"></span>
                                </button>
                                <button type="button" class="card-editor-process-btn" id="editor-process-img" title="Process image">
                                    <span class="process-text">Process</span>
                                    <span class="process-spinner"></span>
                                </button>
                                <button type="button" class="card-editor-edit-btn" id="editor-edit-img" title="Edit existing image" style="display: none;">
                                    <span class="edit-text">Edit</span>
                                    <span class="edit-spinner"></span>
                                </button>
                            </div>
                            <div class="card-editor-image-preview" id="editor-img-dropzone">
                                <span class="placeholder">No image (or drag & drop here)</span>
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

        // Toggle advanced fields visibility
        const advancedToggle = this.backdrop.querySelector('#editor-toggle-advanced');
        const advancedFields = this.backdrop.querySelector('.card-editor-advanced-fields');
        advancedToggle.onclick = () => {
            const isHidden = advancedFields.style.display === 'none';
            advancedFields.style.display = isHidden ? 'flex' : 'none';
            advancedToggle.textContent = isHidden ? 'Hide advanced' : 'Advanced';
        };

        // Track manual edits to eBay search term
        this.backdrop.querySelector('#editor-ebay').oninput = () => {
            this.ebayManuallyEdited = true;
            this.setDirty(true);
        };

        // Price field validation - strip non-numeric, round to whole number on blur
        const priceInput = this.backdrop.querySelector('#editor-price');
        if (priceInput) {
            priceInput.addEventListener('blur', () => {
                let val = priceInput.value.trim().replace(/[^0-9.]/g, '');
                if (val === '' || val === '.') { priceInput.value = ''; return; }
                const num = Math.round(parseFloat(val));
                priceInput.value = isNaN(num) || num <= 0 ? '' : num;
            });
        }

        // Serial/Run field validation - clean up on blur
        const serialInput = this.backdrop.querySelector('#editor-serial');
        if (serialInput) {
            serialInput.addEventListener('blur', () => {
                let val = serialInput.value.trim();
                if (!val) return;
                // Strip leading zeros from numbers, normalize "/099" to "/99"
                val = val.replace(/^\/0+(\d)/, '/$1').replace(/^0+(\d)/, '$1');
                serialInput.value = val;
            });
        }

        // Image preview on URL change
        this.backdrop.querySelector('#editor-img').oninput = (e) => {
            this.updateImagePreview(e.target.value);
            this.updateProcessButton(e.target.value);
            this.updateEditButton(e.target.value);
        };

        // Process image button
        this.backdrop.querySelector('#editor-process-img').onclick = () => this.processImage();

        // Edit existing image button
        this.backdrop.querySelector('#editor-edit-img').onclick = () => this.editExistingImage();

        // Upload image button
        this.backdrop.querySelector('#editor-upload-img').onclick = () => {
            this.backdrop.querySelector('#editor-img-file').click();
        };

        // File input change handler
        this.backdrop.querySelector('#editor-img-file').onchange = (e) => {
            if (e.target.files && e.target.files[0]) {
                this.processLocalFile(e.target.files[0]);
            }
        };

        // Drag and drop on preview area
        const dropzone = this.backdrop.querySelector('#editor-img-dropzone');
        dropzone.ondragover = (e) => {
            e.preventDefault();
            dropzone.classList.add('dragover');
        };
        dropzone.ondragleave = () => {
            dropzone.classList.remove('dragover');
        };
        dropzone.ondrop = (e) => {
            e.preventDefault();
            dropzone.classList.remove('dragover');
            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                this.processLocalFile(e.dataTransfer.files[0]);
            }
        };

        // Escape key to close
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.backdrop.classList.contains('active')) {
                this.close();
            }
        });

        // Enter key to save (unless in a select or textarea)
        modal.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !['SELECT', 'TEXTAREA'].includes(e.target.tagName)) {
                e.preventDefault();
                this.save();
            }
        });
    }

    // Update image preview
    updateImagePreview(url) {
        const preview = this.backdrop.querySelector('.card-editor-image-preview');
        if (url) {
            // Determine the source URL:
            // - data: URLs used as-is
            // - Relative paths (local images) used as-is
            // - Absolute URLs (http/https) go through sanitizeUrl
            let src;
            if (url.startsWith('data:')) {
                src = url;
            } else if (url.startsWith('http://') || url.startsWith('https://')) {
                src = sanitizeUrl(url);
            } else {
                // Relative path - use as-is
                src = url;
            }
            preview.innerHTML = `<img src="${src}" alt="Preview" onerror="this.outerHTML='<span class=\\'placeholder\\'>Failed to load</span>'">`;
        } else {
            preview.innerHTML = '<span class="placeholder">No image</span>';
        }
    }

    // Update process button visibility based on URL
    updateProcessButton(url) {
        const btn = this.backdrop.querySelector('#editor-process-img');
        if (!btn) return;

        const isEbay = this.imageProcessor.isProcessableUrl(url);
        btn.style.display = isEbay ? 'flex' : 'none';
    }

    // Update edit button visibility based on URL (show for local or R2 images)
    updateEditButton(url) {
        const btn = this.backdrop.querySelector('#editor-edit-img');
        if (!btn) return;

        const isEditable = url && (url.startsWith(this.imageFolder) || url.startsWith(R2_IMAGE_BASE));
        btn.style.display = isEditable ? 'flex' : 'none';
    }

    // Set image processing state - disables Save button while processing
    setImageProcessing(isProcessing) {
        const saveBtn = this.backdrop.querySelector('.card-editor-btn.save');
        if (saveBtn) {
            saveBtn.disabled = isProcessing;
            if (isProcessing) {
                saveBtn.dataset.originalText = saveBtn.textContent;
                saveBtn.textContent = 'Processing...';
            } else if (saveBtn.dataset.originalText) {
                saveBtn.textContent = saveBtn.dataset.originalText;
            }
        }
    }

    // Edit existing image: load into editor, save new version
    async editExistingImage() {
        const imgInput = this.backdrop.querySelector('#editor-img');
        const url = imgInput.value.trim();
        const btn = this.backdrop.querySelector('#editor-edit-img');

        if (!url || !(url.startsWith(this.imageFolder) || url.startsWith(R2_IMAGE_BASE))) return;

        // Check if githubSync is available and logged in
        if (typeof githubSync === 'undefined' || !githubSync.isLoggedIn()) {
            alert('Please sign in to edit images');
            return;
        }

        btn.classList.add('processing');
        btn.disabled = true;
        this.setImageProcessing(true);

        try {
            // Open the existing image in the editor
            const editedDataUrl = await imageEditor.open(url);
            if (!editedDataUrl) {
                throw new Error('Cancelled');
            }

            // Convert data URL to base64
            const base64Data = editedDataUrl.split(',')[1];

            // Generate new filename (add timestamp suffix)
            const timestamp = Date.now();
            // For R2 URLs, extract the key path; for local paths, use as-is
            const pathForKey = url.startsWith(R2_IMAGE_BASE)
                ? url.slice(R2_IMAGE_BASE.length - 'images/'.length) // keep "images/..." prefix
                : url;
            const baseName = pathForKey.replace(/\.webp$/, '');
            const newKey = `${baseName}_${timestamp}.webp`;
            const filename = newKey.split('/').pop();

            // Upload to R2
            btn.title = 'Uploading...';
            const r2Url = await githubSync.uploadImage(newKey, base64Data);

            if (!r2Url) {
                throw new Error('Failed to upload image - check console for details');
            }

            // Update the input field with the R2 URL
            imgInput.value = r2Url;
            this.updateImagePreview(`data:image/webp;base64,${base64Data}`);
            this.updateProcessButton(r2Url);
            this.updateEditButton(r2Url);
            this.setDirty(true);

            btn.title = 'Done! Image uploaded';

        } catch (error) {
            if (error.message !== 'Cancelled') {
                console.error('Image edit failed:', error);
                alert('Failed to edit image: ' + error.message);
            }
        } finally {
            btn.classList.remove('processing');
            btn.disabled = false;
            this.setImageProcessing(false);
        }
    }

    // Process image: fetch, show editor, resize, upload to R2, update field with URL
    async processImage() {
        const imgInput = this.backdrop.querySelector('#editor-img');
        const url = imgInput.value.trim();
        const btn = this.backdrop.querySelector('#editor-process-img');

        if (!url || !this.imageProcessor.isProcessableUrl(url)) return;

        // Check if githubSync is available and logged in
        if (typeof githubSync === 'undefined' || !githubSync.isLoggedIn()) {
            alert('Please sign in to process images');
            return;
        }

        // Show loading state
        btn.classList.add('processing');
        btn.disabled = true;
        btn.title = 'Fetching image...';
        this.setImageProcessing(true);

        try {
            // Fetch the image via proxy
            const { base64: rawBase64, contentType } = await this.imageProcessor.fetchViaProxy(url);
            const rawDataUrl = `data:${contentType};base64,${rawBase64}`;

            // Show image editor for crop/rotate
            btn.title = 'Edit image...';
            const editedDataUrl = await imageEditor.open(rawDataUrl);

            // User confirmed - now process the edited image
            btn.title = 'Processing...';

            // Load edited image into Image element
            const img = await new Promise((resolve, reject) => {
                const image = new Image();
                image.onload = () => resolve(image);
                image.onerror = reject;
                image.src = editedDataUrl;
            });

            // Get card data from form to generate filename
            const cardData = {
                set: this.backdrop.querySelector('#editor-set')?.value || '',
                name: this.backdrop.querySelector('#editor-name')?.value || '',
                num: this.backdrop.querySelector('#editor-num')?.value || ''
            };

            // Generate filename and key
            const filename = this.imageProcessor.generateFilename(cardData);
            const key = `${this.imageFolder}/${filename}`;

            // Resize and convert to WebP
            const { base64: base64Content } = await this.imageProcessor.processImage(img);

            // Upload to R2
            btn.title = 'Uploading...';
            const r2Url = await githubSync.uploadImage(key, base64Content);

            if (!r2Url) {
                throw new Error('Failed to upload image');
            }

            // Update the input field with the R2 URL
            imgInput.value = r2Url;
            this.updateImagePreview(`data:image/webp;base64,${base64Content}`);
            this.updateProcessButton(r2Url);
            this.updateEditButton(r2Url);
            this.setDirty(true);

            btn.title = 'Done! Image uploaded';

        } catch (error) {
            // Don't show error if user just cancelled
            if (error.message !== 'Cancelled') {
                console.error('Image processing failed:', error);
                alert('Failed to process image: ' + error.message);
            }
        } finally {
            btn.classList.remove('processing');
            btn.disabled = false;
            this.setImageProcessing(false);
        }
    }

    // Process a local file: read, show editor, resize, upload to R2, update field with URL
    async processLocalFile(file) {
        const imgInput = this.backdrop.querySelector('#editor-img');
        const btn = this.backdrop.querySelector('#editor-upload-img');

        // Check if githubSync is available and logged in
        if (typeof githubSync === 'undefined' || !githubSync.isLoggedIn()) {
            alert('Please sign in to upload images');
            return;
        }

        // Validate file type
        if (!file.type.startsWith('image/')) {
            alert('Please select an image file');
            return;
        }

        // Show loading state
        btn.classList.add('processing');
        btn.disabled = true;
        btn.title = 'Loading...';
        this.setImageProcessing(true);

        try {
            // Read file as data URL
            const dataUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => resolve(e.target.result);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });

            // Show image editor for crop/rotate
            btn.title = 'Edit image...';
            const editedDataUrl = await imageEditor.open(dataUrl);

            // User confirmed - now process the edited image
            btn.title = 'Processing...';

            // Load edited image into Image element
            const img = await new Promise((resolve, reject) => {
                const image = new Image();
                image.onload = () => resolve(image);
                image.onerror = reject;
                image.src = editedDataUrl;
            });

            // Get card data from form to generate filename
            const cardData = {
                set: this.backdrop.querySelector('#editor-set')?.value || '',
                name: this.backdrop.querySelector('#editor-name')?.value || '',
                num: this.backdrop.querySelector('#editor-num')?.value || ''
            };

            // Generate filename and key
            const filename = this.imageProcessor.generateFilename(cardData);
            const key = `${this.imageFolder}/${filename}`;

            // Process the image (resize, convert to webp)
            const { base64: base64Content } = await this.imageProcessor.processImage(img);

            // Upload to R2
            btn.title = 'Uploading...';
            const r2Url = await githubSync.uploadImage(key, base64Content);

            if (!r2Url) {
                throw new Error('Failed to upload image');
            }

            // Update the input field with the R2 URL
            imgInput.value = r2Url;
            this.updateImagePreview(`data:image/webp;base64,${base64Content}`);
            this.updateProcessButton(r2Url);
            this.updateEditButton(r2Url);
            this.setDirty(true);

            btn.title = 'Done! Image uploaded';

            // Clear file input for future uploads
            this.backdrop.querySelector('#editor-img-file').value = '';

        } catch (error) {
            // Don't show error if user just cancelled
            if (error.message !== 'Cancelled') {
                console.error('Image upload failed:', error);
                alert('Failed to upload image: ' + error.message);
            }
        } finally {
            btn.classList.remove('processing');
            btn.disabled = false;
            this.setImageProcessing(false);
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

        // Populate custom fields
        this.populateCustomFields(cardData);

        // Populate core fields
        this.backdrop.querySelector('#editor-set').value = cardData.set || '';
        // Set category if dropdown exists
        const categoryField = this.backdrop.querySelector('#editor-category');
        if (categoryField && cardData.category) {
            categoryField.value = cardData.category;
        }
        // Strip # from card number for editing
        this.backdrop.querySelector('#editor-num').value = (cardData.num || '').replace(/^#/, '');
        const typeEl = this.backdrop.querySelector('#editor-type');
        if (typeEl) typeEl.value = cardData.type || 'Base';
        this.backdrop.querySelector('#editor-price').value = cardData.price !== undefined ? cardData.price : '';
        const ebayValue = cardData.ebay || '';
        this.backdrop.querySelector('#editor-ebay').value = ebayValue;
        this.backdrop.querySelector('#editor-img').value = cardData.img || '';

        // Populate price search field
        const priceSearchValue = cardData.priceSearch || '';
        this.backdrop.querySelector('#editor-price-search').value = priceSearchValue;

        // Show advanced section if either search field has a custom value
        const hasCustomSearch = ebayValue !== '' || priceSearchValue !== '';
        const advancedFields = this.backdrop.querySelector('.card-editor-advanced-fields');
        const advancedToggle = this.backdrop.querySelector('#editor-toggle-advanced');
        advancedFields.style.display = hasCustomSearch ? 'flex' : 'none';
        advancedToggle.textContent = hasCustomSearch ? 'Hide advanced' : 'Advanced';

        this.updateImagePreview(cardData.img);
        this.updateProcessButton(cardData.img);
        this.updateEditButton(cardData.img);
        this.setDirty(false);
        this.ebayManuallyEdited = false;

        // Set owned toggle
        const owned = this.isOwned(cardId);
        this._initialOwned = owned;
        this.backdrop.querySelector('#editor-owned').checked = owned;
        this._updateOwnedToggleVisibility();

        // Show modal
        this.backdrop.classList.add('active');
    }

    // Open modal for adding new card
    openNew(category = null) {
        this.init();
        this.currentCardId = null;
        this.currentCard = { category };
        this.isNewCard = true;

        // Update title
        this.backdrop.querySelector('.card-editor-title').textContent = 'ADD NEW CARD';
        this.backdrop.querySelector('.card-editor-subtitle').textContent = 'Enter card details';
        this.backdrop.querySelector('.card-editor-btn.save').textContent = 'Add Card';
        this.backdrop.querySelector('.card-editor-btn.delete').style.display = 'none';

        // Clear core form fields
        this.backdrop.querySelector('#editor-set').value = '';
        this.backdrop.querySelector('#editor-num').value = '';
        const typeEl = this.backdrop.querySelector('#editor-type');
        if (typeEl) typeEl.value = 'Base';
        this.backdrop.querySelector('#editor-price').value = '';
        this.backdrop.querySelector('#editor-ebay').value = '';
        this.backdrop.querySelector('#editor-img').value = '';

        // Hide advanced section by default for new cards
        this.backdrop.querySelector('#editor-price-search').value = '';
        this.backdrop.querySelector('.card-editor-advanced-fields').style.display = 'none';
        this.backdrop.querySelector('#editor-toggle-advanced').textContent = 'Advanced';

        // Clear custom fields
        this.clearCustomFields();

        // Set category if dropdown exists
        const categoryField = this.backdrop.querySelector('#editor-category');
        if (categoryField && category) {
            categoryField.value = category;
        }
        this.updateImagePreview('');
        this.updateProcessButton('');
        this.updateEditButton('');
        this.setDirty(false);
        this.ebayManuallyEdited = false;

        // Default owned to unchecked for new cards
        this._initialOwned = false;
        this.backdrop.querySelector('#editor-owned').checked = false;
        this._updateOwnedToggleVisibility();

        // Show modal
        this.backdrop.classList.add('active');
        // Focus first top-position custom field, or set name
        const topField = Object.entries(this.customFields)
            .find(([_, c]) => (c.position || 'top') === 'top');
        const firstField = topField
            ? this.backdrop.querySelector(`#editor-${topField[0]}`)
            : this.backdrop.querySelector('#editor-set');
        if (firstField) firstField.focus();
    }

    // Show/hide owned toggle based on whether callbacks are configured
    _updateOwnedToggleVisibility() {
        const toggle = this.backdrop.querySelector('#editor-owned-toggle');
        if (toggle) toggle.style.display = this.onOwnedChange ? '' : 'none';
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
        // Close image editor if it was left open
        imageEditor.close();
    }

    // Gather form data
    getFormData() {
        // Add # prefix to card number if not present
        let num = this.backdrop.querySelector('#editor-num').value.trim();
        if (num && !num.startsWith('#')) {
            num = '#' + num;
        }

        // Core fields
        const data = {
            set: this.backdrop.querySelector('#editor-set').value.trim(),
            num: num,
            type: this.backdrop.querySelector('#editor-type')?.value || ''
        };

        // Image - only include if set (so clearing can delete it)
        const imgVal = this.backdrop.querySelector('#editor-img').value.trim();
        if (imgVal) {
            data.img = imgVal;
        }

        // Category - only include if field exists
        const categoryField = this.backdrop.querySelector('#editor-category');
        if (categoryField) {
            data.category = categoryField.value;
        }

        // Price - only include if explicitly set (stored as whole number)
        const priceVal = this.backdrop.querySelector('#editor-price').value.trim();
        if (priceVal !== '') {
            data.price = Math.round(parseFloat(priceVal)) || 0;
        }

        // eBay search term - only include if explicitly set
        const ebayVal = this.backdrop.querySelector('#editor-ebay').value.trim();
        if (ebayVal !== '') {
            data.ebay = ebayVal;
        }

        // Price search term - only include if explicitly set
        const priceSearchVal = this.backdrop.querySelector('#editor-price-search').value.trim();
        if (priceSearchVal !== '') {
            data.priceSearch = priceSearchVal;
        }

        // Preserve category if editing and no category dropdown exists
        if (!categoryField && this.currentCard && this.currentCard.category) {
            data.category = this.currentCard.category;
        }

        // Add custom field data
        Object.assign(data, this.getCustomFieldData());

        return data;
    }

    // Validate form - require set name OR a top-position custom field (e.g. player name)
    validate() {
        const data = this.getFormData();
        if (data.set) return true;

        // Check if any top-position custom field has a value
        const hasTopField = Object.entries(this.customFields)
            .some(([name, config]) => (config.position || 'top') === 'top' && data[name]);
        if (hasTopField) return true;

        // Nothing filled in - focus the first visible field
        const topField = Object.entries(this.customFields)
            .find(([_, c]) => (c.position || 'top') === 'top');
        if (topField) {
            alert(`${topField[1].label} or Set Name is required`);
            this.backdrop.querySelector(`#editor-${topField[0]}`)?.focus();
        } else {
            alert('Set name is required');
            this.backdrop.querySelector('#editor-set').focus();
        }
        return false;
    }

    // Check if image URL needs processing (external URL from supported domain)
    needsImageProcessing(url) {
        if (!url) return false;
        // Already a local path, data URL, or R2 URL
        if (url.startsWith(this.imageFolder) || url.startsWith('data:') || url.startsWith(R2_IMAGE_BASE) || !url.startsWith('http')) {
            return false;
        }
        return this.imageProcessor.isProcessableUrl(url);
    }

    // Save card (auto-processes image if needed)
    async save() {
        if (!this.validate()) return;

        const imgUrl = this.backdrop.querySelector('#editor-img').value.trim();

        // Auto-process image if it's from a supported domain and not yet processed
        if (this.needsImageProcessing(imgUrl)) {
            const btn = this.backdrop.querySelector('.card-editor-btn.save');
            const originalText = btn.textContent;
            btn.textContent = 'Processing image...';
            btn.disabled = true;

            try {
                await this.processImage();
            } catch (error) {
                console.error('Auto-process failed:', error);
                // Continue with save even if processing fails
            } finally {
                btn.textContent = originalText;
                btn.disabled = false;
            }
        }

        const data = this.getFormData();

        // Check if set or num changed and eBay search wasn't manually edited
        if (!this.ebayManuallyEdited && this.currentCard) {
            const setChanged = data.set !== (this.currentCard.set || '');
            const numChanged = data.num !== (this.currentCard.num || '');

            if (setChanged || numChanged) {
                // Regenerate search term
                const variant = data.variant || this.currentCard.variant;
                data.search = this.generateSearchTerm(data.set, data.num, variant, data.player);
                // Clear any custom ebay field since we're regenerating
                delete data.ebay;
            }
        }

        // Auto-generate search term if ebay field is empty
        if (!data.ebay) {
            data.search = this.generateSearchTerm(data.set, data.num, data.variant, data.player);
        }

        if (this.isNewCard) {
            this.onSave(null, data, true);
        } else {
            this.onSave(this.currentCardId, data, false);
        }

        // Handle owned state change - always pass data so handler can compute
        // the post-save card ID (card ID changes when data changes)
        if (this.onOwnedChange) {
            const nowOwned = this.backdrop.querySelector('#editor-owned').checked;
            if (nowOwned !== this._initialOwned) {
                this.onOwnedChange(data, nowOwned);
            }
        }

        this.setDirty(false);
        this.backdrop.classList.remove('active');
    }

    // Delete card
    delete() {
        if (!this.currentCardId) return;

        if (confirm('Delete this card? This cannot be undone.')) {
            this.onDelete(this.currentCardId);
            this.setDirty(false);
            this.backdrop.classList.remove('active');
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
        this.scrollHandler = null;
        this.navHeight = 60; // Height of nav bar
        this.restingTop = 68; // Initial position below nav
        this.minTop = 10; // Position when nav scrolled away
    }

    init() {
        if (document.querySelector('.add-card-btn')) return;

        const btn = document.createElement('button');
        btn.className = 'add-card-btn';
        btn.innerHTML = '+ Add Card';
        btn.title = 'Add new card';
        btn.style.display = 'none';
        btn.onclick = () => this.onClick();

        document.body.appendChild(btn);
        this.button = btn;

        // Scroll handler to adjust position as nav scrolls away
        this.scrollHandler = () => {
            const scrollY = window.scrollY;
            const newTop = Math.max(this.minTop, this.restingTop - scrollY);
            this.button.style.top = newTop + 'px';
        };
    }

    show() {
        if (!this.button) this.init();
        this.button.style.display = '';
        this.scrollHandler(); // Set initial position
        window.addEventListener('scroll', this.scrollHandler, { passive: true });
    }

    hide() {
        if (this.button) {
            this.button.style.display = 'none';
        }
        if (this.scrollHandler) {
            window.removeEventListener('scroll', this.scrollHandler);
        }
    }
}

/**
 * DynamicNav - Loads registry from gist and renders nav links dynamically
 * Falls back to hardcoded links if registry isn't available
 */
const DynamicNav = {
    _registry: null,
    _sessionKey: 'checklists-registry',

    // Get cached registry from sessionStorage
    _getCached() {
        try {
            const cached = sessionStorage.getItem(this._sessionKey);
            if (cached) return JSON.parse(cached);
        } catch (e) { /* ignore */ }
        return null;
    },

    _setCache(registry) {
        try {
            sessionStorage.setItem(this._sessionKey, JSON.stringify(registry));
        } catch (e) { /* ignore */ }
    },

    // Load registry (from cache or gist)
    async loadRegistry() {
        if (this._registry) return this._registry;

        // Try sessionStorage cache first
        const cached = this._getCached();
        if (cached) {
            this._registry = cached;
            return cached;
        }

        // Load from gist
        if (typeof githubSync !== 'undefined') {
            const registry = await githubSync.loadRegistry();
            if (registry) {
                this._registry = registry;
                this._setCache(registry);
                return registry;
            }
        }
        return null;
    },

    // Get the URL for a checklist entry
    getUrl(entry) {
        if (entry.type === 'legacy') {
            return entry.href;
        }
        return `checklist.html?id=${entry.id}`;
    },

    // Determine if a nav link is active based on current page
    isActive(entry) {
        const path = window.location.pathname;
        const search = window.location.search;

        if (entry.type === 'legacy') {
            return path.endsWith(entry.href);
        }
        // Dynamic checklist: check ?id= param
        return path.endsWith('checklist.html') && search.includes(`id=${entry.id}`);
    },

    // Add dynamic checklist links to the nav (preserves hardcoded legacy links)
    renderNav(registry) {
        const navLinks = document.querySelector('.nav-links');
        if (!navLinks) return;

        // Only add dynamic entries - legacy links are already hardcoded in HTML
        const dynamicEntries = registry.checklists
            .filter(e => e.type === 'dynamic')
            .sort((a, b) => (a.order || 0) - (b.order || 0));

        // Remove any previously added dynamic links
        navLinks.querySelectorAll('.nav-link[data-dynamic]').forEach(el => el.remove());

        dynamicEntries.forEach(entry => {
            const url = this.getUrl(entry);
            const active = this.isActive(entry) ? ' active' : '';
            const link = document.createElement('a');
            link.href = url;
            link.className = `nav-link${active}`;
            link.dataset.dynamic = 'true';
            link.textContent = entry.navLabel || entry.title;
            navLinks.appendChild(link);
        });
    },

    // Initialize: load registry and update nav
    async init() {
        const registry = await this.loadRegistry();
        if (registry && registry.checklists && registry.checklists.length > 0) {
            this.renderNav(registry);
        }
        // If no registry, hardcoded nav links stay as fallback
    }
};

/**
 * ChecklistCreatorModal - Form for creating new dynamic checklists
 * Also used for editing settings of existing checklists.
 */
class ChecklistCreatorModal {
    constructor(options = {}) {
        this.onCreated = options.onCreated || (() => {});
        this.backdrop = null;
        this.editMode = false;
        this.existingConfig = null;
    }

    // Built-in sort options (always shown as chips). Subtitle fields add dynamic chips automatically.
    static SORT_OPTIONS = {
        'year': 'Year',
        'set': 'Set/Brand',
        'price-low': 'Price Low',
        'price-high': 'Price High',
        'scarcity': 'Scarcity',
    };

    static DEFAULT_SORTS = ['year', 'set', 'price-low', 'price-high'];

    // Options for what "Default" sort means
    static DEFAULT_SORT_MODES = {
        'as-entered': 'As Entered (manual order)',
        'alphabetical': 'Alphabetical (player name)',
        'year': 'Year',
        'set': 'Set/Brand',
    };

    init() {
        if (this.backdrop) return;

        const backdrop = document.createElement('div');
        backdrop.className = 'card-editor-backdrop checklist-creator-backdrop';
        backdrop.innerHTML = `
            <div class="card-editor-modal checklist-creator-modal">
                <div class="card-editor-header">
                    <div>
                        <div class="card-editor-title">CREATE NEW CHECKLIST</div>
                        <div class="card-editor-subtitle">Set up your card collection</div>
                    </div>
                    <button class="card-editor-close" title="Close">&times;</button>
                </div>
                <div class="card-editor-body">
                    <div class="creator-section-label">Info</div>
                    <div class="card-editor-grid">
                        <div class="card-editor-field full-width">
                            <label class="card-editor-label">Checklist Title</label>
                            <input type="text" class="card-editor-input" id="creator-title" placeholder="My Card Collection" title="The main heading displayed at the top of your checklist page">
                        </div>
                        <div class="card-editor-field">
                            <label class="card-editor-label">Subtitle</label>
                            <input type="text" class="card-editor-input" id="creator-subtitle" placeholder="Optional subtitle" title="Smaller text shown below the title on the checklist page">
                        </div>
                        <div class="card-editor-field">
                            <label class="card-editor-label">Nav Label</label>
                            <input type="text" class="card-editor-input" id="creator-nav-label" placeholder="e.g. MY CARDS" maxlength="20" title="Short label shown in the top navigation bar">
                        </div>
                        <div class="card-editor-field full-width">
                            <label class="card-editor-label">Description</label>
                            <textarea class="card-editor-input creator-textarea" id="creator-description" rows="2" placeholder="Short description shown on the home page" title="Brief text shown on the index page card for this checklist"></textarea>
                        </div>
                    </div>

                    <div class="creator-section-divider"></div>
                    <div class="creator-section-label">Theme</div>

                    <div class="creator-theme-row">
                        <div class="creator-color-field" title="Main color used for the page header gradient and accents">
                            <label class="card-editor-label">Primary</label>
                            <div class="creator-color-picker">
                                <input type="color" id="creator-primary-color" value="#667eea">
                                <span class="creator-color-hex" id="creator-primary-hex">#667eea</span>
                            </div>
                        </div>
                        <div class="creator-color-field" title="Secondary color used for buttons, links, and highlights">
                            <label class="card-editor-label">Accent</label>
                            <div class="creator-color-picker">
                                <input type="color" id="creator-accent-color" value="#f39c12">
                                <span class="creator-color-hex" id="creator-accent-hex">#f39c12</span>
                            </div>
                        </div>
                        <label class="card-editor-checkbox creator-dark-toggle" title="Dark background with light text instead of the default light theme">
                            <input type="checkbox" id="creator-dark-theme">
                            <span>Dark theme</span>
                        </label>
                    </div>

                    <div class="creator-section-divider"></div>
                    <div class="creator-section-label">Structure</div>

                    <div class="card-editor-grid">
                        <div class="card-editor-field">
                            <label class="card-editor-checkbox" title="Group cards into named sections with headers. Uncheck for a single flat list.">
                                <input type="checkbox" id="creator-use-sections" checked>
                                <span>Organize cards into sections</span>
                            </label>
                        </div>
                        <div class="card-editor-field full-width" id="creator-categories-field">
                            <label class="card-editor-label">Sections</label>
                            <div class="creator-row-list" id="creator-categories-list"></div>
                            <button type="button" class="creator-add-row" id="creator-add-category">+ Add Section</button>
                        </div>
                    </div>

                    <div class="creator-section-divider"></div>
                    <div class="creator-section-label">Display</div>

                    <div class="creator-display-grid">
                        <div class="card-editor-field">
                            <label class="card-editor-label" title="How cards are ordered within each section by default">Default Sort</label>
                            <select class="card-editor-input card-editor-select" id="creator-default-sort" title="The sort applied when viewing the checklist normally"></select>
                            <label class="card-editor-checkbox" style="margin-top: 8px;" title="Show a player name field on each card. Useful for checklists organized by player.">
                                <input type="checkbox" id="creator-show-player">
                                <span>Show player name on cards</span>
                            </label>
                        </div>
                        <div class="card-editor-field">
                            <label class="card-editor-label" title="Extra sort options available in the sort dropdown on the checklist page">Additional Sorts</label>
                            <div class="creator-sort-chips" id="creator-sort-chips" title="Click to toggle each sort option on or off"></div>
                        </div>
                    </div>

                    <div class="creator-section-divider"></div>
                    <div class="creator-section-label">Card Details</div>

                    <div class="creator-subsection-label" title="Custom text lines shown below the player name on each card">Subtitle Lines</div>
                    <div class="creator-hint" style="margin-bottom: 6px;">Text fields shown below the player name on each card</div>
                    <div class="creator-row-list" id="creator-subtitle-lines-list"></div>
                    <button type="button" class="creator-add-row" id="creator-add-subtitle-line">+ Add Subtitle Line</button>


                    <div class="creator-subsection-label" style="margin-top: 14px;" title="Toggle which attribute fields appear in the card editor">Attributes</div>
                    <div class="creator-options-row">
                        <label class="card-editor-checkbox" title="Text field for card variant (e.g. Silver Prizm, Blue Shimmer)">
                            <input type="checkbox" id="creator-attr-variant" checked>
                            <span>Variant</span>
                        </label>
                        <label class="card-editor-checkbox" title="Checkbox to mark autographed cards. Shows a gold AUTO badge.">
                            <input type="checkbox" id="creator-attr-auto" checked>
                            <span>Auto</span>
                        </label>
                        <label class="card-editor-checkbox" title="Checkbox to mark patch/relic cards. Shows a purple PATCH badge.">
                            <input type="checkbox" id="creator-attr-patch" checked>
                            <span>Patch</span>
                        </label>
                        <label class="card-editor-checkbox" title="Text field for serial numbered cards (e.g. /99, /25). Shows a serial badge.">
                            <input type="checkbox" id="creator-attr-serial" checked>
                            <span>Serial</span>
                        </label>
                    </div>

                    <div class="creator-subsection-label" style="margin-top: 14px;" title="Dollar thresholds for price badge colors: green (below mid), orange (mid to high), red (above high)">Price Badge Colors</div>
                    <div class="creator-price-thresholds">
                        <label title="Cards priced at or above this amount show an orange badge">
                            <span class="creator-threshold-color" style="background: var(--color-warning, #ff9800)"></span>
                            <span>$</span><input type="text" inputmode="numeric" id="creator-threshold-mid" value="3" class="creator-threshold-input">
                        </label>
                        <label title="Cards priced at or above this amount show a red badge">
                            <span class="creator-threshold-color" style="background: var(--color-error, #f44336)"></span>
                            <span>$</span><input type="text" inputmode="numeric" id="creator-threshold-high" value="10" class="creator-threshold-input">
                        </label>
                        <span class="creator-threshold-hint"><span>Cards below $<span id="creator-threshold-mid-label">3</span> are</span> <span class="creator-threshold-color" style="background: var(--color-success, #4caf50)"></span></span>
                    </div>

                </div>
                <div class="card-editor-footer">
                    <button class="card-editor-btn save" id="creator-save">Create Checklist</button>
                    <button class="card-editor-btn cancel" id="creator-cancel">Cancel</button>
                </div>
            </div>
        `;

        backdrop.querySelector('.card-editor-close').onclick = () => this.close();
        backdrop.querySelector('#creator-cancel').onclick = () => this.close();
        backdrop.querySelector('#creator-save').onclick = () => this.save();
        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) this.close();
        });

        // Toggle sections visibility
        backdrop.querySelector('#creator-use-sections').addEventListener('change', (e) => {
            if (!e.target.checked && this.editMode && this.existingConfig?.dataShape !== 'flat') {
                if (!confirm('Removing sections will move all cards into a single flat list. Card section assignments will be lost. Continue?')) {
                    e.target.checked = true;
                    return;
                }
            }
            backdrop.querySelector('#creator-categories-field').style.display = e.target.checked ? '' : 'none';
        });

        // Sync color hex displays
        backdrop.querySelector('#creator-primary-color').addEventListener('input', (e) => {
            backdrop.querySelector('#creator-primary-hex').textContent = e.target.value;
        });
        backdrop.querySelector('#creator-accent-color').addEventListener('input', (e) => {
            backdrop.querySelector('#creator-accent-hex').textContent = e.target.value;
        });

        // Update green hint when mid threshold changes
        // Price threshold validation
        const validateThreshold = (input, fallback) => {
            let val = parseInt(input.value);
            if (isNaN(val) || val < 0) val = fallback;
            input.value = val;
            return val;
        };
        const midInput = backdrop.querySelector('#creator-threshold-mid');
        const highInput = backdrop.querySelector('#creator-threshold-high');
        const midLabel = backdrop.querySelector('#creator-threshold-mid-label');
        midInput.addEventListener('input', () => {
            midLabel.textContent = parseInt(midInput.value) || 0;
        });
        midInput.addEventListener('blur', () => {
            const mid = validateThreshold(midInput, 3);
            midLabel.textContent = mid;
            const high = parseInt(highInput.value) || 10;
            if (mid >= high) highInput.value = mid + 1;
        });
        highInput.addEventListener('blur', () => {
            const high = validateThreshold(highInput, 10);
            const mid = parseInt(midInput.value) || 3;
            if (high <= mid) highInput.value = mid + 1;
        });

        // Add category / subtitle line buttons
        backdrop.querySelector('#creator-add-category').onclick = () => this._addCategoryRow();
        backdrop.querySelector('#creator-add-subtitle-line').onclick = () => this._addSubtitleLineRow();

        this.backdrop = backdrop;
        document.body.appendChild(backdrop);
        this._trackDirty();
    }

    open() {
        this.init();
        this.editMode = false;
        this.existingConfig = null;
        this.isDirty = false;
        this.backdrop.querySelector('.card-editor-title').textContent = 'CREATE NEW CHECKLIST';
        this.backdrop.querySelector('.card-editor-subtitle').textContent = 'Set up your card collection';
        this.backdrop.querySelector('#creator-save').textContent = 'Create Checklist';
        this._clearForm();
        this.backdrop.classList.add('active');
        this.backdrop.querySelector('#creator-title').focus();
    }

    openEdit(config) {
        this.init();
        this.editMode = true;
        this.existingConfig = config;
        this.isDirty = false;
        this.backdrop.querySelector('.card-editor-title').textContent = 'CHECKLIST SETTINGS';
        this.backdrop.querySelector('.card-editor-subtitle').textContent = 'Edit checklist configuration';
        this.backdrop.querySelector('#creator-save').textContent = 'Save Settings';
        this._populateForm(config);
        this.backdrop.classList.add('active');
    }

    close() {
        if (this.isDirty) {
            if (!confirm('You have unsaved changes. Close anyway?')) return;
        }
        if (this.backdrop) {
            this.backdrop.classList.remove('active');
        }
    }

    _trackDirty() {
        const modal = this.backdrop.querySelector('.card-editor-modal');
        modal.addEventListener('input', () => { this.isDirty = true; });
        modal.addEventListener('change', () => { this.isDirty = true; });
    }

    // ---- Sort options ----

    _renderSortControls(activeSorts, defaultSortMode, subtitleLines) {
        // Default sort dropdown
        const select = this.backdrop.querySelector('#creator-default-sort');
        if (select) {
            this._rebuildDefaultSortDropdown(defaultSortMode, subtitleLines);
        }

        // Sort chips (additional sorts beyond default)
        this._renderSortChips(activeSorts);
    }

    _renderSortChips(activeSorts) {
        const container = this.backdrop.querySelector('#creator-sort-chips');
        if (!container) return;

        // Remember currently active chips before rebuild
        const currentActive = activeSorts || this._getActiveChipKeys();
        container.innerHTML = '';

        // Built-in sort options
        Object.entries(ChecklistCreatorModal.SORT_OPTIONS).forEach(([key, label]) => {
            this._appendSortChip(container, key, label, currentActive.includes(key));
        });

        // Dynamic chips from subtitle lines
        const subtitleLines = this._getSubtitleLinesFromForm();
        subtitleLines.forEach(line => {
            const key = `field:${line.key}`;
            this._appendSortChip(container, key, line.label, currentActive.includes(key));
        });
    }

    _appendSortChip(container, key, label, isActive) {
        const chip = document.createElement('span');
        chip.className = 'creator-sort-chip' + (isActive ? ' active' : '');
        chip.textContent = label;
        chip.dataset.sort = key;
        chip.onclick = () => chip.classList.toggle('active');
        container.appendChild(chip);
    }

    _getActiveChipKeys() {
        const chips = this.backdrop.querySelectorAll('#creator-sort-chips .creator-sort-chip.active');
        return Array.from(chips).map(c => c.dataset.sort);
    }

    _refreshSortControls() {
        this._renderSortChips();
        this._refreshDefaultSortDropdown();
    }

    _refreshDefaultSortDropdown() {
        const select = this.backdrop.querySelector('#creator-default-sort');
        if (!select) return;
        const currentValue = select.value;
        this._rebuildDefaultSortDropdown(currentValue);
        if ([...select.options].some(o => o.value === currentValue)) {
            select.value = currentValue;
        }
    }

    _rebuildDefaultSortDropdown(selectedValue, subtitleLines) {
        const select = this.backdrop.querySelector('#creator-default-sort');
        if (!select) return;
        select.innerHTML = '';

        // Base modes (As Entered, Alphabetical, Year, Set/Brand)
        Object.entries(ChecklistCreatorModal.DEFAULT_SORT_MODES).forEach(([key, label]) => {
            const opt = document.createElement('option');
            opt.value = key;
            opt.textContent = label;
            select.appendChild(opt);
        });

        // Chip-based sorts (Price Low, Price High, Scarcity)
        Object.entries(ChecklistCreatorModal.SORT_OPTIONS).forEach(([key, label]) => {
            if (ChecklistCreatorModal.DEFAULT_SORT_MODES[key]) return;
            const opt = document.createElement('option');
            opt.value = key;
            opt.textContent = label;
            select.appendChild(opt);
        });

        // Subtitle line fields
        const lines = subtitleLines || this._getSubtitleLinesFromForm();
        lines.forEach(line => {
            const opt = document.createElement('option');
            opt.value = `field:${line.key}`;
            opt.textContent = `${line.label} (custom field)`;
            select.appendChild(opt);
        });

        select.value = selectedValue || 'as-entered';

        // Auto-enable chip when a sort chip option is selected as default
        select.onchange = () => {
            const val = select.value;
            const chip = this.backdrop.querySelector(`#creator-sort-chips .creator-sort-chip[data-sort="${val}"]`);
            if (chip && !chip.classList.contains('active')) chip.classList.add('active');
        };
    }

    _getSortOptionsFromForm() {
        const chips = this.backdrop.querySelectorAll('#creator-sort-chips .creator-sort-chip.active');
        // Always include 'default' as first option, then the selected additional sorts
        return ['default', ...Array.from(chips).map(c => c.dataset.sort)];
    }

    // ---- Category rows ----

    _slugify(label) {
        return label.toLowerCase()
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .substring(0, 30) || 'cat';
    }

    _addCategoryRow(data, parentEl) {
        const list = parentEl || this.backdrop.querySelector('#creator-categories-list');
        const row = document.createElement('div');
        row.className = 'creator-row-wrap';
        if (parentEl) row.classList.add('creator-subcategory');

        const colors = this._extractGradientColors(data?.gradient);
        const themePrimary = this.backdrop.querySelector('#creator-primary-color').value || '#667eea';
        const themeDark = this._darkenColor(themePrimary, 0.45);
        const color1 = colors[0] || (parentEl ? themeDark : themePrimary);
        const color2 = colors[1] || (parentEl ? this._darkenColor(themeDark, 0.3) : themeDark);
        const label = data?.label || '';
        const id = data?.id || '';
        const isMain = data ? data.isMain !== false : true;
        const note = data?.note || '';
        const isExisting = this.editMode && !!data?.id;
        const isParent = !parentEl;

        row.innerHTML = `
            <div class="creator-row-main">
                <input type="color" value="${color1}" title="Gradient start color">
                <input type="color" value="${color2}" title="Gradient end color">
                <div class="creator-row-label">
                    <input type="text" placeholder="${isParent ? 'Section name' : 'Subsection name'}" value="${this._escAttr(label)}">
                </div>
                <span class="creator-row-id ${isExisting ? 'locked' : ''}">${this._escHtml(id)}</span>
                ${isParent ? `<label class="creator-row-extra" title="Include this section in the main totals">
                    <input type="checkbox" ${isMain ? 'checked' : ''}>
                    <span>Counts</span>
                </label>
                <label class="creator-row-index ${isMain ? 'hidden' : ''}" title="Feature this section's stats on the homepage card">
                    <input type="checkbox" ${data?.showOnIndex ? 'checked' : ''}>
                    <span>Feature</span>
                </label>` : ''}
                <div class="creator-row-arrows">
                    <button type="button" class="creator-row-up" title="Move up">&#9650;</button>
                    <button type="button" class="creator-row-down" title="Move down">&#9660;</button>
                </div>
                <button type="button" class="creator-row-remove" title="Remove">&times;</button>
            </div>
            ${isParent ? `<div class="creator-row-note">
                <input type="text" placeholder="Note (shown under header)" value="${this._escAttr(note)}">
            </div>` : ''}
            ${isParent ? `<div class="creator-subcategory-list"></div>
            <button type="button" class="creator-add-subcategory">+ Subsection</button>` : ''}
        `;

        // Auto-generate ID from label (new categories only)
        const labelInput = row.querySelector('.creator-row-label input');
        const idSpan = row.querySelector('.creator-row-id');
        if (!isExisting) {
            labelInput.addEventListener('input', () => {
                idSpan.textContent = this._slugify(labelInput.value);
            });
        }

        // Counts checkbox toggles Feature visibility (Feature only available for non-counted sections)
        const countsCheckbox = row.querySelector('.creator-row-extra input');
        const indexLabel = row.querySelector('.creator-row-index');
        if (countsCheckbox && indexLabel) {
            countsCheckbox.onchange = () => {
                indexLabel.classList.toggle('hidden', countsCheckbox.checked);
                if (countsCheckbox.checked) indexLabel.querySelector('input').checked = false;
                this._updateIndexPillLimit();
            };
            // Index checkbox change updates limit state
            indexLabel.querySelector('input').onchange = () => this._updateIndexPillLimit();
        }

        // Remove button
        row.querySelector('.creator-row-remove').onclick = () => { row.remove(); this._updateIndexPillLimit(); };

        // Reorder arrows
        row.querySelector('.creator-row-up').onclick = () => {
            const prev = row.previousElementSibling;
            if (prev) {
                row.parentNode.insertBefore(row, prev);
                row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                row.classList.add('creator-row-flash');
                row.addEventListener('animationend', () => row.classList.remove('creator-row-flash'), { once: true });
            }
        };
        row.querySelector('.creator-row-down').onclick = () => {
            const next = row.nextElementSibling;
            if (next) {
                row.parentNode.insertBefore(next, row);
                row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                row.classList.add('creator-row-flash');
                row.addEventListener('animationend', () => row.classList.remove('creator-row-flash'), { once: true });
            }
        };

        // Add subcategory button (parent rows only)
        const addSubBtn = row.querySelector('.creator-add-subcategory');
        if (addSubBtn) {
            addSubBtn.onclick = () => {
                const subList = row.querySelector('.creator-subcategory-list');
                this._addCategoryRow(null, subList);
            };
        }

        list.appendChild(row);
        if (!data) labelInput.focus();

        // Populate existing children
        if (isParent && data?.children?.length > 0) {
            const subList = row.querySelector('.creator-subcategory-list');
            data.children.forEach(child => this._addCategoryRow(child, subList));
        }
    }

    _extractGradientColors(gradient) {
        if (!gradient) return [];
        const matches = gradient.match(/#[0-9a-fA-F]{6}/g);
        return matches || [];
    }

    _dedupeId(id, usedIds) {
        let unique = id;
        let suffix = 2;
        while (usedIds.has(unique)) {
            unique = `${id}-${suffix}`;
            suffix++;
        }
        usedIds.add(unique);
        return unique;
    }

    _updateIndexPillLimit() {
        const indexCheckboxes = this.backdrop.querySelectorAll('.creator-row-index input[type="checkbox"]');
        const checkedCount = [...indexCheckboxes].filter(cb => cb.checked).length;
        const atLimit = checkedCount >= 3;
        indexCheckboxes.forEach(cb => {
            if (!cb.checked) {
                cb.disabled = atLimit;
                cb.closest('.creator-row-index').title = atLimit
                    ? 'Maximum of 3 featured sections reached'
                    : 'Feature this section\'s stats on the homepage card';
            }
        });
    }

    _getCategoriesFromForm() {
        // Only get top-level rows (not subcategories nested inside)
        const rows = this.backdrop.querySelectorAll('#creator-categories-list > .creator-row-wrap');
        const categories = [];
        const usedIds = new Set();
        rows.forEach(row => {
            const label = row.querySelector(':scope > .creator-row-main .creator-row-label input').value.trim();
            if (!label) return;
            const idText = row.querySelector(':scope > .creator-row-main .creator-row-id').textContent.trim();
            const id = this._dedupeId(idText || this._slugify(label), usedIds);
            const colors = row.querySelectorAll(':scope > .creator-row-main input[type="color"]');
            const themePrimary = this.backdrop.querySelector('#creator-primary-color').value || '#667eea';
            const themeDark = this._darkenColor(themePrimary, 0.45);
            const color1 = colors[0]?.value || themePrimary;
            const color2 = colors[1]?.value || themeDark;
            const countsInput = row.querySelector(':scope > .creator-row-main .creator-row-extra input');
            const isMain = countsInput ? countsInput.checked : true;
            const indexInput = row.querySelector(':scope > .creator-row-main .creator-row-index input');
            const showOnIndex = indexInput ? indexInput.checked : false;
            const noteInput = row.querySelector(':scope > .creator-row-note input');
            const note = noteInput ? noteInput.value.trim() : '';

            const cat = { id, label, isMain };
            // Only store gradient if it differs from the theme default
            if (color1 !== themePrimary || color2 !== themeDark) {
                cat.gradient = `linear-gradient(135deg, ${color1}, ${color2})`;
            }
            if (note) cat.note = note;
            if (showOnIndex) cat.showOnIndex = true;

            // Collect subcategories
            const subRows = row.querySelectorAll(':scope > .creator-subcategory-list > .creator-row-wrap');
            if (subRows.length > 0) {
                cat.children = [];
                subRows.forEach(subRow => {
                    const subLabel = subRow.querySelector('.creator-row-label input').value.trim();
                    if (!subLabel) return;
                    const subIdText = subRow.querySelector('.creator-row-id').textContent.trim();
                    const subId = this._dedupeId(subIdText || this._slugify(subLabel), usedIds);
                    const subColors = subRow.querySelectorAll('input[type="color"]');
                    const subDefault1 = this._darkenColor(themePrimary, 0.45);
                    const subDefault2 = this._darkenColor(subDefault1, 0.3);
                    const sc1 = subColors[0]?.value || subDefault1;
                    const sc2 = subColors[1]?.value || subDefault2;
                    const child = { id: subId, label: subLabel };
                    // Only store gradient if non-default
                    if (sc1 !== subDefault1 || sc2 !== subDefault2) {
                        child.gradient = `linear-gradient(135deg, ${sc1}, ${sc2})`;
                    }
                    cat.children.push(child);
                });
                if (cat.children.length === 0) delete cat.children;
            }

            categories.push(cat);
        });
        return categories;
    }

    // ---- Subtitle line rows ----

    _addSubtitleLineRow(data) {
        const list = this.backdrop.querySelector('#creator-subtitle-lines-list');
        const row = document.createElement('div');
        row.className = 'creator-row';

        const color = data?.color || '#888888';
        const label = data?.label || '';
        const key = data?.key || '';
        const pill = data?.pill || false;
        const isExisting = this.editMode && !!data?.key;

        row.innerHTML = `
            <input type="color" value="${color}" title="Text color for this line">
            <button type="button" class="creator-pill-toggle ${pill ? 'active' : ''}" title="Toggle pill background">pill</button>
            <div class="creator-row-label">
                <input type="text" placeholder="Field label (e.g. Years Active)" value="${this._escAttr(label)}">
            </div>
            <span class="creator-row-id ${isExisting ? 'locked' : ''}">${this._escHtml(key)}</span>
            <div class="creator-row-arrows">
                <button type="button" class="creator-row-up" title="Move up">&#9650;</button>
                <button type="button" class="creator-row-down" title="Move down">&#9660;</button>
            </div>
            <button type="button" class="creator-row-remove" title="Remove">&times;</button>
        `;

        row.querySelector('.creator-pill-toggle').onclick = (e) => {
            e.currentTarget.classList.toggle('active');
        };

        const labelInput = row.querySelector('.creator-row-label input');
        const idSpan = row.querySelector('.creator-row-id');
        if (!isExisting) {
            labelInput.addEventListener('input', () => {
                idSpan.textContent = this._slugify(labelInput.value);
                this._refreshSortControls();
            });
        }

        row.querySelector('.creator-row-up').onclick = () => {
            const prev = row.previousElementSibling;
            if (prev) {
                row.parentNode.insertBefore(row, prev);
                row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                row.classList.add('creator-row-flash');
                row.addEventListener('animationend', () => row.classList.remove('creator-row-flash'), { once: true });
            }
        };
        row.querySelector('.creator-row-down').onclick = () => {
            const next = row.nextElementSibling;
            if (next) {
                row.parentNode.insertBefore(next, row);
                row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                row.classList.add('creator-row-flash');
                row.addEventListener('animationend', () => row.classList.remove('creator-row-flash'), { once: true });
            }
        };
        row.querySelector('.creator-row-remove').onclick = () => {
            row.remove();
            this._refreshSortControls();
        };
        list.appendChild(row);
        if (!data) labelInput.focus();
        this._refreshSortControls();
    }

    _getSubtitleLinesFromForm() {
        const rows = this.backdrop.querySelectorAll('#creator-subtitle-lines-list .creator-row');
        const lines = [];
        rows.forEach(row => {
            const label = row.querySelector('.creator-row-label input').value.trim();
            if (!label) return;
            const idText = row.querySelector('.creator-row-id').textContent.trim();
            const key = idText || this._slugify(label);
            const color = row.querySelector('input[type="color"]').value;
            const pill = row.querySelector('.creator-pill-toggle')?.classList.contains('active') || false;
            lines.push({ key, label, color, pill });
        });
        return lines;
    }

    // ---- HTML helpers ----

    _escAttr(str) {
        return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    }

    _escHtml(str) {
        return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    _darkenColor(hex, amount) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        const dr = Math.round(r * (1 - amount));
        const dg = Math.round(g * (1 - amount));
        const db = Math.round(b * (1 - amount));
        return `#${dr.toString(16).padStart(2, '0')}${dg.toString(16).padStart(2, '0')}${db.toString(16).padStart(2, '0')}`;
    }

    // ---- Form clear / populate ----

    _clearForm() {
        this.backdrop.querySelector('#creator-title').value = '';
        this.backdrop.querySelector('#creator-subtitle').value = '';
        this.backdrop.querySelector('#creator-nav-label').value = '';
        this.backdrop.querySelector('#creator-primary-color').value = '#667eea';
        this.backdrop.querySelector('#creator-primary-hex').textContent = '#667eea';
        this.backdrop.querySelector('#creator-accent-color').value = '#f39c12';
        this.backdrop.querySelector('#creator-accent-hex').textContent = '#f39c12';
        this.backdrop.querySelector('#creator-dark-theme').checked = false;
        this.backdrop.querySelector('#creator-use-sections').checked = true;
        this.backdrop.querySelector('#creator-show-player').checked = false;
        this.backdrop.querySelector('#creator-description').value = '';

        // Reset attribute checkboxes to checked
        this.backdrop.querySelector('#creator-attr-variant').checked = true;
        this.backdrop.querySelector('#creator-attr-auto').checked = true;
        this.backdrop.querySelector('#creator-attr-patch').checked = true;
        this.backdrop.querySelector('#creator-attr-serial').checked = true;

        // Reset price thresholds
        this.backdrop.querySelector('#creator-threshold-mid').value = '3';
        this.backdrop.querySelector('#creator-threshold-high').value = '10';
        this.backdrop.querySelector('#creator-threshold-mid-label').textContent = '3';

        // Show categories
        this.backdrop.querySelector('#creator-categories-field').style.display = '';

        // Reset category rows - add one default
        this.backdrop.querySelector('#creator-categories-list').innerHTML = '';
        this._addCategoryRow({ id: 'base', label: 'Base Cards', isMain: true });

        // Clear subtitle lines
        this.backdrop.querySelector('#creator-subtitle-lines-list').innerHTML = '';

        // Reset sort controls to defaults
        this._renderSortControls(ChecklistCreatorModal.DEFAULT_SORTS, 'as-entered');
    }

    _populateForm(config) {
        const primaryColor = config.theme?.primaryColor || '#667eea';
        const accentColor = config.theme?.accentColor || '#f39c12';
        this.backdrop.querySelector('#creator-title').value = config.title || '';
        this.backdrop.querySelector('#creator-subtitle').value = config.subtitle || '';
        this.backdrop.querySelector('#creator-nav-label').value = config.navLabel || '';
        this.backdrop.querySelector('#creator-primary-color').value = primaryColor;
        this.backdrop.querySelector('#creator-primary-hex').textContent = primaryColor;
        this.backdrop.querySelector('#creator-accent-color').value = accentColor;
        this.backdrop.querySelector('#creator-accent-hex').textContent = accentColor;
        this.backdrop.querySelector('#creator-dark-theme').checked = config.theme?.darkTheme || false;
        this.backdrop.querySelector('#creator-use-sections').checked = config.dataShape !== 'flat';
        this.backdrop.querySelector('#creator-show-player').checked = config.cardDisplay?.showPlayerName !== false;
        this.backdrop.querySelector('#creator-description').value = config.indexCard?.description || '';

        // Categories as rows
        this.backdrop.querySelector('#creator-categories-list').innerHTML = '';
        if (config.categories && config.categories.length > 0) {
            config.categories.forEach(c => this._addCategoryRow(c));
        } else {
            this._addCategoryRow({ id: 'base', label: 'Base Cards', isMain: true });
        }
        this._updateIndexPillLimit();

        // Subtitle lines: extract from customFields (position: 'bottom', type: 'text', key != 'player')
        this.backdrop.querySelector('#creator-subtitle-lines-list').innerHTML = '';
        if (config.customFields) {
            Object.entries(config.customFields).forEach(([key, field]) => {
                if (field.position === 'bottom' && field.type === 'text' && key !== 'player') {
                    this._addSubtitleLineRow({ key, label: field.label, color: field.color || '#888888', pill: field.pill || false });
                }
            });
        }

        // Attribute toggles (default to checked if no customFields yet, otherwise check if present)
        const cf = config.customFields || {};
        this.backdrop.querySelector('#creator-attr-variant').checked = !config.customFields || 'variant' in cf;
        this.backdrop.querySelector('#creator-attr-auto').checked = !config.customFields || 'auto' in cf;
        this.backdrop.querySelector('#creator-attr-patch').checked = !config.customFields || 'patch' in cf;
        this.backdrop.querySelector('#creator-attr-serial').checked = !config.customFields || 'serial' in cf;

        // Price thresholds
        const thresholds = config.cardDisplay?.priceThresholds || { mid: 3, high: 10 };
        this.backdrop.querySelector('#creator-threshold-mid').value = thresholds.mid;
        this.backdrop.querySelector('#creator-threshold-high').value = thresholds.high;
        this.backdrop.querySelector('#creator-threshold-mid-label').textContent = thresholds.mid;

        // Sort options - extract subtitle lines for the default sort dropdown
        const subtitleLines = [];
        if (config.customFields) {
            Object.entries(config.customFields).forEach(([key, field]) => {
                if (field.position === 'bottom' && field.type === 'text' && key !== 'player') {
                    subtitleLines.push({ key, label: field.label });
                }
            });
        }
        const activeSorts = (config.sortOptions || ChecklistCreatorModal.DEFAULT_SORTS).filter(s => s !== 'default');
        this._renderSortControls(activeSorts, config.defaultSortMode || 'as-entered', subtitleLines);

        // Toggle visibility
        const useSections = config.dataShape !== 'flat';
        this.backdrop.querySelector('#creator-categories-field').style.display = useSections ? '' : 'none';
    }

    _generateId(title) {
        return title.toLowerCase()
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .substring(0, 40);
    }

    _buildConfig() {
        const title = this.backdrop.querySelector('#creator-title').value.trim();
        if (!title) {
            alert('Title is required');
            return null;
        }

        const navLabel = this.backdrop.querySelector('#creator-nav-label').value.trim();
        if (!navLabel) {
            alert('Nav label is required');
            return null;
        }

        const id = this.editMode ? this.existingConfig.id : this._generateId(title);
        const useSections = this.backdrop.querySelector('#creator-use-sections').checked;
        const dataShape = useSections ? 'categories' : 'flat';

        // Start from existing config in edit mode to preserve unmanaged properties
        const config = this.editMode
            ? JSON.parse(JSON.stringify(this.existingConfig))
            : {};

        // Overlay form values
        config.id = id;
        config.title = title;
        config.subtitle = this.backdrop.querySelector('#creator-subtitle').value.trim() || undefined;
        config.navLabel = navLabel;
        const primaryColor = this.backdrop.querySelector('#creator-primary-color').value;
        config.theme = {
            ...(config.theme || {}),
            primaryColor,
            accentColor: this.backdrop.querySelector('#creator-accent-color').value,
            darkColor: this._darkenColor(primaryColor, 0.45),
            darkTheme: this.backdrop.querySelector('#creator-dark-theme').checked,
        };
        config.dataShape = dataShape;
        const midThreshold = parseInt(this.backdrop.querySelector('#creator-threshold-mid').value) || 3;
        const highThreshold = parseInt(this.backdrop.querySelector('#creator-threshold-high').value) || 10;
        config.cardDisplay = {
            ...(config.cardDisplay || {}),
            priceMode: 'explicit',
            showPlayerName: this.backdrop.querySelector('#creator-show-player').checked,
            priceThresholds: { mid: midThreshold, high: highThreshold },
        };

        // Build customFields from form
        const customFields = {};

        // Player field (if showing player names)
        if (config.cardDisplay.showPlayerName) {
            customFields.player = { label: 'Player Name', type: 'text', fullWidth: true };
            config.cardDisplay.includePlayerInCardId = true;
        } else {
            delete config.cardDisplay.includePlayerInCardId;
        }

        // Subtitle lines
        const subtitleLines = this._getSubtitleLinesFromForm();
        subtitleLines.forEach(line => {
            customFields[line.key] = {
                label: line.label,
                type: 'text',
                position: 'bottom',
                color: line.color !== '#888888' ? line.color : undefined,
                pill: line.pill || undefined,
            };
        });

        // Standard attribute fields (toggleable)
        if (this.backdrop.querySelector('#creator-attr-variant').checked) {
            customFields.variant = { label: 'Variant', type: 'text', placeholder: 'Silver Prizm', fullWidth: true, position: 'attributes' };
        }
        if (this.backdrop.querySelector('#creator-attr-auto').checked) {
            customFields.auto = { label: 'Auto', type: 'checkbox', position: 'attributes' };
        }
        if (this.backdrop.querySelector('#creator-attr-patch').checked) {
            customFields.patch = { label: 'Patch', type: 'checkbox', position: 'attributes' };
        }
        if (this.backdrop.querySelector('#creator-attr-serial').checked) {
            customFields.serial = { label: 'Run', type: 'text', inputType: 'number', placeholder: '99', position: 'attributes' };
        }


        config.customFields = customFields;

        // Sort options from chips (always includes 'default' first)
        config.sortOptions = this._getSortOptionsFromForm();

        // Default sort mode
        const defaultSortMode = this.backdrop.querySelector('#creator-default-sort').value;
        config.defaultSortMode = defaultSortMode !== 'as-entered' ? defaultSortMode : undefined;

        config.indexCard = {
            ...(config.indexCard || {}),
            description: this.backdrop.querySelector('#creator-description').value.trim() || undefined,
        };

        // Parse categories or flat
        if (useSections) {
            const categories = this._getCategoriesFromForm();
            if (categories.length === 0) {
                alert('At least one section is required');
                return null;
            }
            config.categories = categories;
            delete config.groups;
            delete config.groupField;
        } else {
            delete config.categories;
            delete config.groups;
            delete config.groupField;
        }

        // Clean undefined values at top level
        Object.keys(config).forEach(k => { if (config[k] === undefined) delete config[k]; });

        return config;
    }

    async save() {
        const config = this._buildConfig();
        if (!config) return;

        const saveBtn = this.backdrop.querySelector('#creator-save');
        saveBtn.disabled = true;
        saveBtn.textContent = this.editMode ? 'Saving...' : 'Creating...';

        // Extract extra category pills for the registry (max 3)
        const extraPills = (config.categories || [])
            .filter(c => c.showOnIndex)
            .slice(0, 3)
            .map(c => ({ id: c.id, label: c.label }));

        try {
            if (this.editMode) {
                // Save updated config
                const success = await githubSync.saveChecklistConfig(config.id, config);
                if (!success) throw new Error('Failed to save config');

                // Config saved - update local state (and migrate cards if shape changed)
                this.isDirty = false;
                this.close();
                await this.onCreated(config);

                // Best-effort: update registry (nav label, pills, etc.)
                try {
                    const registry = await githubSync.loadRegistry();
                    if (registry) {
                        const entry = registry.checklists.find(c => c.id === config.id);
                        if (entry) {
                            entry.title = config.title;
                            entry.navLabel = config.navLabel;
                            entry.description = config.indexCard?.description || '';
                            entry.accentColor = config.theme?.accentColor || config.theme?.primaryColor || '#667eea';
                            entry.borderColor = config.theme?.primaryColor || '#667eea';
                            entry.extraPills = extraPills.length > 0 ? extraPills : undefined;
                            await githubSync.saveRegistry(registry);
                        }
                    }
                    DynamicNav._registry = null;
                    sessionStorage.removeItem(DynamicNav._sessionKey);
                } catch (regError) {
                    console.warn('Config saved but registry update failed:', regError);
                }
                return;
            } else {
                // Load or create registry
                let registry = await githubSync.loadRegistry();
                if (!registry) {
                    registry = { checklists: [] };
                }

                // Check for ID conflict
                if (registry.checklists.find(c => c.id === config.id)) {
                    alert('A checklist with this ID already exists. Try a different title.');
                    return;
                }

                // Add to registry
                registry.checklists.push({
                    id: config.id,
                    title: config.title,
                    navLabel: config.navLabel,
                    description: config.indexCard?.description || '',
                    accentColor: config.theme?.accentColor || config.theme?.primaryColor || '#667eea',
                    borderColor: config.theme?.primaryColor || '#667eea',
                    extraPills: extraPills.length > 0 ? extraPills : undefined,
                    type: 'dynamic',
                    order: registry.checklists.length,
                });

                // Create checklist (config + empty cards + updated registry)
                const success = await githubSync.createChecklist(config.id, config, registry);
                if (!success) throw new Error('Failed to create checklist');

                // Clear nav cache
                DynamicNav._registry = null;
                sessionStorage.removeItem(DynamicNav._sessionKey);
            }

            this.isDirty = false;
            this.close();
            this.onCreated(config);
        } catch (error) {
            console.error('Failed to save checklist:', error);
            alert('Failed to save: ' + error.message);
        } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = this.editMode ? 'Save Settings' : 'Create Checklist';
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
window.CardEditorModal = CardEditorModal;
window.AddCardButton = AddCardButton;
window.ImageProcessor = ImageProcessor;
window.ImageEditorModal = ImageEditorModal;
window.imageEditor = imageEditor;
window.AuthUI = AuthUI;
window.DynamicNav = DynamicNav;
window.ChecklistCreatorModal = ChecklistCreatorModal;
