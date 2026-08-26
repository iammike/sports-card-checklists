// GitHub OAuth + Gist Storage for Sports Card Checklists
//
// Configuration: Set these values after creating your GitHub OAuth App and Cloudflare Worker
// Two notions of "preview", deliberately not the same test. Kept together because
// apart they read as duplicates of each other, and the next person to make them
// agree would be widening a trust boundary without noticing.
//
// The deployment question - are we on Cloudflare Pages rather than production?
// Picks the OAuth app and the gist, so it has to hold on every preview host,
// branch subdomains included. Any Pages project satisfies it, so it is never
// sufficient for trust on its own - but it is a necessary half of both the
// #auth= acceptance check and the CSRF exemption below, so loosening it loosens
// those.
const IS_PREVIEW_DEPLOY = window.location.hostname.endsWith('.pages.dev');

// The identity question - is this *our* project's apex preview, the one that
// receives the OAuth callback? Decides where a token may be sent. Anyone can
// create a Pages project, so "somewhere on pages.dev" is not an answer to this.
const PROJECT_PREVIEW_HOST = 'sports-card-checklists.pages.dev';

const PREVIEW_GIST_ID = 'ec645b5e213447ac37de95ffada2d31b';
const PRODUCTION_GIST_ID = '5f2b43f0588d72892273ae8f24f68c2d';
const CONFIG = {
    // Use preview OAuth app for pages.dev, production app for github.io
    GITHUB_CLIENT_ID: IS_PREVIEW_DEPLOY
        ? 'Ov23limT2ZxKxthkupeT'  // Preview app
        : 'Ov23liik9Fs5C6RCeTgf', // Production app
    OAUTH_PROXY_URL: 'https://cards-oauth.iammikec.workers.dev',
    GIST_FILENAME: 'sports-card-checklists.json',
    GIST_DESCRIPTION: 'Sports Card Checklist Collection Data',
    // Preview uses separate gist so testing doesn't affect production
    PUBLIC_GIST_ID: IS_PREVIEW_DEPLOY ? PREVIEW_GIST_ID : PRODUCTION_GIST_ID,
    PRODUCTION_GIST_ID: PRODUCTION_GIST_ID, // For syncing preview from prod
};

// Minimum gap enforced between consecutive gist PATCHes (see _patchGist, #733).
// 1s errs conservative - GitHub doesn't publish an exact figure for the gist
// secondary limit, and a save is not latency-sensitive enough to shave this down.
const MIN_WRITE_SPACING_MS = 1000;

// Anyone can authorize the OAuth app, but only the owner has anything to sign in
// for - see _rejectIfNotOwner.
const OWNER_USERNAME = 'iammike';

// Everything an OAuth response adds to the address bar, dropped by
// _cleanAuthFromUrl once the callback has read what it needs. Address-bar hygiene
// only - what keeps a stale state from riding back out to GitHub is _returnQuery's
// allowlist, which never picks these up in the first place. Reaching for this list
// as the defense is the mistake that shipped once already.
const OAUTH_RESPONSE_PARAMS = ['code', 'state', 'error', 'error_description', 'error_uri'];

// The only query parameter this app reads - ChecklistEngine's constructor, and
// DynamicNav.isActive to mark the current page. Everything else in the address
// bar belongs to whoever put it there.
const APP_QUERY_PARAMS = ['id'];

// Storage keys
const TOKEN_KEY = 'github_token';
const GIST_ID_KEY = 'github_gist_id';
const USER_KEY = 'github_user';

class GitHubSync {
    constructor() {
        this.token = localStorage.getItem(TOKEN_KEY);
        this.gistId = localStorage.getItem(GIST_ID_KEY);

        // Guard: clear preview gist ID if it leaked into production localStorage
        if (!IS_PREVIEW_DEPLOY && this.gistId === PREVIEW_GIST_ID) {
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
        this._lastWriteAt = 0; // Date.now() of the last gist PATCH, for MIN_WRITE_SPACING_MS (#733)
        this._cachedData = null; // Cache to avoid stale reads during saves
        this._gistCache = null; // Raw gist cache for registry/config reads
        this._publicGistCache = null; // Public gist cache

        // After the fields above, so it never depends on which of them exist yet.
        this._clearStaleNonOwnerSession();

        // Clear cache when tab becomes visible (handles multi-tab edits)
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                this.clearDataCache();
                this.clearGistCache();
            }
        });
    }

    // Signing in as anyone but the owner leaves a half-broken site - the registry
    // read follows the token to the visitor's own gist, so the index page loses
    // every checklist and nav link - and findOrCreateGist() would plant a public
    // gist in their account uninvited. Callers must bail out when this returns true.
    _rejectIfNotOwner(user) {
        if (user?.login === OWNER_USERNAME) return false;
        this.logout();
        alert('Sign-in is limited to the collection owner. You can browse everything without signing in.');
        return true;
    }

    // The handleCallback gates only fire on a fresh OAuth return, so a session
    // stored before sign-in became owner-only would otherwise persist unchecked.
    // Fails closed on a token with no user: that pairing is unattributable, so
    // requiring a user here would let it survive every reload.
    _clearStaleNonOwnerSession() {
        if (this.token && this.user?.login !== OWNER_USERNAME) {
            this.logout();
        }
    }

    // A branch preview, as opposed to the apex preview that receives the OAuth
    // callback. Takes the hostname so it can be exercised for hosts the test
    // environment cannot actually be served from.
    _isBranchPreview(hostname = window.location.hostname) {
        return this.isPreview() && hostname !== PROJECT_PREVIEW_HOST;
    }

    // Is this a URL we are willing to hand a token to? Parsed, not substring
    // matched: "https://evil.example/?x=.pages.dev" contains the preview domain
    // and is not it. Restricted to this project's own subdomains rather than
    // *.pages.dev, because anyone can create a Pages project.
    isProjectPreviewUrl(url) {
        try {
            const { protocol, hostname } = new URL(url);
            return protocol === 'https:'
                && (hostname === PROJECT_PREVIEW_HOST || hostname.endsWith('.' + PROJECT_PREVIEW_HOST));
        } catch (e) {
            return false;
        }
    }

    // Extracted so tests can observe where a token is sent. Asserting on the
    // callback's return value cannot: the redirect branch also returns true.
    _redirect(url) {
        window.location.href = url;
    }

    // Drop the OAuth response from the address bar - the code/state query on one
    // path, the #auth= fragment on the other - and keep everything else. All three
    // matter: a leftover code makes every reload re-enter this callback, a
    // leftover fragment leaves the token in history and the next Referer, and
    // dropping the whole query takes ?id= with it so a reload has nothing to load.
    _cleanAuthFromUrl() {
        const params = new URLSearchParams(window.location.search);
        OAUTH_RESPONSE_PARAMS.forEach(p => params.delete(p));
        const query = params.toString();
        window.history.replaceState({}, document.title,
            window.location.pathname + (query ? '?' + query : ''));
    }

    // The query to ask GitHub to send us back to. An allowlist, where the cleaner
    // above is a denylist, because the two point in opposite directions: leaving
    // an unrecognised parameter alone in our own address bar costs nothing, while
    // this one crosses a trust boundary. Nothing stops a third party handing the
    // owner a link to this site carrying any query they like, and login() is one
    // click away on every page. Sending only the parameter the app actually reads
    // means redirect_uri is bare in every path that exists today.
    _returnQuery() {
        const params = new URLSearchParams(window.location.search);
        const kept = new URLSearchParams();
        for (const name of APP_QUERY_PARAMS) {
            if (params.has(name)) kept.set(name, params.get(name));
        }
        const query = kept.toString();
        return query ? '?' + query : '';
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
        const isBranchPreview = this._isBranchPreview();
        let redirectUri;
        let returnUrl = null;
        // The checklist id rides along, nothing else does.
        //
        // The id matters because checklist.html is nothing without ?id=, and
        // ChecklistEngine reads it in its constructor - before init() calls
        // handleCallback() - so putting it back after the callback would arrive
        // too late. GitHub matches redirect_uri on host and path and permits
        // extra query parameters.
        //
        // The fragment has to go because _copyCardLink hands out "#card-<id>"
        // share URLs and the receiver is handed "<returnUrl>#auth=<payload>":
        // with a fragment already there the result has two, and a token ends up
        // parked in the address bar and history instead of being consumed. The
        // deep link is what is worth losing.
        const here = window.location.origin + window.location.pathname + this._returnQuery();
        if (isBranchPreview) {
            returnUrl = here;
            redirectUri = `https://${PROJECT_PREVIEW_HOST}/`;
        } else {
            redirectUri = here;
        }
        // Just the gist. public_repo went with the repo-file API in #764 - card
        // data lives in the gist, and images go to R2 through the Worker, which
        // only ever calls /user with this token.
        const scope = 'gist';
        // Generate state parameter for CSRF protection (include return URL if branch preview)
        const stateData = { csrf: crypto.randomUUID(), returnUrl };
        const state = btoa(JSON.stringify(stateData));
        sessionStorage.setItem('oauth_state', stateData.csrf);
        const authUrl = `https://github.com/login/oauth/authorize?client_id=${CONFIG.GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&state=${encodeURIComponent(state)}`;
        this._redirect(authUrl);
    }

    // Handle OAuth callback (call this on page load)
    async handleCallback() {
        // Check for auth data passed via URL fragment (from branch preview redirect)
        // Located rather than required to be the whole fragment. login() now
        // strips the fragment from returnUrl so this is the only one, but a
        // receiver that silently no-ops leaves a live token in the address bar,
        // which is too quiet a failure to leave resting on that.
        //
        // Last occurrence, not first: _redirect appends the real payload at the
        // end, so anything that looks like one earlier in the hash came from the
        // prefix - the part an attacker could influence.
        const hash = window.location.hash;
        const AUTH_PREFIX = '#auth=';
        const authAt = hash.lastIndexOf(AUTH_PREFIX);
        if (authAt !== -1) {
            try {
                const authData = JSON.parse(atob(hash.slice(authAt + AUTH_PREFIX.length)));
                // Only a preview origin ever receives one of these, and only as the
                // tail of a flow this tab started: the csrf must match the value
                // login() put in sessionStorage before navigating away. Without
                // that, any link could plant a token - and the ownership check
                // below is no help, since the login it reads is in the same blob.
                const expected = sessionStorage.getItem('oauth_state');
                sessionStorage.removeItem('oauth_state');
                if (!this.isPreview() || !authData.csrf || authData.csrf !== expected) {
                    console.error('Rejected auth fragment: not a redirect this tab started');
                    this._cleanAuthFromUrl();
                    return false;
                }
                if (this._rejectIfNotOwner(authData.user)) {
                    this._cleanAuthFromUrl();
                    return false;
                }
                this.token = authData.token;
                this.user = authData.user;
                this.gistId = authData.gistId;
                localStorage.setItem(TOKEN_KEY, this.token);
                localStorage.setItem(USER_KEY, JSON.stringify(this.user));
                localStorage.setItem(GIST_ID_KEY, this.gistId);
                // Clean URL
                this._cleanAuthFromUrl();
                if (this.onAuthChange) this.onAuthChange(true);
                return true;
            } catch (e) {
                // Clean up even here. A payload that will not decode is still a
                // token in the address bar and in history if it happens to be a
                // real one, and leaving it is the exact failure this branch
                // exists to prevent. The fragment only: a code/state alongside it
                // is a callback this pass has not read yet.
                console.error('Failed to parse auth data from URL:', e);
                window.history.replaceState({}, document.title,
                    window.location.pathname + window.location.search);
            }
        }

        const params = new URLSearchParams(window.location.search);
        const code = params.get('code');
        const state = params.get('state');

        if (!code) {
            // A denied authorization lands here with ?error= and no code. Clear it
            // rather than leaving the error sitting in the address bar. This drops
            // any fragment along with it, which a real denial never carries -
            // GitHub does not send one - so only a hand-built URL loses anything.
            if (params.has('error')) this._cleanAuthFromUrl();
            return false;
        }

        // Parse state parameter (contains CSRF token and optional return URL)
        let stateData = { csrf: null, returnUrl: null };
        try {
            stateData = JSON.parse(atob(state));
        } catch (e) {
            // Legacy: state might be just the CSRF token
            stateData = { csrf: state, returnUrl: null };
        }

        // A branch preview starts on <branch>.<project>.pages.dev and lands here on
        // <project>.pages.dev - a different origin, so sessionStorage is empty and
        // the csrf cannot be matched. That exemption is why isProjectPreviewUrl
        // below carries the weight: it decides who may be handed a token.
        //
        // Residual on a preview origin: a forged code still gets exchanged, and
        // _rejectIfNotOwner then logs out, so a link can end the owner's preview
        // session. Nuisance-grade, owner-only, and inherent to the exemption.
        // Gated on isPreview() too: the exemption's reason applies only on a
        // preview origin. Production verifies the csrf and never redirects.
        const returnUrl = this.isPreview() && this.isProjectPreviewUrl(stateData.returnUrl)
            ? stateData.returnUrl
            : null;
        const expectedState = sessionStorage.getItem('oauth_state');
        sessionStorage.removeItem('oauth_state');
        if (!returnUrl && (!stateData.csrf || stateData.csrf !== expectedState)) {
            console.error('OAuth state mismatch - possible CSRF attack');
            this._cleanAuthFromUrl();
            return false;
        }

        // Clean URL
        this._cleanAuthFromUrl();

        const priorToken = this.token;
        let tokenCommitted = false;
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

            // Held in memory only until the gate passes - fetchUser() and
            // findOrCreateGist() both read this.token, nothing reads storage. An
            // early write would survive a fetchUser() throw as a token with no
            // user, which reads as signed in and no sweeper can attribute.
            this.token = data.access_token;

            // Get user info
            await this.fetchUser();

            // Before findOrCreateGist, so a rejected sign-in never creates one.
            if (this._rejectIfNotOwner(this.user)) return false;

            localStorage.setItem(TOKEN_KEY, this.token);
            tokenCommitted = true;

            // Find or create gist
            await this.findOrCreateGist();

            // Check if we need to redirect back to a branch preview
            if (returnUrl) {
                // Pass auth data via URL fragment (not sent to server)
                // The csrf goes back with it so the receiving origin can tell this
                // payload apart from one an attacker pasted into a link. That origin
                // set the value in sessionStorage before navigating away, and
                // sessionStorage survives the round trip in the same tab.
                const authData = btoa(JSON.stringify({
                    token: this.token,
                    user: this.user,
                    gistId: this.gistId,
                    csrf: stateData.csrf,
                }));
                this._redirect(returnUrl + '#auth=' + authData);
                return true;
            }

            if (this.onAuthChange) this.onAuthChange(true);
            return true;
        } catch (error) {
            console.error('OAuth callback failed:', error);
            // Roll back only a token that never reached storage - a throw after
            // the commit (findOrCreateGist) must leave memory and storage in step,
            // or the owner sees a signed-out UI holding a valid token.
            if (!tokenCommitted) this.token = priorToken;
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
        return IS_PREVIEW_DEPLOY;
    }

    // Sync preview gist from production (only works on preview sites)
    async syncFromProduction() {
        if (!IS_PREVIEW_DEPLOY) {
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
        this.clearDataCache();
        this.clearGistCache();

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
        if (IS_PREVIEW_DEPLOY) {
            return CONFIG.PUBLIC_GIST_ID; // Preview gist
        }
        return this.gistId; // User's personal gist
    }

    // Find existing gist or create new one
    async findOrCreateGist() {
        if (!this.token) return null;

        // On preview sites, always use the preview gist - don't search
        // This prevents finding the wrong gist when multiple exist with same filename
        if (IS_PREVIEW_DEPLOY) {
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
            if (!IS_PREVIEW_DEPLOY && gist.id === PREVIEW_GIST_ID) continue;
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

    // The read behind loadData(), reporting *why* a read came back empty so that
    // callers who intend to write can tell "this gist has no collection yet"
    // (safe to seed) from "the read failed" (must not overwrite). loadData()
    // flattens this back to value-or-null for the read-only callers; the write
    // paths go through _loadDataForWrite() instead (#768).
    //
    // Returns { ok: true, data } - data being null for a gist that carries no
    // collection file yet - or { ok: false, reason } when the read failed.
    async _readCollectionData() {
        const gistId = this.getActiveGistId();
        if (!this.token || !gistId) return { ok: false, reason: 'not_authenticated' };

        // Use cache if available (prevents stale reads during save operations)
        if (this._cachedData) {
            return { ok: true, data: this._cachedData };
        }

        try {
            const response = await fetch(`https://api.github.com/gists/${gistId}`, {
                headers: { 'Authorization': `Bearer ${this.token}` },
            });

            if (!response.ok) {
                // Order matters here, and mirrors _patchGistFiles: GitHub's
                // secondary rate limit answers 403, so the rate-limit check has
                // to come first or a throttled read is misread as expired auth
                // and sends the caller to a different collection entirely (#768).
                if (await this._isRateLimited(response)) {
                    return { ok: false, reason: 'rate_limited' };
                }
                if (response.status === 401 || response.status === 403) {
                    return { ok: false, reason: 'auth_expired' };
                }
                return { ok: false, reason: 'api_error', status: response.status };
            }

            const gist = await response.json();
            const content = gist.files[CONFIG.GIST_FILENAME]?.content;

            // A gist that exists but has no collection file yet is a real,
            // writable state - not a failure.
            if (!content) return { ok: true, data: null };

            this._cachedData = JSON.parse(content);
            return { ok: true, data: this._cachedData };
        } catch (error) {
            console.error('Failed to load from gist:', error);
            return { ok: false, reason: 'network_error' };
        }
    }

    // Load all collection data from gist (uses cache if available).
    //
    // Read-only callers keep the original contract: the data, or null when there
    // is none to show. A genuine auth failure still falls back to the public
    // collection so a stale session renders something rather than an empty page.
    // A rate-limited 403 deliberately does not - it is not an auth problem, and
    // on production the public gist is a different collection (#768).
    async loadData() {
        const result = await this._readCollectionData();
        if (result.ok) return result.data;
        if (result.reason === 'auth_expired') return this.loadPublicData();
        return null;
    }

    // The read-modify-write base for every path that PATCHes the collection
    // file. Returns { ok: true, data } - a fresh empty collection when the gist
    // genuinely has none yet - or { ok: false, reason } when the read failed, in
    // which case the caller MUST abort. Treating a failed read as "nothing is
    // stored" is what let a single transient error overwrite the whole
    // collection with a blank one (#768).
    async _loadDataForWrite() {
        if (!this.token) return { ok: false, reason: 'not_authenticated' };

        // Having no gist yet is the first-save case, not a failure: create it,
        // then read back whatever findOrCreateGist found or seeded.
        if (!this.getActiveGistId()) {
            await this.findOrCreateGist();
        }

        const result = await this._readCollectionData();
        if (!result.ok) return result;
        return { ok: true, data: result.data || { checklists: {}, stats: {} } };
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

    // Queue a gist PATCH through the shared write queue to prevent 409 conflicts.
    // `fn(gistId)` should return { done, value, status? }:
    //   done:true  = stop retrying, return value
    //   done:false = retryable failure, status is the HTTP status
    _patchGist(fn) {
        const run = this._saveQueue.then(async () => {
            const gistId = this.getActiveGistId();
            if (!gistId) return false;

            const maxRetries = 3;
            for (let attempt = 0; attempt < maxRetries; attempt++) {
                // GitHub's gist secondary rate limit reacts to write *rate*, not
                // just volume - wait out the minimum gap before every attempt,
                // including 409 retries, so a request can't fire right on the
                // heels of the previous one completing (#733).
                const elapsed = Date.now() - this._lastWriteAt;
                if (elapsed < MIN_WRITE_SPACING_MS) {
                    await new Promise(r => setTimeout(r, MIN_WRITE_SPACING_MS - elapsed));
                }

                const result = await fn(gistId);
                this._lastWriteAt = Date.now();

                if (result.done) return result.value;
                if (result.status === 409 && attempt < maxRetries - 1) {
                    // This backoff is for spreading out concurrent-edit conflicts,
                    // not rate-limit spacing - it's shorter than MIN_WRITE_SPACING_MS
                    // and the loop-top wait above tops it up to the full gap on the
                    // next iteration, so it's additive with that wait, not instead of it.
                    await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
                    continue;
                }
                return result.value;
            }
        });
        // Chain the *settled* promise back into the queue, never the rejectable
        // one. A rejected _saveQueue makes every later .then() short-circuit, so
        // a single throw would silently kill every gist write for the rest of
        // the session without fn ever being called again (#767).
        this._saveQueue = run.catch(() => {});
        return run;
    }

    // Distinguish a GitHub rate-limit 403 from a genuine auth 403.
    // Secondary write rate limits return 403 (sometimes 429) with a rate-limit
    // body and/or Retry-After header, even while the core quota looks healthy.
    async _isRateLimited(response) {
        if (response.status !== 403 && response.status !== 429) return false;
        if (response.headers.get('retry-after')) return true;
        if (response.headers.get('x-ratelimit-remaining') === '0') return true;
        try {
            const body = await response.clone().text();
            return /rate limit/i.test(body);
        } catch (e) {
            return false;
        }
    }

    // Write one or more JSON files to the gist in a single PATCH, returning a
    // rich { ok, reason } result (reason: rate_limited | auth_expired | api_error | network_error).
    _patchGistFiles(filesMap) {
        const files = {};
        for (const [filename, data] of Object.entries(filesMap)) {
            files[filename] = { content: JSON.stringify(data, null, 2) };
        }

        return this._patchGist(async (gistId) => {
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
                    this.clearGistCache();
                    return { done: true, value: { ok: true } };
                }
                if (await this._isRateLimited(response)) {
                    return { done: true, value: { ok: false, reason: 'rate_limited' } };
                }
                if (response.status === 401 || response.status === 403) {
                    return { done: true, value: { ok: false, reason: 'auth_expired' } };
                }
                return { done: false, status: response.status, value: { ok: false, reason: 'api_error', status: response.status } };
            } catch (error) {
                console.error('Failed to save card data to gist:', error);
                return { done: true, value: { ok: false, reason: 'network_error' } };
            }
        });
    }

    // Save collection data to gist (queued to prevent race conditions)
    async saveData(data) {
        if (!this.token) return false;

        if (!this.getActiveGistId()) {
            await this.findOrCreateGist();
        }

        return this._patchGist(async (gistId) => {
            try {
                const response = await fetch(`https://api.github.com/gists/${gistId}`, {
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
                    this._cachedData = data;
                    return { done: true, value: true };
                }

                return { done: false, status: response.status, value: false };
            } catch (error) {
                console.error('Failed to save to gist:', error);
                return { done: true, value: false };
            }
        });
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
        const result = await this._loadDataForWrite();
        if (!result.ok) return false;
        const data = result.data;
        if (!data.checklists) data.checklists = {};
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
        const result = await this._loadDataForWrite();
        if (!result.ok) return false;
        const data = result.data;
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

    // Build an error flagged as an expired session so callers can prompt a
    // re-login instead of surfacing a cryptic "Invalid token" message.
    _authExpiredError() {
        const err = new Error('Your session has expired. Please sign in again.');
        err.authExpired = true;
        return err;
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
            // The Worker returns 401 only for an expired/invalid token. 403 is
            // used for non-auth cases (preview-site block, unauthorized user),
            // so it must fall through to the real error message below.
            if (response.status === 401) {
                throw this._authExpiredError();
            }
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
            // The Worker returns 401 only for an expired/invalid token. 403 is
            // used for non-auth cases (preview-site block, unauthorized user),
            // so it must fall through to the real error message below.
            if (response.status === 401) {
                throw this._authExpiredError();
            }
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

    // The two caches this object keeps are cleared independently, because the
    // callers genuinely want different things: the checklist engine needs a fresh
    // gist before merging, the shopping list needs fresh collection data. Both are
    // public so nothing outside this file has to reach into the private fields.

    // Drop both raw gist caches so the next _fetchGist() refetches.
    //
    // Deliberately leaves _cachedData alone: that is the card-data cache, and only
    // some of the callers here want it cleared as well. They say so explicitly.
    clearGistCache() {
        this._gistCache = null;
        this._publicGistCache = null;
    }

    // Drop the collection-data cache so the next loadData() refetches. That cache
    // exists to keep reads stable across a save, so it outlives a page load and
    // goes stale for anything reading the collection well after startup.
    //
    // Deliberately leaves the gist caches alone: loadData() and loadPublicData()
    // fetch directly and never consult them, so clearing them here would be a
    // wasted refetch for the callers that only want collection data.
    clearDataCache() {
        this._cachedData = null;
    }

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

        return this._patchGist(async (gistId) => {
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
                if (response.ok) {
                    this.clearGistCache();
                    return { done: true, value: true };
                }
                return { done: false, status: response.status, value: false };
            } catch (error) {
                console.error(`Failed to write ${filename}:`, error);
                return { done: true, value: false };
            }
        });
    }

    // Write multiple JSON files to the gist in one API call
    async _writeGistFiles(filesMap) {
        if (!this.token) return false;

        const files = {};
        for (const [filename, data] of Object.entries(filesMap)) {
            files[filename] = {
                content: JSON.stringify(data, null, 2),
            };
        }

        return this._patchGist(async (gistId) => {
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
                    this.clearGistCache();
                    return { done: true, value: true };
                }
                return { done: false, status: response.status, value: false };
            } catch (error) {
                console.error('Failed to write gist files:', error);
                return { done: true, value: false };
            }
        });
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
                this.clearGistCache();
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
                this.clearGistCache();
                this.clearDataCache();
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

    // Save card data, optionally bundling computed stats into the same PATCH.
    // Passing `stats` writes both `{id}-cards.json` and the main data file in a
    // single request, halving write pressure against GitHub's rate limit.
    async saveCardData(checklistId, cardData, stats = null) {
        if (!this.token) return { ok: false, reason: 'not_authenticated' };

        if (!this.getActiveGistId()) {
            await this.findOrCreateGist();
        }

        const filesMap = { [`${checklistId}-cards.json`]: cardData };

        // Bundle stats into the same write so we don't spend a second request.
        let mergedData = null;
        if (stats) {
            const result = await this._loadDataForWrite();
            // Card data is the point of this call; stats are the freeloader. If
            // the collection read failed we cannot rebuild that file safely, so
            // drop the stats half and still write the cards rather than PATCH a
            // blank collection over the real one (#768).
            if (result.ok) {
                mergedData = result.data;
                if (!mergedData.stats) mergedData.stats = {};
                mergedData.stats[checklistId] = stats;
                mergedData.lastUpdated = new Date().toISOString();
                filesMap[CONFIG.GIST_FILENAME] = mergedData;
            }
        }

        const result = await this._patchGistFiles(filesMap);
        if (result.ok && mergedData) {
            this._cachedData = mergedData; // keep cache coherent with the write
        }
        return result;
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

// Exported because the other bundle and index.html check it too - a login gate
// that disagrees with this one is how a differently-cased account signs in and
// then lands read-only everywhere. #751 wrote exactly that and caught it in
// review before it shipped; the copies have to agree.
window.OWNER_USERNAME = OWNER_USERNAME;

// Export singleton
window.githubSync = new GitHubSync();
