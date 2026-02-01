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
        this.user = JSON.parse(localStorage.getItem(USER_KEY) || 'null');
        this.onAuthChange = null;
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
        const scope = 'gist';
        const authUrl = `https://github.com/login/oauth/authorize?client_id=${CONFIG.GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}`;
        window.location.href = authUrl;
    }

    // Handle OAuth callback (call this on page load)
    async handleCallback() {
        const params = new URLSearchParams(window.location.search);
        const code = params.get('code');

        if (!code) return false;

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

    // Load all collection data from gist
    async loadData() {
        if (!this.token || !this.gistId) return null;

        try {
            const response = await fetch(`https://api.github.com/gists/${this.gistId}`, {
                headers: { 'Authorization': `Bearer ${this.token}` },
            });

            if (!response.ok) return null;

            const gist = await response.json();
            const content = gist.files[CONFIG.GIST_FILENAME]?.content;

            if (!content) return null;

            return JSON.parse(content);
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

    // Save collection data to gist
    async saveData(data) {
        if (!this.token) return false;

        if (!this.gistId) {
            await this.findOrCreateGist();
        }

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

            return response.ok;
        } catch (error) {
            console.error('Failed to save to gist:', error);
            return false;
        }
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

    async saveChecklist(checklistId, ownedCards) {
        let data = await this.loadData();
        if (!data) {
            data = { checklists: {} };
        }
        data.checklists[checklistId] = ownedCards;
        data.lastUpdated = new Date().toISOString();
        return await this.saveData(data);
    }

    // Save computed stats for a checklist (for index page aggregate)
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
}

// Export singleton
window.githubSync = new GitHubSync();
