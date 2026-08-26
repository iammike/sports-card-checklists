// How long saveOwned() waits for the owned-checkbox clicks to go quiet before
// actually writing to the gist. toggleOwned() calls saveOwned() on every click
// un-awaited, and that path shares _patchGist's write queue - a streak of N
// quick toggles was N separate PATCHes, serialized ~1s apart (#733), so it took
// N seconds to fully sync instead of coalescing into one write of the final
// state (#734).
const OWNED_SYNC_DEBOUNCE_MS = 1500;

/**
 * Checklist Manager - handles owned state, sync, and auth
 */
class ChecklistManager {
    constructor(config) {
        this.checklistId = config.checklistId;
        this.ownerUsername = config.ownerUsername || OWNER_USERNAME;
        this.localStorageKey = config.localStorageKey;
        this.ownedCards = [];
        this.isReadOnly = true;
        this.onOwnedChange = config.onOwnedChange || (() => {});
        this.getStats = config.getStats || null; // Optional: return stats object for combined save
        this._ownedSyncTimer = null;
    }

    // Generate unique card ID from card data
    getCardId(card) {
        // Allow custom ID field, otherwise generate from set+num+variant.
        // Only a safe-charset id is honored - see isSafeCardId in shared.js
        if (isSafeCardId(card.id)) return card.id;
        const str = (card.set || '') + (card.num || '') + (card.variant || '');
        // Replace non-Latin-1 chars (e.g. iOS smart quotes) so btoa doesn't throw.
        // Must NOT use encodeURIComponent here - that changes the encoding and
        // breaks all existing stored card IDs.
        const safe = str.replace(/[^\x00-\xFF]/g, '_');
        return btoa(safe).replace(/[^a-zA-Z0-9]/g, '');
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

    // Save owned cards to localStorage immediately and debounce the GitHub
    // sync (see OWNED_SYNC_DEBOUNCE_MS) - a rapid streak of toggles collapses
    // into one write of the final state instead of one write per click.
    saveOwned() {
        // Always save to localStorage as backup - cheap, local-only, no reason
        // to delay it behind the network debounce.
        if (this.localStorageKey) {
            localStorage.setItem(this.localStorageKey, JSON.stringify(this.ownedCards));
        }

        if (!(window.githubSync && githubSync.isLoggedIn())) return;

        // Reflect the pending sync immediately - the debounce delays the
        // network call, not the feedback that a save is on its way.
        this.setSyncStatus('syncing', 'Syncing...');
        clearTimeout(this._ownedSyncTimer);
        this._ownedSyncTimer = setTimeout(() => this._syncOwnedNow(), OWNED_SYNC_DEBOUNCE_MS);
    }

    async _syncOwnedNow() {
        // Get stats if callback provided (saves both atomically to avoid race condition)
        const stats = this.getStats ? this.getStats() : null;
        const success = await githubSync.saveChecklist(this.checklistId, this.ownedCards, stats);
        if (success) {
            this.setSyncStatus('synced', 'Synced');
        } else {
            this.setSyncStatus('error', 'Sync failed');
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

    // Update nav auth UI with dropdown menu. Delegates to AuthUI.update()
    // (nav.js) for everything that isn't checklist-specific - avatar, dropdown
    // toggle, Shopping List, Sign out, commit hash - then adds this
    // checklist's owner-only actions on top, the same way
    // ChecklistEngine._initDeleteButton/_initSettingsButton insert into
    // whatever the base render produced. This used to be a full
    // second copy of AuthUI.update()'s template; the two drifted apart when
    // Shopping List was added to one and never mirrored into the other, which
    // silently hid it on every checklist page (only index.html called
    // AuthUI.update() directly) - exactly the failure mode a single source of
    // truth avoids.
    updateAuthUI() {
        if (!window.AuthUI) return;
        AuthUI.update();

        if (!this.isOwner()) return;
        const dropdown = document.getElementById('nav-dropdown');
        // Shopping List is always in AuthUI.update()'s template, so it's a
        // stable anchor regardless of whether the preview sync button is
        // also present ahead of it.
        const insertBefore = document.getElementById('shopping-list-btn') || document.getElementById('auth-logout-btn');
        if (!dropdown || !insertBefore) return;

        const addCardBtn = document.createElement('button');
        addCardBtn.className = 'nav-dropdown-item';
        addCardBtn.id = 'add-card-btn';
        addCardBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg> Add card';

        const clearAllBtn = document.createElement('button');
        clearAllBtn.className = 'nav-dropdown-item danger';
        clearAllBtn.id = 'clear-all-btn';
        clearAllBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg> Clear All';
        clearAllBtn.onclick = () => this.clearAll();

        const divider = document.createElement('div');
        divider.className = 'nav-dropdown-divider';

        dropdown.insertBefore(addCardBtn, insertBefore);
        dropdown.insertBefore(clearAllBtn, insertBefore);
        dropdown.insertBefore(divider, insertBefore);
    }

    // Update read-only UI state
    updateReadOnlyUI() {
        this.isReadOnly = !this.isOwner();

        // Hide clear button in read-only mode
        const clearBtn = document.querySelector('.clear-btn');
        if (clearBtn) clearBtn.style.display = this.isReadOnly ? 'none' : '';

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



window.ChecklistManager = ChecklistManager;
