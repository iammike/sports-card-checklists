import { describe, it, expect } from 'vitest';

const ChecklistEngine = globalThis.ChecklistEngine;
const ChecklistManager = globalThis.ChecklistManager;

function makeManager(ownedIds) {
  const owned = new Set(ownedIds);
  return {
    owned,
    getCardId: ChecklistManager.prototype.getCardId,
    isOwned: (id) => owned.has(id),
    toggleOwned: (id, on) => { if (on) owned.add(id); else owned.delete(id); },
    setSyncStatus: () => {},
    isReadOnly: false,
  };
}

// Build an engine with a real card editor so its onSave callback can be driven.
function makeEngine(cards, ownedIds) {
  const engine = Object.create(ChecklistEngine.prototype);
  engine.id = 'test';
  engine.config = { dataShape: 'flat', customFields: {} };
  engine.cards = cards;
  engine._renderedCards = [];
  engine.checklistManager = makeManager(ownedIds);
  engine.renderCards = () => {};
  engine.updateStats = () => {};
  engine._saveCardData = async () => true;
  engine._initCardEditor();
  return engine;
}

const hash = (card) => ChecklistManager.prototype.getCardId(card);

describe('onSave — ownership of no-card entries', () => {
  it('clears ownership when an owned card is flagged as no-card', async () => {
    const card = { set: 'Prizm', num: '1', player: 'Ariel Hukporti' };
    const oldId = hash(card);
    const engine = makeEngine([card], [oldId]);

    await engine.cardEditor.onSave(oldId, {
      set: '', num: '', player: 'Ariel Hukporti', noCard: true, id: 'ncArielHukporti1',
    }, false);

    expect(engine.checklistManager.isOwned(oldId)).toBe(false);
    expect(engine.checklistManager.isOwned('ncArielHukporti1')).toBe(false);
  });

  it('leaves a no-card entry unowned when it was already unowned', async () => {
    const card = { id: 'ncArielHukporti1', player: 'Ariel Hukporti', noCard: true };
    const engine = makeEngine([card], []);

    await engine.cardEditor.onSave('ncArielHukporti1', {
      player: 'Ariel Hukporti', noCard: true, id: 'ncArielHukporti1',
    }, false);

    expect(engine.checklistManager.owned.size).toBe(0);
  });

  it('still transfers ownership when a normal card id changes', async () => {
    const card = { set: 'Prizm', num: '1' };
    const oldId = hash(card);
    const engine = makeEngine([card], [oldId]);
    const newId = hash({ set: 'Prizm', num: '1', variant: 'Silver' });

    await engine.cardEditor.onSave(oldId, {
      set: 'Prizm', num: '1', variant: 'Silver', noCard: false,
    }, false);

    expect(engine.checklistManager.isOwned(oldId)).toBe(false);
    expect(engine.checklistManager.isOwned(newId)).toBe(true);
  });
});
