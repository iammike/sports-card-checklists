import { describe, it, expect, beforeEach } from 'vitest';

const CardEditorModal = globalThis.CardEditorModal;
const ChecklistEngine = globalThis.ChecklistEngine;
const ChecklistManager = globalThis.ChecklistManager;
const DynamicNav = globalThis.DynamicNav;

// A collection link card stands in for another checklist instead of describing a
// physical card. Until now it could only be created by hand-editing the gist, so
// these tests drive the real modal - every fixture below is whatever
// CardEditorModal.getFormData() actually produced from real DOM inputs, never a
// cardData object assembled by hand.

// Mirrors washington-qbs, one of the two configs that really carries a collection
// link card: `player` is the top-position field the editor derives an entry name
// from, and each checklist brings its own custom fields.
const CUSTOM_FIELDS = {
  player: { label: 'Player Name', type: 'text', fullWidth: true },
  years: { label: 'Years', type: 'text', position: 'bottom' },
  serial: { label: 'Run', type: 'text', position: 'attributes' },
};

const TARGETS = [
  { value: 'checklist.html?id=jayden-daniels', label: 'Jayden Daniels' },
  { value: 'checklist.html?id=jmu-pro-players', label: 'JMU Pro Players' },
];
const LINK = TARGETS[0].value;

// Real R2 URLs, the shape the production cards store
const IMG_A = 'https://cards-oauth.iammikec.workers.dev/images/jayden-daniels/card_00.webp';
const IMG_B = 'https://cards-oauth.iammikec.workers.dev/images/jayden-daniels/card_03.webp';

function makeEditor(options = {}) {
  return new CardEditorModal({
    customFields: CUSTOM_FIELDS,
    cardTypes: [],
    getLinkTargets: () => TARGETS,
    // Wired so the owned toggle is visible to begin with - without an ownership
    // callback _updateOwnedToggleVisibility hides it anyway and asserting that a
    // link hides it would pass for the wrong reason.
    onOwnedChange: () => {},
    ...options,
  });
}

const field = (editor, selector) => editor.backdrop.querySelector(selector);
const isHidden = (editor, selector) => field(editor, selector).style.display === 'none';

// Pick a checklist to link to the way a user does - the change event is what
// switches the form between the two kinds of card.
function chooseLink(editor, value) {
  const select = field(editor, '#editor-collection-link');
  select.value = value;
  select.dispatchEvent(new window.Event('change'));
}

function typeInto(editor, selector, value) {
  field(editor, selector).value = value;
}

// Fill in the modal exactly as the Jayden Daniels card on washington-qbs is filled
// in, and hand back what getFormData() made of it.
function buildCollectionLinkCard(editor) {
  editor.openNew();
  typeInto(editor, '#editor-player', 'Jayden Daniels');
  chooseLink(editor, LINK);
  typeInto(editor, '#editor-card-count', '40');
  typeInto(editor, '#editor-stack-images', `${IMG_A}\n${IMG_B}`);
  return editor.getFormData();
}

function makeFlatEngine(cards, customFields = CUSTOM_FIELDS) {
  const engine = Object.create(ChecklistEngine.prototype);
  engine.id = 'washington-qbs';
  engine.config = { dataShape: 'flat', customFields, cardDisplay: {} };
  engine.cards = cards;
  engine._renderedCards = [];
  engine._reorderMode = false;
  engine.updateStats = () => {};
  engine.checklistManager = new ChecklistManager({ checklistId: 'washington-qbs' });
  engine.checklistManager.ownedCards = [];
  engine.checklistManager.isReadOnly = false;
  return engine;
}

describe('marking a card as a collection link', () => {
  let editor;
  beforeEach(() => { editor = makeEditor(); });

  it('offers every checklist the caller supplied, plus an opt-out', () => {
    editor.openNew();
    const options = [...editor.backdrop.querySelectorAll('#editor-collection-link option')];

    expect(options.map(o => o.value)).toEqual(['', ...TARGETS.map(t => t.value)]);
    expect(options.map(o => o.textContent)).toEqual([
      'Not a collection link', ...TARGETS.map(t => t.label),
    ]);
  });

  it('puts the chosen checklist on the card', () => {
    editor.openNew();
    typeInto(editor, '#editor-player', 'Jayden Daniels');
    chooseLink(editor, LINK);

    expect(editor.getFormData().collectionLink).toBe(LINK);
  });

  it('emits no collection link fields for an ordinary card', () => {
    editor.openNew();
    typeInto(editor, '#editor-set', '2024 Panini Prizm');
    const data = editor.getFormData();

    expect('collectionLink' in data).toBe(false);
    expect('cardCount' in data).toBe(false);
    expect('stackImages' in data).toBe(false);
  });

  it('hides the dropdown entirely when there is nothing to link to', () => {
    const bare = makeEditor({ getLinkTargets: () => [] });
    bare.openNew();

    expect(isHidden(bare, '#editor-collection-link-field')).toBe(true);
  });

  it('keeps a link the registry no longer offers, rather than resetting the card', () => {
    // The registry may not have loaded, or the link may have been written by hand
    editor.open('clSomeone', { player: 'Someone', collectionLink: 'checklist.html?id=gone' });

    expect(field(editor, '#editor-collection-link').value).toBe('checklist.html?id=gone');
    expect(editor.getFormData().collectionLink).toBe('checklist.html?id=gone');
  });
});

describe('the fields that describe a physical card', () => {
  const PHYSICAL = [
    '#editor-set-field',
    '#editor-num-field',
    '.card-editor-image-section',
    '#editor-header-price',
    '#editor-owned-toggle',
    '#editor-no-card-field',
  ];
  let editor;
  beforeEach(() => { editor = makeEditor(); editor.openNew(); });

  it('are visible for an ordinary card', () => {
    // Guards the test below: it would pass trivially if these started hidden
    expect(PHYSICAL.filter(sel => isHidden(editor, sel))).toEqual([]);
  });

  it('are hidden once a link is chosen', () => {
    chooseLink(editor, LINK);

    expect(PHYSICAL.filter(sel => !isHidden(editor, sel))).toEqual([]);
  });

  it('come back when the link is removed again', () => {
    chooseLink(editor, LINK);
    chooseLink(editor, '');

    expect(PHYSICAL.filter(sel => isHidden(editor, sel))).toEqual([]);
  });

  it('leaves the row they share collapsed, not empty', () => {
    const row = field(editor, '#editor-set-field').closest('.card-editor-row');
    chooseLink(editor, LINK);

    expect(row.style.display).toBe('none');
  });

  it('hides the card type dropdown too, on a checklist that has one', () => {
    const legacy = makeEditor({ cardTypes: ['Base', 'Insert'] });
    legacy.openNew();
    expect(isHidden(legacy, '#editor-type-field')).toBe(false);

    chooseLink(legacy, LINK);

    expect(isHidden(legacy, '#editor-type-field')).toBe(true);
  });

  it('keeps a value the hidden field already held instead of wiping it', () => {
    // A hand-written collection link card can use a plain `img` rather than a
    // stack; opening the editor on it must not delete the image.
    //
    // A repo-relative path rather than an R2 URL: updateImageActions compares
    // against R2_IMAGE_BASE, a top-level const in shared.js that the test setup
    // evaluates into its own lexical scope, so card-editor.js cannot see it here
    // the way it can in the browser. A local path short-circuits that comparison.
    const localImg = 'images/washington-qbs/jayden.webp';
    editor.open('clSomeone', { player: 'Someone', collectionLink: LINK, img: localImg });

    expect(isHidden(editor, '.card-editor-image-section')).toBe(true);
    expect(editor.getFormData().img).toBe(localImg);
  });
});

describe('a price does not survive being linked', () => {
  // The price field is hidden on a linked card, so a price left on one is
  // unreachable without un-linking first - and price-low/price-high sort still
  // reads card.price, so the tile silently moves under those sorts.
  const PRICED = { id: 'clJaydenDaniels', player: 'Jayden Daniels', price: 250 };

  it('is dropped from the form data once a link is chosen', () => {
    const editor = makeEditor();
    editor.open(PRICED.id, { ...PRICED });
    expect(editor.getFormData().price).toBe(250);

    chooseLink(editor, LINK);

    expect('price' in editor.getFormData()).toBe(false);
  });

  it('is deleted from the merged card, not just the local one', () => {
    const engine = makeFlatEngine([{ ...PRICED }]);
    const editor = makeEditor();
    editor.open(PRICED.id, { ...PRICED });
    chooseLink(editor, LINK);

    engine._updateCard(PRICED.id, editor.getFormData());
    const merged = engine._mergeCardArrays(engine.cards, [PRICED]);

    expect('price' in merged[0]).toBe(false);
    expect(merged[0].collectionLink).toBe(LINK);
  });

  it('comes back when the link is removed again', () => {
    // Hidden, not cleared - so un-linking is not a destructive round trip
    const editor = makeEditor();
    editor.open(PRICED.id, { ...PRICED });
    chooseLink(editor, LINK);
    chooseLink(editor, '');

    expect(editor.getFormData().price).toBe(250);
  });
});

describe('the advanced search overrides', () => {
  // A collection link tile renders neither an eBay nor a price search link
  const SEARCHY = { id: 'clJaydenDaniels', player: 'Jayden Daniels', search: 'custom ebay term' };

  it('are visible on an ordinary card with a stored term', () => {
    const editor = makeEditor();
    editor.open(SEARCHY.id, { ...SEARCHY });

    expect(isHidden(editor, '.card-editor-advanced-toggle')).toBe(false);
    expect(field(editor, '.card-editor-advanced-fields').style.display).toBe('flex');
  });

  it('are hidden once a link is chosen', () => {
    const editor = makeEditor();
    editor.open(SEARCHY.id, { ...SEARCHY });
    chooseLink(editor, LINK);

    expect(isHidden(editor, '.card-editor-advanced-toggle')).toBe(true);
    expect(isHidden(editor, '.card-editor-advanced-fields')).toBe(true);
  });

  it('are restored, still expanded, when the link is removed again', () => {
    const editor = makeEditor();
    editor.open(SEARCHY.id, { ...SEARCHY });
    chooseLink(editor, LINK);
    chooseLink(editor, '');

    expect(isHidden(editor, '.card-editor-advanced-toggle')).toBe(false);
    expect(field(editor, '.card-editor-advanced-fields').style.display).toBe('flex');
  });

  it('stay collapsed on a card that never had a term', () => {
    const editor = makeEditor();
    editor.openNew();
    chooseLink(editor, LINK);
    chooseLink(editor, '');

    expect(isHidden(editor, '.card-editor-advanced-toggle')).toBe(false);
    expect(isHidden(editor, '.card-editor-advanced-fields')).toBe(true);
    expect(field(editor, '#editor-toggle-advanced').textContent).toBe('Advanced');
  });
});

describe('the fields that only a collection link card has', () => {
  let editor;
  beforeEach(() => { editor = makeEditor(); editor.openNew(); });

  it('are hidden until a link is chosen', () => {
    expect(isHidden(editor, '#editor-stack-images-field')).toBe(true);
    expect(isHidden(editor, '#editor-card-count-field')).toBe(true);
  });

  it('appear once a link is chosen', () => {
    chooseLink(editor, LINK);

    expect(isHidden(editor, '#editor-stack-images-field')).toBe(false);
    expect(isHidden(editor, '#editor-card-count-field')).toBe(false);
  });
});

describe('a collection link and "no card exists" are alternatives', () => {
  let editor;
  beforeEach(() => { editor = makeEditor(); editor.openNew(); });

  const tickNoCard = () => {
    const box = field(editor, '#editor-no-card');
    box.checked = true;
    box.dispatchEvent(new window.Event('change'));
  };

  it('hides the link dropdown when the entry is flagged as having no card', () => {
    tickNoCard();

    expect(isHidden(editor, '#editor-collection-link-field')).toBe(true);
  });

  it('drops the link from the form data, matching how the card renders', () => {
    // createCardElement routes a card with both to the no-card branch, so the
    // link would otherwise be stored and never used.
    chooseLink(editor, LINK);
    tickNoCard();

    expect('collectionLink' in editor.getFormData()).toBe(false);
  });
});

describe('stack images', () => {
  let editor;
  beforeEach(() => { editor = makeEditor(); editor.openNew(); chooseLink(editor, LINK); });

  it('stores one entry per line', () => {
    typeInto(editor, '#editor-stack-images', `${IMG_A}\n${IMG_B}`);

    expect(editor.getFormData().stackImages).toEqual([IMG_A, IMG_B]);
  });

  it('stores nothing at all when the box is empty', () => {
    // [''] renders a broken image in the stack, and [] is truthy so it would
    // never be recognized as a cleared field
    expect('stackImages' in editor.getFormData()).toBe(false);
  });

  it('stores nothing when the box holds only blank lines', () => {
    typeInto(editor, '#editor-stack-images', '\n   \n\n');

    expect('stackImages' in editor.getFormData()).toBe(false);
  });

  it('drops blank and padded lines between real URLs', () => {
    typeInto(editor, '#editor-stack-images', `\n  ${IMG_A}  \n\n${IMG_B}\n`);

    expect(editor.getFormData().stackImages).toEqual([IMG_A, IMG_B]);
  });
});

describe('card count', () => {
  let editor;
  beforeEach(() => { editor = makeEditor(); editor.openNew(); chooseLink(editor, LINK); });

  it('is stored as a number, the way the badge renders it', () => {
    typeInto(editor, '#editor-card-count', '40');

    expect(editor.getFormData().cardCount).toBe(40);
  });

  it('is omitted when left blank', () => {
    expect('cardCount' in editor.getFormData()).toBe(false);
  });
});

describe('saving and reopening a collection link card', () => {
  it('hands the engine a card the renderer can already use', async () => {
    let saved = null;
    const editor = makeEditor({ onSave: (id, data) => { saved = data; } });
    buildCollectionLinkCard(editor);

    await editor.save();

    expect(saved).toMatchObject({
      player: 'Jayden Daniels',
      collectionLink: LINK,
      cardCount: 40,
      stackImages: [IMG_A, IMG_B],
    });
  });

  it('round-trips every collection link field back into the form', async () => {
    let saved = null;
    const editor = makeEditor({ onSave: (id, data) => { saved = data; } });
    buildCollectionLinkCard(editor);
    await editor.save();

    editor.open(saved.id, saved);

    expect(field(editor, '#editor-collection-link').value).toBe(LINK);
    expect(field(editor, '#editor-card-count').value).toBe('40');
    expect(field(editor, '#editor-stack-images').value).toBe(`${IMG_A}\n${IMG_B}`);
    expect(isHidden(editor, '#editor-set-field')).toBe(true);
  });

  it('survives a save-reopen-save cycle unchanged', async () => {
    let saved = null;
    const editor = makeEditor({ onSave: (id, data) => { saved = data; } });
    buildCollectionLinkCard(editor);
    await editor.save();
    const first = saved;

    editor.open(first.id, first);
    await editor.save();

    expect(saved).toEqual(first);
  });

  it('saves even on a checklist with no player field to fall back on', async () => {
    // validate() otherwise demands a set name, and the set name field is hidden
    let saved = null;
    const editor = makeEditor({
      customFields: {},
      onSave: (id, data) => { saved = data; },
    });
    editor.openNew();
    chooseLink(editor, LINK);

    await editor.save();

    expect(saved?.collectionLink).toBe(LINK);
  });
});

describe('collection link card identity', () => {
  it('gives a new card an explicit id, since it has nothing to hash', async () => {
    let saved = null;
    const editor = makeEditor({ onSave: (id, data) => { saved = data; } });
    buildCollectionLinkCard(editor);
    await editor.save();

    expect(saved.id).toBe('clJaydenDaniels');
  });

  it('falls back to the linked checklist id when the card has no name', async () => {
    let saved = null;
    const editor = makeEditor({ customFields: {}, onSave: (id, data) => { saved = data; } });
    editor.openNew();
    chooseLink(editor, LINK);
    await editor.save();

    expect(saved.id).toBe('cljaydendaniels');
  });

  it('does not reuse an id already taken', async () => {
    let saved = null;
    const editor = makeEditor({
      getExistingIds: () => ['clJaydenDaniels'],
      onSave: (id, data) => { saved = data; },
    });
    buildCollectionLinkCard(editor);
    await editor.save();

    expect(saved.id).toBe('clJaydenDaniels2');
  });

  it('keeps the id it was given rather than regenerating on a rename', () => {
    const editor = makeEditor();
    editor.open('clJaydenDaniels', { id: 'clJaydenDaniels', player: 'Jayden Daniels', collectionLink: LINK });
    typeInto(editor, '#editor-player', 'Jayden Daniels Jr');

    expect(editor.getFormData().id).toBe('clJaydenDaniels');
  });

  it('backfills an id onto a card that was added by hand-editing the gist', () => {
    const engine = makeFlatEngine([
      { player: 'Jayden Daniels', collectionLink: LINK, cardCount: 40 },
      { player: 'Sam Howell', collectionLink: 'checklist.html?id=busts', cardCount: 4 },
    ]);

    engine._backfillSyntheticIds();

    expect(engine.cards.map(c => c.id)).toEqual(['clJaydenDaniels', 'clSamHowell']);
  });

  it('lets edit target the card the user picked, not the first collection link', () => {
    // Without an explicit id both cards hash to the empty string and
    // _findCardWithLocation always returns the first one.
    const engine = makeFlatEngine([
      { player: 'Jayden Daniels', collectionLink: LINK },
      { player: 'Sam Howell', collectionLink: 'checklist.html?id=busts' },
    ]);
    engine._backfillSyntheticIds();

    const found = engine._findCardWithLocation(engine.cards[1].id);

    expect(found?.card.player).toBe('Sam Howell');
    expect(found?.index).toBe(1);
  });

  it('renders the id the context menu reads, so Edit can find the card', () => {
    document.body.innerHTML = '<div id="sections-container"></div>';
    const engine = makeFlatEngine([{ player: 'Jayden Daniels', collectionLink: LINK }]);
    engine._backfillSyntheticIds();
    engine.renderCards();

    const el = document.querySelector('.card.collection-link');
    expect(el.dataset.cardId).toBe('clJaydenDaniels');
    expect(engine._findCardWithLocation(el.dataset.cardId)?.card.player).toBe('Jayden Daniels');
  });
});

describe('clearing a collection link', () => {
  // The gist copy is the merge base, so a field simply dropped from the local
  // card comes straight back - the clear has to be recorded. See #686.
  const gistShape = () => ({
    id: 'clJaydenDaniels',
    player: 'Jayden Daniels',
    collectionLink: LINK,
    cardCount: 40,
    stackImages: [IMG_A, IMG_B],
  });

  function clearLinkAndSave(engine, gistCard, fill = () => {}) {
    const editor = makeEditor();
    editor.open(gistCard.id, { ...gistCard });
    chooseLink(editor, '');
    fill(editor);
    engine._updateCard(gistCard.id, editor.getFormData());
    return engine._mergeCardArrays(engine.cards, [gistCard]);
  }

  it('deletes the link, count and stack from the merged card', () => {
    const gistCard = gistShape();
    const engine = makeFlatEngine([{ ...gistCard }]);

    const merged = clearLinkAndSave(engine, gistCard, (editor) => {
      typeInto(editor, '#editor-set', '2024 Panini Prizm');
    });

    expect('collectionLink' in merged[0]).toBe(false);
    expect('cardCount' in merged[0]).toBe(false);
    expect('stackImages' in merged[0]).toBe(false);
    expect(merged[0].set).toBe('2024 Panini Prizm');
  });

  it('keeps the card itself, and the fields the edit did not touch', () => {
    const gistCard = { ...gistShape(), years: '2024-2025' };
    const engine = makeFlatEngine([{ ...gistCard }]);

    const merged = clearLinkAndSave(engine, gistCard, (editor) => {
      typeInto(editor, '#editor-set', '2024 Panini Prizm');
    });

    expect(merged).toHaveLength(1);
    expect(merged[0].player).toBe('Jayden Daniels');
    expect(merged[0].years).toBe('2024-2025');
  });

  it('clears only the stack when the link itself is kept', () => {
    const gistCard = gistShape();
    const engine = makeFlatEngine([{ ...gistCard }]);
    const editor = makeEditor();
    editor.open(gistCard.id, { ...gistCard });
    typeInto(editor, '#editor-stack-images', '');

    engine._updateCard(gistCard.id, editor.getFormData());
    const merged = engine._mergeCardArrays(engine.cards, [gistCard]);

    expect('stackImages' in merged[0]).toBe(false);
    expect(merged[0].collectionLink).toBe(LINK);
    expect(merged[0].cardCount).toBe(40);
  });

  it('does not touch a collection link on a card the user never edited', () => {
    const edited = { id: 'ncOther', player: 'Other', noCard: true };
    const linked = gistShape();
    const engine = makeFlatEngine([{ ...edited }, { ...linked }]);
    const editor = makeEditor();
    editor.open('ncOther', { ...edited });
    typeInto(editor, '#editor-player', 'Other Renamed');

    engine._updateCard('ncOther', editor.getFormData());
    const merged = engine._mergeCardArrays(engine.cards, [edited, linked]);

    expect(merged[1].collectionLink).toBe(LINK);
    expect(merged[1].stackImages).toEqual([IMG_A, IMG_B]);
  });
});

describe('the checklists offered to link to', () => {
  const REGISTRY = {
    checklists: [
      { id: 'washington-qbs', type: 'dynamic', title: 'Washington QBs' },
      { id: 'jayden-daniels', type: 'dynamic', title: 'Jayden Daniels' },
      { id: 'secret', type: 'dynamic', title: 'Secret', hidden: true },
      { id: 'old', type: 'legacy', title: 'Old', href: 'old.html' },
    ],
  };

  beforeEach(() => {
    DynamicNav._registry = REGISTRY;
  });

  it('excludes hidden and legacy entries', () => {
    expect(DynamicNav.listChecklists().map(e => e.id)).toEqual(['jayden-daniels', 'washington-qbs']);
  });

  it('never offers the checklist being edited', () => {
    const engine = makeFlatEngine([]);
    engine._getAllCardsFlat = () => [];
    engine._initCardEditor();

    expect(engine.cardEditor.getLinkTargets()).toEqual([
      { value: 'checklist.html?id=jayden-daniels', label: 'Jayden Daniels' },
    ]);
  });
});
