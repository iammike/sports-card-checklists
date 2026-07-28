import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const sanitizeText = globalThis.sanitizeText;
const isSafeColor = globalThis.isSafeColor;

// index.html conveyed several states with a glyph and a colour and nothing else
// (#703). The convention chosen for the whole page is ARIA roles and names on the
// existing element - never visually-hidden text, because both this page and the
// card grid filter on textContent, so hidden words would leak into search matches
// and into the "N of M" parse in applyFilters below.

// The markup and the two functions under test are all inline in index.html, which
// tests/setup.js does not load (it only evals src/*.js). Extract the real source
// and evaluate it so this asserts the shipped page rather than a copy. Same trick
// as tests/index-stats-escaping.test.js and tests/index-aggregate-complete.test.js.
const INDEX_HTML = readFileSync(resolve(import.meta.dirname, '..', 'index.html'), 'utf-8');

// Bounds of the balanced {...} block opening at or after `from`.
function balancedBlock(from) {
    const bodyStart = INDEX_HTML.indexOf('{', from);
    let depth = 0;
    for (let i = bodyStart; i < INDEX_HTML.length; i++) {
        if (INDEX_HTML[i] === '{') depth++;
        else if (INDEX_HTML[i] === '}' && --depth === 0) return { bodyStart, end: i + 1 };
    }
    throw new Error('unbalanced block in index.html');
}

function sourceOf(marker) {
    const start = INDEX_HTML.indexOf(marker);
    if (start === -1) throw new Error(`${marker} not found in index.html`);
    return { start, ...balancedBlock(start + marker.length - 1) };
}

// The element opened by `startTag`, up to its matching </div>.
function markupOf(startTag) {
    const start = INDEX_HTML.indexOf(startTag);
    if (start === -1) throw new Error(`${startTag} not found in index.html`);

    const tags = /<div\b|<\/div>/g;
    tags.lastIndex = start;
    let depth = 0;
    let match;
    while ((match = tags.exec(INDEX_HTML)) !== null) {
        if (match[0] === '</div>') {
            if (--depth === 0) return INDEX_HTML.slice(start, match.index + '</div>'.length);
        } else {
            depth++;
        }
    }
    throw new Error(`unbalanced ${startTag} markup in index.html`);
}

const FILTER_BAR_MARKUP = markupOf('<div class="checklist-filter-bar"');
const GRID_MARKUP = markupOf('<div class="checklist-grid">');

const buildRenderCard = (() => {
    const { bodyStart, end } = sourceOf('dynamicEntries.forEach(entry => {');
    return new Function(
        'allGistStats',
        'PROGRESS_RING_CIRCUMFERENCE',
        'grid',
        'dynamicStats',
        'sanitizeText',
        'isSafeColor',
        `return (entry) => ${INDEX_HTML.slice(bodyStart, end)};`,
    );
})();

const loadInitChecklistFilters = () => {
    const { start, end } = sourceOf('function initChecklistFilters() {');
    return new Function(`${INDEX_HTML.slice(start, end)}; return initChecklistFilters;`)();
};

// Matches the r="20" circle in the card's SVG, as index.html's own constant does.
const CIRCUMFERENCE = 2 * Math.PI * 20;

// Render one registry entry through the real card builder and hand back the card.
function renderCard(entry, stats, grid = document.createElement('div')) {
    buildRenderCard(
        { [entry.id]: stats },
        CIRCUMFERENCE,
        grid,
        {},
        sanitizeText,
        isSafeColor,
    )(entry);
    return grid.querySelector('.checklist-card:last-of-type');
}

// How much of the ring is dashed out, i.e. the unfilled part of the arc.
const ringOffset = (card) =>
    parseFloat(card.querySelector('.progress-ring .fill').getAttribute('stroke-dashoffset'));

// What a screen reader would use to name the control: an explicit name wins,
// otherwise the rendered text. Deliberately not the placeholder, which is only a
// last-resort fallback and not one to rely on.
const accessibleName = (el) => (el.getAttribute('aria-label') || el.textContent).trim();

const ENTRY = { id: 'test', title: 'Test Checklist', type: 'dynamic' };
const STATS = { owned: 3, total: 10, ownedValue: 100, neededValue: 50 };
const COMPLETE_STATS = { owned: 10, total: 10, ownedValue: 150, neededValue: 0 };

beforeEach(() => {
    document.body.innerHTML = '';
});

describe('index.html progress ring — role and value', () => {
    it('exposes the ring as a progressbar carrying the percentage', () => {
        const card = renderCard(ENTRY, STATS);

        const rings = card.querySelectorAll('[role="progressbar"]');
        expect(rings).toHaveLength(1);
        expect(rings[0].classList.contains('progress-ring')).toBe(true);
        expect(rings[0].getAttribute('aria-valuemin')).toBe('0');
        expect(rings[0].getAttribute('aria-valuemax')).toBe('100');
        expect(rings[0].getAttribute('aria-valuenow')).toBe('30');
        expect(rings[0].getAttribute('aria-valuetext')).toBe('30% collected');
    });

    it('gives the progressbar a name, which the role requires', () => {
        const card = renderCard(ENTRY, STATS);

        expect(accessibleName(card.querySelector('[role="progressbar"]'))).toBe('Cards collected');
    });

    it('says "Complete" rather than leaving a bare checkmark to speak for itself', () => {
        // The visible glyph replaces the percentage once every card is owned. A
        // lone ✓ announces as nothing useful, so the meaning moves onto the ring.
        const card = renderCard(ENTRY, COMPLETE_STATS);

        const ring = card.querySelector('[role="progressbar"]');
        expect(ring.getAttribute('aria-valuenow')).toBe('100');
        expect(ring.getAttribute('aria-valuetext')).toBe('Complete');
        expect(card.querySelector('.percentage').textContent).toBe('✓');
    });

    it('hides the glyph itself, so the ring is not announced twice', () => {
        const card = renderCard(ENTRY, COMPLETE_STATS);

        const hidden = card.querySelectorAll('.progress-ring [aria-hidden="true"]');
        expect(hidden).toHaveLength(2);
        expect(card.querySelector('.percentage').getAttribute('aria-hidden')).toBe('true');
        expect(card.querySelector('.progress-ring svg').getAttribute('aria-hidden')).toBe('true');
    });

    it('clamps the drawn arc and aria-valuenow together when a stale total leaves more cards owned than listed', () => {
        // Owning 12 of 10 is a state the gist can really hold while a checklist is
        // being trimmed. The percentage is clamped once at its source so both
        // consumers are covered: unclamped, aria-valuenow lands above
        // aria-valuemax and stroke-dashoffset goes negative, which shifts the dash
        // pattern and draws the ring as a broken arc rather than a closed one.
        const card = renderCard(ENTRY, { ...STATS, owned: 12, total: 10 });

        const ring = card.querySelector('[role="progressbar"]');
        expect(ring.getAttribute('aria-valuenow')).toBe('100');
        expect(ring.getAttribute('aria-valuetext')).toBe('Complete');
        expect(ringOffset(card)).toBe(0);
    });

    it('still draws the arc from the owned percentage in the ordinary case', () => {
        // Pins the geometry the clamp must not flatten: 3 of 10 owned leaves 70% of
        // the circumference dashed out. Without this, clamping to a constant would
        // satisfy the test above.
        const card = renderCard(ENTRY, STATS);

        expect(ringOffset(card)).toBeCloseTo(0.7 * CIRCUMFERENCE, 6);
    });

    it('leaves no progressbar on a checklist with no cards to report', () => {
        const card = renderCard(ENTRY, null);

        expect(card.querySelectorAll('[role="progressbar"]')).toHaveLength(0);
        expect(card.textContent).toContain('No cards yet');
    });
});

describe('index.html extra stat pill — named counts', () => {
    const pillEntry = { ...ENTRY, extraPills: [{ id: 'auto', label: 'Autos' }] };

    it('spells out the figures instead of leaving "2/5" to be read as a slash', () => {
        const card = renderCard(pillEntry, { ...STATS, autoOwned: 2, autoTotal: 5 });

        const counts = card.querySelectorAll('.stat-pill .count');
        expect(counts).toHaveLength(1);
        expect(counts[0].getAttribute('role')).toBe('img');
        expect(counts[0].getAttribute('aria-label')).toBe('2 of 5 owned');
        expect(counts[0].textContent).toBe('2/5');
    });

    it('names the checkmark a completed pill shows in place of the counts', () => {
        const card = renderCard(pillEntry, { ...STATS, autoOwned: 5, autoTotal: 5 });

        const count = card.querySelector('.stat-pill .count');
        expect(count.textContent).toBe('✓');
        expect(count.getAttribute('role')).toBe('img');
        expect(count.getAttribute('aria-label')).toBe('all 5 owned');
    });

    it('escapes a hostile pill total instead of opening a second attribute', () => {
        // The label lands inside a quoted attribute, so a pill total from the gist
        // has to be attribute-escaped and not just text-escaped (#692).
        const card = renderCard(pillEntry, {
            ...STATS,
            autoOwned: 2,
            autoTotal: '" onmouseover="alert(1)',
        });

        const count = card.querySelector('.stat-pill .count');
        expect(count.getAttribute('onmouseover')).toBeNull();
        expect(count.getAttribute('aria-label')).toBe('2 of " onmouseover="alert(1) owned');
    });
});

describe('index.html filter pills — pressed state', () => {
    function mountFilters() {
        document.body.innerHTML = FILTER_BAR_MARKUP + GRID_MARKUP;
        const grid = document.querySelector('.checklist-grid');
        renderCard({ ...ENTRY, id: 'alpha', title: 'Alpha' }, STATS, grid);
        renderCard({ ...ENTRY, id: 'beta', title: 'Beta' }, COMPLETE_STATS, grid);
        loadInitChecklistFilters()();
        return document.querySelectorAll('.filter-pill');
    }

    const pressed = (pills) => [...pills].filter(p => p.getAttribute('aria-pressed') === 'true');

    it('marks exactly the active pill as pressed on load', () => {
        const pills = mountFilters();

        expect(pills.length).toBe(4);
        expect(pressed(pills)).toHaveLength(1);
        expect(pressed(pills)[0].dataset.filter).toBe('all');
        expect(pressed(pills)[0].classList.contains('active')).toBe(true);
    });

    it('every pill carries a pressed state, so none reads as a plain button', () => {
        const pills = mountFilters();

        expect(pills.length).toBe(4);
        [...pills].forEach(pill => {
            expect(['true', 'false']).toContain(pill.getAttribute('aria-pressed'));
        });
    });

    it('moves the pressed state with the visual active state on click', () => {
        const pills = mountFilters();
        const complete = [...pills].find(p => p.dataset.filter === 'complete');

        complete.click();

        expect(pressed(pills)).toHaveLength(1);
        expect(pressed(pills)[0]).toBe(complete);
        expect([...pills].filter(p => p.classList.contains('active'))).toEqual([complete]);
    });

    it('groups the pills under a name, so the set is not four loose buttons', () => {
        mountFilters();

        const group = document.querySelector('.checklist-filter-pills');
        expect(group.getAttribute('role')).toBe('group');
        expect(accessibleName(group)).toBe('Filter checklists by progress');
    });

    it('names every control in the filter bar', () => {
        mountFilters();

        const controls = document.querySelectorAll('.checklist-filter-bar input, .checklist-filter-bar button');
        expect(controls.length).toBe(6);
        controls.forEach(control => {
            expect(accessibleName(control)).not.toBe('');
        });
    });

    it('names the clear button, which is otherwise a bare glyph', () => {
        mountFilters();

        expect(accessibleName(document.querySelector('.search-clear'))).toBe('Clear search');
        expect(accessibleName(document.getElementById('checklist-search'))).toBe('Search checklists');
    });
});

describe('index.html no-results message — live region', () => {
    function mountFilters() {
        document.body.innerHTML = FILTER_BAR_MARKUP + GRID_MARKUP;
        const grid = document.querySelector('.checklist-grid');
        renderCard({ ...ENTRY, id: 'alpha', title: 'Alpha' }, STATS, grid);
        loadInitChecklistFilters()();
        return document.getElementById('checklist-search');
    }

    const region = () => document.getElementById('checklist-no-results');

    const search = (input, query) => {
        input.value = query;
        input.dispatchEvent(new Event('input'));
    };

    it('is already in the page, empty, before anything is searched', () => {
        mountFilters();

        expect(region()).not.toBeNull();
        expect(region().getAttribute('role')).toBe('status');
        expect(region().textContent).toBe('');
    });

    it('announces through that same node rather than a freshly inserted one', () => {
        // A live region inserted at the same moment as its text is not reliably
        // announced, which is why the element is permanent and only its text
        // changes. Holding the node identity across the transition is the property
        // that keeps it that way.
        const input = mountFilters();
        const before = region();

        search(input, 'nothing matches this');

        expect(region()).toBe(before);
        expect(region().textContent).toBe('No checklists match your search.');
    });

    it('empties the region again once a search matches something', () => {
        const input = mountFilters();

        search(input, 'nothing matches this');
        search(input, 'alpha');

        expect(document.querySelectorAll('.checklist-no-results')).toHaveLength(1);
        expect(region().textContent).toBe('');
    });

    it('stays quiet when a filter hides every card but there were none to begin with', () => {
        document.body.innerHTML = FILTER_BAR_MARKUP + GRID_MARKUP;
        loadInitChecklistFilters()();

        const input = document.getElementById('checklist-search');
        search(input, 'anything');

        expect(document.querySelectorAll('.checklist-card')).toHaveLength(0);
        expect(region().textContent).toBe('');
    });
});
