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
            const safeAvatarUrl = sanitizeAttr(sanitizeUrl(user.avatar_url));
            const safeLogin = sanitizeText(user.login);
            const safeLoginAttr = sanitizeAttr(user.login);
            const isPreview = githubSync.isPreview();
            const syncButton = isPreview ? `
                    <button class="nav-dropdown-item" id="sync-from-prod-btn">
                        ${this.ICON_SYNC}
                        Sync from Production
                    </button>
                    <div class="nav-dropdown-divider"></div>` : '';
            authContent.innerHTML = `
                <button class="nav-avatar-btn" id="nav-avatar-btn">
                    <img src="${safeAvatarUrl}" alt="${safeLoginAttr}">
                </button>
                <div class="nav-dropdown" id="nav-dropdown">
                    <div class="nav-dropdown-header">
                        <img src="${safeAvatarUrl}" alt="">
                        <span>${safeLogin}</span>
                    </div>
                    ${syncButton}
                    <!-- Still #shopping-list-btn: ChecklistManager.updateAuthUI and
                         the engine anchor their inserts on that id. The label moved
                         on because the dialog behind it now exports needed, owned or
                         every card, in PDF or CSV - a shopping list is one of its
                         outputs rather than the whole of it (#745). -->
                    <button class="nav-dropdown-item" id="shopping-list-btn">
                        <svg viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
                        Export
                    </button>
                    <div class="nav-dropdown-divider"></div>
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
            document.getElementById('shopping-list-btn').onclick = () => ShoppingList.showOptionsModal();
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
                el.innerHTML = `<a href="${sanitizeAttr(sanitizeLinkUrl(data.url))}" target="_blank" rel="noopener noreferrer">${sanitizeText(data.commit)}</a>`;
            }
        } catch (e) {
            // Silently fail - version.json may not exist locally
        }
    }
};

/**
 * DynamicNav - Loads registry from gist and renders nav links dynamically
 * Falls back to hardcoded links if registry isn't available
 */
const DynamicNav = {
    _registry: null,

    // Cache key includes gist ID so switching gists invalidates automatically
    _getSessionKey() {
        const gistId = window.githubSync?.getActiveGistId() || 'public';
        return `checklists-registry-${gistId}`;
    },

    // Get cached registry from sessionStorage
    _getCached() {
        try {
            const cached = sessionStorage.getItem(this._getSessionKey());
            if (cached) return JSON.parse(cached);
        } catch (e) { /* ignore */ }
        return null;
    },

    _setCache(registry) {
        try {
            sessionStorage.setItem(this._getSessionKey(), JSON.stringify(registry));
        } catch (e) { /* ignore */ }
    },

    // Drop both cache layers so the next read refetches from the gist. Callers on
    // destructive paths need both: loadRegistry() returns _registry before it ever
    // looks at sessionStorage, and the sessionStorage copy outlives a page load.
    clearCache() {
        this._registry = null;
        try {
            sessionStorage.removeItem(this._getSessionKey());
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
            // A signed-in reader who is not the owner reads their *own* gist,
            // which has no registry in it - so this came back null and the page
            // rendered with no checklists and no nav links, while a direct
            // checklist.html?id= still worked because the config and card-data
            // reads have had this fallback all along (#759).
            //
            // Unconditional `||`, the shape the sibling reads use, rather than
            // gated on being signed in. The retry costs a signed-out reader
            // nothing: their first read already populated _publicGistCache, so
            // it is a cache hit - and the one case where it is not is a *failed*
            // public read, which is exactly when a retry is worth having.
            const registry = await githubSync.loadRegistry()
                || await githubSync.loadPublicRegistry?.();

            if (registry) {
                this._registry = registry;
                this._setCache(registry);
                return registry;
            }
        }
        return null;
    },

    // The checklists available to link to, read synchronously: the card editor
    // builds its dropdown while the modal is being created and cannot await the
    // registry fetch. init() primes _registry, and the sessionStorage cache covers
    // a page whose fetch hasn't landed yet. Legacy entries are excluded because
    // their URLs carry no ?id=, which is what a collection link is parsed for.
    listChecklists() {
        const registry = this._registry || this._getCached();
        return (registry?.checklists || [])
            .filter(e => e.type === 'dynamic' && !e.hidden)
            .sort((a, b) => (a.navLabel || a.title).localeCompare(b.navLabel || b.title));
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

    // Add checklist links to the nav from registry
    renderNav(registry) {
        const navLinks = document.querySelector('.nav-links');
        if (!navLinks) return;

        const dynamicEntries = registry.checklists
            .filter(e => e.type === 'dynamic' && !e.hidden)
            .sort((a, b) => (a.navLabel || a.title).localeCompare(b.navLabel || b.title));

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

    // Check if nav links overflow and toggle compact/hamburger mode
    _checkOverflow() {
        const navBar = document.querySelector('.nav-bar');
        const navLinks = document.querySelector('.nav-links');
        const hamburger = document.getElementById('nav-hamburger');
        if (!navBar || !navLinks || !hamburger) return;

        // Close menu before measuring
        hamburger.classList.remove('open');
        navLinks.classList.remove('open');
        hamburger.setAttribute('aria-expanded', 'false');

        // Remove compact mode to measure natural row width
        navBar.classList.remove('nav-compact');

        // Check if links overflow their container
        const overflow = navLinks.scrollWidth > navLinks.clientWidth + 1;
        if (overflow) {
            navBar.classList.add('nav-compact');
        }
    },

    // Set up hamburger menu toggle
    _initHamburger() {
        const hamburger = document.getElementById('nav-hamburger');
        const navLinks = document.querySelector('.nav-links');
        if (!hamburger || !navLinks) return;

        hamburger.addEventListener('click', () => {
            const isOpen = hamburger.classList.toggle('open');
            navLinks.classList.toggle('open');
            hamburger.setAttribute('aria-expanded', String(isOpen));
        });

        // Close menu when a nav link is clicked
        navLinks.addEventListener('click', (e) => {
            if (e.target.classList.contains('nav-link')) {
                hamburger.classList.remove('open');
                navLinks.classList.remove('open');
                hamburger.setAttribute('aria-expanded', 'false');
            }
        });

        // Close menu when clicking outside
        document.addEventListener('click', (e) => {
            if (!hamburger.contains(e.target) && !navLinks.contains(e.target)) {
                hamburger.classList.remove('open');
                navLinks.classList.remove('open');
                hamburger.setAttribute('aria-expanded', 'false');
            }
        });

        // Re-check overflow on resize
        let resizeTimer;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => this._checkOverflow(), 100);
        });
    },

    // Initialize: load registry and update nav
    async init() {
        const registry = await this.loadRegistry();
        if (registry && registry.checklists && registry.checklists.length > 0) {
            this.renderNav(registry);
        }
        this._initHamburger();
        this._checkOverflow();
    }
};

window.AuthUI = AuthUI;
window.DynamicNav = DynamicNav;
