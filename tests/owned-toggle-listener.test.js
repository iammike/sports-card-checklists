import { describe, it, expect, beforeEach, vi } from 'vitest';

const ChecklistEngine = globalThis.ChecklistEngine;
const ChecklistManager = globalThis.ChecklistManager;
const CardRenderer = globalThis.CardRenderer;

// Owned checkboxes are wired by one delegated change listener on
// #sections-container instead of an inline onchange attribute. renderCards()
// rewrites that element's innerHTML but never replaces the element, so the
// listener is attached once at init and must keep working across re-renders.
function makeEngine(ownedIds = []) {
  const owned = new Set(ownedIds);
  const engine = Object.create(ChecklistEngine.prototype);
  engine.id = 'test';
  engine.config = { dataShape: 'flat', customFields: {}, cardDisplay: {} };
  engine.cards = [];
  engine._renderedCards = [];
  engine.checklistManager = {
    owned,
    getCardId: ChecklistManager.prototype.getCardId,
    isOwned: (id) => owned.has(id),
    toggleOwned: vi.fn((id, on) => { if (on) owned.add(id); else owned.delete(id); }),
    isReadOnly: false,
  };
  engine.updateStats = vi.fn();
  return engine;
}

function container() {
  return document.getElementById('sections-container');
}

// Stand in for a render: replace the container's contents, not the container.
function renderCard(cardId, owned = false) {
  container().innerHTML = `<div class="card-grid"><div class="card${owned ? ' owned' : ''}">`
    + CardRenderer.renderOwnedControl(cardId, owned, false)
    + `</div></div>`;
  return container().querySelector('input[type="checkbox"]');
}

function check(checkbox, value) {
  checkbox.checked = value;
  checkbox.dispatchEvent(new window.Event('change', { bubbles: true }));
}

beforeEach(() => {
  document.body.innerHTML = '<div id="sections-container"></div>';
});

describe('ChecklistEngine — delegated owned toggle', () => {
  it('marks a card owned when its checkbox is checked', () => {
    const engine = makeEngine();
    engine._initOwnedToggle();
    const checkbox = renderCard('abc123', false);

    check(checkbox, true);

    expect(engine.checklistManager.toggleOwned).toHaveBeenCalledWith('abc123', true);
    expect(engine.checklistManager.isOwned('abc123')).toBe(true);
    expect(container().querySelector('.card').classList.contains('owned')).toBe(true);
    expect(engine.updateStats).toHaveBeenCalledTimes(1);
  });

  it('marks a card unowned when its checkbox is unchecked', () => {
    const engine = makeEngine(['abc123']);
    engine._initOwnedToggle();
    const checkbox = renderCard('abc123', true);

    check(checkbox, false);

    expect(engine.checklistManager.toggleOwned).toHaveBeenCalledWith('abc123', false);
    expect(engine.checklistManager.isOwned('abc123')).toBe(false);
    expect(container().querySelector('.card').classList.contains('owned')).toBe(false);
  });

  it('still handles checkboxes rendered after the listener was attached', () => {
    const engine = makeEngine();
    engine._initOwnedToggle();
    renderCard('first', false);

    const checkbox = renderCard('second', false);
    check(checkbox, true);

    expect(engine.checklistManager.toggleOwned).toHaveBeenCalledTimes(1);
    expect(engine.checklistManager.toggleOwned).toHaveBeenCalledWith('second', true);
  });

  it('fires once per toggle, not once per render', () => {
    const engine = makeEngine();
    engine._initOwnedToggle();
    renderCard('abc123', false);
    renderCard('abc123', false);
    const checkbox = renderCard('abc123', false);

    check(checkbox, true);

    expect(engine.checklistManager.toggleOwned).toHaveBeenCalledTimes(1);
    expect(engine.updateStats).toHaveBeenCalledTimes(1);
  });

  it('does not stack a second listener when init runs again', () => {
    const engine = makeEngine();
    engine._initOwnedToggle();
    engine._initOwnedToggle();
    const checkbox = renderCard('abc123', false);

    check(checkbox, true);

    expect(engine.checklistManager.toggleOwned).toHaveBeenCalledTimes(1);
  });

  it('ignores a change from a checkbox that is not an owned control', () => {
    const engine = makeEngine();
    engine._initOwnedToggle();
    container().innerHTML = '<input type="checkbox" id="other">';
    const checkbox = container().querySelector('input');

    check(checkbox, true);

    expect(engine.checklistManager.toggleOwned).not.toHaveBeenCalled();
    expect(engine.updateStats).not.toHaveBeenCalled();
  });

  it('keys ownership by the raw id when the id contains a quote', () => {
    const hostile = `x" onmouseover="alert(1)`;
    const engine = makeEngine();
    engine._initOwnedToggle();
    const checkbox = renderCard(hostile, false);

    check(checkbox, true);

    expect(engine.checklistManager.toggleOwned).toHaveBeenCalledWith(hostile, true);
  });

  it('does nothing when there is no sections container to bind to', () => {
    document.body.innerHTML = '';
    const engine = makeEngine();

    expect(() => engine._initOwnedToggle()).not.toThrow();
    expect(engine._ownedToggleBound).toBeFalsy();
  });
});

describe('ChecklistEngine.renderCards — the container element survives a re-render', () => {
  // The delegated listener lives on #sections-container, so a render that
  // replaced the element instead of its contents would silently drop it.
  function makeRenderableEngine(cards) {
    const engine = makeEngine();
    engine.cards = cards;
    engine._reorderMode = false;
    engine._filterCard = () => true;
    return engine;
  }

  it('rewrites innerHTML without replacing #sections-container', () => {
    const engine = makeRenderableEngine([{ set: '2024 Prizm', num: '1' }]);
    const before = container();

    engine.renderCards();
    const afterFirst = container();
    engine.renderCards();

    expect(afterFirst).toBe(before);
    expect(container()).toBe(before);
    expect(container().querySelectorAll('.card')).toHaveLength(1);
  });

  it('leaves the toggle working after a real re-render', () => {
    const engine = makeRenderableEngine([{ set: '2024 Prizm', num: '1' }]);
    engine._initOwnedToggle();
    engine.renderCards();
    engine.renderCards();

    const checkbox = container().querySelector('input[type="checkbox"][data-card-id]');
    check(checkbox, true);

    expect(engine.checklistManager.toggleOwned).toHaveBeenCalledTimes(1);
    expect(engine.checklistManager.toggleOwned).toHaveBeenCalledWith(
      engine.getCardId({ set: '2024 Prizm', num: '1' }),
      true,
    );
  });
});
