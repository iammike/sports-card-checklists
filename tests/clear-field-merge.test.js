import { describe, it, expect, afterEach } from 'vitest';

const ChecklistEngine = globalThis.ChecklistEngine;

// Mirrors a real config (jmu-pro-players): auto/patch are checkbox custom fields,
// serial/variant/achievement are text custom fields. `rc` is deliberately absent -
// no checklist in production declares it, and the editor never renders it.
const CUSTOM_FIELDS = {
  auto: { type: 'checkbox' },
  patch: { type: 'checkbox' },
  serial: { type: 'text' },
  variant: { type: 'text' },
  achievement: { type: 'text' },
};

// Identity from set+num+variant, like ChecklistManager.getCardId
const hashId = (c) => (c.set || '') + (c.num || '') + (c.variant || '');

function makeFlatEngine(cards, getCardId = hashId, customFields = CUSTOM_FIELDS) {
  const engine = Object.create(ChecklistEngine.prototype);
  engine.id = 'test';
  engine.config = { dataShape: 'flat', customFields };
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

// Build the object _updateCard actually receives for `card` with only `cleared`
// emptied - that is CardEditorModal.getFormData() as post-processed by save().
// img, noCard and text fields are always sent (empty when blank); checkboxes,
// price and priceSearch are omitted entirely when unset.
// `search` is the one field whose form key differs from its storage key: the
// input is #editor-ebay and getFormData emits `ebay`, but save() renames it to
// `search` and deletes `ebay` before calling onSave, so `ebay` never gets here.
// A flagged entry never sends a price, even a stale one still sitting in the
// disabled input - see the `!noCardChecked` guard in getFormData.
// `customFields` must be the config the engine was built with: getFormData can
// only send a field the editor rendered, so a field this config doesn't declare
// is absent from the submission no matter what the card holds.
// Only `checkbox` and text-like fields are modelled, which is all any config here
// declares. getCustomFieldData sends `[]` for an empty parseArray field and always
// sends el.value for a select, so extend the else branch before using either.
function formDataWithCleared(cleared, card, extra = {}, customFields = CUSTOM_FIELDS) {
  const noCard = 'noCard' in extra ? !!extra.noCard : !!card.noCard;
  const data = { set: card.set, num: card.num, type: '' };
  data.img = cleared === 'img' ? '' : (card.img || '');
  data.noCard = noCard;
  if (cleared !== 'price' && card.price && !noCard) data.price = card.price;
  if (cleared !== 'search' && card.search) data.search = card.search;
  if (cleared !== 'priceSearch' && card.priceSearch) data.priceSearch = card.priceSearch;
  for (const [name, config] of Object.entries(customFields)) {
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
  patch: true,
  serial: '/99',
  search: 'stored ebay term',
  priceSearch: 'stored price term',
  achievement: 'stored achievement',
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

  it('keeps a stored search term through an unrelated edit', () => {
    // search is the only ENGINE_BUILTIN_CLEARABLE field whose form key differs
    // from its storage key, so it is the one most likely to be mis-modelled: a
    // fixture that sends `ebay` instead of `search` reports this as destroyed.
    const gistCard = {
      set: 'Prizm', num: '10', variant: 'Silver', price: 25, search: 'my custom term',
    };
    const engine = makeFlatEngine([{ ...gistCard }]);

    engine._updateCard(hashId(gistCard), formDataWithCleared('price', gistCard));
    const merged = engine._mergeCardArrays(engine.cards, [gistCard]);

    expect('price' in merged[0]).toBe(false);
    expect(merged[0].search).toBe('my custom term');
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
    const other = { set: 'Prizm', num: '11', variant: 'Silver', price: 40, achievement: 'keep me' };
    const engine = makeFlatEngine([{ ...edited }, { ...other }]);

    engine._updateCard(hashId(edited), formDataWithCleared('price', edited));
    const merged = engine._mergeCardArrays(engine.cards, [edited, other]);

    expect('price' in merged[0]).toBe(false);
    expect(merged[1].price).toBe(40);
    expect(merged[1].achievement).toBe('keep me');
  });
});

// An empty form field means "cleared" only for a field the editor renders. These
// fields are never in the form data at all, so treating their absence as a clear
// would delete real data from the gist on an unrelated edit.
describe('fields this checklist does not manage are never deleted', () => {
  it('keeps rc, which no config declares and the editor never renders', () => {
    // 31 production cards on jmu-pro-players carry rc: true
    const gistCard = { set: 'Prizm', num: '10', variant: 'Silver', rc: true, price: 25 };
    const engine = makeFlatEngine([{ ...gistCard }]);

    engine._updateCard(hashId(gistCard), formDataWithCleared('price', gistCard));
    const merged = engine._mergeCardArrays(engine.cards, [gistCard]);

    expect('price' in merged[0]).toBe(false);
    expect(merged[0].rc).toBe(true);
  });

  it('keeps serial when this config has no serial field', () => {
    // The `busts` config shape: player, claim-to-fame and variant, but no serial
    const customFields = {
      player: { type: 'text' }, 'claim-to-fame': { type: 'text' }, variant: { type: 'text' },
    };
    const gistCard = { set: 'Prizm', num: '10', variant: 'Silver', serial: '/99', price: 25 };
    const engine = makeFlatEngine([{ ...gistCard }], hashId, customFields);

    engine._updateCard(hashId(gistCard), formDataWithCleared('price', gistCard, {}, customFields));
    const merged = engine._mergeCardArrays(engine.cards, [gistCard]);

    expect(merged[0].serial).toBe('/99');
  });

  it('keeps auto and patch when this config declares neither', () => {
    const customFields = { player: { type: 'text' }, variant: { type: 'text' } };
    const gistCard = { set: 'Prizm', num: '10', variant: 'Silver', auto: true, patch: true, price: 25 };
    const engine = makeFlatEngine([{ ...gistCard }], hashId, customFields);

    engine._updateCard(hashId(gistCard), formDataWithCleared('price', gistCard, {}, customFields));
    const merged = engine._mergeCardArrays(engine.cards, [gistCard]);

    expect(merged[0].auto).toBe(true);
    expect(merged[0].patch).toBe(true);
  });

  it('keeps variant when this config has no variant field', () => {
    // The `washington-qbs` config shape: serial but no variant
    const customFields = { player: { type: 'text' }, serial: { type: 'text' } };
    const gistCard = { id: 'abc123', set: 'Prizm', num: '10', variant: 'Silver', price: 25 };
    const engine = makeFlatEngine([{ ...gistCard }], (c) => c.id || hashId(c), customFields);

    engine._updateCard('abc123', formDataWithCleared('price', gistCard, {}, customFields));
    const merged = engine._mergeCardArrays(engine.cards, [gistCard]);

    expect(merged[0].variant).toBe('Silver');
  });

  it('still deletes them from the local card, as before the fix', () => {
    // Only the recording is gated - the in-session delete is unchanged
    const customFields = { player: { type: 'text' } };
    const card = { set: 'Prizm', num: '10', rc: true, serial: '/99' };
    const engine = makeFlatEngine([card], hashId, customFields);

    engine._updateCard(hashId(card), formDataWithCleared('price', card, {}, customFields));

    expect('rc' in card).toBe(false);
    expect('serial' in card).toBe(false);
  });
});

describe('the marker survives a failed merge', () => {
  afterEach(() => {
    delete globalThis.githubSync;
  });

  it('still clears the field on the next successful merge', async () => {
    // Only a successful merge resets the marker. If it is dropped when the fetch
    // fails, the field is already off the card, the next edit has nothing to
    // record, and the following merge hands the gist's old value back.
    globalThis.githubSync = {
      loadCardData: async () => null,
      loadPublicCardData: async () => null,
    };
    const gistCard = { set: 'Prizm', num: '10', variant: 'Silver', price: 25 };
    const engine = makeFlatEngine([{ ...gistCard }]);

    engine._updateCard(hashId(gistCard), formDataWithCleared('price', gistCard));
    await engine._mergeWithFreshGistData();

    // A second, unrelated edit - the card no longer has a price to clear
    engine._updateCard(hashId(gistCard), formDataWithCleared('price', engine.cards[0]));
    const merged = engine._mergeCardArrays(engine.cards, [gistCard]);

    expect('price' in merged[0]).toBe(false);
  });

  it('drops a carried key once a later edit sets the field again', () => {
    const gistCard = { set: 'Prizm', num: '10', variant: 'Silver', price: 25 };
    const engine = makeFlatEngine([{ ...gistCard }]);

    engine._updateCard(hashId(gistCard), formDataWithCleared('price', gistCard));
    // No merge ran; now the user types a new price
    engine._updateCard(hashId(gistCard), { ...formDataWithCleared(null, gistCard), price: 40 });
    const merged = engine._mergeCardArrays(engine.cards, [gistCard]);

    expect(merged[0].price).toBe(40);
  });
});

describe('a hand-edited gist card cannot break the merge', () => {
  it('ignores a non-array _clearedKeys instead of throwing', () => {
    // Throwing here would abort _mergeCardArrays for the whole checklist
    const local = { set: 'Prizm', num: '10', variant: 'Silver', _clearedKeys: 'price' };
    const engine = makeFlatEngine([local]);

    const merged = engine._mergeCardArrays([local], [{ set: 'Prizm', num: '10', variant: 'Silver', price: 25 }]);

    expect(merged[0].price).toBe(25);
  });

  it('strips an enumerable _clearedKeys instead of writing it back to the gist', () => {
    // The key is ours, so it is dropped whatever shape it arrived in
    const local = { set: 'Prizm', num: '10', variant: 'Silver', _clearedKeys: 'price' };
    const engine = makeFlatEngine([local]);

    const merged = engine._mergeCardArrays([local], [{ set: 'Prizm', num: '10', variant: 'Silver' }]);

    expect(JSON.stringify(merged[0]).includes('_clearedKeys')).toBe(false);
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
    const gistCard = { id: 'n1', set: 'Prizm', num: '10', noCard: true };
    const engine = makeFlatEngine([{ ...gistCard }], (c) => c.id);

    engine._updateCard('n1', formDataWithCleared(null, gistCard, { noCard: false }));
    expect(engine.cards[0].noCard).toBe(false);

    const merged = engine._mergeCardArrays(engine.cards, [gistCard]);
    expect('noCard' in merged[0]).toBe(false);
  });
});

describe('flagging an entry as no-card clears its price for real', () => {
  it('drops a stored price from the merged card', () => {
    // getFormData omits price entirely once "No card exists" is ticked, so the
    // clear-tracking now makes the deletion stick. Before this fix the merge kept
    // handing the price back, so "no card, no price" was never true end to end -
    // even though _applyNoCardState's confirm dialog promises exactly that.
    const gistCard = { id: 'n1', set: 'Prizm', num: '10', price: 25 };
    const engine = makeFlatEngine([{ ...gistCard }], (c) => c.id);

    engine._updateCard('n1', formDataWithCleared(null, gistCard, { noCard: true }));
    const merged = engine._mergeCardArrays(engine.cards, [gistCard]);

    expect('price' in merged[0]).toBe(false);
    expect(merged[0].noCard).toBe(true);
  });
});
