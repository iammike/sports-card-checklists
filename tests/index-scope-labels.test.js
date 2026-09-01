import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { renderCard, sourceOf } from './index-source.js';

// #775: the index card renders both scopes from one computeStats payload -
// "45 of 60 cards" counts main categories only, "$1,200 value" counts every
// owned card - with nothing distinguishing them. Same conflation #773 fixed on
// the checklist header, one surface over. These drive the real markup extracted
// from index.html, not a copy of it.

const INDEX_HTML = readFileSync(resolve(import.meta.dirname, '..', 'index.html'), 'utf-8');

const STATS = { owned: 45, total: 60, ownedValue: 1200, neededValue: 210 };
const ENTRY = { id: 'jd', type: 'dynamic', title: 'Jayden Daniels', navLabel: 'JD' };

const SPLIT_CONFIG = {
    totalLabel: 'Main Cards',
    categories: [{ id: 'base' }, { id: 'inserts', isMain: false }],
};
const WHOLE_CONFIG = { categories: [{ id: 'base' }, { id: 'more' }] };

const valueText = card => card.querySelector('.value-owned').textContent;
const neededText = card => card.querySelector('.value-needed').textContent;

// Everything below this block injects `configs` into an extracted function
// body, which says nothing about whether index.html ever builds one. Deleting
// the loop that does left all 1085 tests passing, with every card and the
// aggregate row rendering unlabelled - the exact bug #775 exists to fix. These
// pin the wiring itself.
describe('index.html actually loads and forwards the configs (#775)', () => {
    it('loads a config per dynamic entry, falling back to the public gist', () => {
        const { start, end } = sourceOf('async function renderDynamicChecklists() {');
        const body = INDEX_HTML.slice(start, end);

        expect(body).toContain('for (const entry of dynamicEntries)');
        // `||`, not a ternary on the auth flag (#759): a signed-in reader who is
        // not the owner reads their own gist, where neither file exists, so both
        // branches of the ternary returned null and every card lost the scope
        // label this suite is about.
        expect(body).toMatch(
            /await githubSync\.loadChecklistConfig\(entry\.id\)\s*\n?\s*\|\|\s*await githubSync\.loadPublicChecklistConfig\(entry\.id\)/);
        expect(body).not.toMatch(/loggedIn\s*\n?\s*\?\s*await githubSync\.loadChecklistConfig/);
    });

    it('returns the configs it loaded', () => {
        const { start, end } = sourceOf('async function renderDynamicChecklists() {');

        expect(INDEX_HTML.slice(start, end)).toContain('return { stats: dynamicStats, entries: dynamicEntries, configs };');
    });

    it('forwards them to the aggregate row', () => {
        expect(INDEX_HTML).toContain('const { stats: allStats, entries, configs } = await renderDynamicChecklists();');
        expect(INDEX_HTML).toContain('updateAggregateStats(allStats, uniqueOwned, configs);');
    });

    // One hand-edited config file must not cost the whole index page.
    it('guards each config read so one bad file cannot abort the render', () => {
        const { start, end } = sourceOf('async function renderDynamicChecklists() {');
        const body = INDEX_HTML.slice(start, end);
        const loopAt = body.indexOf('for (const entry of dynamicEntries)');
        const loadAt = body.indexOf('githubSync.loadPublicChecklistConfig(entry.id)');

        // The try has to be inside the loop, not wrapped around it, or one bad
        // config still costs every checklist after it.
        const tryAt = body.lastIndexOf('try {', loadAt);
        expect(tryAt).toBeGreaterThan(loopAt);
        expect(body.slice(loadAt)).toContain('} catch (e) {');
    });

    // The card body reads configs[entry.id]; a rename on either side is silent.
    it('reads the loaded config when rendering a card', () => {
        const { start, end } = sourceOf('dynamicEntries.forEach(entry => {');
        const body = INDEX_HTML.slice(start, end);

        expect(body).toContain('configs[entry.id]');
        expect(body).toContain('countExcludesExtras(config)');
        expect(body).toContain('completionScopeSuffix(config');
    });
});

describe('index card — scope labels (#775)', () => {
    it('says the value spans every card where the count does not', () => {
        const card = renderCard(ENTRY, STATS, undefined, SPLIT_CONFIG);

        expect(valueText(card)).toBe('$1200 value (all cards)');
    });

    // The to-complete figure shares the count's scope, not the value's, and it
    // sits right beside a figure now labelled "(all cards)".
    it('names the completion figure with the checklist own count label', () => {
        const card = renderCard(ENTRY, STATS, undefined, SPLIT_CONFIG);

        expect(neededText(card)).toBe('$210 to complete (main cards)');
    });

    it('falls back to the default count label when the config sets none', () => {
        const card = renderCard(ENTRY, STATS, undefined, {
            categories: [{ id: 'base' }, { id: 'x', isMain: false }],
        });

        expect(neededText(card)).toBe('$210 to complete (total cards)');
    });

    // Unqualified wherever the two scopes match - the qualifier has to be earned
    // or it implies a distinction that isn't there.
    it('leaves both figures plain when nothing is excluded', () => {
        const card = renderCard(ENTRY, STATS, undefined, WHOLE_CONFIG);

        expect(valueText(card)).toBe('$1200 value');
        expect(neededText(card)).toBe('$210 to complete');
    });

    // A hand-edited config can carry anything; a throw here would take out the
    // whole page, since this runs during render on both surfaces.
    it('treats an unrecognisable categories value as excluding nothing', () => {
        for (const categories of [{ base: [] }, 'base', 42, [null, undefined]]) {
            const card = renderCard(ENTRY, STATS, undefined, { categories });

            expect(valueText(card), JSON.stringify(categories)).toBe('$1200 value');
            expect(neededText(card)).toBe('$210 to complete');
        }
    });

    it('leaves both plain when the config could not be loaded at all', () => {
        const card = renderCard(ENTRY, STATS, undefined, null);

        expect(valueText(card)).toBe('$1200 value');
        expect(neededText(card)).toBe('$210 to complete');
    });

    // A config whose totalLabel is not a string is reachable: the file is
    // hand-editable JSON.
    it('survives a non-string count label', () => {
        const card = renderCard(ENTRY, STATS, undefined, {
            totalLabel: 123,
            categories: [{ id: 'base' }, { id: 'x', isMain: false }],
        });

        expect(neededText(card)).toBe('$210 to complete (123)');
    });

    it('escapes a count label rather than trusting it', () => {
        const card = renderCard(ENTRY, STATS, undefined, {
            totalLabel: '<img src=x onerror=alert(1)>',
            categories: [{ id: 'base' }, { id: 'x', isMain: false }],
        });

        expect(card.querySelector('.value-needed img')).toBeNull();
        expect(neededText(card)).toContain('<img');
    });
});

// updateChecklistCardValues rewrites .value-owned a moment after render, once the
// de-duplicated figures land. Rebuilding that text without the scope silently
// strips "(all cards)" from a card that had just shown it.
describe('index card — the live value patch keeps the scope (#775)', () => {
    const loadUpdater = () => {
        const { start, end } = sourceOf('function updateChecklistCardValues(uniqueOwned) {');
        // jsdom has no CSS.escape, and the extracted body uses it to build the
        // card selector. Injected rather than set on globalThis so it cannot
        // leak into another test file.
        const cssShim = { escape: v => String(v).replace(/[^a-zA-Z0-9_-]/g, ch => '\\' + ch) };
        return new Function('CSS',
            `${INDEX_HTML.slice(start, end)}; return updateChecklistCardValues;`)(cssShim);
    };

    beforeEach(() => {
        document.body.innerHTML = '';
    });

    function mount(config) {
        const grid = document.createElement('div');
        document.body.appendChild(grid);
        renderCard(ENTRY, STATS, grid, config);
        return grid.querySelector('.checklist-card .value-owned');
    }

    it('re-applies the scope when patching in the live figure', () => {
        const el = mount(SPLIT_CONFIG);
        expect(el.textContent).toBe('$1200 value (all cards)');

        loadUpdater()({ perChecklist: { jd: 1350 } });

        expect(el.textContent).toBe('$1350 value (all cards)');
    });

    it('adds no scope to a checklist that never had one', () => {
        const el = mount(WHOLE_CONFIG);

        loadUpdater()({ perChecklist: { jd: 1350 } });

        expect(el.textContent).toBe('$1350 value');
    });
});

describe('index aggregate — scope labels (#775)', () => {
    const loadAggregate = () => {
        const { start, end } = sourceOf('function updateAggregateStats(allStats, uniqueOwned, configs = {}) {');
        return new Function('animateValue',
            `let hasAnimatedStats = true; ${INDEX_HTML.slice(start, end)}; return updateAggregateStats;`)(vi.fn());
    };

    beforeEach(() => {
        document.body.innerHTML = '<div class="aggregate-stats" id="aggregate-stats">'
            + '<div id="agg-owned"></div><div id="agg-total"></div>'
            + '<div class="aggregate-stat-label" id="agg-total-label">Total Cards</div>'
            // Sentinels, not the expected defaults: seeded with the real text,
            // every "stays plain" assertion below passes even when the else
            // branch never writes at all. Same trap as the count label's
            // fixture - this is the sibling that was left behind.
            + '<div id="agg-value"></div><div class="aggregate-stat-label" id="agg-value-label">UNSET</div>'
            + '<span id="agg-needed-value"></span></div>';
    });

    const stats = { jd: { owned: 45, total: 60, ownedValue: 1200, neededValue: 210 } };

    it('qualifies the aggregate value when any checklist excludes cards from its count', () => {
        loadAggregate()(stats, null, { jd: SPLIT_CONFIG });

        expect(document.getElementById('agg-value-label').textContent).toBe('Est. Value (all cards)');
        // Derived from the tile's own label, so the row does not name the same
        // set two ways in adjacent lines (#779).
        expect(document.getElementById('agg-needed-value').textContent).toBe('$210 to complete (target cards)');
    });

    it('leaves it plain when no checklist excludes anything', () => {
        loadAggregate()(stats, null, { jd: WHOLE_CONFIG });

        expect(document.getElementById('agg-value-label').textContent).toBe('Est. Value');
        expect(document.getElementById('agg-needed-value').textContent).toBe('$210 to complete');
    });

    // One checklist is enough: the summed value already spans cards the summed
    // count leaves out.
    it('qualifies on the strength of a single excluding checklist', () => {
        loadAggregate()(
            { a: stats.jd, b: { owned: 1, total: 2, ownedValue: 5, neededValue: 5 } },
            null,
            { a: WHOLE_CONFIG, b: SPLIT_CONFIG },
        );

        expect(document.getElementById('agg-value-label').textContent).toBe('Est. Value (all cards)');
    });

    // A checklist contributes nothing to these sums until it has stats, so it
    // cannot be the reason they disagree.
    it('ignores a split checklist that has no stats yet', () => {
        loadAggregate()(stats, null, { jd: WHOLE_CONFIG, brandnew: SPLIT_CONFIG });

        expect(document.getElementById('agg-value-label').textContent).toBe('Est. Value');
        expect(document.getElementById('agg-needed-value').textContent).toBe('$210 to complete');
    });

    it('leaves it plain when no configs could be loaded', () => {
        loadAggregate()(stats, null, {});

        expect(document.getElementById('agg-value-label').textContent).toBe('Est. Value');
    });
});
