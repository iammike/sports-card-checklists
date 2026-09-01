import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const DynamicNav = globalThis.DynamicNav;

// The class is not exported; only the instance github-sync.js constructs is.
// Captured at module load, because every test below replaces globalThis
// .githubSync with a stub and afterEach deletes it.
const SyncProto = Object.getPrototypeOf(globalThis.githubSync);

// #759: getActiveGistId() returns the reader's *own* gist once they are signed
// in. For anyone but the owner that gist holds no checklists-registry.json, so
// githubSync.loadRegistry() came back null and DynamicNav had no fallback -
// unlike the config and card-data reads, which have had one all along. The index
// rendered with zero checklists and zero nav links, and the shopping-list modal
// with an empty list, while a direct checklist.html?id= still worked.
//
// Not reachable today (#751 limits sign-in to the owner) but filed because it
// returns the moment sign-in opens up (#633).

const REGISTRY = {
    checklists: [
        { id: 'jayden-daniels', type: 'dynamic', title: 'Jayden Daniels', order: 0 },
        { id: 'washington-qbs', type: 'dynamic', title: 'Washington QBs', order: 1 },
    ],
};

let loadRegistry;
let loadPublicRegistry;

function stubSync({ own = null, pub = null, loggedIn = true } = {}) {
    DynamicNav.clearCache();
    loadRegistry = vi.fn().mockResolvedValue(own);
    loadPublicRegistry = vi.fn().mockResolvedValue(pub);
    globalThis.githubSync = {
        loadRegistry,
        loadPublicRegistry,
        isLoggedIn: () => loggedIn,
        getActiveGistId: () => 'gist123',
    };
    DynamicNav.clearCache();
}

beforeEach(() => {
    stubSync();
    DynamicNav.clearCache();
});

afterEach(() => {
    DynamicNav.clearCache();
    delete globalThis.githubSync;
});

describe('DynamicNav.loadRegistry falls back to the public gist (#759)', () => {
    it('returns the public registry when the reader own gist has none', async () => {
        stubSync({ own: null, pub: REGISTRY });

        expect(await DynamicNav.loadRegistry()).toEqual(REGISTRY);
        expect(loadRegistry).toHaveBeenCalledTimes(1);
        expect(loadPublicRegistry).toHaveBeenCalledTimes(1);
    });

    // The owner's own gist *is* the production gist, so their read succeeds and
    // the fallback must not fire - a second fetch on every page load.
    it('does not reach for the public copy when the own read succeeded', async () => {
        stubSync({ own: REGISTRY, pub: { checklists: [] } });

        expect(await DynamicNav.loadRegistry()).toEqual(REGISTRY);
        expect(loadPublicRegistry).not.toHaveBeenCalled();
    });

    // A signed-out reader already read the public gist, so null there is a real
    // absence and retrying fetches the same thing twice.
    it('does not retry for a signed-out reader', async () => {
        stubSync({ own: null, pub: REGISTRY, loggedIn: false });

        expect(await DynamicNav.loadRegistry()).toBeNull();
        expect(loadPublicRegistry).not.toHaveBeenCalled();
    });

    it('still returns null when neither gist has one', async () => {
        stubSync({ own: null, pub: null });

        expect(await DynamicNav.loadRegistry()).toBeNull();
    });

    // Whatever it settles on has to populate both cache layers, or every
    // consumer refetches and the fallback runs again on each one.
    it('caches what the fallback returned', async () => {
        stubSync({ own: null, pub: REGISTRY });
        await DynamicNav.loadRegistry();

        expect(DynamicNav._registry).toEqual(REGISTRY);
        expect(JSON.parse(sessionStorage.getItem(DynamicNav._getSessionKey())))
            .toEqual(REGISTRY);

        expect(await DynamicNav.loadRegistry()).toEqual(REGISTRY);
        expect(loadPublicRegistry).toHaveBeenCalledTimes(1);
    });

    // isLoggedIn is optional-chained because not every stub in this repo has it.
    it('survives a githubSync with no isLoggedIn', async () => {
        globalThis.githubSync = { loadRegistry: vi.fn().mockResolvedValue(null) };

        await expect(DynamicNav.loadRegistry()).resolves.toBeNull();
    });
});

describe('githubSync.loadPublicRegistry (#759)', () => {
    it('is exposed on the sync object', () => {
        expect(typeof SyncProto.loadPublicRegistry).toBe('function');
    });

    // It must read the public gist explicitly, like loadPublicChecklistConfig
    // and loadPublicCardData - not whichever gist happens to be active.
    it('reads the public gist, not the active one', async () => {
        const sync = Object.create(SyncProto);
        sync._fetchGist = vi.fn().mockResolvedValue({
            files: { 'checklists-registry.json': { content: JSON.stringify(REGISTRY) } },
        });

        expect(await sync.loadPublicRegistry()).toEqual(REGISTRY);
        expect(sync._fetchGist).toHaveBeenCalledWith(true);
    });

    it('returns null when the public gist has no registry', async () => {
        const sync = Object.create(SyncProto);
        sync._fetchGist = vi.fn().mockResolvedValue({ files: {} });

        expect(await sync.loadPublicRegistry()).toBeNull();
    });

    it('returns null when the public gist cannot be read', async () => {
        const sync = Object.create(SyncProto);
        sync._fetchGist = vi.fn().mockResolvedValue(null);

        expect(await sync.loadPublicRegistry()).toBeNull();
    });
});
