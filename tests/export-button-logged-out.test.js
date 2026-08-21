import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const ChecklistEngine = globalThis.ChecklistEngine;
const ChecklistManager = globalThis.ChecklistManager;

// Logged out, AuthUI.update() renders nothing into #auth-content (nav.js), so
// there is no dropdown at all - which is where every export entry used to live.
// The filter row is the only home the button has for a visitor who isn't signed
// in, and it opens ChecklistExport rather than the owner's Shopping List.
//
// Harness mirrors tests/price-range-and-quick-filters.test.js: a real engine and
// a real _renderFilters() DOM render, so these assert the markup a visitor
// actually gets rather than a hand-built approximation of it.
function makeEngine() {
    const engine = Object.create(ChecklistEngine.prototype);
    engine.id = 'test';
    engine.config = {
        dataShape: 'flat',
        customFields: {},
        cardDisplay: {},
        sortOptions: ['default'],
        customFilters: [],
    };
    engine.cards = [{ set: 'A', num: '1' }];
    engine._renderedCards = [];
    engine._reorderMode = false;
    engine.updateStats = vi.fn();
    engine.checklistManager = new ChecklistManager({ checklistId: 'test' });
    engine.checklistManager.ownedCards = [];
    engine.checklistManager.isReadOnly = false;
    return engine;
}

// _renderFilters() ends in _updateReorderButton(), which reaches isOwner() ->
// getUser(), so both are needed for the render to complete either way.
const loggedOut = () => ({ isLoggedIn: () => false, getUser: () => null });

const loggedIn = () => ({ isLoggedIn: () => true, getUser: () => ({ login: 'someone-else' }) });

describe('Export button in the filter row', () => {
    let realGithubSync;
    let realChecklistExport;

    beforeEach(() => {
        document.body.innerHTML = '<div id="filters-container"></div><div id="sections-container"></div>';
        realGithubSync = window.githubSync;
        realChecklistExport = window.ChecklistExport;
    });

    afterEach(() => {
        window.githubSync = realGithubSync;
        window.ChecklistExport = realChecklistExport;
    });

    it('renders for a logged-out visitor, who has no nav dropdown to reach it from', () => {
        window.githubSync = loggedOut();

        makeEngine()._renderFilters();

        expect(document.getElementById('checklist-export-btn')).not.toBeNull();
    });

    it('does not render when signed in - the filter row is the logged-out home', () => {
        window.githubSync = loggedIn();

        makeEngine()._renderFilters();

        // #reorder-btn proves the row rendered at all, so the absence below is a
        // real absence and not an empty container passing vacuously.
        expect(document.getElementById('reorder-btn')).not.toBeNull();
        expect(document.getElementById('checklist-export-btn')).toBeNull();
    });

    // Driven by a real click: the binding is where this behaviour lives, and
    // calling the handler by hand leaves a revert of the wiring passing green.
    it('opens the export dialog for this checklist when clicked', () => {
        window.githubSync = loggedOut();
        const open = vi.fn();
        window.ChecklistExport = { open };

        const engine = makeEngine();
        engine._renderFilters();
        document.getElementById('checklist-export-btn').click();

        expect(open).toHaveBeenCalledTimes(1);
        const ctx = open.mock.calls[0][0];
        expect(ctx.id).toBe('test');
        // Reads the engine's already-loaded data - no gist refetch, so no
        // dependence on the registry or on a checklist's hidden flag.
        expect(ctx.cards).toBe(engine.cards);
        expect(ctx.config).toBe(engine.config);
    });

    // Pins that the context carries a working sort, not merely that some function
    // was passed: a wrong sort mode reorders every row and is otherwise silent.
    it('passes a sort honouring the checklist default sort mode', () => {
        window.githubSync = loggedOut();
        const open = vi.fn();
        window.ChecklistExport = { open };

        const engine = makeEngine();
        engine.config.defaultSortMode = 'price-high';
        engine._renderFilters();
        document.getElementById('checklist-export-btn').click();

        const { sort } = open.mock.calls[0][0];
        const input = [{ set: 'A', num: '1', price: 5 }, { set: 'B', num: '2', price: 90 }];
        expect(sort(input).map(c => c.num)).toEqual(['2', '1']);
        // The engine's own arrays must not be reordered as a side effect.
        expect(input.map(c => c.num)).toEqual(['1', '2']);
    });

    it('leaves order alone when the checklist sets no default sort', () => {
        window.githubSync = loggedOut();
        const open = vi.fn();
        window.ChecklistExport = { open };

        const engine = makeEngine();
        delete engine.config.defaultSortMode;
        engine._renderFilters();
        document.getElementById('checklist-export-btn').click();

        const { sort } = open.mock.calls[0][0];
        const input = [{ set: 'B', num: '2' }, { set: 'A', num: '1' }];
        expect(sort(input).map(c => c.num)).toEqual(['2', '1']);
    });

    it('labels the button Export', () => {
        window.githubSync = loggedOut();

        makeEngine()._renderFilters();

        expect(document.getElementById('checklist-export-btn').textContent).toBe('Export');
    });

    it('is omitted when the export module is absent, rather than rendering a dead button', () => {
        window.githubSync = loggedOut();
        window.ChecklistExport = undefined;

        makeEngine()._renderFilters();

        expect(document.getElementById('reorder-btn')).not.toBeNull();
        expect(document.getElementById('checklist-export-btn')).toBeNull();
    });
});
