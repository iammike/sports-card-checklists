import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

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
    loadRegistry = vi.fn().mockResolvedValue(own);
    loadPublicRegistry = vi.fn().mockResolvedValue(pub);
    globalThis.githubSync = {
        loadRegistry,
        loadPublicRegistry,
        isLoggedIn: () => loggedIn,
        getActiveGistId: () => 'gist123',
    };
    // After the stub, not before: the sessionStorage key derives from
    // getActiveGistId(), so clearing first clears a different key and the
    // previous test's registry leaks into this one.
    DynamicNav.clearCache();
}

beforeEach(() => {
    stubSync();
});

afterEach(() => {
    DynamicNav.clearCache();
    delete globalThis.githubSync;
});

describe('DynamicNav.loadRegistry falls back to the public gist (#759)', () => {
    it('returns the public registry when their own gist has none', async () => {
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

    // No sign-in gate: the retry is a _publicGistCache hit for a signed-out
    // reader, and the one case where it is not is a failed public read, which is
    // when it is worth having. (A signed-out loadRegistry returning null while
    // the public gist has a registry cannot really happen - they are the same
    // read - so this pins the absence of the gate, not a reachable state.)
    it('falls back for a signed-out reader too', async () => {
        stubSync({ own: null, pub: REGISTRY, loggedIn: false });

        expect(await DynamicNav.loadRegistry()).toEqual(REGISTRY);
        expect(loadPublicRegistry).toHaveBeenCalledTimes(1);
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

    // Optional-chained, because the older stubs in this repo predate the method
    // and would otherwise throw a TypeError straight out of loadRegistry().
    it('survives a githubSync with no loadPublicRegistry', async () => {
        globalThis.githubSync = {
            loadRegistry: vi.fn().mockResolvedValue(null),
            getActiveGistId: () => 'gist123',
        };

        await expect(DynamicNav.loadRegistry()).resolves.toBeNull();
    });
});

describe('githubSync.loadPublicRegistry (#759)', () => {
    it('is exposed on the sync object', () => {
        expect(typeof SyncProto.loadPublicRegistry).toBe('function');
    });

    // It must read the public gist explicitly, like loadPublicChecklistConfig
    // and loadPublicCardData - not whichever gist happens to be active.
    //
    // The token matters: _readGistFile only passes `true` when there is none, so
    // on a token-less instance it and _readPublicGistFile make identical calls
    // and this assertion cannot tell them apart. Without it, swapping the helper
    // for _readGistFile passed - which is the whole bug, since a signed-in
    // non-owner is exactly a reader who *has* a token.
    it('reads the public gist even when a token would point elsewhere', async () => {
        const sync = Object.create(SyncProto);
        sync.token = 'gho_readerstoken';
        sync._fetchGist = vi.fn().mockResolvedValue({
            files: { 'checklists-registry.json': { content: JSON.stringify(REGISTRY) } },
        });

        expect(await sync.loadPublicRegistry()).toEqual(REGISTRY);
        expect(sync._fetchGist).toHaveBeenCalledWith(true);
    });

    // The siblings share the helper now, so they need the same guarantee.
    it('does the same for the config and card-data fallbacks', async () => {
        const sync = Object.create(SyncProto);
        sync.token = 'gho_readerstoken';
        sync._fetchGist = vi.fn().mockResolvedValue({ files: {} });

        await sync.loadPublicChecklistConfig('jd');
        await sync.loadPublicCardData('jd');

        expect(sync._fetchGist).toHaveBeenCalledTimes(2);
        sync._fetchGist.mock.calls.forEach(call => expect(call).toEqual([true]));
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

// The same bug class on the index page, which is where #759's symptoms were
// reported. These reads chose their source with a ternary on the auth flag, so
// for a signed-in non-owner *both* branches returned null: computeUniqueOwned
// dropped every entry at its `if (!config || !cardData) continue`, leaving a
// reader who owns cards looking at 0 owned / $0, and configs[] came back null so
// every card lost the value-scope label #775 added.
describe('the index reads fall back too (#759)', () => {
    const INDEX_HTML = readFileSync(resolve(import.meta.dirname, '..', 'index.html'), 'utf-8');

    const fallsBack = (fn, pub) => new RegExp(
        `await githubSync\\.${fn}\\(entry\\.id\\)\\s*\\n?\\s*\\|\\|\\s*await githubSync\\.${pub}\\(entry\\.id\\)`);

    it('falls back for the config and the card data behind the aggregate stats', () => {
        const body = INDEX_HTML.slice(INDEX_HTML.indexOf('function computeUniqueOwned'));

        expect(body).toMatch(fallsBack('loadChecklistConfig', 'loadPublicChecklistConfig'));
        expect(body).toMatch(fallsBack('loadCardData', 'loadPublicCardData'));
    });

    // A ternary anywhere here is the bug: for this reader both arms are null.
    it('leaves no auth-flag ternary on any of these reads', () => {
        expect(INDEX_HTML).not.toMatch(/(isLoggedIn|loggedIn)\s*\n?\s*\?\s*await githubSync\.load(ChecklistConfig|CardData)/);
    });
});
