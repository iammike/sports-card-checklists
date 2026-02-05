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
 * Card data utilities - parsing and display helpers
 */
const CardUtils = {
    // Known parallel patterns (color/finish variants)
    parallelPatterns: [
        /\b(Silver|Gold|Red|Blue|Green|Orange|Purple|Pink|Black|White|Bronze|Platinum)\s*(Prizm|Refractor|Wave|Shimmer|Ice|Holo)?\b/i,
        /\b(Prizm|Refractor|Wave|Shimmer|Ice|Holo)\b/i,
        /\b(Mojo|Velocity|Disco|Laser|Speckle|Camo|Tie-Dye|Snakeskin)\b/i,
    ],

    // Parse print run from string (e.g., "/199" -> 199)
    parsePrintRun(str) {
        if (!str) return null;
        const match = str.match(/\/(\d+)/);
        return match ? parseInt(match[1], 10) : null;
    },

    // Parse name field into variant/parallel/printRun
    parseName(name) {
        if (!name) return { variant: null, parallel: null, printRun: null };

        let remaining = name;
        let parallel = null;
        let printRun = null;

        // Extract print run
        const printRunMatch = remaining.match(/\s*\/(\d+)\s*/);
        if (printRunMatch) {
            printRun = parseInt(printRunMatch[1], 10);
            remaining = remaining.replace(printRunMatch[0], ' ').trim();
        }

        // Extract parallel
        for (const pattern of this.parallelPatterns) {
            const match = remaining.match(pattern);
            if (match) {
                parallel = match[0].trim();
                remaining = remaining.replace(match[0], ' ').trim();
                break;
            }
        }

        // What's left is the variant
        const variant = remaining.replace(/\s+/g, ' ').trim() || null;

        return { variant, parallel, printRun };
    },

    // Get display name from card data
    getDisplayName(card) {
        const parts = [];
        if (card.variant && card.variant !== 'Base') parts.push(card.variant);
        if (card.parallel) parts.push(card.parallel);
        if (card.printRun) parts.push(`/${card.printRun}`);
        return parts.join(' ') || 'Base';
    },

    // Check if card is a numbered parallel
    isNumbered(card) {
        return card.printRun != null;
    },

    // Check if card is a parallel (colored/special finish)
    isParallel(card) {
        return !!card.parallel;
    }
};

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
        if (card.printRun) {
            base *= Math.max(3, 100 / card.printRun);
        }

        // Parallel cards
        const parallel = card.parallel || '';
        if (/Silver|Refractor/i.test(parallel)) base *= 3;
        if (/Holo/i.test(parallel)) base *= 2;
        if (/Gold/i.test(parallel) && card.printRun) base *= 5;

        // Special insert types (check variant for Downtown, etc.)
        const variant = card.variant || '';
        if (/Downtown/i.test(variant)) base = 60;

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
        const priceClass = this.getPriceClass(price, thresholds);
        const displayPrice = Math.max(1, Math.round(price));
        return `<span class="price-badge ${priceClass}">$${displayPrice}</span>`;
    },

    // Render auto badge HTML (for autographed cards)
    renderAutoBadge(card) {
        if (!card.auto) return '';
        return `<span class="auto-badge">AUTO</span>`;
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
                            <button class="image-editor-step-btn" id="rotate-minus" title="Decrease 0.5°">−</button>
                            <input type="range" class="image-editor-slider" id="image-editor-rotate" min="-45" max="45" value="0" step="0.5">
                            <button class="image-editor-step-btn" id="rotate-plus" title="Increase 0.5°">+</button>
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
                </div>
                <div class="image-editor-footer">
                    <button class="image-editor-tool" data-action="reset" title="Reset All">
                        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/></svg>
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
            this.backdrop.querySelector('#rotate-minus').onclick = () => setFineRotation(parseFloat(rotateSlider.value) - 0.5);
            this.backdrop.querySelector('#rotate-plus').onclick = () => setFineRotation(parseFloat(rotateSlider.value) + 0.5);
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

        // Reset rotation state
        this.baseRotation = 0;
        this.fineRotation = 0;
        const slider = this.backdrop.querySelector('#image-editor-rotate');
        const input = this.backdrop.querySelector('#image-editor-rotate-value');
        if (slider) slider.value = 0;
        if (input) input.value = '0°';

        // Set image source
        const img = this.backdrop.querySelector('#image-editor-img');
        img.src = imageSrc;

        // Show modal
        this.backdrop.classList.add('active');

        // Wait for image to load, then initialize cropper
        return new Promise((resolve, reject) => {
            this.resolvePromise = resolve;
            this.rejectPromise = reject;

            img.onload = () => {
                this.cropper = new Cropper(img, {
                    viewMode: 1,
                    dragMode: 'move',
                    aspectRatio: NaN, // Free crop
                    autoCropArea: 1,
                    restore: false,
                    guides: true,
                    center: true,
                    highlight: false,
                    cropBoxMovable: true,
                    cropBoxResizable: true,
                    toggleDragModeOnDblclick: false,
                    background: true,
                });
            };
            img.onerror = () => reject(new Error('Failed to load image'));
        });
    }

    // Confirm - return cropped/edited image
    confirm() {
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
        const reject = this.rejectPromise;
        this.close();
        if (reject) {
            reject(new Error('Cancelled'));
        }
    }

    // Close modal
    close() {
        this.backdrop.classList.remove('active');
        if (this.cropper) {
            this.cropper.destroy();
            this.cropper = null;
        }
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
        this.currentCard = null;
        this.currentCardId = null;
        this.isDirty = false;
        this.backdrop = null;
        this.isNewCard = false;
        this.imageProcessor = new ImageProcessor();
        this.ebayManuallyEdited = false; // Track if user manually edited eBay search term

        // Schema-driven custom fields
        // Format: { fieldName: { label, type, options?, placeholder?, fullWidth? } }
        // Types: 'text', 'select', 'checkbox'
        // For select: options is array of { value, label } or just strings
        this.customFields = options.customFields || {};
    }

    // Generate eBay search term from card data
    generateSearchTerm(set, num, variant) {
        const parts = [this.playerName, set];
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
    // position: 'top' (before set) or 'after-num' (after card number)
    generateCustomFieldsHtml(position = 'top') {
        return Object.entries(this.customFields)
            .filter(([_, config]) => (config.position || 'top') === position)
            .map(([fieldName, config]) => {
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
                return `<div class="card-editor-field${fullWidth}">
                    <label class="card-editor-label">${config.label}</label>
                    <input type="text" class="card-editor-input" id="${id}" placeholder="${placeholder}">
                </div>`;
            }
        }).join('');
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
                        ${this.generateCustomFieldsHtml('top')}
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
                        ${this.generateCustomFieldsHtml('after-num')}
                        ${this.categories ? `<div class="card-editor-field">
                            <label class="card-editor-label">Section</label>
                            <select class="card-editor-select" id="editor-category">
                                ${this.categories.map(c => {
                                    const label = typeof c === 'string' ? c.charAt(0).toUpperCase() + c.slice(1) : c.label;
                                    const value = typeof c === 'string' ? c : c.value;
                                    return `<option value="${value}">${label}</option>`;
                                }).join('')}
                            </select>
                        </div>` : ''}
                        <div class="card-editor-field">
                            <label class="card-editor-label">Autographed</label>
                            <label class="card-editor-checkbox">
                                <input type="checkbox" id="editor-auto">
                                <span>Auto</span>
                            </label>
                        </div>
                        <div class="card-editor-field">
                            <label class="card-editor-label">Price ($)</label>
                            <input type="number" class="card-editor-input" id="editor-price" placeholder="Auto-estimate" step="0.01" min="0">
                        </div>
                        <div class="card-editor-field full-width card-editor-advanced-toggle">
                            <button type="button" class="card-editor-toggle-btn" id="editor-toggle-ebay">Customize eBay search</button>
                            <button type="button" class="card-editor-toggle-btn" id="editor-toggle-price-search">Customize price search</button>
                        </div>
                        <div class="card-editor-field full-width card-editor-ebay-field" style="display: none;">
                            <label class="card-editor-label">eBay Search Term</label>
                            <input type="text" class="card-editor-input" id="editor-ebay" placeholder="Auto-generate from card data">
                        </div>
                        <div class="card-editor-field full-width card-editor-price-search-field" style="display: none;">
                            <label class="card-editor-label">Price Search Term</label>
                            <input type="text" class="card-editor-input" id="editor-price-search" placeholder="Auto-generate from player name">
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

        // Toggle eBay search field visibility
        const ebayToggle = this.backdrop.querySelector('#editor-toggle-ebay');
        const ebayField = this.backdrop.querySelector('.card-editor-ebay-field');
        ebayToggle.onclick = () => {
            const isHidden = ebayField.style.display === 'none';
            ebayField.style.display = isHidden ? 'flex' : 'none';
            ebayToggle.textContent = isHidden ? 'Hide eBay search' : 'Customize eBay search';
        };

        // Track manual edits to eBay search term
        this.backdrop.querySelector('#editor-ebay').oninput = () => {
            this.ebayManuallyEdited = true;
            this.setDirty(true);
        };

        // Toggle price search field visibility
        const priceSearchToggle = this.backdrop.querySelector('#editor-toggle-price-search');
        const priceSearchField = this.backdrop.querySelector('.card-editor-price-search-field');
        priceSearchToggle.onclick = () => {
            const isHidden = priceSearchField.style.display === 'none';
            priceSearchField.style.display = isHidden ? 'flex' : 'none';
            priceSearchToggle.textContent = isHidden ? 'Hide price search' : 'Customize price search';
        };

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

    // Update edit button visibility based on URL (show for local images)
    updateEditButton(url) {
        const btn = this.backdrop.querySelector('#editor-edit-img');
        if (!btn) return;

        // Show edit button for local images (in the imageFolder)
        const isLocal = url && url.startsWith(this.imageFolder);
        btn.style.display = isLocal ? 'flex' : 'none';
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

        if (!url || !url.startsWith(this.imageFolder)) return;

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
            const baseName = url.replace(/\.webp$/, '');
            const newPath = `${baseName}_${timestamp}.webp`;
            const filename = newPath.split('/').pop();

            // On preview sites, show the result but don't commit
            if (this.isPreviewSite()) {
                imgInput.value = newPath;
                this.updateImagePreview(`data:image/webp;base64,${base64Data}`);
                this.updateProcessButton(newPath);
                this.updateEditButton(newPath);
                alert('Preview site: Image edited but not saved. Commits are disabled on preview deployments.');
                return;
            }

            // Commit via PR
            btn.title = 'Creating PR...';
            const committedPath = await githubSync.commitImageViaPR(
                newPath,
                base64Data,
                `Update image: ${filename}`
            );

            if (!committedPath) {
                throw new Error('Failed to create PR - check console for details');
            }

            // Update the input field
            imgInput.value = committedPath;
            this.updateImagePreview(`data:image/webp;base64,${base64Data}`);
            this.updateProcessButton(committedPath);
            this.updateEditButton(committedPath);
            this.setDirty(true);

            btn.title = 'Done! Edited image committed via PR';

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

    // Process image: fetch, show editor, resize, commit via PR, update field with path
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

            // Generate filename and path
            const filename = this.imageProcessor.generateFilename(cardData);
            const path = `${this.imageFolder}/${filename}`;

            // Resize and convert to WebP
            const { base64: base64Content } = await this.imageProcessor.processImage(img);

            // On preview sites, show the result but don't commit
            if (this.isPreviewSite()) {
                imgInput.value = path;
                this.updateImagePreview(`data:image/webp;base64,${base64Content}`);
                this.updateProcessButton(path);
                this.updateEditButton(path);
                alert('Preview site: Image processed but not saved. Commits are disabled on preview deployments.');
                return;
            }

            // Commit via PR (will auto-merge)
            btn.title = 'Creating PR...';
            const committedPath = await githubSync.commitImageViaPR(
                path,
                base64Content,
                `Add image: ${filename}`
            );

            if (!committedPath) {
                throw new Error('Failed to commit image');
            }

            // Update the input field with the file path
            imgInput.value = committedPath;
            // Show the processed image as preview (path won't work until PR merges)
            this.updateImagePreview(`data:image/webp;base64,${base64Content}`);
            this.updateProcessButton(committedPath);
            this.updateEditButton(committedPath);
            this.setDirty(true);

            // Show success message
            btn.title = 'Done! Image committed via PR';

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

    // Process a local file: read, show editor, resize, commit via PR, update field with path
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

            // Generate filename and path
            const filename = this.imageProcessor.generateFilename(cardData);
            const path = `${this.imageFolder}/${filename}`;

            // Process the image (resize, convert to webp)
            const { base64: base64Content } = await this.imageProcessor.processImage(img);

            // On preview sites, show the result but don't commit
            if (this.isPreviewSite()) {
                imgInput.value = path;
                this.updateImagePreview(`data:image/webp;base64,${base64Content}`);
                this.updateProcessButton(path);
                this.updateEditButton(path);
                alert('Preview site: Image uploaded but not saved. Commits are disabled on preview deployments.');
                return;
            }

            // Commit via PR (will auto-merge)
            btn.title = 'Creating PR...';
            const committedPath = await githubSync.commitImageViaPR(
                path,
                base64Content,
                `Add image: ${filename}`
            );

            if (!committedPath) {
                throw new Error('Failed to commit image');
            }

            // Update the input field with the file path
            imgInput.value = committedPath;
            // Show the processed image as preview
            this.updateImagePreview(`data:image/webp;base64,${base64Content}`);
            this.updateProcessButton(committedPath);
            this.updateEditButton(committedPath);
            this.setDirty(true);

            // Show success message
            btn.title = 'Done! Image committed via PR';

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
        this.backdrop.querySelector('#editor-type').value = cardData.type || 'Base';
        this.backdrop.querySelector('#editor-auto').checked = cardData.auto || false;
        this.backdrop.querySelector('#editor-price').value = cardData.price !== undefined ? cardData.price : '';
        const ebayValue = cardData.ebay || '';
        this.backdrop.querySelector('#editor-ebay').value = ebayValue;
        this.backdrop.querySelector('#editor-img').value = cardData.img || '';

        // Show eBay field only if it has a custom value
        const ebayField = this.backdrop.querySelector('.card-editor-ebay-field');
        const ebayToggle = this.backdrop.querySelector('#editor-toggle-ebay');
        const hasCustomEbay = ebayValue !== '';
        ebayField.style.display = hasCustomEbay ? 'flex' : 'none';
        ebayToggle.textContent = hasCustomEbay ? 'Hide eBay search' : 'Customize eBay search';

        // Populate and show price search field if it has a custom value
        const priceSearchValue = cardData.priceSearch || '';
        this.backdrop.querySelector('#editor-price-search').value = priceSearchValue;
        const priceSearchField = this.backdrop.querySelector('.card-editor-price-search-field');
        const priceSearchToggle = this.backdrop.querySelector('#editor-toggle-price-search');
        const hasCustomPriceSearch = priceSearchValue !== '';
        priceSearchField.style.display = hasCustomPriceSearch ? 'flex' : 'none';
        priceSearchToggle.textContent = hasCustomPriceSearch ? 'Hide price search' : 'Customize price search';

        this.updateImagePreview(cardData.img);
        this.updateProcessButton(cardData.img);
        this.updateEditButton(cardData.img);
        this.setDirty(false);
        this.ebayManuallyEdited = false;

        // Show modal
        this.backdrop.classList.add('active');
        // Focus first field (first custom field or set name)
        const customFieldNames = Object.keys(this.customFields);
        const firstField = customFieldNames.length > 0
            ? this.backdrop.querySelector(`#editor-${customFieldNames[0]}`)
            : this.backdrop.querySelector('#editor-set');
        if (firstField) firstField.focus();
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
        this.backdrop.querySelector('#editor-type').value = 'Base';
        this.backdrop.querySelector('#editor-auto').checked = false;
        this.backdrop.querySelector('#editor-price').value = '';
        this.backdrop.querySelector('#editor-ebay').value = '';
        this.backdrop.querySelector('#editor-img').value = '';

        // Hide eBay field by default for new cards
        this.backdrop.querySelector('.card-editor-ebay-field').style.display = 'none';
        this.backdrop.querySelector('#editor-toggle-ebay').textContent = 'Customize eBay search';

        // Hide price search field by default for new cards
        this.backdrop.querySelector('#editor-price-search').value = '';
        this.backdrop.querySelector('.card-editor-price-search-field').style.display = 'none';
        this.backdrop.querySelector('#editor-toggle-price-search').textContent = 'Customize price search';

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

        // Show modal
        this.backdrop.classList.add('active');
        // Focus first field (first custom field or set name)
        const customFieldNames = Object.keys(this.customFields);
        const firstField = customFieldNames.length > 0
            ? this.backdrop.querySelector(`#editor-${customFieldNames[0]}`)
            : this.backdrop.querySelector('#editor-set');
        if (firstField) firstField.focus();
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

        // Core fields
        const data = {
            set: this.backdrop.querySelector('#editor-set').value.trim(),
            num: num,
            type: this.backdrop.querySelector('#editor-type').value
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

        // Auto - only include if checked
        if (this.backdrop.querySelector('#editor-auto').checked) {
            data.auto = true;
        }

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

    // Check if image URL needs processing (external URL from supported domain)
    needsImageProcessing(url) {
        if (!url) return false;
        // Already a local path or data URL
        if (url.startsWith(this.imageFolder) || url.startsWith('data:') || !url.startsWith('http')) {
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
                data.search = this.generateSearchTerm(data.set, data.num, variant);
                // Clear any custom ebay field since we're regenerating
                delete data.ebay;
            }
        }

        // Auto-generate search term if ebay field is empty
        if (!data.ebay) {
            data.search = this.generateSearchTerm(data.set, data.num, data.variant);
        }

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

// Export for use in pages
window.CARD_TYPES = CARD_TYPES;
window.CardUtils = CardUtils;
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
