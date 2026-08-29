import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const ChecklistEngine = globalThis.ChecklistEngine;
const ChecklistManager = globalThis.ChecklistManager;

// #783: featuring a section wrote extraPills into the registry but never
// refreshed the checklist's stats - and the index gates each pill on
// stats[`${cat.id}Total`], so it silently did not appear until some unrelated
// path that carries stats ran (toggling a card owned, or revisiting the page).

const OWNER = 'iammike';

function makeEngine(config) {
    const engine = Object.create(ChecklistEngine.prototype);
    engine.id = 'jd';
    engine.config = config;
    engine.cards = { base: [{ set: 'A', num: '1' }], inserts: [{ set: 'B', num: '2' }] };
    engine._renderedCards = [];
    engine._reorderMode = false;
    engine._savedStatsSnapshot = null;
    engine.updateStats = vi.fn();
    engine.checklistManager = new ChecklistManager({ checklistId: 'jd' });
    engine.checklistManager.ownedCards = [];
    engine.checklistManager.isReadOnly = false;
    return engine;
}

const CONFIG = () => ({
    dataShape: 'categories',
    customFields: {},
    cardDisplay: {},
    categories: [{ id: 'base', label: 'Base' }, { id: 'inserts', label: 'Inserts', isMain: false }],
});

describe('ChecklistEngine._refreshStatsIfStale (#783)', () => {
    let realSync, saved;

    beforeEach(() => {
        realSync = window.githubSync;
        saved = [];
        window.githubSync = {
            isLoggedIn: () => true,
            getUser: () => ({ login: OWNER }),
            saveChecklistStats: vi.fn(async (id, stats) => { saved.push({ id, stats }); return true; }),
        };
    });

    afterEach(() => {
        window.githubSync = realSync;
    });

    it('writes when the computed stats differ from what was last saved', async () => {
        const engine = makeEngine(CONFIG());

        await engine._refreshStatsIfStale();

        expect(saved).toHaveLength(1);
        // The per-category keys the index pill is gated on.
        expect(saved[0].stats).toHaveProperty('insertsTotal', 1);
    });

    it('writes nothing when they already match', async () => {
        const engine = makeEngine(CONFIG());
        engine._savedStatsSnapshot = engine.computeStats();

        await engine._refreshStatsIfStale();

        expect(saved).toHaveLength(0);
    });

    // The snapshot is "what the gist last got from us", so every path that
    // writes stats has to say so - otherwise the next comparison is against a
    // value the gist never saw and writes again whether or not anything changed.
    it('moves the snapshot with the write, so a second call is a no-op', async () => {
        const engine = makeEngine(CONFIG());

        await engine._refreshStatsIfStale();
        await engine._refreshStatsIfStale();

        expect(saved).toHaveLength(1);
    });

    // saveChecklistStats resolves false for every failure the gist layer
    // expects - a dead session, a rate limit, a non-2xx PATCH, a network error -
    // and essentially never rejects. A test that throws models a shape the real
    // code does not produce, which is how this went unnoticed.
    it('leaves the snapshot alone when the write reports failure, so the next attempt retries', async () => {
        const engine = makeEngine(CONFIG());
        const save = vi.fn(async () => false);
        window.githubSync.saveChecklistStats = save;

        await engine._refreshStatsIfStale();
        expect(engine._savedStatsSnapshot).toBeNull();

        // And the next call actually tries again rather than believing it landed.
        await engine._refreshStatsIfStale();
        expect(save).toHaveBeenCalledTimes(2);
    });

    // Kept as well: a genuine throw still must not advance it.
    it('leaves the snapshot alone when the write throws', async () => {
        const engine = makeEngine(CONFIG());
        window.githubSync.saveChecklistStats = vi.fn(async () => { throw new Error('offline'); });

        await engine._refreshStatsIfStale();

        expect(engine._savedStatsSnapshot).toBeNull();
    });

    // The migration tests below stub _saveCardData wholesale, so the real one's
    // recording goes unexercised by them. This drives it.
    it('records its stats when a card save carries them, so no refresh follows', async () => {
        const engine = makeEngine(CONFIG());
        engine.cardData = engine.cards;
        engine._mergeWithFreshGistData = vi.fn(async () => {});
        engine._applySaveResult = (r) => r.ok;
        // statsSaved, not merely ok - the real shape saveCardData returns.
        window.githubSync.saveCardData = vi.fn(async () => ({ ok: true, statsSaved: true }));

        expect(await engine._saveCardData()).toBe(true);
        expect(engine._savedStatsSnapshot).toEqual(engine.computeStats());

        // Which is the point: the refresh now finds nothing to do.
        await engine._refreshStatsIfStale();
        expect(saved).toHaveLength(0);
    });

    // saveCardData drops the stats half whenever the collection read failed for
    // anything but a dead session or a rate limit, and still writes the cards.
    // Recording on ok alone would claim the gist had stats it never got, and
    // suppress the refresh that exists to carry them.
    it('records nothing when the card write landed but dropped the stats half', async () => {
        const engine = makeEngine(CONFIG());
        engine.cardData = engine.cards;
        engine._mergeWithFreshGistData = vi.fn(async () => {});
        engine._applySaveResult = (r) => r.ok;
        window.githubSync.saveCardData = vi.fn(async () => ({ ok: true, statsSaved: false }));

        expect(await engine._saveCardData()).toBe(true);
        expect(engine._savedStatsSnapshot).toBeNull();

        // And the refresh still carries them, which is the whole point.
        await engine._refreshStatsIfStale();
        expect(saved).toHaveLength(1);
    });

    it('records nothing when that card save failed', async () => {
        const engine = makeEngine(CONFIG());
        engine.cardData = engine.cards;
        engine._mergeWithFreshGistData = vi.fn(async () => {});
        engine._applySaveResult = (r) => r.ok;
        window.githubSync.saveCardData = vi.fn(async () => ({ ok: false, reason: 'auth_expired', statsSaved: false }));

        await engine._saveCardData();

        expect(engine._savedStatsSnapshot).toBeNull();
    });

    // The snapshot the whole comparison rests on was assigned only past
    // _loadLinkedStats' "no linked cards" early return, so on a checklist with
    // no collection-link cards it stayed undefined - and undefined never equals
    // anything, so the owner re-wrote stats on every single page load.
    it('is seeded even on a checklist with no collection links', async () => {
        const engine = makeEngine(CONFIG());
        const stored = { owned: 0, total: 1, insertsTotal: 1 };
        window.githubSync.loadAllStats = vi.fn(async () => ({ jd: stored }));

        await engine._loadLinkedStats();

        expect(engine._savedStatsSnapshot).toEqual(stored);
        expect(engine._linkedStats).toEqual({});
    });

    // A visitor with no linked cards reads neither value, so fetching the whole
    // stats map for them is a request nothing uses.
    it('skips the fetch entirely for a visitor with no linked cards', async () => {
        const engine = makeEngine(CONFIG());
        engine.checklistManager.ownerUsername = 'someone-else';
        const load = vi.fn(async () => ({}));
        window.githubSync.loadAllStats = load;
        window.githubSync.loadPublicStats = load;

        await engine._loadLinkedStats();

        expect(load).not.toHaveBeenCalled();
        expect(engine._linkedStats).toEqual({});
    });

    it('still seeds it as null when the gist holds no stats for this checklist', async () => {
        const engine = makeEngine(CONFIG());
        window.githubSync.loadAllStats = vi.fn(async () => ({}));

        await engine._loadLinkedStats();

        expect(engine._savedStatsSnapshot).toBeNull();
    });

    it('does nothing for a visitor', async () => {
        window.githubSync.getUser = () => ({ login: 'someone-else' });
        const engine = makeEngine(CONFIG());

        await engine._refreshStatsIfStale();

        expect(saved).toHaveLength(0);
    });
});

// The wiring is the fix; the method above already existed. Driven through the
// real onCreated callback the settings modal invokes, not a re-implementation.
describe('saving checklist settings refreshes its stats (#783)', () => {
    let realSync, realNav, saved;

    beforeEach(() => {
        document.body.innerHTML = '<h1 id="page-title"></h1><p id="page-subtitle"></p>'
            + '<div id="page-intro"></div><div id="total-label"></div><div id="value-label"></div>'
            // _applyTheme writes the generated CSS into this.
            + '<style id="dynamic-theme"></style>'
            + '<div class="nav-dropdown"><button id="checklist-delete-btn"></button></div>'
            + '<div id="filters-container"></div><div id="sections-container"></div>';
        realSync = window.githubSync;
        realNav = { clearCache: globalThis.DynamicNav.clearCache, init: globalThis.DynamicNav.init };
        globalThis.DynamicNav.clearCache = vi.fn();
        globalThis.DynamicNav.init = vi.fn();
        saved = [];
        window.githubSync = {
            isLoggedIn: () => true,
            getUser: () => ({ login: OWNER }),
            saveChecklistStats: vi.fn(async (id, stats) => { saved.push({ id, stats }); return true; }),
        };
    });

    afterEach(() => {
        window.githubSync = realSync;
        globalThis.DynamicNav.clearCache = realNav.clearCache;
        globalThis.DynamicNav.init = realNav.init;
        document.body.innerHTML = '';
    });

    // Captured off the real ChecklistCreatorModal construction rather than
    // re-implemented, so this exercises both the callback body and the wiring
    // that hands it over - a rename on either side fails here.
    function captureOnCreated(engine) {
        const realModal = globalThis.ChecklistCreatorModal;
        let captured = null;
        globalThis.ChecklistCreatorModal = function (options) {
            captured = options.onCreated;
            return { open: () => {}, openEdit: () => {} };
        };
        try {
            engine._initSettingsButton();
        } finally {
            globalThis.ChecklistCreatorModal = realModal;
        }
        expect(captured, 'settings modal was never constructed').toBeTypeOf('function');
        return captured;
    }

    const prepared = (config) => {
        const engine = makeEngine(config);
        engine._migrateDataShape = () => false;
        engine._initCardEditor = vi.fn();
        // Anchor _initSettingsButton looks for after the dropdown.
        const dd = document.querySelector('.nav-dropdown');
        dd.insertBefore(document.createElement('div'), document.getElementById('checklist-delete-btn'));
        return engine;
    };

    it('saves stats after the config is applied', async () => {
        const engine = prepared(CONFIG());
        const onCreated = captureOnCreated(engine);

        const next = CONFIG();
        next.categories.push({ id: 'chase', label: 'Chase', isMain: false, showOnIndex: true });
        engine.cards.chase = [{ set: 'C', num: '3' }];

        await onCreated(next);

        expect(saved).toHaveLength(1);
        // Computed from the config just applied, not the one it replaced - which
        // is why the call sits after renderCards rather than before it.
        expect(saved[0].stats).toHaveProperty('chaseTotal', 1);
    });

    it('reports the section under the key the index pill is gated on', async () => {
        const engine = prepared(CONFIG());
        const onCreated = captureOnCreated(engine);

        await onCreated(CONFIG());

        // index.html: `stats[pill.id + 'Total']`, and a 0 renders no pill.
        expect(saved[0].stats.insertsTotal).toBe(1);
    });

    // A migration writes stats itself, in the same PATCH as the card data. The
    // refresh must not follow it with a second, identical write - nor with any
    // write at all when the migration failed, since that write has its own
    // no-retry rule and the gist would get stats for a shape never persisted.
    it('adds no second write after a migration that already saved stats', async () => {
        const engine = prepared(CONFIG());
        engine._migrateDataShape = () => true;
        engine._saveCardData = vi.fn(async () => {
            engine._markStatsSaved(engine.computeStats());
            return true;
        });
        engine.checklistManager.setSyncStatus = vi.fn();
        const onCreated = captureOnCreated(engine);

        await onCreated(CONFIG());

        expect(engine._saveCardData).toHaveBeenCalledTimes(1);
        expect(saved).toHaveLength(0);
    });

    it('writes nothing at all when the migration failed', async () => {
        const engine = prepared(CONFIG());
        engine._migrateDataShape = () => true;
        engine._saveCardData = vi.fn(async () => false);
        engine.checklistManager.setSyncStatus = vi.fn();
        const onCreated = captureOnCreated(engine);

        await onCreated(CONFIG());

        expect(saved).toHaveLength(0);
    });

    it('writes nothing when the save changed nothing about the counts', async () => {
        const engine = prepared(CONFIG());
        engine._savedStatsSnapshot = engine.computeStats();
        const onCreated = captureOnCreated(engine);

        await onCreated(CONFIG());

        expect(saved).toHaveLength(0);
    });
});
