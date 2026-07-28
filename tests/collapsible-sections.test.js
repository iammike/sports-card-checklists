import { describe, it, expect, beforeEach } from 'vitest';

const ChecklistEngine = globalThis.ChecklistEngine;
const ChecklistManager = globalThis.ChecklistManager;
const CollapsibleSections = globalThis.CollapsibleSections;

// CollapsibleSections persists which sections a visitor left collapsed. The key
// it stores them under used to be the header's whole textContent, badge
// included, so "Base Set 12/35" became a different section from "Base Set 13/35"
// and marking a card owned sprang the section back open (#716).
//
// These render through the real engine so the headers under test are the ones a
// visitor's page contains - the category class the key now derives from is part
// of what is being pinned.

const STORAGE_KEY = 'test-collapsed';

function makeEngine(cards, config = {}) {
    const engine = Object.create(ChecklistEngine.prototype);
    engine.id = 'test';
    engine.config = { dataShape: 'categories', customFields: {}, cardDisplay: {}, ...config };
    engine.cards = cards;
    engine._renderedCards = [];
    engine._reorderMode = false;
    engine.updateStats = () => {};
    engine.checklistManager = new ChecklistManager({
        checklistId: 'test',
        onOwnedChange: () => {},
    });
    engine.checklistManager.ownedCards = [];
    engine.checklistManager.isReadOnly = false;
    return engine;
}

function container() {
    return document.getElementById('sections-container');
}

// Two categories so a key collision between them would show up as one collapse
// affecting both.
const CARDS = {
    base: [{ set: '2024 Prizm', num: '1' }, { set: '2024 Prizm', num: '2' }],
    inserts: [{ set: '2024 Prizm', num: '3' }],
};

const CATEGORIES = [
    { id: 'base', label: 'Base Set' },
    { id: 'inserts', label: 'Inserts' },
];

function renderChecklist() {
    const engine = makeEngine(CARDS, { categories: CATEGORIES });
    engine.renderCards();
    return engine;
}

function header(categoryId) {
    return container().querySelector(`.section-header.cat-${categoryId}`);
}

function stored() {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
}

// What the badge shows, so a test can prove the header text really did change.
function badgeText(categoryId) {
    return header(categoryId).querySelector('.section-progress').textContent;
}

beforeEach(() => {
    document.body.innerHTML = '<div id="sections-container"></div>';
    localStorage.clear();
});

describe('collapse state survives a change to the section\'s owned count', () => {
    it('leaves a collapsed section collapsed after a card in it is marked owned', () => {
        const engine = renderChecklist();
        expect(badgeText('base')).toBe('0/2');

        header('base').click();
        expect(header('base').classList.contains('collapsed')).toBe(true);

        engine.checklistManager.ownedCards.push(engine.getCardId(CARDS.base[0]));
        engine.renderCards();

        expect(badgeText('base')).toBe('1/2');
        expect(header('base').classList.contains('collapsed')).toBe(true);
    });

    it('stores one key for the section and keeps storing that same key', () => {
        const engine = renderChecklist();

        header('base').click();
        const afterCollapse = stored();

        engine.checklistManager.ownedCards.push(engine.getCardId(CARDS.base[0]));
        engine.renderCards();
        header('inserts').click();

        // The base entry is untouched by the owned count and by a second
        // section being collapsed; nothing accumulated a per-count duplicate.
        expect(afterCollapse).toEqual(['cat-base']);
        expect(stored()).toHaveLength(2);
        expect(stored()).toContain('cat-base');
        expect(stored()).toContain('cat-inserts');
    });

    it('collapses only the section that was clicked', () => {
        renderChecklist();

        header('base').click();

        expect(header('base').classList.contains('collapsed')).toBe(true);
        expect(header('inserts').classList.contains('collapsed')).toBe(false);
    });

    it('still expands again, and forgets the section when it does', () => {
        const engine = renderChecklist();

        header('base').click();
        engine.renderCards();
        header('base').click();
        engine.renderCards();

        expect(stored()).toEqual([]);
        expect(header('base').classList.contains('collapsed')).toBe(false);
    });
});

// A section header was a plain div with a click handler: no way to reach it
// with a keyboard, and nothing telling a screen reader it was a control or
// which state it was in (#715). jsdom can confirm the attributes and that the
// key handlers fire; it cannot confirm focus lands anywhere or that the ring is
// visible, which is why this was also walked through in a browser.
describe('section headers are operable without a mouse', () => {
    function press(el, key) {
        const event = new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
        el.dispatchEvent(event);
        return event;
    }

    it('exposes the header as a focusable button', () => {
        renderChecklist();

        expect(header('base').getAttribute('role')).toBe('button');
        expect(header('base').getAttribute('tabindex')).toBe('0');
    });

    it('toggles on Enter', () => {
        renderChecklist();

        press(header('base'), 'Enter');
        expect(header('base').classList.contains('collapsed')).toBe(true);

        press(header('base'), 'Enter');
        expect(header('base').classList.contains('collapsed')).toBe(false);
    });

    it('toggles on Space without letting the page scroll', () => {
        renderChecklist();

        const event = press(header('base'), ' ');

        expect(header('base').classList.contains('collapsed')).toBe(true);
        expect(event.defaultPrevented).toBe(true);
    });

    it('leaves other keys alone', () => {
        renderChecklist();

        const event = press(header('base'), 'a');

        expect(header('base').classList.contains('collapsed')).toBe(false);
        expect(event.defaultPrevented).toBe(false);
    });

    it('reports the expanded state and keeps it in step with the toggle', () => {
        renderChecklist();
        expect(header('base').getAttribute('aria-expanded')).toBe('true');

        header('base').click();
        expect(header('base').getAttribute('aria-expanded')).toBe('false');

        press(header('base'), 'Enter');
        expect(header('base').getAttribute('aria-expanded')).toBe('true');
    });

    it('reports the restored state on first render, before anything is clicked', () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(['cat-base']));
        renderChecklist();

        expect(header('base').getAttribute('aria-expanded')).toBe('false');
        expect(header('inserts').getAttribute('aria-expanded')).toBe('true');
    });

    // Restoring a collapsed section suppresses both the slide and the delayed
    // visibility flip that takes its content out of the tab order - the delay is
    // timed to a slide that is not running, and restored-collapsed content must
    // not be focusable even briefly. jsdom has no transitions or visibility, so
    // this pins the mechanism; the focus behaviour itself was checked in Chrome.
    it('suppresses the region\'s transitions while restoring it collapsed', () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(['cat-base']));
        renderChecklist();

        const region = document.getElementById(header('base').getAttribute('aria-controls'));
        expect(region.style.transition).toBe('none');
        expect(region.firstElementChild.style.transition).toBe('none');
    });

    it('hands the transitions back on the next frame, so the next toggle animates', async () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(['cat-base']));
        renderChecklist();
        const region = document.getElementById(header('base').getAttribute('aria-controls'));

        await new Promise(resolve => requestAnimationFrame(resolve));

        expect(region.style.transition).toBe('');
        expect(region.firstElementChild.style.transition).toBe('');
    });

    it('leaves transitions alone for a section that renders expanded', () => {
        renderChecklist();

        const region = document.getElementById(header('base').getAttribute('aria-controls'));
        expect(region.classList.contains('collapsed')).toBe(false);
        expect(region.style.transition).toBe('');
        expect(region.firstElementChild.style.transition).toBe('');
    });

    it('points aria-controls at the region it collapses', () => {
        renderChecklist();

        const region = document.getElementById(header('base').getAttribute('aria-controls'));
        expect(region).not.toBeNull();
        expect(region.classList.contains('collapsible-content')).toBe(true);
        expect(region.querySelectorAll('.card')).toHaveLength(CARDS.base.length);

        header('base').click();
        expect(region.classList.contains('collapsed')).toBe(true);
    });

    it('gives each header its own region id', () => {
        renderChecklist();

        const ids = [...container().querySelectorAll('[aria-controls]')]
            .map(el => el.getAttribute('aria-controls'));
        expect(ids).toHaveLength(2);
        expect(new Set(ids).size).toBe(2);
    });

    it('does not put the state into the header text, where the card filter reads', () => {
        renderChecklist();
        header('base').click();

        expect(header('base').textContent).toBe('Base Set0/2');
    });
});

// Left to the browser, the button's name is computed from its contents - which
// in Chrome includes the ::before disclosure glyph, so every header announced as
// "black down-pointing triangle, Base Set, 0 of 2 owned". An explicit aria-label
// overrides that. It has to carry the badge too: a button is a leaf in the
// accessibility tree, so the badge inside it is never announced on its own.
describe('section header accessible name', () => {
    it('names the header with its title and the badge, and nothing else', () => {
        renderChecklist();

        expect(header('base').getAttribute('aria-label')).toBe('Base Set, 0 of 2 owned');
        expect(header('inserts').getAttribute('aria-label')).toBe('Inserts, 0 of 1 owned');
    });

    it('takes the badge\'s spelled-out name rather than its "0/2" text', () => {
        renderChecklist();
        const badge = header('base').querySelector('.section-progress');

        expect(badge.textContent).toBe('0/2');
        expect(header('base').getAttribute('aria-label')).toContain(badge.getAttribute('aria-label'));
        expect(header('base').getAttribute('aria-label')).not.toContain('0/2');
    });

    it('follows the owned count when the section re-renders', () => {
        const engine = renderChecklist();

        engine.checklistManager.ownedCards.push(engine.getCardId(CARDS.base[0]));
        engine.renderCards();

        expect(header('base').getAttribute('aria-label')).toBe('Base Set, 1 of 2 owned');
    });

    it('names a header that has no badge to fold in', () => {
        const engine = makeEngine({ base: [{ set: '2024 Prizm', num: '1', noCard: true }] },
            { categories: [{ id: 'base', label: 'Base Set' }] });
        engine.renderCards();

        expect(header('base').querySelectorAll('.section-progress')).toHaveLength(0);
        expect(header('base').getAttribute('aria-label')).toBe('Base Set');
    });

    it('leaves the browser to it when there is nothing to name the header with', () => {
        document.body.innerHTML = '<div id="sections-container"><div class="section">'
            + '<div class="section-header"></div><div class="card-grid"></div></div></div>';
        CollapsibleSections.init();

        expect(document.querySelector('.section-header').hasAttribute('aria-label')).toBe(false);
    });
});

describe('sectionKey - headers with no category class', () => {
    // The sorted view renders every card under one "All Cards" header carrying
    // no cat- class, so the fallback is a live path, not a defensive one.
    it('keys the sorted view\'s single header on its label, not its badge', () => {
        document.body.innerHTML = `
            <div id="sections-container"></div>
            <select id="sort-filter"><option value="year">Year</option></select>`;
        const engine = makeEngine(CARDS, { categories: CATEGORIES });
        engine.renderCards();

        const allCards = container().querySelector('.section-header');
        expect(allCards.classList.contains('collapsible')).toBe(true);
        allCards.click();

        expect(stored()).toEqual(['all-cards']);
    });

    it('ignores element children when deriving a key from the label', () => {
        const host = document.createElement('div');
        host.innerHTML = '<div class="section-header">Rookies<span class="section-progress">7/9</span></div>';

        expect(CollapsibleSections.sectionKey(host.firstElementChild, 0)).toBe('rookies');
    });

    it('falls back to the header\'s position when there is no text to key on', () => {
        const host = document.createElement('div');
        host.innerHTML = '<div class="section-header"><span class="section-progress">7/9</span></div>';

        expect(CollapsibleSections.sectionKey(host.firstElementChild, 3)).toBe('section-3');
    });
});
