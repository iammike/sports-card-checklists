import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const ChecklistEngine = globalThis.ChecklistEngine;
const ChecklistManager = globalThis.ChecklistManager;

// renderCards() always ends in _applyFilters(), which calls updateStats(). Every
// caller therefore gets the stats refresh for free, and an updateStats() right
// after a renderCards() is a second, redundant pass over the whole collection.
// These tests pin each caller to exactly one stats update per render.

function makeEngine(cards = []) {
  const engine = Object.create(ChecklistEngine.prototype);
  engine.id = 'test';
  engine.config = { dataShape: 'flat', customFields: {}, cardDisplay: {} };
  engine.cards = cards;
  engine._renderedCards = [];
  engine._reorderMode = false;
  engine._filterCard = () => true;
  engine.updateStats = vi.fn();
  engine._saveCardData = vi.fn(async () => true);
  engine.checklistManager = {
    getCardId: ChecklistManager.prototype.getCardId,
    isOwned: () => false,
    toggleOwned: () => {},
    setSyncStatus: () => {},
    isOwner: () => true,
    isReadOnly: false,
  };
  return engine;
}

const CARD = { set: '2024 Prizm', num: '1' };

beforeEach(() => {
  document.body.innerHTML = '<div id="sections-container"></div>';
  // jsdom has no layout, so it does not implement scrollIntoView; onSave scrolls
  // to the card it just saved.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  delete Element.prototype.scrollIntoView;
});

describe('ChecklistEngine — the card editor save callback', () => {
  function setUp(cards) {
    const engine = makeEngine(cards);
    engine._initCardEditor();
    return engine;
  }

  it('updates the stats exactly once when saving an edited card', async () => {
    const engine = setUp([CARD]);
    const cardId = engine.getCardId(CARD);

    await engine.cardEditor.onSave(cardId, { ...CARD, price: 25 }, false);

    expect(engine.updateStats).toHaveBeenCalledTimes(1);
  });

  it('updates the stats exactly once when saving a new card', async () => {
    const engine = setUp([]);

    await engine.cardEditor.onSave(null, { ...CARD }, true);

    expect(engine.updateStats).toHaveBeenCalledTimes(1);
  });

  it('still re-renders the saved card', async () => {
    const engine = setUp([]);

    await engine.cardEditor.onSave(null, { ...CARD }, true);

    expect(document.querySelectorAll('#sections-container .card')).toHaveLength(1);
  });
});

describe('ChecklistEngine — the card editor delete callback', () => {
  it('updates the stats exactly once when deleting a card', async () => {
    const engine = makeEngine([CARD]);
    engine._initCardEditor();
    const cardId = engine.getCardId(CARD);

    await engine.cardEditor.onDelete(cardId);

    expect(engine.updateStats).toHaveBeenCalledTimes(1);
  });

  it('still re-renders without the deleted card', async () => {
    const engine = makeEngine([CARD]);
    engine._initCardEditor();

    await engine.cardEditor.onDelete(engine.getCardId(CARD));

    expect(document.querySelectorAll('#sections-container .card')).toHaveLength(0);
  });
});

describe('ChecklistEngine — the settings modal onCreated callback', () => {
  // _initSettingsButton keeps the ChecklistCreatorModal in a local, so swap the
  // constructor to capture the callback it is wired with. The engine resolves
  // ChecklistCreatorModal off the global object, so the swap takes effect.
  function captureOnCreated(engine) {
    const Real = globalThis.ChecklistCreatorModal;
    let onCreated;
    globalThis.ChecklistCreatorModal = class {
      constructor(options) { onCreated = options.onCreated; }
    };
    try {
      engine._initSettingsButton();
    } finally {
      globalThis.ChecklistCreatorModal = Real;
    }
    return onCreated;
  }

  function setUp() {
    const engine = makeEngine([CARD]);
    // Everything onCreated does besides re-rendering: theme, page metadata and
    // the filter/editor rebuild all read the DOM the real page has and none of
    // them touch the stats.
    engine._migrateDataShape = vi.fn(() => false);
    engine._applyTheme = vi.fn();
    engine._setPageMeta = vi.fn();
    engine._renderFilters = vi.fn();
    engine._initCardEditor = vi.fn();
    vi.spyOn(globalThis.DynamicNav, 'init').mockResolvedValue(undefined);
    return { engine, onCreated: captureOnCreated(engine) };
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('updates the stats exactly once after saving settings', async () => {
    const { engine, onCreated } = setUp();

    await onCreated({ ...engine.config, title: 'Renamed' });

    expect(engine.updateStats).toHaveBeenCalledTimes(1);
  });

  it('re-renders the cards under the new config', async () => {
    const { engine, onCreated } = setUp();

    await onCreated({ ...engine.config, title: 'Renamed' });

    expect(engine.config.title).toBe('Renamed');
    expect(document.querySelectorAll('#sections-container .card')).toHaveLength(1);
  });
});
