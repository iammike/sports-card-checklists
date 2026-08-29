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

    // The snapshot is "what the gist last got from us", so it has to move with
    // the write - otherwise the second caller compares against the same stale
    // value and writes again whether or not anything changed.
    it('moves the snapshot with the write, so a second call is a no-op', async () => {
        const engine = makeEngine(CONFIG());

        await engine._refreshStatsIfStale();
        await engine._refreshStatsIfStale();

        expect(saved).toHaveLength(1);
    });

    it('leaves the snapshot alone when the write fails, so the next attempt retries', async () => {
        const engine = makeEngine(CONFIG());
        window.githubSync.saveChecklistStats = vi.fn(async () => { throw new Error('offline'); });

        await engine._refreshStatsIfStale();

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

    it('writes nothing when the save changed nothing about the counts', async () => {
        const engine = prepared(CONFIG());
        engine._savedStatsSnapshot = engine.computeStats();
        const onCreated = captureOnCreated(engine);

        await onCreated(CONFIG());

        expect(saved).toHaveLength(0);
    });
});
