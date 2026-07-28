import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ChecklistEngine = globalThis.ChecklistEngine;
const ChecklistManager = globalThis.ChecklistManager;
const ShoppingList = globalThis.ShoppingList;
const CardEditorModal = globalThis.CardEditorModal;
const isSafeCardId = globalThis.isSafeCardId;

// Card ids are interpolated into HTML attributes, so an explicit card.id is only
// honored when it matches a safe charset. The four id resolvers must agree on that
// decision or the same card gets different ids in different parts of the app.
// The render sink escapes ids as well (see card-renderer.js renderOwnedControl and
// tests/owned-toggle-listener.test.js) - this is the source-validation layer.

const UNSAFE_IDS = {
  'single quote': "nc'x",
  'double quote': 'nc"x',
  'angle bracket': 'nc<x',
  space: 'nc x',
};

// index.html resolves ids in an inline script, which tests/setup.js does not
// load (it only evals src/*.js). Extract the real computeId source from the
// file and evaluate it, so this asserts the shipped code rather than a copy.
function loadIndexComputeId(includePlayer) {
  const html = readFileSync(resolve(import.meta.dirname, '..', 'index.html'), 'utf-8');
  const start = html.indexOf('const computeId = (card) => {');
  if (start === -1) throw new Error('computeId not found in index.html');

  const bodyStart = html.indexOf('{', start);
  let depth = 0;
  let bodyEnd = -1;
  for (let i = bodyStart; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') {
      depth--;
      if (depth === 0) {
        bodyEnd = i + 1;
        break;
      }
    }
  }
  if (bodyEnd === -1) throw new Error('unbalanced computeId body in index.html');

  const body = html.slice(bodyStart, bodyEnd);
  return new Function('includePlayer', 'isSafeCardId', `return (card) => ${body};`)(
    includePlayer,
    isSafeCardId,
  );
}

// Every id resolver, in both includePlayerInCardId modes. ChecklistManager has
// no player-inclusive mode - the engine's includePlayer branch hashes directly
// and never delegates to it - so it only participates as a peer in the default
// mode, where all four implementations apply.
function resolvers(includePlayer) {
  const cardDisplay = includePlayer ? { includePlayerInCardId: true } : {};

  const engine = Object.create(ChecklistEngine.prototype);
  engine.config = { dataShape: 'flat', cardDisplay };
  engine.checklistManager = new ChecklistManager({ checklistId: 'test' });

  const all = {
    engine: (card) => engine.getCardId(card),
    shoppingList: (card) => ShoppingList.generateCardId(card, { cardDisplay }),
    index: loadIndexComputeId(includePlayer),
  };
  if (!includePlayer) all.manager = (card) => engine.checklistManager.getCardId(card);
  return all;
}

describe('isSafeCardId', () => {
  it('accepts alphanumerics, underscore and hyphen', () => {
    expect(isSafeCardId('ok-id_1')).toBe(true);
    expect(isSafeCardId('ncAdamSmith')).toBe(true);
    expect(isSafeCardId('ncAdamSmith2')).toBe(true);
    expect(isSafeCardId('MjAyNVByaXptMTI')).toBe(true);
  });

  it('rejects characters that could break out of an attribute or JS string', () => {
    for (const id of Object.values(UNSAFE_IDS)) {
      expect(isSafeCardId(id)).toBe(false);
    }
    expect(isSafeCardId('nc>x')).toBe(false);
    expect(isSafeCardId('nc\\x')).toBe(false);
    expect(isSafeCardId('nc/x')).toBe(false);
    expect(isSafeCardId('nc.x')).toBe(false);
  });

  it('rejects empty and non-string values', () => {
    expect(isSafeCardId('')).toBe(false);
    expect(isSafeCardId(undefined)).toBe(false);
    expect(isSafeCardId(null)).toBe(false);
    expect(isSafeCardId(5)).toBe(false);
    expect(isSafeCardId({})).toBe(false);
    expect(isSafeCardId(['ok'])).toBe(false);
  });
});

describe('card id resolvers — explicit card.id validation', () => {
  it('exercises all four id implementations in the default mode', () => {
    expect(Object.keys(resolvers(false)).sort()).toEqual([
      'engine',
      'index',
      'manager',
      'shoppingList',
    ]);
  });

  for (const includePlayer of [false, true]) {
    const mode = includePlayer ? 'includePlayerInCardId' : 'default hashing';

    describe(mode, () => {
      it('honors a safe explicit id in every implementation', () => {
        const card = { id: 'ok-id_1', player: 'Adam Smith', set: 'Prizm', num: '12' };
        for (const [name, resolve_] of Object.entries(resolvers(includePlayer))) {
          expect(resolve_(card), name).toBe('ok-id_1');
        }
      });

      for (const [label, unsafeId] of Object.entries(UNSAFE_IDS)) {
        it(`rejects an id containing a ${label} and falls back to the hash`, () => {
          const card = { id: unsafeId, player: 'Adam Smith', set: 'Prizm', num: '12', variant: 'Silver' };
          const hashInput = (includePlayer ? 'Adam Smith' : '') + 'Prizm12Silver';
          const expected = btoa(hashInput).replace(/[^a-zA-Z0-9]/g, '');

          for (const [name, resolve_] of Object.entries(resolvers(includePlayer))) {
            expect(resolve_(card), name).toBe(expected);
          }
        });
      }

      it('produces the same rejected-id value across every implementation', () => {
        const card = { id: "nc'\"<x", player: 'Adam Smith', set: 'Prizm', num: '12' };
        const values = Object.entries(resolvers(includePlayer)).map(([name, resolve_]) => [
          name,
          resolve_(card),
        ]);

        const [, first] = values[0];
        expect(first).toBeTruthy();
        expect(first).toMatch(/^[a-zA-Z0-9]+$/);
        for (const [name, value] of values) {
          expect(value, name).toBe(first);
        }
      });

      it('leaves cards with no explicit id unaffected', () => {
        const card = { player: 'Adam Smith', set: 'Prizm', num: '12', variant: 'Silver' };
        const hashInput = (includePlayer ? 'Adam Smith' : '') + 'Prizm12Silver';
        const expected = btoa(hashInput).replace(/[^a-zA-Z0-9]/g, '');

        for (const [name, resolve_] of Object.entries(resolvers(includePlayer))) {
          expect(resolve_(card), name).toBe(expected);
        }
      });
    });
  }
});

describe('no-card id backfill — unsafe existing id', () => {
  function makeEngine(cards) {
    const engine = Object.create(ChecklistEngine.prototype);
    engine.config = { dataShape: 'flat', customFields: { player: { position: 'top' } } };
    engine.cards = cards;
    return engine;
  }

  it('replaces an unsafe id so the entry does not hash to the empty string', () => {
    const cards = [{ noCard: true, player: 'Adam Smith', id: "nc'x" }];
    const engine = makeEngine(cards);

    engine._backfillSyntheticIds();

    expect(cards[0].id).toBe('ncAdamSmith');
    expect(isSafeCardId(cards[0].id)).toBe(true);
  });

  it('leaves a safe existing id alone', () => {
    const cards = [{ noCard: true, player: 'Adam Smith', id: 'ncOldName' }];
    makeEngine(cards)._backfillSyntheticIds();

    expect(cards[0].id).toBe('ncOldName');
  });
});

// Second layer: the resolvers above reject these ids, so this can only be reached
// by a future code path that produces an id without validating it. Even then the id
// must land escaped in the markup rather than as new attributes or elements.
describe('render sink — an unvalidated card id cannot inject', () => {
  const HOSTILE = `x" onmouseover="alert(1)`;

  function makeEngine() {
    const engine = Object.create(ChecklistEngine.prototype);
    engine.config = { dataShape: 'flat', cardDisplay: { showPlayerName: true } };
    engine.cards = [];
    engine._renderedCards = [];
    engine.checklistManager = {
      // Stands in for a resolver that skipped isSafeCardId
      getCardId: (card) => card.id,
      isOwned: () => false,
      isReadOnly: false,
    };
    return engine;
  }

  function renderCard(card) {
    const host = document.createElement('div');
    host.innerHTML = makeEngine().createCardElement(card);
    return host;
  }

  it('escapes the id in a regular card element', () => {
    const host = renderCard({ id: HOSTILE, set: 'Prizm', num: '1' });
    const cardEl = host.querySelector('.card');

    expect(cardEl.id).toBe(`card-${HOSTILE}`);
    expect(cardEl.getAttribute('onmouseover')).toBe(null);
  });

  it('escapes the id in a no-card element', () => {
    const host = renderCard({ id: HOSTILE, player: 'Adam Smith', noCard: true });
    const cardEl = host.querySelector('.card');

    expect(cardEl.id).toBe(`card-${HOSTILE}`);
    expect(cardEl.dataset.cardId).toBe(HOSTILE);
    expect(cardEl.getAttribute('onmouseover')).toBe(null);
  });

  it('escapes the id on the owned checkbox and uses no inline handler', () => {
    const host = renderCard({ id: HOSTILE, set: 'Prizm', num: '1' });
    const checkbox = host.querySelector('input[type="checkbox"]');

    expect(checkbox.dataset.cardId).toBe(HOSTILE);
    expect(checkbox.getAttribute('onmouseover')).toBe(null);
    expect(host.innerHTML).not.toContain('onchange');
  });
});

describe('CardEditorModal — unsafe existing id is not carried forward', () => {
  function makeEditor() {
    const editor = new CardEditorModal({
      customFields: { player: { label: 'Player', position: 'top' } },
    });
    editor.init();
    return editor;
  }

  it('regenerates a safe id for a no-card entry', () => {
    const editor = makeEditor();
    editor.currentCard = { id: "nc'x", noCard: true, player: 'Adam Smith' };
    editor.backdrop.querySelector('#editor-player').value = 'Adam Smith';
    editor.backdrop.querySelector('#editor-no-card').checked = true;

    expect(editor.getFormData().id).toBe('ncAdamSmith');
  });

  it('drops an unsafe id on a regular card instead of re-persisting it', () => {
    const editor = makeEditor();
    editor.currentCard = { id: 'nc<x', set: 'Prizm' };
    editor.backdrop.querySelector('#editor-set').value = 'Prizm';
    editor.backdrop.querySelector('#editor-no-card').checked = false;

    expect('id' in editor.getFormData()).toBe(false);
  });
});
