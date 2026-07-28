import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const DynamicNav = globalThis.DynamicNav;
const ChecklistEngine = globalThis.ChecklistEngine;
const ChecklistCreatorModal = globalThis.ChecklistCreatorModal;

// Deleting a checklist, or renaming one from its settings, has to drop the nav's
// registry cache or the entry keeps showing up until the tab is closed. The cache
// has two layers - an in-memory DynamicNav._registry and a sessionStorage copy
// keyed by gist id - and clearing only one of them leaves the stale entry
// reachable, so every assertion below is about the cache actually being gone
// rather than about a clear having been attempted.

const GIST_ID = 'a1b2c3d4e5f6';

// The entry a delete or a settings save is meant to evict
const STALE = {
    checklists: [
        { id: 'doomed', type: 'dynamic', title: 'Doomed', order: 0 },
        { id: 'kept', type: 'dynamic', title: 'Kept', order: 1 },
    ],
};

// What the gist returns once the destructive write has landed
const FRESH = {
    checklists: [{ id: 'kept', type: 'dynamic', title: 'Kept', order: 0 }],
};

let githubSync;

function seedCache(registry = STALE) {
    DynamicNav._registry = registry;
    DynamicNav._setCache(registry);
}

const cachedRegistry = () => sessionStorage.getItem(DynamicNav._getSessionKey());
const cachedIds = () => JSON.parse(cachedRegistry() || '{"checklists":[]}').checklists.map(c => c.id);

// A successful delete navigates to the index; jsdom refuses real navigation, so
// swap in a Location stand-in and assert where it was sent instead.
const realLocation = Object.getOwnPropertyDescriptor(window, 'location');
function stubLocation() {
    const stub = { href: window.location.href, pathname: '/checklist.html', search: '?id=doomed' };
    Object.defineProperty(window, 'location', { configurable: true, get: () => stub });
    return stub;
}

beforeEach(() => {
    sessionStorage.clear();
    DynamicNav._registry = null;
    githubSync = {
        getActiveGistId: () => GIST_ID,
        isLoggedIn: () => true,
        getUser: () => ({ login: 'iammike' }),
        loadRegistry: vi.fn(async () => structuredClone(FRESH)),
        saveRegistry: vi.fn(async () => true),
        saveChecklistConfig: vi.fn(async () => true),
        createChecklist: vi.fn(async () => true),
        deleteChecklist: vi.fn(async () => true),
    };
    window.githubSync = githubSync;
    window.confirm = vi.fn(() => true);
    window.alert = vi.fn();
});

afterEach(() => {
    Object.defineProperty(window, 'location', realLocation);
    sessionStorage.clear();
    DynamicNav._registry = null;
    delete window.githubSync;
    document.body.innerHTML = '';
});

describe('DynamicNav.clearCache', () => {
    it('removes the gist-scoped sessionStorage entry', () => {
        seedCache();
        expect(cachedRegistry()).not.toBeNull();

        DynamicNav.clearCache();

        expect(cachedRegistry()).toBeNull();
    });

    it('targets the real key, not one named "undefined"', () => {
        // DynamicNav._sessionKey does not exist; reading it instead of calling
        // _getSessionKey() removed a literal "undefined" entry and left the
        // registry cached. This sentinel fails if that ever comes back.
        seedCache();
        sessionStorage.setItem('undefined', 'sentinel');

        DynamicNav.clearCache();

        expect(DynamicNav._getSessionKey()).toBe(`checklists-registry-${GIST_ID}`);
        expect(cachedRegistry()).toBeNull();
        expect(sessionStorage.getItem('undefined')).toBe('sentinel');
    });

    it('drops the in-memory copy too, so the next load refetches', async () => {
        // loadRegistry() returns _registry before it ever consults sessionStorage,
        // so removing the key alone would still serve the stale registry.
        seedCache();

        DynamicNav.clearCache();
        const registry = await DynamicNav.loadRegistry();

        expect(githubSync.loadRegistry).toHaveBeenCalled();
        expect(registry.checklists.map(c => c.id)).toEqual(['kept']);
    });

    it('survives a page with no cached registry', () => {
        expect(() => DynamicNav.clearCache()).not.toThrow();
        expect(cachedRegistry()).toBeNull();
    });
});

describe('the checklist page delete button', () => {
    function makeEngine() {
        document.body.innerHTML = `
            <div class="nav-dropdown">
                <button id="auth-logout-btn">Log Out</button>
            </div>
            <div class="nav-links"></div>`;
        const engine = Object.create(ChecklistEngine.prototype);
        engine.id = 'doomed';
        engine.config = { title: 'Doomed', dataShape: 'flat' };
        engine._initDeleteButton();
        return engine;
    }

    it('clears the cached registry when the delete succeeds', async () => {
        seedCache();
        makeEngine();
        const location = stubLocation();

        await document.getElementById('checklist-delete-btn').onclick();

        expect(githubSync.deleteChecklist).toHaveBeenCalledWith('doomed');
        expect(location.href).toBe('index.html');
        expect(cachedRegistry()).toBeNull();
        expect(DynamicNav._registry).toBeNull();
    });

    it('clears the cached registry even when the delete fails', async () => {
        // The nav must not keep advertising a checklist whose state is now unknown.
        githubSync.deleteChecklist = vi.fn(async () => false);
        seedCache();
        makeEngine();

        await document.getElementById('checklist-delete-btn').onclick();

        expect(window.alert).toHaveBeenCalled();
        expect(cachedRegistry()).toBeNull();
    });

    it('leaves the cache alone when the delete is not confirmed', () => {
        window.confirm = vi.fn(() => false);
        seedCache();
        makeEngine();

        document.getElementById('checklist-delete-btn').onclick();

        expect(githubSync.deleteChecklist).not.toHaveBeenCalled();
        expect(cachedRegistry()).not.toBeNull();
    });
});

describe('the checklist page settings save', () => {
    // The engine builds its settings modal inline and keeps no reference to it, so
    // stand in a subclass to capture the real options object it passes. The
    // callback under test is the one the engine actually wired up.
    function captureSettingsCallback() {
        // The parts of checklist.html the save callback re-renders
        document.body.innerHTML = `
            <style id="dynamic-theme"></style>
            <div class="nav-dropdown">
                <button id="auth-logout-btn">Log Out</button>
            </div>
            <div class="nav-links"></div>
            <div class="page-header" id="page-header">
                <h1 id="page-title">Doomed</h1>
                <p class="subtitle" id="page-subtitle"></p>
                <div class="stats" id="page-stats">
                    <div class="stat-label" id="total-label">Total Cards</div>
                </div>
            </div>
            <div class="filters" id="filters-container"></div>
            <div id="sections-container"></div>`;

        let options;
        globalThis.ChecklistCreatorModal = class extends ChecklistCreatorModal {
            constructor(opts) { super(opts); options = opts; }
        };
        try {
            const engine = Object.create(ChecklistEngine.prototype);
            engine.id = 'doomed';
            engine.config = { id: 'doomed', title: 'Doomed', dataShape: 'flat', customFields: {}, cardDisplay: {} };
            engine.cards = [];
            engine._renderedCards = [];
            engine._reorderMode = false;
            engine._filterCard = () => true;
            engine.updateStats = vi.fn();
            engine._saveCardData = vi.fn(async () => true);
            engine.checklistManager = {
                isOwner: () => true,
                isReadOnly: false,
                getCardId: () => 'x',
                isOwned: () => false,
                toggleOwned: () => {},
                setSyncStatus: () => {},
            };
            engine._initSettingsButton();
            return options;
        } finally {
            globalThis.ChecklistCreatorModal = ChecklistCreatorModal;
        }
    }

    it('clears the cached registry when the config is saved', async () => {
        seedCache();
        const { onCreated } = captureSettingsCallback();

        await onCreated({ id: 'doomed', title: 'Renamed', dataShape: 'flat', customFields: {}, cardDisplay: {} });

        expect(DynamicNav._registry).not.toBe(STALE);
        expect(cachedIds()).not.toContain('doomed');
    });
});

describe('the checklist creator modal', () => {
    const EXISTING = {
        id: 'doomed',
        title: 'Doomed',
        navLabel: 'Doomed',
        dataShape: 'flat',
        customFields: {},
        theme: {},
    };

    function openCreator(config) {
        const creator = new ChecklistCreatorModal({ onCreated: vi.fn() });
        if (config) {
            creator.openEdit(config);
        } else {
            creator.open();
        }
        return creator;
    }

    it('clears the cached registry when settings are saved', async () => {
        githubSync.loadRegistry = vi.fn(async () => structuredClone(STALE));
        seedCache();
        const creator = openCreator(EXISTING);
        creator.backdrop.querySelector('#creator-nav-label').value = 'Renamed';

        await creator.save();

        expect(githubSync.saveChecklistConfig).toHaveBeenCalled();
        expect(cachedRegistry()).toBeNull();
        expect(DynamicNav._registry).toBeNull();
    });

    it('clears the cached registry when a checklist is created', async () => {
        githubSync.loadRegistry = vi.fn(async () => structuredClone(STALE));
        seedCache();
        const creator = openCreator();
        creator.backdrop.querySelector('#creator-title').value = 'Brand New';
        creator.backdrop.querySelector('#creator-nav-label').value = 'Brand New';

        await creator.save();

        expect(githubSync.createChecklist).toHaveBeenCalled();
        expect(cachedRegistry()).toBeNull();
        expect(DynamicNav._registry).toBeNull();
    });
});
