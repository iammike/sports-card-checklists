// Sports Card Checklists - Shared JavaScript Utilities

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
        // Fall back to localStorage
        if (this.localStorageKey) {
            this.ownedCards = JSON.parse(localStorage.getItem(this.localStorageKey) || '[]');
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
            const success = await githubSync.saveChecklist(this.checklistId, this.ownedCards);
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

        try {
            await this.loadOwned();
        } catch (e) {
            console.error('Failed to load data:', e);
        }

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

// Export for use in pages
window.ChecklistManager = ChecklistManager;
window.PriceUtils = PriceUtils;
window.FilterUtils = FilterUtils;
window.CardRenderer = CardRenderer;
window.StatsAnimator = StatsAnimator;
