import { describe, it, expect, beforeEach } from 'vitest';

const ChecklistEngine = globalThis.ChecklistEngine;
const ChecklistManager = globalThis.ChecklistManager;
const CardEditorModal = globalThis.CardEditorModal;

function makeEngine(config) {
  const engine = Object.create(ChecklistEngine.prototype);
  engine.config = config;
  engine.cards = [];
  engine._renderedCards = [];
  engine.checklistManager = new ChecklistManager({ checklistId: 'test' });
  return engine;
}

describe('getCardId — explicit id', () => {
  it('honors card.id on the default hashing path', () => {
    const engine = makeEngine({ dataShape: 'flat' });
    expect(engine.getCardId({ id: 'ncAdamSmith' })).toBe('ncAdamSmith');
  });

  it('honors card.id even when includePlayerInCardId is set', () => {
    const engine = makeEngine({ dataShape: 'flat', cardDisplay: { includePlayerInCardId: true } });
    expect(engine.getCardId({ id: 'ncAdamSmith', player: 'Adam Smith' })).toBe('ncAdamSmith');
  });

  it('still hashes player+set+num+variant when no explicit id exists', () => {
    const engine = makeEngine({ dataShape: 'flat', cardDisplay: { includePlayerInCardId: true } });
    const expected = btoa('Adam SmithPrizm12Silver').replace(/[^a-zA-Z0-9]/g, '');
    expect(engine.getCardId({ player: 'Adam Smith', set: 'Prizm', num: '12', variant: 'Silver' }))
      .toBe(expected);
  });

  it('does not throw on a non-Latin-1 player name', () => {
    const engine = makeEngine({ dataShape: 'flat', cardDisplay: { includePlayerInCardId: true } });
    const card = { player: 'Alperen Şengün', set: 'Prizm', num: '12' };

    expect(() => engine.getCardId(card)).not.toThrow();
    expect(engine.getCardId(card)).toBeTruthy();
  });

  it('matches index.html and shopping-list.js for a non-Latin-1 player name', () => {
    const engine = makeEngine({ dataShape: 'flat', cardDisplay: { includePlayerInCardId: true } });
    const expected = btoa('Alperen Şengün'.replace(/[^\x00-\xFF]/g, '_') + 'Prizm12')
      .replace(/[^a-zA-Z0-9]/g, '');

    expect(engine.getCardId({ player: 'Alperen Şengün', set: 'Prizm', num: '12' })).toBe(expected);
  });
});

describe('createCardElement — no-card entry identity', () => {
  const config = { dataShape: 'flat', cardDisplay: { showPlayerName: true } };

  it('emits id and data-card-id so edit, delete, and deep links work', () => {
    const engine = makeEngine(config);
    const html = engine.createCardElement({ id: 'ncArielHukporti', player: 'Ariel Hukporti', noCard: true });

    expect(html).toContain('id="card-ncArielHukporti"');
    expect(html).toContain('data-card-id="ncArielHukporti"');
  });
});

describe('CardEditorModal — no-card entry id assignment', () => {
  let editor;

  function makeEditor(options = {}) {
    const e = new CardEditorModal({
      customFields: { player: { label: 'Player', position: 'top' } },
      ...options,
    });
    e.init();
    e.currentCard = {};
    return e;
  }

  beforeEach(() => {
    editor = makeEditor();
  });

  function flag(playerName) {
    editor.backdrop.querySelector('#editor-player').value = playerName;
    editor.backdrop.querySelector('#editor-no-card').checked = true;
    return editor.getFormData();
  }

  it('assigns an id derived from the player name', () => {
    const data = flag('Ariel Hukporti');
    expect(data.id).toMatch(/^ncArielHukporti[a-z0-9]+$/);
  });

  it('assigns an id containing only alphanumerics', () => {
    const data = flag("Jo'Vaughn O'Neal-Smith");
    expect(data.id).toMatch(/^[a-zA-Z0-9]+$/);
  });

  it('does not assign an id when the entry is not flagged', () => {
    editor.backdrop.querySelector('#editor-set').value = 'Prizm';
    editor.backdrop.querySelector('#editor-no-card').checked = false;
    expect('id' in editor.getFormData()).toBe(false);
  });

  it('keeps an existing id unchanged when the player name is edited', () => {
    editor.currentCard = { id: 'ncOldName', noCard: true, player: 'Old Name' };
    const data = flag('New Name');
    expect(data.id).toBe('ncOldName');
  });

  it('preserves an existing id when un-flagging', () => {
    editor.currentCard = { id: 'ncOldName', noCard: true };
    editor.backdrop.querySelector('#editor-no-card').checked = false;
    expect(editor.getFormData().id).toBe('ncOldName');
  });

  it('uniquifies against ids already used in the checklist', () => {
    const existing = ['ncArielHukporti'];
    editor = makeEditor({ getExistingIds: () => existing });
    editor.currentCard = {};
    const first = flag('Ariel Hukporti');
    existing.push(first.id);
    const second = flag('Ariel Hukporti');

    expect(second.id).not.toBe(first.id);
  });

  it('generates distinct ids for two entries with no name at all', () => {
    const existing = [];
    editor = makeEditor({ getExistingIds: () => existing });
    editor.currentCard = {};
    const first = flag('');
    existing.push(first.id);
    const second = flag('');

    expect(first.id).toBeTruthy();
    expect(second.id).not.toBe(first.id);
  });
});
