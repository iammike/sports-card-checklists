// GitHub OAuth + Gist Storage for Sports Card Checklists
//
// Configuration: Set these values after creating your GitHub OAuth App and Cloudflare Worker
const IS_PREVIEW = window.location.hostname.endsWith('.pages.dev');
const PREVIEW_GIST_ID = 'ec645b5e213447ac37de95ffada2d31b';
const PRODUCTION_GIST_ID = '5f2b43f0588d72892273ae8f24f68c2d';
const CONFIG = {
    // Use preview OAuth app for pages.dev, production app for github.io
    GITHUB_CLIENT_ID: IS_PREVIEW
        ? 'Ov23limT2ZxKxthkupeT'  // Preview app
        : 'Ov23liik9Fs5C6RCeTgf', // Production app
    OAUTH_PROXY_URL: 'https://cards-oauth.iammikec.workers.dev',
    GIST_FILENAME: 'sports-card-checklists.json',
    GIST_DESCRIPTION: 'Sports Card Checklist Collection Data',
    // Preview uses separate gist so testing doesn't affect production
    PUBLIC_GIST_ID: IS_PREVIEW ? PREVIEW_GIST_ID : PRODUCTION_GIST_ID,
    PRODUCTION_GIST_ID: PRODUCTION_GIST_ID, // For syncing preview from prod
};

// Storage keys
const TOKEN_KEY = 'github_token';
const GIST_ID_KEY = 'github_gist_id';
const USER_KEY = 'github_user';

class GitHubSync {
    constructor() {
        this.token = localStorage.getItem(TOKEN_KEY);
        this.gistId = localStorage.getItem(GIST_ID_KEY);

        // Guard: clear preview gist ID if it leaked into production localStorage
        if (!IS_PREVIEW && this.gistId === PREVIEW_GIST_ID) {
            this.gistId = null;
            localStorage.removeItem(GIST_ID_KEY);
        }

        try {
            this.user = JSON.parse(localStorage.getItem(USER_KEY) || 'null');
        } catch (e) {
            console.error('Failed to parse user data:', e);
            this.user = null;
            localStorage.removeItem(USER_KEY);
        }
        this.onAuthChange = null;
        this._saveQueue = Promise.resolve(); // Queue to prevent concurrent saves
        this._cachedData = null; // Cache to avoid stale reads during saves
        this._gistCache = null; // Raw gist cache for registry/config reads
        this._publicGistCache = null; // Public gist cache

        // Clear cache when tab becomes visible (handles multi-tab edits)
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                this._cachedData = null;
                this._gistCache = null;
                this._publicGistCache = null;
            }
        });
    }

    isLoggedIn() {
        return !!this.token;
    }

    getUser() {
        return this.user;
    }

    // Start OAuth flow
    login() {
        // For branch previews, use main pages.dev as OAuth callback, then redirect back
        const isBranchPreview = IS_PREVIEW && !window.location.hostname.match(/^sports-card-checklists\.pages\.dev$/);
        let redirectUri;
        let returnUrl = null;
        if (isBranchPreview) {
            returnUrl = window.location.href;
            redirectUri = 'https://sports-card-checklists.pages.dev/';
        } else {
            redirectUri = window.location.origin + window.location.pathname;
        }
        const scope = 'gist public_repo'; // gist for owned cards, public_repo for card data edits
        // Generate state parameter for CSRF protection (include return URL if branch preview)
        const stateData = { csrf: crypto.randomUUID(), returnUrl };
        const state = btoa(JSON.stringify(stateData));
        sessionStorage.setItem('oauth_state', stateData.csrf);
        const authUrl = `https://github.com/login/oauth/authorize?client_id=${CONFIG.GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&state=${encodeURIComponent(state)}`;
        window.location.href = authUrl;
    }

    // Handle OAuth callback (call this on page load)
    async handleCallback() {
        // Check for auth data passed via URL fragment (from branch preview redirect)
        const hash = window.location.hash;
        if (hash.startsWith('#auth=')) {
            try {
                const authData = JSON.parse(atob(hash.slice(6)));
                this.token = authData.token;
                this.user = authData.user;
                this.gistId = authData.gistId;
                localStorage.setItem(TOKEN_KEY, this.token);
                localStorage.setItem(USER_KEY, JSON.stringify(this.user));
                localStorage.setItem(GIST_ID_KEY, this.gistId);
                // Clean URL
                window.history.replaceState({}, document.title, window.location.pathname);
                if (this.onAuthChange) this.onAuthChange(true);
                return true;
            } catch (e) {
                console.error('Failed to parse auth data from URL:', e);
            }
        }

        const params = new URLSearchParams(window.location.search);
        const code = params.get('code');
        const state = params.get('state');

        if (!code) return false;

        // Parse state parameter (contains CSRF token and optional return URL)
        let stateData = { csrf: null, returnUrl: null };
        try {
            stateData = JSON.parse(atob(state));
        } catch (e) {
            // Legacy: state might be just the CSRF token
            stateData = { csrf: state, returnUrl: null };
        }

        // Verify CSRF token - check both sessionStorage (same-origin) and allow branch previews
        const expectedState = sessionStorage.getItem('oauth_state');
        sessionStorage.removeItem('oauth_state');
        // For branch preview redirects, we won't have sessionStorage, so trust the state if it has a valid returnUrl
        const isBranchRedirect = stateData.returnUrl && stateData.returnUrl.includes('.pages.dev');
        if (!isBranchRedirect && (!stateData.csrf || stateData.csrf !== expectedState)) {
            console.error('OAuth state mismatch - possible CSRF attack');
            window.history.replaceState({}, document.title, window.location.pathname);
            return false;
        }

        // Store return URL for after auth completes
        const returnUrl = stateData.returnUrl;

        // Clean URL
        window.history.replaceState({}, document.title, window.location.pathname);

        try {
            // Exchange code for token via proxy
            const response = await fetch(CONFIG.OAUTH_PROXY_URL + '/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code }),
            });

            const data = await response.json();

            if (data.error) {
                console.error('OAuth error:', data.error_description || data.error);
                return false;
            }

            this.token = data.access_token;
            localStorage.setItem(TOKEN_KEY, this.token);

            // Get user info
            await this.fetchUser();

            // Find or create gist
            await this.findOrCreateGist();

            // Check if we need to redirect back to a branch preview
            if (returnUrl) {
                // Pass auth data via URL fragment (not sent to server)
                const authData = btoa(JSON.stringify({
                    token: this.token,
                    user: this.user,
                    gistId: this.gistId
                }));
                window.location.href = returnUrl + '#auth=' + authData;
                return true;
            }

            if (this.onAuthChange) this.onAuthChange(true);
            return true;
        } catch (error) {
            console.error('OAuth callback failed:', error);
            return false;
        }
    }

    async fetchUser() {
        const response = await fetch('https://api.github.com/user', {
            headers: { 'Authorization': `Bearer ${this.token}` },
        });
        this.user = await response.json();
        localStorage.setItem(USER_KEY, JSON.stringify(this.user));
    }

    logout() {
        this.token = null;
        this.user = null;
        this.gistId = null;
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        localStorage.removeItem(GIST_ID_KEY);
        if (this.onAuthChange) this.onAuthChange(false);
    }

    // Check if running on preview environment
    isPreview() {
        return IS_PREVIEW;
    }

    // Sync preview gist from production (only works on preview sites)
    async syncFromProduction() {
        if (!IS_PREVIEW) {
            throw new Error('Sync only available on preview sites');
        }
        if (!this.token) {
            throw new Error('Must be logged in to sync');
        }

        // Fetch all data from production gist
        const prodResponse = await fetch(`https://api.github.com/gists/${CONFIG.PRODUCTION_GIST_ID}`);
        if (!prodResponse.ok) {
            throw new Error('Failed to fetch production data');
        }
        const prodGist = await prodResponse.json();

        // Copy all files from production to preview gist
        const files = {};
        for (const [filename, fileData] of Object.entries(prodGist.files)) {
            files[filename] = { content: fileData.content };
        }

        // Delete files that exist in preview but not in production
        const previewGistId = CONFIG.PUBLIC_GIST_ID;
        const previewResponse = await fetch(`https://api.github.com/gists/${previewGistId}`, {
            headers: { 'Authorization': `Bearer ${this.token}` },
        });
        if (previewResponse.ok) {
            const previewGist = await previewResponse.json();
            for (const filename of Object.keys(previewGist.files)) {
                if (!prodGist.files[filename]) {
                    files[filename] = null; // null deletes the file from the gist
                }
            }
        }

        // Update preview gist with production data
        const updateResponse = await fetch(`https://api.github.com/gists/${previewGistId}`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${this.token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ files }),
        });

        if (!updateResponse.ok) {
            throw new Error('Failed to update preview gist');
        }

        // Clear cache so next load gets fresh data
        this._cachedData = null;
        this._gistCache = null;
        this._publicGistCache = null;

        // Clear DynamicNav sessionStorage cache so registry reloads fresh
        try {
            for (const key of Object.keys(sessionStorage)) {
                if (key.startsWith('checklists-registry-')) {
                    sessionStorage.removeItem(key);
                }
            }
        } catch (e) { /* ignore */ }

        return true;
    }

    // Get the active gist ID for read/write operations
    // On preview sites, always use the preview gist (even when logged in)
    // On production, use the user's personal gist
    getActiveGistId() {
        if (IS_PREVIEW) {
            return CONFIG.PUBLIC_GIST_ID; // Preview gist
        }
        return this.gistId; // User's personal gist
    }

    // Find existing gist or create new one
    async findOrCreateGist() {
        if (!this.token) return null;

        // On preview sites, always use the preview gist - don't search
        // This prevents finding the wrong gist when multiple exist with same filename
        if (IS_PREVIEW) {
            this.gistId = CONFIG.PUBLIC_GIST_ID;
            localStorage.setItem(GIST_ID_KEY, this.gistId);
            return this.gistId;
        }

        // Check if we have a cached gist ID
        if (this.gistId) {
            try {
                const response = await fetch(`https://api.github.com/gists/${this.gistId}`, {
                    headers: { 'Authorization': `Bearer ${this.token}` },
                });
                if (response.ok) return this.gistId;
            } catch (e) {
                // Gist doesn't exist anymore, find or create
            }
        }

        // Search for existing gist (production only)
        const response = await fetch('https://api.github.com/gists', {
            headers: { 'Authorization': `Bearer ${this.token}` },
        });
        const gists = await response.json();

        for (const gist of gists) {
            // Skip the preview gist when searching on production
            if (!IS_PREVIEW && gist.id === PREVIEW_GIST_ID) continue;
            if (gist.files[CONFIG.GIST_FILENAME]) {
                this.gistId = gist.id;
                localStorage.setItem(GIST_ID_KEY, this.gistId);
                return this.gistId;
            }
        }

        // Create new gist
        const createResponse = await fetch('https://api.github.com/gists', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                description: CONFIG.GIST_DESCRIPTION,
                public: true,
                files: {
                    [CONFIG.GIST_FILENAME]: {
                        content: JSON.stringify({ checklists: {} }, null, 2),
                    },
                },
            }),
        });

        const newGist = await createResponse.json();
        this.gistId = newGist.id;
        localStorage.setItem(GIST_ID_KEY, this.gistId);
        return this.gistId;
    }

    // Load all collection data from gist (uses cache if available)
    async loadData() {
        const gistId = this.getActiveGistId();
        if (!this.token || !gistId) return null;

        // Use cache if available (prevents stale reads during save operations)
        if (this._cachedData) {
            return this._cachedData;
        }

        try {
            const response = await fetch(`https://api.github.com/gists/${gistId}`, {
                headers: { 'Authorization': `Bearer ${this.token}` },
            });

            // If auth failed, fall back to public data
            if (!response.ok && (response.status === 401 || response.status === 403)) {
                return this.loadPublicData();
            }
            if (!response.ok) return null;

            const gist = await response.json();
            const content = gist.files[CONFIG.GIST_FILENAME]?.content;

            if (!content) return null;

            this._cachedData = JSON.parse(content);
            return this._cachedData;
        } catch (error) {
            console.error('Failed to load from gist:', error);
            return null;
        }
    }

    // Load from public gist (no auth required)
    async loadPublicData() {
        try {
            const response = await fetch(`https://api.github.com/gists/${CONFIG.PUBLIC_GIST_ID}`);
            if (!response.ok) return null;

            const gist = await response.json();
            const content = gist.files[CONFIG.GIST_FILENAME]?.content;

            if (!content) return null;

            return JSON.parse(content);
        } catch (error) {
            console.error('Failed to load public gist:', error);
            return null;
        }
    }

    // Save collection data to gist (queued to prevent race conditions)
    async saveData(data) {
        if (!this.token) return false;

        const gistId = this.getActiveGistId();
        if (!gistId) {
            await this.findOrCreateGist();
        }

        // Queue saves to prevent concurrent writes
        this._saveQueue = this._saveQueue.then(async () => {
            const maxRetries = 3;
            for (let attempt = 0; attempt < maxRetries; attempt++) {
                try {
                    const response = await fetch(`https://api.github.com/gists/${this.getActiveGistId()}`, {
                        method: 'PATCH',
                        headers: {
                            'Authorization': `Bearer ${this.token}`,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            files: {
                                [CONFIG.GIST_FILENAME]: {
                                    content: JSON.stringify(data, null, 2),
                                },
                            },
                        }),
                    });

                    if (response.ok) {
                        this._cachedData = data; // Update cache on successful save
                        return true;
                    }

                    // Retry on 409 Conflict (git-level conflict from rapid saves)
                    if (response.status === 409 && attempt < maxRetries - 1) {
                        await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
                        continue;
                    }

                    return false;
                } catch (error) {
                    console.error('Failed to save to gist:', error);
                    return false;
                }
            }
            return false;
        });

        return this._saveQueue;
    }

    // Checklist-specific helpers
    async loadChecklist(checklistId) {
        const data = await this.loadData();
        return data?.checklists?.[checklistId] || [];
    }

    async loadPublicChecklist(checklistId) {
        const data = await this.loadPublicData();
        return data?.checklists?.[checklistId] || [];
    }

    async saveChecklist(checklistId, ownedCards, stats = null) {
        let data = await this.loadData();
        if (!data) {
            data = { checklists: {}, stats: {} };
        }
        data.checklists[checklistId] = ownedCards;
        // Save stats too if provided (avoids race condition)
        if (stats) {
            if (!data.stats) data.stats = {};
            data.stats[checklistId] = stats;
        }
        data.lastUpdated = new Date().toISOString();
        return await this.saveData(data);
    }

    // Save computed stats for a checklist (for index page aggregate)
    // NOTE: Prefer passing stats to saveChecklist() to avoid race conditions
    async saveChecklistStats(checklistId, stats) {
        let data = await this.loadData();
        if (!data) {
            data = { checklists: {}, stats: {} };
        }
        if (!data.stats) {
            data.stats = {};
        }
        data.stats[checklistId] = stats;
        data.lastUpdated = new Date().toISOString();
        return await this.saveData(data);
    }

    // Load stats for all checklists
    async loadAllStats() {
        const data = await this.loadData();
        return data?.stats || {};
    }

    async loadPublicStats() {
        const data = await this.loadPublicData();
        return data?.stats || {};
    }

    // ========================================
    // Repo File Operations (for card data)
    // ========================================

    // Get repo info from current page URL (assumes GitHub Pages)
    getRepoInfo() {
        // For GitHub Pages: https://username.github.io/repo-name/
        // Or custom domain pointing to GitHub Pages
        // We'll use a config value for reliability
        return {
            owner: 'iammike',
            repo: 'sports-card-checklists'
        };
    }

    // Get a file from the repo (returns content and SHA for updates)
    async getRepoFile(path) {
        if (!this.token) return null;

        const { owner, repo } = this.getRepoInfo();
        try {
            // Add timestamp to bust browser cache and get latest SHA
            const response = await fetch(
                `https://api.github.com/repos/${owner}/${repo}/contents/${path}?t=${Date.now()}`,
                {
                    headers: { 'Authorization': `Bearer ${this.token}` }
                }
            );

            if (!response.ok) {
                console.error('Failed to get repo file:', response.status);
                return null;
            }

            const data = await response.json();
            // Content is base64 encoded
            const content = atob(data.content);
            return {
                content,
                sha: data.sha,
                path: data.path
            };
        } catch (error) {
            console.error('Failed to get repo file:', error);
            return null;
        }
    }

    // Update a file in the repo
    async updateRepoFile(path, content, message) {
        if (!this.token) return false;

        const { owner, repo } = this.getRepoInfo();

        // First get the current file to get its SHA
        const currentFile = await this.getRepoFile(path);
        if (!currentFile) {
            console.error('Could not get current file SHA');
            return false;
        }

        try {
            const response = await fetch(
                `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
                {
                    method: 'PUT',
                    headers: {
                        'Authorization': `Bearer ${this.token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        message: message || `Update ${path}`,
                        content: btoa(content), // Base64 encode
                        sha: currentFile.sha
                    })
                }
            );

            if (!response.ok) {
                const error = await response.json();
                console.error('Failed to update repo file:', error);
                return false;
            }

            return true;
        } catch (error) {
            console.error('Failed to update repo file:', error);
            return false;
        }
    }

    // Upload an image to Cloudflare R2 via the Worker
    // Returns the full R2 URL on success, null on failure
    async uploadImage(key, base64Content) {
        if (!this.token) throw new Error('Not authenticated');

        const response = await fetch(CONFIG.OAUTH_PROXY_URL + '/upload-image', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.token}`,
            },
            body: JSON.stringify({
                key,
                base64: base64Content,
                contentType: 'image/webp',
            }),
        });

        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            if (body.error) {
                throw new Error(body.error);
            }
            throw new Error(`Upload failed (${response.status})`);
        }

        const data = await response.json();
        return data.url;
    }

    // Delete an image from Cloudflare R2 via the Worker
    async deleteImage(key) {
        if (!this.token) throw new Error('Not authenticated');

        const response = await fetch(CONFIG.OAUTH_PROXY_URL + '/delete-image', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.token}`,
            },
            body: JSON.stringify({ key }),
        });

        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            if (body.error) {
                throw new Error(body.error);
            }
            throw new Error(`Delete failed (${response.status})`);
        }

        return true;
    }

    // List all images in R2 (for cleanup scripts)
    async listImages(cursor = null) {
        if (!this.token) throw new Error('Not authenticated');

        const response = await fetch(CONFIG.OAUTH_PROXY_URL + '/list-images', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.token}`,
            },
            body: JSON.stringify({ cursor }),
        });

        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body.error || `List failed (${response.status})`);
        }

        return response.json();
    }

    // ========================================
    // Registry & Config Operations (stored in gist)
    // ========================================

    // Fetch raw gist data with caching (avoids duplicate API calls)
    async _fetchGist(forcePublic = false) {
        const cacheKey = forcePublic ? '_publicGistCache' : '_gistCache';
        if (this[cacheKey]) return this[cacheKey];

        try {
            let response;
            if (!forcePublic && this.token) {
                const gistId = this.getActiveGistId();
                if (!gistId) return null;
                response = await fetch(`https://api.github.com/gists/${gistId}`, {
                    headers: { 'Authorization': `Bearer ${this.token}` },
                });
                // If auth failed, fall back to public gist
                if (!response.ok && (response.status === 401 || response.status === 403)) {
                    return this._fetchGist(true);
                }
            } else {
                response = await fetch(`https://api.github.com/gists/${CONFIG.PUBLIC_GIST_ID}`);
            }
            if (!response.ok) return null;
            const gist = await response.json();
            this[cacheKey] = gist;
            return gist;
        } catch (error) {
            console.error('Failed to fetch gist:', error);
            return null;
        }
    }

    // Read a JSON file from the gist
    async _readGistFile(filename) {
        const gist = this.token
            ? await this._fetchGist()
            : await this._fetchGist(true);
        if (!gist) return null;
        const content = gist.files[filename]?.content;
        return content ? JSON.parse(content) : null;
    }

    // Write a JSON file to the gist
    async _writeGistFile(filename, data) {
        if (!this.token) return false;
        const gistId = this.getActiveGistId();
        if (!gistId) return false;

        const maxRetries = 3;
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const response = await fetch(`https://api.github.com/gists/${gistId}`, {
                    method: 'PATCH',
                    headers: {
                        'Authorization': `Bearer ${this.token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        files: {
                            [filename]: {
                                content: JSON.stringify(data, null, 2),
                            },
                        },
                    }),
                });
                // Invalidate gist cache on write
                if (response.ok) {
                    this._gistCache = null;
                    this._publicGistCache = null;
                    return true;
                }
                // Retry on 409 Conflict (git-level conflict from rapid saves)
                if (response.status === 409 && attempt < maxRetries - 1) {
                    await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
                    continue;
                }
                return false;
            } catch (error) {
                console.error(`Failed to write ${filename}:`, error);
                return false;
            }
        }
        return false;
    }

    // Write multiple JSON files to the gist in one API call
    async _writeGistFiles(filesMap) {
        if (!this.token) return false;
        const gistId = this.getActiveGistId();
        if (!gistId) return false;

        const files = {};
        for (const [filename, data] of Object.entries(filesMap)) {
            files[filename] = {
                content: JSON.stringify(data, null, 2),
            };
        }

        const maxRetries = 3;
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const response = await fetch(`https://api.github.com/gists/${gistId}`, {
                    method: 'PATCH',
                    headers: {
                        'Authorization': `Bearer ${this.token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ files }),
                });
                if (response.ok) {
                    this._gistCache = null;
                    this._publicGistCache = null;
                    return true;
                }
                if (response.status === 409 && attempt < maxRetries - 1) {
                    await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
                    continue;
                }
                return false;
            } catch (error) {
                console.error('Failed to write gist files:', error);
                return false;
            }
        }
        return false;
    }

    // Load checklists registry from gist
    async loadRegistry() {
        return this._readGistFile('checklists-registry.json');
    }

    // Save checklists registry to gist
    async saveRegistry(registry) {
        return this._writeGistFile('checklists-registry.json', registry);
    }

    // Load per-checklist config from gist
    async loadChecklistConfig(checklistId) {
        return this._readGistFile(`${checklistId}-config.json`);
    }

    // Save per-checklist config to gist
    async saveChecklistConfig(checklistId, config) {
        return this._writeGistFile(`${checklistId}-config.json`, config);
    }

    // Create a new dynamic checklist: saves config, empty cards, and updates registry in one call
    async createChecklist(checklistId, config, registry) {
        let emptyCards;
        if (config.dataShape === 'flat') {
            emptyCards = { cards: [] };
        } else {
            emptyCards = { categories: {} };
            if (config.categories) {
                config.categories.forEach(cat => {
                    if (cat.children && cat.children.length > 0) {
                        cat.children.forEach(child => { emptyCards.categories[child.id] = []; });
                    } else {
                        emptyCards.categories[cat.id] = [];
                    }
                });
            }
        }
        const ok = await this._writeGistFiles({
            [`${checklistId}-config.json`]: config,
            [`${checklistId}-cards.json`]: emptyCards,
            'checklists-registry.json': registry,
        });
        if (ok) {
            // Write initial zeroed stats so the index page shows 0/0 immediately
            await this.saveChecklistStats(checklistId, {
                owned: 0,
                total: 0,
                ownedValue: 0,
                neededValue: 0,
            });
        }
        return ok;
    }

    // Delete a dynamic checklist: saves backup, then removes config, cards, stats, and registry entry
    async deleteChecklist(checklistId) {
        if (!this.token) return false;
        const gistId = this.getActiveGistId();
        if (!gistId) return false;

        try {
            // Fetch current gist to see what files exist
            const gistResponse = await fetch(`https://api.github.com/gists/${gistId}`, {
                headers: { 'Authorization': `Bearer ${this.token}` },
            });
            if (!gistResponse.ok) return false;
            const gist = await gistResponse.json();
            const gistFiles = gist.files;

            const files = {};

            // Save a backup of all checklist data before deleting
            const configFile = `${checklistId}-config.json`;
            const cardsFile = `${checklistId}-cards.json`;
            const backup = { deletedAt: new Date().toISOString(), id: checklistId };
            if (gistFiles[configFile]?.content) {
                backup.config = JSON.parse(gistFiles[configFile].content);
                files[configFile] = null;
            }
            if (gistFiles[cardsFile]?.content) {
                backup.cards = JSON.parse(gistFiles[cardsFile].content);
                files[cardsFile] = null;
            }
            const registryContent = gistFiles['checklists-registry.json']?.content;
            if (registryContent) {
                const registry = JSON.parse(registryContent);
                backup.registryEntry = registry.checklists.find(e => e.id === checklistId);
                registry.checklists = registry.checklists.filter(e => e.id !== checklistId);
                files['checklists-registry.json'] = { content: JSON.stringify(registry, null, 2) };
            }
            const statsContent = gistFiles['sports-card-stats.json']?.content;
            if (statsContent) {
                const stats = JSON.parse(statsContent);
                if (stats[checklistId]) {
                    backup.stats = stats[checklistId];
                    delete stats[checklistId];
                    files['sports-card-stats.json'] = { content: JSON.stringify(stats, null, 2) };
                }
            }

            // Write backup file (overwrites any previous backup for this ID)
            if (backup.config || backup.cards) {
                files[`_backup-${checklistId}.json`] = { content: JSON.stringify(backup, null, 2) };
            }

            // If nothing to update, the checklist data is already gone
            if (Object.keys(files).length === 0) {
                this._gistCache = null;
                this._publicGistCache = null;
                return true;
            }

            const response = await fetch(`https://api.github.com/gists/${gistId}`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ files }),
            });
            if (response.ok) {
                this._gistCache = null;
                this._publicGistCache = null;
                this._cachedData = null;
            } else {
                const err = await response.text();
                console.error('Gist PATCH failed:', response.status, err);
            }
            return response.ok;
        } catch (error) {
            console.error('Failed to delete checklist:', error);
            return false;
        }
    }

    // ========================================
    // Card Data Operations (stored in gist)
    // ========================================

    // Save card data to gist (as separate file per checklist)
    async saveCardData(checklistId, cardData) {
        if (!this.token) return { ok: false, reason: 'not_authenticated' };

        const gistId = this.getActiveGistId();
        if (!gistId) {
            await this.findOrCreateGist();
        }

        const filename = `${checklistId}-cards.json`;
        const maxRetries = 3;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const response = await fetch(`https://api.github.com/gists/${this.getActiveGistId()}`, {
                    method: 'PATCH',
                    headers: {
                        'Authorization': `Bearer ${this.token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        files: {
                            [filename]: {
                                content: JSON.stringify(cardData, null, 2),
                            },
                        },
                    }),
                });

                if (response.ok) return { ok: true };

                // Retry on 409 Conflict (git-level conflict from rapid saves)
                if (response.status === 409 && attempt < maxRetries - 1) {
                    await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
                    continue;
                }

                console.error(`Save failed: ${response.status}`, await response.text().catch(() => ''));
                if (response.status === 401 || response.status === 403) {
                    return { ok: false, reason: 'auth_expired' };
                }
                return { ok: false, reason: 'api_error', status: response.status };
            } catch (error) {
                console.error('Failed to save card data to gist:', error);
                return { ok: false, reason: 'network_error' };
            }
        }
        return { ok: false, reason: 'api_error', status: 409 };
    }

    // Load card data from gist (for logged-in user editing)
    async loadCardData(checklistId) {
        return this._readGistFile(`${checklistId}-cards.json`);
    }

    // Load config from public gist (fallback when auth fails)
    async loadPublicChecklistConfig(checklistId) {
        const filename = `${checklistId}-config.json`;
        const gist = await this._fetchGist(true);
        if (!gist) return null;
        const content = gist.files[filename]?.content;
        return content ? JSON.parse(content) : null;
    }

    // Load card data from public gist (fallback, or for non-logged-in users)
    async loadPublicCardData(checklistId) {
        const filename = `${checklistId}-cards.json`;
        const gist = await this._fetchGist(true);
        if (!gist) return null;
        const content = gist.files[filename]?.content;
        return content ? JSON.parse(content) : null;
    }

}

// Export singleton
window.githubSync = new GitHubSync();
