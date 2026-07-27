import { describe, it, expect, beforeEach, vi } from 'vitest';

const ChecklistEngine = globalThis.ChecklistEngine;
const ChecklistManager = globalThis.ChecklistManager;
const CardRenderer = globalThis.CardRenderer;

// Owned checkboxes are wired by one delegated change listener on
// #sections-container instead of an inline onchange attribute. renderCards()
// rewrites that element's innerHTML but never replaces the element, so the
// listener is attached once at init and must keep working across re-renders.

function baseEngine(cards = []) {
  const engine = Object.create(ChecklistEngine.prototype);
  engine.id = 'test';
  engine.config = { dataShape: 'flat', customFields: {}, cardDisplay: {} };
  engine.cards = cards;
  engine._renderedCards = [];
  engine._reorderMode = false;
  engine._filterCard = () => true;
  engine.updateStats = vi.fn();
  return engine;
}

// The real ChecklistManager, wired exactly the way init() wires it: toggleOwned
// synchronously calls onOwnedChange, which re-renders. Tests that care what a
// toggle actually does to the page must go through this, not a stub - a stub
// that skips onOwnedChange cannot show the re-render at all.
function makeEngine(ownedIds = [], cards = []) {
  const engine = baseEngine(cards);
  engine.checklistManager = new ChecklistManager({
    checklistId: 'test',
    // Mirrors checklist-engine.js init()
    onOwnedChange: () => { engine.renderCards(); engine.updateStats(); },
  });
  engine.checklistManager.ownedCards = [...ownedIds];
  engine.checklistManager.isReadOnly = false;
  return engine;
}

// A stub manager for the tests that are about the listener plumbing rather than
// what a toggle does: it does not re-render, so hand-written markup survives the
// event and toggleOwned calls can be counted directly.
function makeStubEngine(ownedIds = []) {
  const owned = new Set(ownedIds);
  const engine = baseEngine();
  engine.checklistManager = {
    owned,
    getCardId: ChecklistManager.prototype.getCardId,
    isOwned: (id) => owned.has(id),
    toggleOwned: vi.fn((id, on) => { if (on) owned.add(id); else owned.delete(id); }),
    isReadOnly: false,
  };
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

const CARD = { set: '2024 Prizm', num: '1' };

beforeEach(() => {
  document.body.innerHTML = '<div id="sections-container"></div>';
});

describe('ChecklistEngine — toggling a checkbox through the real manager', () => {
  function setUp(ownedIds = []) {
    const engine = makeEngine(ownedIds, [CARD]);
    engine._initOwnedToggle();
    engine.renderCards();
    engine.updateStats.mockClear();
    return {
      engine,
      cardId: engine.getCardId(CARD),
      checkbox: container().querySelector('input[type="checkbox"][data-card-id]'),
    };
  }

  it('marks the card owned and the re-rendered card carries the owned class', () => {
    const { engine, cardId, checkbox } = setUp();

    check(checkbox, true);

    expect(engine.checklistManager.isOwned(cardId)).toBe(true);
    expect(container().querySelector('.card').classList.contains('owned')).toBe(true);
    expect(container().querySelector('input[type="checkbox"]').checked).toBe(true);
  });

  it('marks the card unowned and the re-rendered card drops the owned class', () => {
    const cardId = ChecklistManager.prototype.getCardId(CARD);
    const { engine, checkbox } = setUp([cardId]);
    expect(container().querySelector('.card').classList.contains('owned')).toBe(true);

    check(checkbox, false);

    expect(engine.checklistManager.isOwned(cardId)).toBe(false);
    expect(container().querySelector('.card').classList.contains('owned')).toBe(false);
    expect(container().querySelector('input[type="checkbox"]').checked).toBe(false);
  });

  // Why setOwned must not touch the DOM or the stats itself: onOwnedChange has
  // already replaced the container's contents by the time it would.
  it('detaches the clicked checkbox before setOwned could touch it', () => {
    const { checkbox } = setUp();

    check(checkbox, true);

    expect(document.contains(checkbox)).toBe(false);
    expect(container().querySelector('input[type="checkbox"]')).not.toBe(checkbox);
  });

  it('updates the stats once per toggle rather than twice', () => {
    // The two expected calls both come from the re-render path: renderCards ->
    // _applyFilters, then onOwnedChange's own call. A third would mean setOwned
    // is redundantly updating stats after the render already did.
    const { engine, checkbox } = setUp();

    check(checkbox, true);

    expect(engine.updateStats).toHaveBeenCalledTimes(2);
  });
});

describe('ChecklistEngine.setOwned', () => {
  it('delegates to the manager and does nothing else', () => {
    // No re-render happens with a stub manager, so anything setOwned does to the
    // page or the stats shows up here. It should do neither: onOwnedChange owns
    // the re-render and the stats update.
    const engine = makeStubEngine();
    const checkbox = renderCard('abc123', false);
    checkbox.checked = true;

    engine.setOwned('abc123', true);

    expect(engine.checklistManager.toggleOwned).toHaveBeenCalledWith('abc123', true);
    expect(container().querySelector('.card').classList.contains('owned')).toBe(false);
    expect(engine.updateStats).not.toHaveBeenCalled();
  });
});

describe('ChecklistEngine — delegated listener plumbing', () => {
  it('reports the checked state of the clicked checkbox', () => {
    const engine = makeStubEngine();
    engine._initOwnedToggle();
    const checkbox = renderCard('abc123', false);

    check(checkbox, true);
    expect(engine.checklistManager.toggleOwned).toHaveBeenLastCalledWith('abc123', true);

    check(checkbox, false);
    expect(engine.checklistManager.toggleOwned).toHaveBeenLastCalledWith('abc123', false);
  });

  it('does not toggle the owned class itself - the re-render does that', () => {
    // The stub manager never re-renders, so an owned class appearing here could
    // only have come from the handler reaching into the DOM on its own.
    const engine = makeStubEngine();
    engine._initOwnedToggle();
    const checkbox = renderCard('abc123', false);

    check(checkbox, true);

    expect(engine.checklistManager.toggleOwned).toHaveBeenCalledWith('abc123', true);
    expect(container().querySelector('.card').classList.contains('owned')).toBe(false);
  });

  it('still handles checkboxes rendered after the listener was attached', () => {
    const engine = makeStubEngine();
    engine._initOwnedToggle();
    renderCard('first', false);

    const checkbox = renderCard('second', false);
    check(checkbox, true);

    expect(engine.checklistManager.toggleOwned).toHaveBeenCalledTimes(1);
    expect(engine.checklistManager.toggleOwned).toHaveBeenCalledWith('second', true);
  });

  it('fires once per toggle, not once per render', () => {
    const engine = makeStubEngine();
    engine._initOwnedToggle();
    renderCard('abc123', false);
    renderCard('abc123', false);
    const checkbox = renderCard('abc123', false);

    check(checkbox, true);

    expect(engine.checklistManager.toggleOwned).toHaveBeenCalledTimes(1);
  });

  it('does not stack a second listener when init runs again', () => {
    const engine = makeStubEngine();
    engine._initOwnedToggle();
    engine._initOwnedToggle();
    const checkbox = renderCard('abc123', false);

    check(checkbox, true);

    expect(engine.checklistManager.toggleOwned).toHaveBeenCalledTimes(1);
  });

  it('ignores a change from a checkbox that is not an owned control', () => {
    const engine = makeStubEngine();
    engine._initOwnedToggle();
    container().innerHTML = '<input type="checkbox" id="other">';
    const checkbox = container().querySelector('input');

    check(checkbox, true);

    expect(engine.checklistManager.toggleOwned).not.toHaveBeenCalled();
  });

  it('keys ownership by the raw id when the id contains a quote', () => {
    const hostile = `x" onmouseover="alert(1)`;
    const engine = makeStubEngine();
    engine._initOwnedToggle();
    const checkbox = renderCard(hostile, false);

    check(checkbox, true);

    expect(engine.checklistManager.toggleOwned).toHaveBeenCalledWith(hostile, true);
  });

  it('does nothing when there is no sections container to bind to', () => {
    document.body.innerHTML = '';
    const engine = makeStubEngine();

    expect(() => engine._initOwnedToggle()).not.toThrow();
    expect(engine._ownedToggleBound).toBeFalsy();
  });
});

describe('ChecklistEngine.renderCards — the container element survives a re-render', () => {
  // The delegated listener lives on #sections-container, so a render that
  // replaced the element instead of its contents would silently drop it.
  it('rewrites innerHTML without replacing #sections-container', () => {
    const engine = makeEngine([], [CARD]);
    const before = container();

    engine.renderCards();
    const afterFirst = container();
    engine.renderCards();

    expect(afterFirst).toBe(before);
    expect(container()).toBe(before);
    expect(container().querySelectorAll('.card')).toHaveLength(1);
  });

  it('leaves the toggle working after a real re-render', () => {
    const engine = makeEngine([], [CARD]);
    engine._initOwnedToggle();
    engine.renderCards();
    engine.renderCards();

    check(container().querySelector('input[type="checkbox"][data-card-id]'), true);

    expect(engine.checklistManager.isOwned(engine.getCardId(CARD))).toBe(true);
    expect(container().querySelector('.card').classList.contains('owned')).toBe(true);
  });
});
