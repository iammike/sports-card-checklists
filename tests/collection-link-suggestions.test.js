import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const CardEditorModal = globalThis.CardEditorModal;
const ChecklistEngine = globalThis.ChecklistEngine;

// A collection link card's tile shows a stack of images that belong to the
// checklist it points at rather than to the card itself. They were typed by hand.
// These tests cover the editor offering them from the linked checklist, and the
// engine side that answers the question.
//
// Nothing here touches the network: the editor is handed a suggestion callback,
// and the engine is handed a stubbed githubSync. Every card fixture below - both
// the card being edited and the cards of the checklist it links to - is whatever
// CardEditorModal.getFormData() really produced from filled-in DOM inputs.

const CUSTOM_FIELDS = {
  player: { label: 'Player Name', type: 'text', fullWidth: true },
};

const TARGETS = [
  { value: 'checklist.html?id=jayden-daniels', label: 'Jayden Daniels' },
  { value: 'checklist.html?id=jmu-pro-players', label: 'JMU Pro Players' },
];
const LINK = TARGETS[0].value;
const OTHER_LINK = TARGETS[1].value;

// Real R2 URLs, the shape the production cards store
const R2 = 'https://cards-oauth.iammikec.workers.dev/images';
const IMG_A = `${R2}/jayden-daniels/card_00.webp`;
const IMG_B = `${R2}/jayden-daniels/card_03.webp`;
const IMG_C = `${R2}/jayden-daniels/card_07.webp`;
const IMG_D = `${R2}/jayden-daniels/card_11.webp`;

const SUGGEST_LABEL = 'Suggest from checklist';

function makeEditor(options = {}) {
  return new CardEditorModal({
    customFields: CUSTOM_FIELDS,
    cardTypes: [],
    getLinkTargets: () => TARGETS,
    onOwnedChange: () => {},
    ...options,
  });
}

const field = (editor, selector) => editor.backdrop.querySelector(selector);
const valueOf = (editor, selector) => field(editor, selector).value;

function chooseLink(editor, value) {
  const select = field(editor, '#editor-collection-link');
  select.value = value;
  select.dispatchEvent(new window.Event('change'));
}

function typeInto(editor, selector, value) {
  field(editor, selector).value = value;
}

function pressSuggest(editor) {
  return field(editor, '#editor-suggest-stack').click();
}

// The suggestion fetch is deliberately not awaited by the button handler, so let
// its microtasks drain before asserting.
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// An editor whose linked checklist always answers with the same suggestion
function editorAnswering(suggestion, options = {}) {
  const getLinkSuggestions = vi.fn(async () => suggestion);
  return { editor: makeEditor({ getLinkSuggestions, ...options }), getLinkSuggestions };
}

// A collection link card as the editor really produces one, for reopening
function savedLinkCard({ stackImages } = {}) {
  const editor = makeEditor();
  editor.openNew();
  typeInto(editor, '#editor-player', 'Jayden Daniels');
  chooseLink(editor, LINK);
  if (stackImages) typeInto(editor, '#editor-stack-images', stackImages.join('\n'));
  return editor.getFormData();
}

describe('suggesting stack images', () => {
  it('fills the box from the linked checklist when the button is pressed', async () => {
    const { editor } = editorAnswering({ stackImages: [IMG_A, IMG_B, IMG_C] });
    editor.openNew();
    chooseLink(editor, LINK);
    await flush();
    expect(valueOf(editor, '#editor-stack-images')).toBe('');

    pressSuggest(editor);
    await flush();

    expect(valueOf(editor, '#editor-stack-images')).toBe([IMG_A, IMG_B, IMG_C].join('\n'));
    expect(editor.getFormData().stackImages).toEqual([IMG_A, IMG_B, IMG_C]);
  });

  it('marks the form dirty, so a suggestion the user asked for gets saved', async () => {
    const { editor } = editorAnswering({ stackImages: [IMG_A] });
    const stored = savedLinkCard();
    editor.open(stored.id, stored);
    await flush();
    expect(editor.isDirty).toBe(false);

    pressSuggest(editor);
    await flush();

    expect(editor.isDirty).toBe(true);
  });

  it('leaves a hand-picked stack alone until the button is pressed', async () => {
    // Three chosen images are a curation, not a derived value: nothing replaces
    // them but the button - not opening the card, and not pointing it at a
    // different checklist, neither of which asks the linked checklist anything
    const stored = savedLinkCard({ stackImages: [IMG_A, IMG_B] });
    const { editor, getLinkSuggestions } = editorAnswering({ stackImages: [IMG_C, IMG_D] });

    editor.open(stored.id, stored);
    chooseLink(editor, OTHER_LINK);
    await flush();

    expect(getLinkSuggestions).not.toHaveBeenCalled();
    expect(editor.getFormData().stackImages).toEqual([IMG_A, IMG_B]);
  });

  it('replaces a hand-picked stack once the button is pressed', async () => {
    const stored = savedLinkCard({ stackImages: [IMG_A, IMG_B] });
    const { editor } = editorAnswering({ stackImages: [IMG_C, IMG_D] });

    editor.open(stored.id, stored);
    pressSuggest(editor);
    await flush();

    expect(editor.getFormData().stackImages).toEqual([IMG_C, IMG_D]);
  });

  it('says so when the linked checklist has no images to offer', async () => {
    const { editor } = editorAnswering({ stackImages: [] });
    editor.openNew();
    chooseLink(editor, LINK);
    await flush();

    pressSuggest(editor);
    await flush();

    expect(field(editor, '#editor-suggest-stack').textContent).toBe('No images found');
    expect(valueOf(editor, '#editor-stack-images')).toBe('');
    expect(editor.isDirty).toBe(true); // from choosing the link, not from the press
  });

  it('says so when the linked checklist cannot be read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stored = savedLinkCard({ stackImages: [IMG_A] });
    const editor = makeEditor({
      getLinkSuggestions: async () => { throw new Error('gist unreachable'); },
    });

    editor.open(stored.id, stored);
    pressSuggest(editor);
    await flush();

    expect(field(editor, '#editor-suggest-stack').textContent).toBe('Could not load');
    expect(editor.getFormData().stackImages).toEqual([IMG_A]);
    warn.mockRestore();
  });

  it('re-enables the button whatever the answer was', async () => {
    const { editor } = editorAnswering({ stackImages: [IMG_A] });
    editor.openNew();
    chooseLink(editor, LINK);
    await flush();

    pressSuggest(editor);
    expect(field(editor, '#editor-suggest-stack').disabled).toBe(true);
    await flush();

    expect(field(editor, '#editor-suggest-stack').disabled).toBe(false);
    expect(field(editor, '#editor-suggest-stack').textContent).toBe(SUGGEST_LABEL);
  });

  it('drops images that arrive after the card is pointed somewhere else', async () => {
    const pending = deferred();
    const editor = makeEditor({ getLinkSuggestions: () => pending.promise });

    editor.openNew();
    chooseLink(editor, LINK);
    pressSuggest(editor);
    // The user changes their mind while the images are still on their way
    chooseLink(editor, OTHER_LINK);
    pending.resolve({ stackImages: [IMG_A, IMG_B] });
    await flush();

    expect(valueOf(editor, '#editor-stack-images')).toBe('');
    // Someone else's request now, so the button says nothing about its outcome
    expect(field(editor, '#editor-suggest-stack').disabled).toBe(false);
    expect(field(editor, '#editor-suggest-stack').textContent).toBe(SUGGEST_LABEL);
  });

  it('drops images meant for a card the editor has since moved off', async () => {
    // Both cards happen to store the same stack, so the box looks untouched -
    // only knowing which card the answer was for keeps it off the second one
    const first = savedLinkCard({ stackImages: [IMG_A] });
    const second = savedLinkCard({ stackImages: [IMG_A] });
    const pending = deferred();
    const editor = makeEditor({ getLinkSuggestions: () => pending.promise });

    editor.open(first.id, first);
    pressSuggest(editor);
    // Reopening rebuilds the modal - the answer in flight is about the old form
    editor.open(second.id, second);
    pending.resolve({ stackImages: [IMG_C, IMG_D] });
    await flush();

    expect(editor.getFormData().stackImages).toEqual([IMG_A]);
  });

  it('asks nothing at all when the card links nowhere', async () => {
    const { editor, getLinkSuggestions } = editorAnswering({ stackImages: [IMG_A] });
    editor.openNew();

    pressSuggest(editor);
    await flush();

    expect(getLinkSuggestions).not.toHaveBeenCalled();
    expect(valueOf(editor, '#editor-stack-images')).toBe('');
    // Nothing was attempted, so the button reports neither success nor failure.
    // It said "Could not load" before, which was a lie about a fetch that never
    // happened - only ever visible to a test, since the UI hides the field.
    expect(field(editor, '#editor-suggest-stack').textContent).toBe(SUGGEST_LABEL);
    expect(field(editor, '#editor-suggest-stack').disabled).toBe(false);
  });
});

// What the checklist page answers with when the editor asks. The images come out
// of the gist, so githubSync is stubbed - no test here reaches the network. The
// stats readers are stubbed too, purely so the tests below can assert nothing
// consults them: the answer is drawn from the linked checklist's cards alone.
describe('what the linked checklist reports about itself', () => {
  let engine;
  let sync;

  // Cards of the linked checklist, as its own editor really produced them
  function linkedCard({ set, img = '', noCard = false, link = null }) {
    const editor = makeEditor();
    editor.openNew();
    typeInto(editor, '#editor-player', set);
    typeInto(editor, '#editor-set', set);
    typeInto(editor, '#editor-img', img);
    if (noCard) {
      const box = field(editor, '#editor-no-card');
      box.checked = true;
      box.dispatchEvent(new window.Event('change'));
    }
    if (link) chooseLink(editor, link);
    return editor.getFormData();
  }

  beforeEach(() => {
    engine = Object.create(ChecklistEngine.prototype);
    sync = {
      isLoggedIn: () => true,
      loadAllStats: vi.fn(async () => ({ 'jayden-daniels': { owned: 12, total: 43 } })),
      loadPublicStats: vi.fn(async () => ({ 'jayden-daniels': { owned: 9, total: 40 } })),
      loadCardData: vi.fn(async () => ({ cards: [] })),
      loadPublicCardData: vi.fn(async () => ({ cards: [] })),
    };
    window.githubSync = sync;
  });

  afterEach(() => {
    delete window.githubSync;
    document.body.innerHTML = '';
  });

  it('offers images and nothing else', async () => {
    sync.loadCardData = vi.fn(async () => ({ cards: [linkedCard({ set: 'One', img: IMG_A })] }));

    const suggestion = await engine._loadLinkSuggestions(LINK);

    expect(suggestion).toEqual({ stackImages: [IMG_A] });
    // No count is offered, so the saved stats are never read for one
    expect(sync.loadAllStats).not.toHaveBeenCalled();
    expect(sync.loadPublicStats).not.toHaveBeenCalled();
  });

  it('reports nothing at all for a link with no checklist id in it', async () => {
    expect(await engine._loadLinkSuggestions('index.html')).toBeNull();
    expect(sync.loadCardData).not.toHaveBeenCalled();
    expect(sync.loadPublicCardData).not.toHaveBeenCalled();
  });

  it('reports nothing at all when the sync module was never loaded', async () => {
    // Not hypothetical: every githubSync call in _loadLinkSuggestions is a bare
    // reference, so without a guard this is a ReferenceError rather than a quiet
    // undefined. setup.js does load github-sync.js (#719), so the delete below is
    // what makes the module genuinely absent - the assertion after it is the proof,
    // and nothing here is stubbed to merely look absent.
    delete window.githubSync;
    expect(typeof globalThis.githubSync).toBe('undefined');

    expect(await engine._loadLinkSuggestions(LINK)).toBeNull();
  });

  it('offers the first three cards that have an image', async () => {
    const cards = [
      linkedCard({ set: 'One', img: IMG_A }),
      linkedCard({ set: 'Two', img: IMG_B }),
      linkedCard({ set: 'Three', img: IMG_C }),
      linkedCard({ set: 'Four', img: IMG_D }),
    ];
    sync.loadCardData = vi.fn(async () => ({ cards }));

    const suggestion = await engine._loadLinkSuggestions(LINK);

    // Three, because that is how many the card stack lays out
    expect(suggestion.stackImages).toHaveLength(3);
    expect(suggestion.stackImages).toEqual([IMG_A, IMG_B, IMG_C]);
  });

  it('reads a categorized checklist as readily as a flat one', async () => {
    sync.loadCardData = vi.fn(async () => ({
      categories: {
        rookies: [linkedCard({ set: 'One', img: IMG_A })],
        autos: [linkedCard({ set: 'Two', img: IMG_B })],
      },
    }));

    const suggestion = await engine._loadLinkSuggestions(LINK);

    expect(suggestion.stackImages).toEqual([IMG_A, IMG_B]);
  });

  it("skips cards with no image, no-card entries and the target's own link cards", async () => {
    // The two entries that are skipped for what they are, rather than for having
    // no image, are given images so the filter has something to reject
    const cards = [
      linkedCard({ set: 'No image at all' }),
      linkedCard({ set: 'Nonexistent', img: IMG_B, noCard: true }),
      linkedCard({ set: 'Stands in for another checklist', img: IMG_D, link: OTHER_LINK }),
      linkedCard({ set: 'A real card', img: IMG_A }),
    ];
    sync.loadCardData = vi.fn(async () => ({ cards }));
    expect(cards.filter(c => c.img).map(c => c.img)).toEqual([IMG_B, IMG_D, IMG_A]);

    const suggestion = await engine._loadLinkSuggestions(LINK);

    expect(suggestion.stackImages).toEqual([IMG_A]);
  });

  // The two halves of one distinction, kept adjacent because the difference
  // between them is the whole point: an empty answer and no answer at all reach
  // the editor as different messages ("No images found" vs "Could not load").

  it('offers no images when the linked checklist has none', async () => {
    sync.loadCardData = vi.fn(async () => ({ cards: [linkedCard({ set: 'One' })] }));

    const suggestion = await engine._loadLinkSuggestions(LINK);

    // An answer, and an empty one - not the absence of an answer
    expect(suggestion).toEqual({ stackImages: [] });
  });

  it('reports nothing at all when the linked checklist cannot be read', async () => {
    // A deleted checklist, or a gist the reads could not reach. Both card reads
    // answer null only for a file that is missing or unreachable - a checklist
    // that exists but holds nothing still answers with an object, as above.
    sync.loadCardData = vi.fn(async () => null);
    sync.loadPublicCardData = vi.fn(async () => null);

    expect(await engine._loadLinkSuggestions(LINK)).toBeNull();
  });

  it('offers no images for a checklist created but never filled in', async () => {
    // What createChecklist writes up front. Present, so it is not a failure
    sync.loadCardData = vi.fn(async () => ({ cards: [] }));

    expect(await engine._loadLinkSuggestions(LINK)).toEqual({ stackImages: [] });
  });

  it('falls back to the public copy when the private read comes back empty', async () => {
    sync.loadCardData = vi.fn(async () => null);
    sync.loadPublicCardData = vi.fn(async () => ({
      cards: [linkedCard({ set: 'One', img: IMG_B })],
    }));

    const suggestion = await engine._loadLinkSuggestions(LINK);

    expect(sync.loadCardData).toHaveBeenCalledWith('jayden-daniels');
    expect(suggestion.stackImages).toEqual([IMG_B]);
  });

  it('reads only the public gist when nobody is logged in', async () => {
    sync.isLoggedIn = () => false;
    sync.loadPublicCardData = vi.fn(async () => ({
      cards: [linkedCard({ set: 'One', img: IMG_C })],
    }));

    const suggestion = await engine._loadLinkSuggestions(LINK);

    expect(sync.loadCardData).not.toHaveBeenCalled();
    expect(suggestion).toEqual({ stackImages: [IMG_C] });
  });
});

// _loadLinkSuggestions was not the only place in this file reading githubSync
// through an optional-chained check and then dereferencing it bare. Two others had
// the same shape, both pre-existing, and both are covered here so the class stays
// fixed rather than the one instance.
//
// No page can currently reach either: init() calls _loadConfig first, which returns
// null with no module and makes init throw before anything below runs. These drive
// the methods directly, which is what makes the guards testable at all.
describe('the engine with no sync module loaded at all', () => {
  let engine;

  beforeEach(() => {
    delete window.githubSync;
    engine = Object.create(ChecklistEngine.prototype);
    engine.id = 'washington-qbs';
    engine.config = { dataShape: 'flat', customFields: CUSTOM_FIELDS, cardDisplay: {} };
  });

  afterEach(() => {
    delete window.githubSync;
    document.body.innerHTML = '';
  });

  it('reports no linked stats rather than throwing', async () => {
    // A collection link card, so the linkedIds.length === 0 early return cannot be
    // what makes this pass - the method has to reach the stats read to be tested
    const editor = makeEditor();
    editor.openNew();
    typeInto(editor, '#editor-player', 'Jayden Daniels');
    chooseLink(editor, LINK);
    engine.cards = [editor.getFormData()];
    expect(engine.cards[0].collectionLink).toBe(LINK);

    await engine._loadLinkedStats();

    expect(engine._linkedStats).toEqual({});
  });

  it('fails to load card data with the error that already means that', async () => {
    // The optional-chained isLoggedIn check guards only its own branch; the public
    // read after it is bare, so this reached it and threw a ReferenceError
    await expect(engine._loadCardData()).rejects.toThrow('Failed to load card data');
  });
});
