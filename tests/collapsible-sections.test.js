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
