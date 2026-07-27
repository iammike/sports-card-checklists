import { describe, it, expect, afterEach } from 'vitest';

const ChecklistEngine = globalThis.ChecklistEngine;

// Mirrors a real checklist's schema: auto/rc/patch are checkbox custom fields,
// serial/variant/notes are text custom fields.
const CUSTOM_FIELDS = {
  auto: { type: 'checkbox' },
  rc: { type: 'checkbox' },
  patch: { type: 'checkbox' },
  serial: { type: 'text' },
  variant: { type: 'text' },
  notes: { type: 'text' },
};

// Identity from set+num+variant, like ChecklistManager.getCardId
const hashId = (c) => (c.set || '') + (c.num || '') + (c.variant || '');

function makeFlatEngine(cards, getCardId = hashId) {
  const engine = Object.create(ChecklistEngine.prototype);
  engine.id = 'test';
  engine.config = { dataShape: 'flat', customFields: CUSTOM_FIELDS };
  engine.cards = cards;
  engine.checklistManager = { getCardId };
  return engine;
}

function makeCategoryEngine(cardsByCategory, getCardId = hashId) {
  const engine = Object.create(ChecklistEngine.prototype);
  engine.id = 'test';
  engine.config = {
    dataShape: 'categories',
    categories: [{ id: 'base' }],
    customFields: CUSTOM_FIELDS,
  };
  engine.cards = cardsByCategory;
  engine.checklistManager = { getCardId };
  return engine;
}

// Build the form data CardEditorModal.getFormData() produces for `card` with
// only `cleared` emptied. Text fields are always sent (empty string when blank);
// checkboxes, price, ebay and priceSearch are omitted entirely when unset.
function formDataWithCleared(cleared, card, extra = {}) {
  const data = { set: card.set, num: card.num, type: '' };
  data.img = cleared === 'img' ? '' : (card.img || '');
  if (cleared !== 'price' && card.price) data.price = card.price;
  if (cleared !== 'search' && card.search) data.ebay = card.search;
  if (cleared !== 'priceSearch' && card.priceSearch) data.priceSearch = card.priceSearch;
  for (const [name, config] of Object.entries(CUSTOM_FIELDS)) {
    if (config.type === 'checkbox') {
      if (cleared !== name && card[name]) data[name] = true;
    } else {
      data[name] = cleared === name ? '' : (card[name] || '');
    }
  }
  if (card.id) data.id = card.id;
  return { ...data, ...extra };
}

// Every field an edit can clear, with the value the gist holds for it.
const CLEARABLE = {
  price: 25,
  auto: true,
  rc: true,
  patch: true,
  serial: '/99',
  search: 'stored ebay term',
  priceSearch: 'stored price term',
  notes: 'stored notes',
};

describe('clearing a field persists through the merge (flat)', () => {
  for (const [field, stored] of Object.entries(CLEARABLE)) {
    it(`clears ${field} even though the gist copy still has it`, () => {
      const gistCard = { set: 'Prizm', num: '10', variant: 'Silver', [field]: stored };
      const engine = makeFlatEngine([{ ...gistCard }]);

      engine._updateCard(hashId(gistCard), formDataWithCleared(field, gistCard));
      const merged = engine._mergeCardArrays(engine.cards, [gistCard]);

      expect(field in merged[0]).toBe(false);
    });
  }

  it('clears variant when an explicit id keeps the card identity stable', () => {
    // Without an explicit id, clearing variant changes the hashed id and the
    // card has no fresh counterpart. With one, the merge is what has to honor it.
    const gistCard = { id: 'abc123', set: 'Prizm', num: '10', variant: 'Silver' };
    const engine = makeFlatEngine([{ ...gistCard }], (c) => c.id || hashId(c));

    engine._updateCard('abc123', formDataWithCleared('variant', gistCard));
    const merged = engine._mergeCardArrays(engine.cards, [gistCard]);

    expect('variant' in merged[0]).toBe(false);
  });
});

describe('clearing a field persists through the merge (categories)', () => {
  for (const [field, stored] of Object.entries(CLEARABLE)) {
    it(`clears ${field} even though the gist copy still has it`, () => {
      const gistCard = { set: 'Prizm', num: '10', variant: 'Silver', [field]: stored };
      const engine = makeCategoryEngine({ base: [{ ...gistCard }] });

      engine._updateCard(hashId(gistCard), formDataWithCleared(field, gistCard, { category: 'base' }));
      const merged = engine._mergeCardArrays(engine.cards.base, [gistCard]);

      expect(field in merged[0]).toBe(false);
    });
  }
});

describe('clearing still persists with no fresh counterpart', () => {
  it('keeps the cleared price when an id-changing edit misses the fresh map', () => {
    const gistCard = { set: 'Prizm', num: '10', variant: 'Silver', price: 25 };
    const engine = makeFlatEngine([{ ...gistCard }]);

    // Clearing variant changes the hashed id, so nothing in the fresh copy matches
    const form = formDataWithCleared('variant', gistCard);
    delete form.price;
    engine._updateCard(hashId(gistCard), form);
    const merged = engine._mergeCardArrays(engine.cards, [gistCard]);

    expect('price' in merged[0]).toBe(false);
    expect('variant' in merged[0]).toBe(false);
  });
});

describe('fields the edit did not touch survive the merge', () => {
  it('keeps a field added to the gist externally on the edited card', () => {
    // `grade` is not a field the editor knows about, so fresh-as-base must win
    const gistCard = { set: 'Prizm', num: '10', variant: 'Silver', price: 25, grade: 'PSA 10' };
    const engine = makeFlatEngine([{ set: 'Prizm', num: '10', variant: 'Silver', price: 25 }]);

    engine._updateCard(hashId(gistCard), formDataWithCleared('price', gistCard));
    const merged = engine._mergeCardArrays(engine.cards, [gistCard]);

    expect('price' in merged[0]).toBe(false);
    expect(merged[0].grade).toBe('PSA 10');
  });

  it('keeps an externally-added value for a field the local card never had', () => {
    // The form sends price empty because the local copy has no price - that is
    // not the user clearing anything, so the gist's price must survive
    const local = { set: 'Prizm', num: '10', variant: 'Silver' };
    const gistCard = { ...local, price: 25 };
    const engine = makeFlatEngine([{ ...local }]);

    engine._updateCard(hashId(local), formDataWithCleared('price', local));
    const merged = engine._mergeCardArrays(engine.cards, [gistCard]);

    expect(merged[0].price).toBe(25);
  });

  it('leaves cards the user never edited untouched', () => {
    const edited = { set: 'Prizm', num: '10', variant: 'Silver', price: 25 };
    const other = { set: 'Prizm', num: '11', variant: 'Silver', price: 40, notes: 'keep me' };
    const engine = makeFlatEngine([{ ...edited }, { ...other }]);

    engine._updateCard(hashId(edited), formDataWithCleared('price', edited));
    const merged = engine._mergeCardArrays(engine.cards, [edited, other]);

    expect('price' in merged[0]).toBe(false);
    expect(merged[1].price).toBe(40);
    expect(merged[1].notes).toBe('keep me');
  });
});

describe('the cleared-keys marker never reaches the gist', () => {
  afterEach(() => {
    delete globalThis.githubSync;
  });

  const hasMarker = (card) => '_clearedKeys' in card || JSON.stringify(card).includes('_clearedKeys');

  it('is absent from a card merged against a fresh counterpart', () => {
    const gistCard = { set: 'Prizm', num: '10', variant: 'Silver', price: 25 };
    const engine = makeFlatEngine([{ ...gistCard }]);

    engine._updateCard(hashId(gistCard), formDataWithCleared('price', gistCard));
    const merged = engine._mergeCardArrays(engine.cards, [gistCard]);

    expect(hasMarker(merged[0])).toBe(false);
  });

  it('is absent on the no-fresh-counterpart path', () => {
    const gistCard = { set: 'Prizm', num: '10', variant: 'Silver', price: 25 };
    const engine = makeFlatEngine([{ ...gistCard }]);

    engine._updateCard(hashId(gistCard), formDataWithCleared('variant', gistCard));
    const merged = engine._mergeCardArrays(engine.cards, [gistCard]);

    expect(hasMarker(merged[0])).toBe(false);
  });

  it('is not serialized when the fresh-data fetch returns nothing', async () => {
    globalThis.githubSync = {
      loadCardData: async () => null,
      loadPublicCardData: async () => null,
    };
    const card = { set: 'Prizm', num: '10', variant: 'Silver', price: 25 };
    const engine = makeFlatEngine([{ ...card }]);

    engine._updateCard(hashId(card), formDataWithCleared('price', card));
    await engine._mergeWithFreshGistData();

    expect(JSON.stringify(engine.cards).includes('_clearedKeys')).toBe(false);
  });

  it('is not serialized when the fresh-data fetch throws', async () => {
    globalThis.githubSync = {
      loadCardData: async () => { throw new Error('network'); },
      loadPublicCardData: async () => null,
    };
    const card = { set: 'Prizm', num: '10', variant: 'Silver', price: 25 };
    const engine = makeFlatEngine([{ ...card }]);

    engine._updateCard(hashId(card), formDataWithCleared('price', card));
    await engine._mergeWithFreshGistData();

    expect(JSON.stringify(engine.cards).includes('_clearedKeys')).toBe(false);
  });

  it('is not serialized for a category the fresh copy does not have', async () => {
    globalThis.githubSync = {
      loadCardData: async () => ({ categories: {} }),
      loadPublicCardData: async () => null,
    };
    const card = { set: 'Prizm', num: '10', variant: 'Silver', price: 25 };
    const engine = makeCategoryEngine({ base: [{ ...card }] });

    engine._updateCard(hashId(card), formDataWithCleared('price', card, { category: 'base' }));
    await engine._mergeWithFreshGistData();

    expect(JSON.stringify(engine.cards).includes('_clearedKeys')).toBe(false);
  });
});

describe('img and noCard keep their existing markers', () => {
  it('_updateCard stores img as the empty string, not a deletion', () => {
    const card = { set: 'Prizm', num: '10', variant: 'Silver', img: 'https://x/y.webp' };
    const engine = makeFlatEngine([card]);

    engine._updateCard(hashId(card), formDataWithCleared('img', card));

    expect(card.img).toBe('');
  });

  it('a cleared img does not come back from the gist copy', () => {
    const gistCard = { set: 'Prizm', num: '10', variant: 'Silver', img: 'https://x/y.webp' };
    const engine = makeFlatEngine([{ ...gistCard }]);

    engine._updateCard(hashId(gistCard), formDataWithCleared('img', gistCard));
    const merged = engine._mergeCardArrays(engine.cards, [gistCard]);

    expect('img' in merged[0]).toBe(false);
  });

  it('_updateCard keeps noCard: false and the merge strips it', () => {
    const gistCard = { id: 'n1', set: 'Prizm', noCard: true };
    const engine = makeFlatEngine([{ ...gistCard }], (c) => c.id);

    engine._updateCard('n1', { id: 'n1', set: 'Prizm', noCard: false });
    expect(engine.cards[0].noCard).toBe(false);

    const merged = engine._mergeCardArrays(engine.cards, [gistCard]);
    expect('noCard' in merged[0]).toBe(false);
  });
});
