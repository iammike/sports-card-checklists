// GitHub OAuth + Gist Storage for Sports Card Checklists
//
// Configuration: Set these values after creating your GitHub OAuth App and Cloudflare Worker
const CONFIG = {
    GITHUB_CLIENT_ID: 'Ov23liik9Fs5C6RCeTgf',
    OAUTH_PROXY_URL: 'https://cards-oauth.iammikec.workers.dev',
    GIST_FILENAME: 'sports-card-checklists.json',
    GIST_DESCRIPTION: 'Sports Card Checklist Collection Data',
    PUBLIC_GIST_ID: '5f2b43f0588d72892273ae8f24f68c2d',
};

// Storage keys
const TOKEN_KEY = 'github_token';
const GIST_ID_KEY = 'github_gist_id';
const USER_KEY = 'github_user';

class GitHubSync {
    constructor() {
        this.token = localStorage.getItem(TOKEN_KEY);
        this.gistId = localStorage.getItem(GIST_ID_KEY);
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

        // Clear cache when tab becomes visible (handles multi-tab edits)
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                this._cachedData = null;
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
        const redirectUri = window.location.origin + window.location.pathname;
        const scope = 'gist public_repo'; // gist for owned cards, public_repo for card data edits
        // Generate state parameter for CSRF protection
        const state = crypto.randomUUID();
        sessionStorage.setItem('oauth_state', state);
        const authUrl = `https://github.com/login/oauth/authorize?client_id=${CONFIG.GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&state=${encodeURIComponent(state)}`;
        window.location.href = authUrl;
    }

    // Handle OAuth callback (call this on page load)
    async handleCallback() {
        const params = new URLSearchParams(window.location.search);
        const code = params.get('code');
        const state = params.get('state');

        if (!code) return false;

        // Verify state parameter for CSRF protection
        const expectedState = sessionStorage.getItem('oauth_state');
        sessionStorage.removeItem('oauth_state');
        if (!state || state !== expectedState) {
            console.error('OAuth state mismatch - possible CSRF attack');
            window.history.replaceState({}, document.title, window.location.pathname);
            return false;
        }

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

    // Find existing gist or create new one
    async findOrCreateGist() {
        if (!this.token) return null;

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

        // Search for existing gist
        const response = await fetch('https://api.github.com/gists', {
            headers: { 'Authorization': `Bearer ${this.token}` },
        });
        const gists = await response.json();

        for (const gist of gists) {
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
        if (!this.token || !this.gistId) return null;

        // Use cache if available (prevents stale reads during save operations)
        if (this._cachedData) {
            return this._cachedData;
        }

        try {
            const response = await fetch(`https://api.github.com/gists/${this.gistId}`, {
                headers: { 'Authorization': `Bearer ${this.token}` },
            });

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

        if (!this.gistId) {
            await this.findOrCreateGist();
        }

        // Queue saves to prevent concurrent writes
        this._saveQueue = this._saveQueue.then(async () => {
            try {
                const response = await fetch(`https://api.github.com/gists/${this.gistId}`, {
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
                }
                return response.ok;
            } catch (error) {
                console.error('Failed to save to gist:', error);
                return false;
            }
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

    // Commit an image to the repo via PR (auto-merges via GitHub Action)
    // Returns the path where the image will be available after merge
    async commitImageViaPR(path, base64Content, message) {
        if (!this.token) return null;

        const { owner, repo } = this.getRepoInfo();
        const branchName = `image/${path.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${Date.now()}`;

        try {
            // 1. Get main branch SHA
            const mainRef = await fetch(
                `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/main`,
                { headers: { 'Authorization': `Bearer ${this.token}` } }
            );
            if (!mainRef.ok) throw new Error('Failed to get main branch');
            const mainData = await mainRef.json();
            const mainSha = mainData.object.sha;

            // 2. Create new branch
            const createBranch = await fetch(
                `https://api.github.com/repos/${owner}/${repo}/git/refs`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${this.token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        ref: `refs/heads/${branchName}`,
                        sha: mainSha
                    })
                }
            );
            if (!createBranch.ok) throw new Error('Failed to create branch');

            // 3. Commit image to new branch
            const commitImage = await fetch(
                `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
                {
                    method: 'PUT',
                    headers: {
                        'Authorization': `Bearer ${this.token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        message: message || `Add image ${path}`,
                        content: base64Content,
                        branch: branchName
                    })
                }
            );
            if (!commitImage.ok) throw new Error('Failed to commit image');

            // 4. Create PR (GitHub Action will auto-merge)
            const createPR = await fetch(
                `https://api.github.com/repos/${owner}/${repo}/pulls`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${this.token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        title: message || `Add image ${path}`,
                        head: branchName,
                        base: 'main',
                        body: 'Auto-generated image upload. This PR will be auto-merged.'
                    })
                }
            );
            if (!createPR.ok) throw new Error('Failed to create PR');

            // Return the path - image will be available after PR merges (~30-60s)
            return path;
        } catch (error) {
            console.error('Failed to commit image via PR:', error);
            return null;
        }
    }

    // ========================================
    // Card Data Operations (stored in gist)
    // ========================================

    // Save card data to gist (as separate file per checklist)
    async saveCardData(checklistId, cardData) {
        if (!this.token) return false;

        if (!this.gistId) {
            await this.findOrCreateGist();
        }

        const filename = `${checklistId}-cards.json`;

        try {
            const response = await fetch(`https://api.github.com/gists/${this.gistId}`, {
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

            return response.ok;
        } catch (error) {
            console.error('Failed to save card data to gist:', error);
            return false;
        }
    }

    // Load card data from gist (for logged-in user editing)
    async loadCardData(checklistId) {
        if (!this.token || !this.gistId) return null;

        const filename = `${checklistId}-cards.json`;

        try {
            const response = await fetch(`https://api.github.com/gists/${this.gistId}`, {
                headers: { 'Authorization': `Bearer ${this.token}` },
            });

            if (!response.ok) return null;

            const gist = await response.json();
            const content = gist.files[filename]?.content;

            if (!content) return null;

            return JSON.parse(content);
        } catch (error) {
            console.error('Failed to load card data from gist:', error);
            return null;
        }
    }

    // Load card data from public gist (fallback, or for non-logged-in users)
    async loadPublicCardData(checklistId) {
        const filename = `${checklistId}-cards.json`;

        try {
            const response = await fetch(`https://api.github.com/gists/${CONFIG.PUBLIC_GIST_ID}`);
            if (!response.ok) return null;

            const gist = await response.json();
            const content = gist.files[filename]?.content;

            if (!content) return null;

            return JSON.parse(content);
        } catch (error) {
            console.error('Failed to load public card data:', error);
            return null;
        }
    }
}

// Export singleton
window.githubSync = new GitHubSync();
