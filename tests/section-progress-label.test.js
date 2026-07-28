import { describe, it, expect } from 'vitest';

const ChecklistEngine = globalThis.ChecklistEngine;

// A section header's progress badge shows "9/9" with a checkmark prepended once
// the section is complete (#703). The checkmark is a bare glyph and the counts
// read as "9 slash 9", so the badge carries an accessible name spelling the
// figures out. Same convention as the index page: a role and a name on the
// element, never visually-hidden text - the card grid filters on textContent
// (FilterUtils.applyFilters), so hidden words would leak into search matches.

function makeEngine(ownedIds) {
    const engine = Object.create(ChecklistEngine.prototype);
    const owned = new Set(ownedIds);
    engine.checklistManager = {
        getCardId: (card) => card.id,
        isOwned: (cardId) => owned.has(cardId),
    };
    return engine;
}

// Parse the badge out of the rendered header so assertions read attributes rather
// than the markup string.
function renderBadge(cards, ownedIds) {
    const host = document.createElement('div');
    host.innerHTML = makeEngine(ownedIds)._sectionHeaderHtml('Rookies', 'section-header', cards);
    return host.querySelector('.section-progress');
}

const CARDS = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

describe('section progress badge — accessible name', () => {
    it('spells out a partial count instead of leaving it read as a slash', () => {
        const badge = renderBadge(CARDS, ['a']);

        expect(badge).not.toBeNull();
        expect(badge.getAttribute('role')).toBe('img');
        expect(badge.getAttribute('aria-label')).toBe('1 of 3 owned');
        expect(badge.textContent).toBe('1/3');
    });

    it('names the checkmark a complete section shows', () => {
        const badge = renderBadge(CARDS, ['a', 'b', 'c']);

        expect(badge.classList.contains('complete')).toBe(true);
        expect(badge.getAttribute('role')).toBe('img');
        expect(badge.getAttribute('aria-label')).toBe('all 3 owned');
        expect(badge.textContent).toBe('✓ 3/3');
    });

    it('renders no badge at all for a section with nothing to count', () => {
        const host = document.createElement('div');
        host.innerHTML = makeEngine([])._sectionHeaderHtml('Rookies', 'section-header', []);

        expect(host.querySelectorAll('.section-progress')).toHaveLength(0);
        expect(host.textContent).toBe('Rookies');
    });

    it('keeps the label out of the section title text', () => {
        // CollapsibleSections keys its persisted collapse state on the header's
        // textContent, so the name has to stay in an attribute.
        const badge = renderBadge(CARDS, ['a']);

        expect(badge.parentElement.textContent).toBe('Rookies1/3');
    });
});
