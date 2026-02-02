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
    ICON_LOGOUT: '<svg viewBox="0 0 24 24"><path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/></svg>',

    update(logoutFn = () => { githubSync.logout(); location.reload(); }) {
        const authContent = document.getElementById('auth-content');
        if (!authContent || !window.githubSync) return;

        if (githubSync.isLoggedIn()) {
            const user = githubSync.getUser();
            const safeAvatarUrl = sanitizeUrl(user.avatar_url);
            const safeLogin = sanitizeText(user.login);
            authContent.innerHTML = `
                <button class="nav-avatar-btn" id="nav-avatar-btn">
                    <img src="${safeAvatarUrl}" alt="${safeLogin}">
                </button>
                <div class="nav-dropdown" id="nav-dropdown">
                    <div class="nav-dropdown-header">
                        <img src="${safeAvatarUrl}" alt="">
                        <span>${safeLogin}</span>
                    </div>
                    <button class="nav-dropdown-item" id="auth-logout-btn">
                        ${this.ICON_LOGOUT}
                        Sign out
                    </button>
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

    // Update nav auth UI with dropdown menu
    updateAuthUI() {
        const authContent = document.getElementById('auth-content');
        if (!authContent || !window.githubSync) return;

        if (githubSync.isLoggedIn()) {
            const user = githubSync.getUser();
            const safeAvatarUrl = sanitizeUrl(user.avatar_url);
            const safeLogin = sanitizeText(user.login);
            const isOwner = this.isOwner();

            const ownerItemsHtml = isOwner ? `
                <button class="nav-dropdown-item" id="edit-mode-btn">
                    <svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
                    Edit cards
                </button>
                <button class="nav-dropdown-item danger" id="clear-all-btn">
                    <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                    Clear All
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
                    <button class="nav-dropdown-item" id="auth-logout-btn">
                        <svg viewBox="0 0 24 24"><path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/></svg>
                        Sign out
                    </button>
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
            document.getElementById('auth-logout-btn').onclick = () => this.logout();
            const clearAllBtn = document.getElementById('clear-all-btn');
            if (clearAllBtn) clearAllBtn.onclick = () => this.clearAll();
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

    // SVG icons for edit button
    static ICON_EDIT = '<svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';
    static ICON_CHECK = '<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';

    // Hook into the edit button in the dropdown (created by ChecklistManager.updateAuthUI)
    createEditButton() {
        // The button is now created by ChecklistManager.updateAuthUI in the dropdown
        // We just need to attach the click handler when it exists
        this.updateEditButton();
    }

    // Update edit button state in dropdown menu
    updateEditButton() {
        const editBtn = document.getElementById('edit-mode-btn');
        if (!editBtn) return;

        // Attach click handler
        editBtn.onclick = (e) => {
            e.stopPropagation();
            this.toggleEditMode();
            // Close dropdown after clicking
            document.getElementById('nav-avatar-btn')?.classList.remove('menu-open');
            document.getElementById('nav-dropdown')?.classList.remove('open');
        };

        // Update button appearance based on current mode
        const icon = this.isEditMode ? EditModeManager.ICON_CHECK : EditModeManager.ICON_EDIT;
        const text = this.isEditMode ? 'Done editing' : 'Edit cards';
        editBtn.innerHTML = icon + ' ' + text;
        editBtn.classList.toggle('active', this.isEditMode);
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
    }

    // Check if URL is from eBay
    isEbayUrl(url) {
        if (!url) return false;
        try {
            const parsed = new URL(url);
            return parsed.hostname.includes('ebay');
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

        const ctx = canvas.getContext('2d');
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
    generateFilename(cardData) {
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
 * Card Editor Modal - handles card editing UI
 */
class CardEditorModal {
    constructor(options = {}) {
        this.onSave = options.onSave || (() => {});
        this.onDelete = options.onDelete || (() => {});
        this.cardTypes = options.cardTypes || CARD_TYPES;
        this.categories = options.categories || null; // e.g., ['panini', 'topps', 'inserts', 'chase']
        this.showPlayerField = options.showPlayerField !== false; // default true
        this.showCardNameField = options.showCardNameField !== false; // default true
        this.showAchievementField = options.showAchievementField !== false; // default true
        this.imageFolder = options.imageFolder || 'images'; // folder for processed images
        this.currentCard = null;
        this.currentCardId = null;
        this.isDirty = false;
        this.backdrop = null;
        this.isNewCard = false;
        this.imageProcessor = new ImageProcessor();
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
                        ${this.categories ? `<div class="card-editor-field">
                            <label class="card-editor-label">Section</label>
                            <select class="card-editor-select" id="editor-category">
                                ${this.categories.map(c => `<option value="${c}">${c.charAt(0).toUpperCase() + c.slice(1)}</option>`).join('')}
                            </select>
                        </div>` : ''}
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
                        ${this.showCardNameField ? `<div class="card-editor-field full-width">
                            <label class="card-editor-label">Card Name / Variant</label>
                            <input type="text" class="card-editor-input" id="editor-name" placeholder="Silver Prizm /199">
                        </div>` : ''}
                        ${this.showAchievementField ? `<div class="card-editor-field full-width">
                            <label class="card-editor-label">Achievements</label>
                            <input type="text" class="card-editor-input" id="editor-achievement" placeholder="Pro Bowl, Super Bowl Champion">
                        </div>` : ''}
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
                            <div class="card-editor-image-input-row">
                                <input type="text" class="card-editor-input" id="editor-img" placeholder="https://...">
                                <button type="button" class="card-editor-process-btn" id="editor-process-img" title="Process eBay image">
                                    <span class="process-text">Process</span>
                                    <span class="process-spinner"></span>
                                </button>
                            </div>
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
            this.updateProcessButton(e.target.value);
        };

        // Process image button
        this.backdrop.querySelector('#editor-process-img').onclick = () => this.processImage();

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
        if (url && (url.startsWith('http') || url.startsWith('/') || url.startsWith('data:'))) {
            const src = url.startsWith('data:') ? url : sanitizeUrl(url);
            preview.innerHTML = `<img src="${src}" alt="Preview" onerror="this.outerHTML='<span class=\\'placeholder\\'>Failed to load</span>'">`;
        } else {
            preview.innerHTML = '<span class="placeholder">No image</span>';
        }
    }

    // Update process button visibility based on URL
    updateProcessButton(url) {
        const btn = this.backdrop.querySelector('#editor-process-img');
        if (!btn) return;

        const isEbay = this.imageProcessor.isEbayUrl(url);
        btn.style.display = isEbay ? 'flex' : 'none';
    }

    // Process image: fetch, resize, commit via PR, update field with path
    async processImage() {
        const imgInput = this.backdrop.querySelector('#editor-img');
        const url = imgInput.value.trim();
        const btn = this.backdrop.querySelector('#editor-process-img');

        if (!url || !this.imageProcessor.isEbayUrl(url)) return;

        // Check if githubSync is available and logged in
        if (typeof githubSync === 'undefined' || !githubSync.isLoggedIn()) {
            alert('Please sign in to process images');
            return;
        }

        // Show loading state
        btn.classList.add('processing');
        btn.disabled = true;
        btn.title = 'Processing...';

        try {
            // Get card data from form to generate filename
            const cardData = {
                set: this.backdrop.querySelector('#editor-set')?.value || '',
                name: this.backdrop.querySelector('#editor-name')?.value || '',
                num: this.backdrop.querySelector('#editor-num')?.value || ''
            };

            // Generate filename and path
            const filename = this.imageProcessor.generateFilename(cardData);
            const path = `${this.imageFolder}/${filename}`;

            // Process the image and get base64 content
            const base64Content = await this.imageProcessor.processFromUrl(url);

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
            this.setDirty(true);

            // Show success message
            btn.title = 'Done! Image committed via PR';

        } catch (error) {
            console.error('Image processing failed:', error);
            alert('Failed to process image: ' + error.message);
        } finally {
            btn.classList.remove('processing');
            btn.disabled = false;
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
        // Set category if dropdown exists
        const categoryField = this.backdrop.querySelector('#editor-category');
        if (categoryField && cardData.category) {
            categoryField.value = cardData.category;
        }
        // Strip # from card number for editing
        this.backdrop.querySelector('#editor-num').value = (cardData.num || '').replace(/^#/, '');
        const nameField = this.backdrop.querySelector('#editor-name');
        if (nameField) nameField.value = cardData.name || '';
        this.backdrop.querySelector('#editor-type').value = cardData.type || 'Base';
        this.backdrop.querySelector('#editor-auto').checked = cardData.auto || false;
        const achievementField = this.backdrop.querySelector('#editor-achievement');
        if (achievementField) {
            achievementField.value = Array.isArray(cardData.achievement)
                ? cardData.achievement.join(', ')
                : (cardData.achievement || '');
        }
        this.backdrop.querySelector('#editor-price').value = cardData.price !== undefined ? cardData.price : '';
        this.backdrop.querySelector('#editor-ebay').value = cardData.ebay || cardData.search || '';
        this.backdrop.querySelector('#editor-img').value = cardData.img || '';

        this.updateImagePreview(cardData.img);
        this.updateProcessButton(cardData.img);
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
        this.backdrop.querySelectorAll('input').forEach(input => {
            if (input.type === 'checkbox') {
                input.checked = false;
            } else {
                input.value = '';
            }
        });
        this.backdrop.querySelector('#editor-type').value = 'Base';
        // Set category if dropdown exists
        const categoryField = this.backdrop.querySelector('#editor-category');
        if (categoryField && category) {
            categoryField.value = category;
        }
        this.updateImagePreview('');
        this.updateProcessButton('');
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

        const nameField = this.backdrop.querySelector('#editor-name');
        const data = {
            set: this.backdrop.querySelector('#editor-set').value.trim(),
            num: num,
            name: nameField ? nameField.value.trim() : '',
            type: this.backdrop.querySelector('#editor-type').value,
            img: this.backdrop.querySelector('#editor-img').value.trim()
        };

        // Player - only include if field exists and has value
        const playerField = this.backdrop.querySelector('#editor-player');
        if (playerField && playerField.value.trim()) {
            data.player = playerField.value.trim();
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

        // Achievement - parse comma-separated, only include if field exists and has value
        const achievementField = this.backdrop.querySelector('#editor-achievement');
        if (achievementField) {
            const achievementVal = achievementField.value.trim();
            if (achievementVal) {
                data.achievement = achievementVal.split(',').map(a => a.trim()).filter(a => a);
            }
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

        // Preserve category if editing and no category dropdown exists
        // (If dropdown exists, user's selection from lines 884-888 should be used)
        if (!categoryField && this.currentCard && this.currentCard.category) {
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
window.ChecklistManager = ChecklistManager;
window.PriceUtils = PriceUtils;
window.FilterUtils = FilterUtils;
window.CardRenderer = CardRenderer;
window.StatsAnimator = StatsAnimator;
window.EditModeManager = EditModeManager;
window.CardEditorModal = CardEditorModal;
window.AddCardButton = AddCardButton;
window.ImageProcessor = ImageProcessor;
