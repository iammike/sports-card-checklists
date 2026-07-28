import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const ChecklistEngine = globalThis.ChecklistEngine;
const ChecklistManager = globalThis.ChecklistManager;
const CardRenderer = globalThis.CardRenderer;
const CardEditorModal = globalThis.CardEditorModal;

// Card and config data is interpolated into HTML attributes all over the render
// path. sanitizeText() escapes & < > but not quotes, so any value that reaches an
// attribute unescaped can close it and inject further attributes - including an
// event handler. Two of these sinks were inline handlers, where the value landed
// in a JS string and one quote was enough to execute.
//
// One hostile value is used everywhere: a double quote to close a double-quoted
// attribute, a single quote to close a JS string, and an angle bracket plus a
// full payload to prove nothing new gets parsed as markup.
const HOSTILE = `x"'><img src=x onerror=alert(1)>`;

// Fixture fidelity: each of these mirrors a real call site.
//
// makeEngine wires ChecklistEngine the way init() does (real ChecklistManager,
// onOwnedChange re-rendering) and renders through renderCards(), so the markup
// asserted on is what a visitor's page actually contains - not markup a test
// assembled. The real _filterCard and _renderCollectionLinkCard run. Only
// updateStats is replaced: it reads stat elements this fixture has no page for.
function makeEngine(cards, config = {}) {
  const engine = Object.create(ChecklistEngine.prototype);
  engine.id = 'test';
  engine.config = { dataShape: 'flat', customFields: {}, cardDisplay: {}, ...config };
  engine.cards = cards;
  engine._renderedCards = [];
  engine._reorderMode = false;
  engine.updateStats = () => {};
  engine.checklistManager = new ChecklistManager({
    checklistId: 'test',
    onOwnedChange: () => { engine.renderCards(); engine.updateStats(); },
  });
  engine.checklistManager.ownedCards = [];
  engine.checklistManager.isReadOnly = false;
  return engine;
}

function container() {
  return document.getElementById('sections-container');
}

// Every on* attribute on every element in a subtree. Asserting this rather than
// grepping innerHTML matters: a hostile value survives verbatim inside an
// attribute value, so the serialized markup legitimately contains the text
// " onerror=alert(1)" even when nothing was injected. Only the parsed DOM can
// tell an attribute from a string that looks like one.
function inlineHandlers(root) {
  return [...root.querySelectorAll('*')]
    .flatMap(el => el.getAttributeNames())
    .filter(name => name.startsWith('on'));
}

// Render and return the sole .card element, whatever kind of card it is.
function renderOne(card, config) {
  const engine = makeEngine([card], config);
  engine._initOwnedToggle();
  engine._initCollectionLinkNav();
  engine._initImageFallback();
  engine.renderCards();
  return { engine, el: container().querySelector('.card') };
}

// jsdom refuses to perform a real navigation, so capture the assignment the
// delegated listener makes instead of letting it happen.
function captureNavigation() {
  const original = window.location;
  const seen = [];
  delete window.location;
  window.location = {};
  Object.defineProperty(window.location, 'href', {
    set: (v) => seen.push(v),
    get: () => '',
  });
  return { seen, restore: () => { window.location = original; } };
}

beforeEach(() => {
  document.body.innerHTML = '<div id="sections-container"></div>';
});

// ============================================================================
// Sink: the collection-link card's navigation (was an inline onclick)
// ============================================================================

describe('collection-link cards — the link cannot inject markup or execute', () => {
  // Real call site: createCardElement() routes any card with collectionLink and
  // no noCard to _renderCollectionLinkCard, which is what these renders exercise.
  const CARD = { player: 'Someone', collectionLink: 'checklist.html?id=x', cardCount: 3 };

  it('carries no inline handler at all', () => {
    renderOne(CARD);
    expect(container().innerHTML).not.toMatch(/\son[a-z]+=/);
  });

  it('renders no injected attribute or element for a hostile link', () => {
    const { el } = renderOne({ ...CARD, collectionLink: HOSTILE });

    expect(el.getAttributeNames().sort()).toEqual(
      ['class', 'data-card-idx', 'data-collection-link']
    );
    expect(el.getAttribute('onerror')).toBe(null);
    expect(el.querySelectorAll('img')).toHaveLength(0);
    expect(inlineHandlers(container())).toEqual([]);
  });

  it('renders no injected attribute on the "View Full Collection" anchor', () => {
    const { el } = renderOne({ ...CARD, collectionLink: HOSTILE });
    const cta = el.querySelector('.collection-cta');

    expect(el.querySelectorAll('.collection-cta')).toHaveLength(1);
    expect(cta.getAttributeNames().sort()).toEqual(['class', 'href']);
  });

  it('round-trips a safe link through the data attribute unchanged', () => {
    const { el } = renderOne({ ...CARD, collectionLink: 'checklist.html?id=a&b=2' });

    expect(el.dataset.collectionLink).toBe('checklist.html?id=a&b=2');
    expect(el.querySelector('.collection-cta').getAttribute('href'))
      .toBe('checklist.html?id=a&b=2');
  });

  it('drops a javascript: link from both the href and the navigation target', () => {
    const { el } = renderOne({ ...CARD, collectionLink: 'javascript:alert(1)' });

    expect(el.dataset.collectionLink).toBe('');
    expect(el.querySelector('.collection-cta').getAttribute('href')).toBe('');
  });
});

describe('collection-link cards — clicking still navigates', () => {
  const CARD = { player: 'Someone', collectionLink: 'checklist.html?id=x', cardCount: 3 };
  let nav;

  beforeEach(() => { nav = captureNavigation(); });
  afterEach(() => { nav.restore(); });

  function click(el) {
    el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  }

  it('navigates to the link when the card body is clicked', () => {
    const { el } = renderOne(CARD);

    click(el.querySelector('.player-name'));

    expect(nav.seen).toEqual(['checklist.html?id=x']);
  });

  it('navigates when the card element itself is clicked', () => {
    const { el } = renderOne(CARD);

    click(el);

    expect(nav.seen).toEqual(['checklist.html?id=x']);
  });

  it('keeps working after a re-render, since the listener is on the container', () => {
    const { engine, el } = renderOne(CARD);
    engine.renderCards();

    click(container().querySelector('.player-name'));

    expect(nav.seen).toEqual(['checklist.html?id=x']);
    expect(container().querySelector('.card.collection-link')).not.toBe(el);
  });

  it('does not navigate on top of the "View Full Collection" anchor', () => {
    // The anchor already takes the browser there; navigating as well would be a
    // second, competing navigation.
    const { el } = renderOne(CARD);

    click(el.querySelector('.collection-cta'));

    expect(nav.seen).toEqual([]);
  });

  it('does not navigate for a javascript: link', () => {
    const { el } = renderOne({ ...CARD, collectionLink: 'javascript:alert(1)' });

    click(el.querySelector('.player-name'));

    expect(nav.seen).toEqual([]);
  });

  it('ignores clicks on ordinary cards', () => {
    const { el } = renderOne({ set: '2024 Prizm', num: '1' });

    click(el);

    expect(nav.seen).toEqual([]);
  });

  it('does not stack a second listener when init runs again', () => {
    const { engine } = renderOne(CARD);
    engine._initCollectionLinkNav();

    click(container().querySelector('.player-name'));

    expect(nav.seen).toEqual(['checklist.html?id=x']);
  });
});

// ============================================================================
// Sink: the card image's fallback (was an inline onerror)
// ============================================================================

describe('CardRenderer.renderCardImage — no value can break out', () => {
  function parse(html) {
    const host = document.createElement('div');
    host.innerHTML = html;
    return host;
  }

  it('carries no inline handler', () => {
    const html = CardRenderer.renderCardImage('a.jpg', 'Card', 'https://ebay.com/x');
    expect(html).not.toMatch(/\son[a-z]+=/);
  });

  it('renders one image with no injected attribute for a hostile search URL', () => {
    const host = parse(CardRenderer.renderCardImage('a.jpg', 'Card', HOSTILE));

    expect(host.querySelectorAll('img')).toHaveLength(1);
    expect(host.querySelectorAll('a')).toHaveLength(1);
    const img = host.querySelector('img');
    expect(img.getAttribute('src')).toBe('a.jpg');
    expect(img.getAttribute('onerror')).toBe(null);
    expect(host.querySelector('a').getAttributeNames().sort()).toEqual(['href', 'rel', 'target']);
  });

  it('renders one image with no injected attribute for a hostile image src', () => {
    const host = parse(CardRenderer.renderCardImage(HOSTILE, 'Card', 'https://ebay.com/x'));

    expect(host.querySelectorAll('img')).toHaveLength(1);
    const img = host.querySelector('img');
    expect(img.getAttribute('src')).toBe(HOSTILE);
    expect(img.getAttributeNames().sort()).toEqual(['alt', 'class', 'loading', 'src']);
  });

  it('renders one image with no injected attribute for a hostile alt', () => {
    const host = parse(CardRenderer.renderCardImage('a.jpg', HOSTILE, 'https://ebay.com/x'));

    expect(host.querySelectorAll('img')).toHaveLength(1);
    expect(host.querySelector('img').getAttribute('alt')).toBe(HOSTILE);
    expect(host.querySelector('img').getAttributeNames().sort())
      .toEqual(['alt', 'class', 'loading', 'src']);
  });

  it('escapes the hostile search URL in the no-image placeholder too', () => {
    const host = parse(CardRenderer.renderCardImage(null, 'Card', HOSTILE));

    expect(host.querySelectorAll('a')).toHaveLength(1);
    expect(host.querySelectorAll('img')).toHaveLength(0);
    expect(host.querySelector('a').getAttribute('href')).toBe(HOSTILE);
    expect(host.querySelector('a').textContent).toBe('No image');
  });
});

describe('CardRenderer.renderSearchLinks — neither URL can break out', () => {
  // Real call site: createCardElement() passes getEbayUrl(card.search || default)
  // and getScpUrl(card.priceSearch || default). getEbayUrl percent-encodes double
  // quotes; getScpUrl's only replace is /\+/g -> '+', which changes nothing, so a
  // double quote in card.priceSearch arrives at the href intact.
  function parse(html) {
    const host = document.createElement('div');
    host.innerHTML = html;
    return host;
  }

  it('injects nothing through a hostile eBay URL', () => {
    const host = parse(CardRenderer.renderSearchLinks(HOSTILE));

    expect(host.querySelectorAll('a')).toHaveLength(1);
    expect(host.querySelectorAll('img')).toHaveLength(0);
    expect(inlineHandlers(host)).toEqual([]);
    expect(host.querySelector('a').getAttribute('href')).toBe(HOSTILE);
  });

  it('injects nothing through a hostile price-search URL', () => {
    const host = parse(CardRenderer.renderSearchLinks('https://ebay.com/x', HOSTILE));

    expect(host.querySelectorAll('a')).toHaveLength(2);
    expect(host.querySelectorAll('img')).toHaveLength(0);
    expect(inlineHandlers(host)).toEqual([]);
    expect(host.querySelectorAll('a')[1].getAttribute('href')).toBe(HOSTILE);
  });

  it('injects nothing through a double quote in card.priceSearch end to end', () => {
    const { el } = renderOne({ set: '2024 Prizm', priceSearch: `x" onmouseover="alert(1)` });

    const prices = [...el.querySelectorAll('.search-link')].find(a => a.textContent === 'Prices');
    expect(prices.getAttributeNames().sort()).toEqual(['class', 'href', 'rel', 'target']);
    expect(inlineHandlers(container())).toEqual([]);
  });
});

describe('a quote in card.search really does reach the image markup', () => {
  // Proves the sink is reachable rather than theoretical: getEbayUrl() percent-
  // encodes double quotes but not single quotes, so a single quote in card.search
  // survives all the way into the rendered attributes - which is exactly what
  // broke out of the old inline onerror's JS string.
  it('leaves a single quote in the search URL and still injects nothing', () => {
    const { el } = renderOne({ set: '2024 Prizm', img: 'a.jpg', search: `x'y` });

    const anchor = el.querySelector('.card-image-wrapper a');
    expect(anchor.getAttribute('href')).toContain(`x'y`);
    expect(el.querySelectorAll('img')).toHaveLength(1);
    expect(inlineHandlers(container())).toEqual([]);
  });
});

describe('a broken card image is still replaced by the linked "No image" placeholder', () => {
  // Real call site: createCardElement() calls renderCardImage(card.img, card.set,
  // searchUrl), so the image asserted on here is rendered by the real path and the
  // error is dispatched on the real element - error does not bubble, which is why
  // the listener captures.
  const CARD = { set: '2024 Prizm', num: '1', img: 'broken.jpg' };

  function breakImage() {
    const img = container().querySelector('img.card-image');
    img.dispatchEvent(new window.Event('error'));
    return img;
  }

  it('swaps the image for a "No image" placeholder', () => {
    renderOne(CARD);
    const img = breakImage();

    expect(document.contains(img)).toBe(false);
    expect(container().querySelectorAll('img.card-image')).toHaveLength(0);
    const placeholder = container().querySelector('.card-image.placeholder');
    expect(placeholder).not.toBe(null);
    expect(placeholder.textContent).toBe('No image');
  });

  it('leaves the placeholder linking to the eBay search', () => {
    const { el } = renderOne(CARD);
    const href = el.querySelector('.card-image-wrapper a').getAttribute('href');
    breakImage();

    const link = container().querySelector('.card-image.placeholder').closest('a');
    expect(link).not.toBe(null);
    expect(link.getAttribute('href')).toBe(href);
    expect(href).toContain('ebay.com');
  });

  it('cannot inject markup through a hostile search URL on the fallback path', () => {
    renderOne({ ...CARD, search: HOSTILE });
    breakImage();

    expect(container().querySelectorAll('img')).toHaveLength(0);
    expect(inlineHandlers(container())).toEqual([]);
    expect(container().querySelector('.card-image.placeholder').textContent).toBe('No image');
  });

  it('keeps working after a re-render', () => {
    const { engine } = renderOne(CARD);
    engine.renderCards();
    breakImage();

    expect(container().querySelector('.card-image.placeholder').textContent).toBe('No image');
  });

  it('leaves images that are not card images alone', () => {
    // Collection-link card stacks render plain <img> without the card-image class
    // and never had a fallback; the delegated listener must not invent one.
    renderOne({
      player: 'Someone',
      collectionLink: 'checklist.html?id=x',
      stackImages: ['a.jpg', 'b.jpg'],
    });
    const img = container().querySelector('.card-stack img');

    img.dispatchEvent(new window.Event('error'));

    expect(document.contains(img)).toBe(true);
    expect(container().querySelector('.card-image.placeholder')).toBe(null);
  });

  it('does not stack a second listener when init runs again', () => {
    const { engine } = renderOne(CARD);
    engine._initImageFallback();
    breakImage();

    expect(container().querySelectorAll('.card-image.placeholder')).toHaveLength(1);
  });
});

describe('CardRenderer.replaceBrokenImage', () => {
  it('does nothing for an image with no parent', () => {
    const orphan = document.createElement('img');
    expect(() => CardRenderer.replaceBrokenImage(orphan)).not.toThrow();
    expect(() => CardRenderer.replaceBrokenImage(null)).not.toThrow();
  });
});

// ============================================================================
// Sink: the card element's data attributes (issue #691)
// ============================================================================

describe('card data attributes — sport, era, type and price', () => {
  // Real call site: createCardElement() reads card.sport, card.era, card.type and
  // getPrice(card) straight off the gist card object.
  const CARD = { set: '2024 Prizm', num: '1', sport: 'FB', era: '2020s', type: 'Base' };

  it('round-trips safe values', () => {
    const { el } = renderOne(CARD);

    expect(el.dataset.sport).toBe('FB');
    expect(el.dataset.era).toBe('2020s');
    expect(el.dataset.type).toBe('Base');
    expect(el.dataset.price).toBe('0');
  });

  for (const field of ['sport', 'era', 'type']) {
    it(`injects nothing through a hostile ${field}`, () => {
      const { el } = renderOne({ ...CARD, [field]: HOSTILE });

      expect(el.getAttributeNames().sort()).toEqual(
        ['class', 'data-card-idx', 'data-era', 'data-price', 'data-sport', 'data-type', 'id']
      );
      expect(el.dataset[field]).toBe(HOSTILE);
      expect(el.querySelectorAll('img')).toHaveLength(0);
      expect(inlineHandlers(container())).toEqual([]);
    });
  }

  it('injects nothing through a hostile price from a hand-edited gist', () => {
    const { el } = renderOne({ ...CARD, price: HOSTILE });

    expect(el.dataset.price).toBe(HOSTILE);
    expect(el.getAttribute('onerror')).toBe(null);
    expect(inlineHandlers(container())).toEqual([]);
  });
});

// ============================================================================
// Sink: config-driven filter and section markup
// ============================================================================

describe('filter dropdowns built from config', () => {
  // Real call site: _renderFilters() reads config.sortOptions and
  // config.customFilters and writes them into #filters-container.
  beforeEach(() => {
    document.body.innerHTML = '<div id="filters-container"></div><div id="sections-container"></div>';
  });

  function renderFilters(config) {
    const engine = makeEngine([], config);
    engine._renderFilters();
    return document.getElementById('filters-container');
  }

  it('injects nothing through a hostile sort option', () => {
    const el = renderFilters({ sortOptions: ['default', HOSTILE] });

    expect(el.querySelectorAll('img')).toHaveLength(0);
    expect(inlineHandlers(el)).toEqual([]);
    const option = [...el.querySelectorAll('#sort-filter option')].at(-1);
    expect(option.value).toBe(HOSTILE);
    expect(option.textContent).toBe(`Sort: ${HOSTILE}`);
  });

  it('injects nothing through a hostile custom filter id or option value', () => {
    const el = renderFilters({
      customFilters: [{ id: HOSTILE, allLabel: 'All', options: [{ value: HOSTILE, label: 'L' }] }],
    });

    expect(el.querySelectorAll('img')).toHaveLength(0);
    expect(inlineHandlers(el)).toEqual([]);
    // The custom filter select sits between the sort and status dropdowns.
    const select = el.querySelectorAll('select')[1];
    expect(select.id).toBe(`${HOSTILE}-filter`);
    expect(select.querySelectorAll('option')[1].value).toBe(HOSTILE);
  });

  // Escaping must not eat a legitimately falsy config value. sanitizeText used to
  // run `text || ''`, so an option value of 0 rendered as value="" - and an empty
  // filter value is not 'all', so _filterCard compared every card against '' and
  // hid the entire checklist.
  it('renders a numeric option value of 0 rather than blanking it', () => {
    const el = renderFilters({
      customFilters: [{
        id: 'grade', allLabel: 'All',
        options: [{ value: 0, label: 'None' }, { value: 10, label: 'Ten' }],
      }],
    });

    expect([...el.querySelector('#grade-filter').options].map(o => o.value))
      .toEqual(['all', '0', '10']);
  });
});

describe('a filter option value of 0 still filters', () => {
  // Drives the real path end to end: _renderFilters builds the select,
  // _applyFilters reads its value into customFilterValues and _filterCard
  // (checklist-engine.js:1392) compares it to the card field with !==.
  //
  // The card field is the string '0' because that comparison does not coerce - a
  // numeric card field of 0 does not match the select's string '0'. That gap is
  // pre-existing and unrelated to escaping (main renders the same string '0'
  // here); what this pins is that the option is no longer value="", which
  // matched nothing at all.
  beforeEach(() => {
    document.body.innerHTML =
      '<div id="filters-container"></div><div id="sections-container"></div>';
  });

  function setUp() {
    const engine = makeEngine(
      [{ set: 'Ungraded', grade: '0' }, { set: 'Gem Mint', grade: '10' }],
      {
        customFilters: [{
          id: 'grade', allLabel: 'All',
          options: [{ value: 0, label: 'None' }, { value: 10, label: 'Ten' }],
        }],
      }
    );
    engine._renderFilters();
    engine.renderCards();
    return engine;
  }

  function visibleTitles() {
    return [...container().querySelectorAll('.card:not(.filter-hidden) .card-title')]
      .map(el => el.textContent);
  }

  it('shows every card before a filter is chosen', () => {
    setUp();
    expect(visibleTitles()).toEqual(['Ungraded', 'Gem Mint']);
  });

  it('shows only the matching card when the 0 option is selected', () => {
    const engine = setUp();

    document.getElementById('grade-filter').value = '0';
    engine._applyFilters();

    expect(visibleTitles()).toEqual(['Ungraded']);
  });

  it('still filters normally on a non-falsy option', () => {
    const engine = setUp();

    document.getElementById('grade-filter').value = '10';
    engine._applyFilters();

    expect(visibleTitles()).toEqual(['Gem Mint']);
  });
});

describe('CardEditorModal — a select option value of 0 survives escaping', () => {
  // Real call site: checklist-engine passes config customFields straight through,
  // so an option of { value: 0, label: 'None' } comes from the config gist.
  afterEach(() => {
    document.querySelectorAll('.card-editor-backdrop').forEach(el => el.remove());
  });

  it('renders value="0" rather than an empty value', () => {
    const editor = new CardEditorModal({
      cardTypes: [],
      customFields: {
        grade: {
          label: 'Grade', type: 'select', position: 'top',
          options: [{ value: 0, label: 'None' }, { value: 10, label: 'Ten' }],
        },
      },
    });
    editor.init();

    expect([...editor.backdrop.querySelectorAll('#editor-grade option')].map(o => o.value))
      .toEqual(['0', '10']);
  });
});

describe('section markup built from config category ids', () => {
  // Real call site: _renderCategoryCards() interpolates cat.id and child.id into
  // grid/section ids and into the header's class via cat-${cat.id}.
  it('injects nothing through a hostile category id', () => {
    const engine = makeEngine(
      { [HOSTILE]: [{ set: '2024 Prizm', num: '1' }] },
      { dataShape: 'categories', categories: [{ id: HOSTILE, label: 'Cat', note: 'n' }] }
    );
    engine.renderCards();

    expect(container().querySelectorAll('img')).toHaveLength(0);
    expect(inlineHandlers(container())).toEqual([]);
    expect(container().querySelector('.section').id).toBe(`${HOSTILE}-section`);
    expect(container().querySelector('.card-grid').id).toBe(`${HOSTILE}-cards`);
    // data-collapsible is added by CollapsibleSections.init(), which renderCards
    // runs at the end; nothing else may appear.
    expect(container().querySelector('.section-header').getAttributeNames().sort())
      .toEqual(['class', 'data-collapsible']);
  });
});

// ============================================================================
// Sink: the card editor's config-driven fields
// ============================================================================

describe('CardEditorModal — config-driven custom fields', () => {
  // Real call site: checklist-engine builds the editor with
  // new CardEditorModal({ customFields, categories, cardTypes: [], ... }) where
  // customFields comes straight from the checklist config gist.
  function makeEditor(options) {
    const editor = new CardEditorModal({ cardTypes: [], ...options });
    editor.init();
    return editor;
  }

  afterEach(() => {
    document.querySelectorAll('.card-editor-backdrop').forEach(el => el.remove());
  });

  it('injects nothing through a hostile field name, label or placeholder', () => {
    const editor = makeEditor({
      customFields: {
        [HOSTILE]: { label: HOSTILE, type: 'text', placeholder: HOSTILE, position: 'top' },
      },
    });

    expect(editor.backdrop.querySelectorAll('img')).toHaveLength(0);
    expect(inlineHandlers(editor.backdrop)).toEqual([]);
    const input = editor.backdrop.querySelector(`.card-editor-field input[type="text"]`);
    expect(input.getAttribute('placeholder')).toBe(HOSTILE);
  });

  it('injects nothing through a hostile select option', () => {
    const editor = makeEditor({
      customFields: {
        variant: {
          label: 'Variant', type: 'select', position: 'top',
          options: [{ value: HOSTILE, label: HOSTILE }],
        },
      },
    });

    expect(editor.backdrop.querySelectorAll('img')).toHaveLength(0);
    expect(inlineHandlers(editor.backdrop)).toEqual([]);
    const option = editor.backdrop.querySelector('#editor-variant option');
    expect(option.value).toBe(HOSTILE);
    expect(option.textContent).toBe(HOSTILE);
  });

  it('injects nothing through a hostile section category', () => {
    const editor = makeEditor({ categories: [{ value: HOSTILE, label: HOSTILE }] });

    expect(editor.backdrop.querySelectorAll('img')).toHaveLength(0);
    expect(inlineHandlers(editor.backdrop)).toEqual([]);
    expect(editor.backdrop.querySelector('#editor-category option').value).toBe(HOSTILE);
  });

  it('injects nothing through a hostile custom field colour hint', () => {
    const editor = makeEditor({
      customFields: {
        years: { label: 'Years', type: 'text', position: 'top', color: HOSTILE },
      },
    });

    expect(editor.backdrop.querySelectorAll('img')).toHaveLength(0);
    expect(inlineHandlers(editor.backdrop)).toEqual([]);
    // The hint used to render with the hostile value escaped into its style
    // attribute, which stopped attribute breakout but not CSS declaration
    // injection. #698 validates the colour instead, so a value that is not a hex
    // colour renders no swatch at all - see tests/css-color-validation.test.js.
    expect(editor.backdrop.querySelector('.card-editor-color-hint')).toBeNull();
  });

  it('still binds a plain field id so the form can be read back', () => {
    const editor = makeEditor({
      customFields: { years: { label: 'Years Active', type: 'text', position: 'top' } },
    });

    const input = editor.backdrop.querySelector('#editor-years');
    expect(input).not.toBe(null);
    input.value = '2020-2024';
    expect(editor.getFormData().years).toBe('2020-2024');
  });
});

// ============================================================================
// Sink: the checklist creator's subtitle line colour
// ============================================================================

describe('ChecklistCreatorModal — subtitle line colour', () => {
  // Real call site: loading a config into the creator calls
  // _addSubtitleLineRow({ key, label, color: field.color || '#888888', pill }) for
  // each bottom-position text custom field, so field.color reaches the row raw.
  // Category gradient colours reach _addCategoryRow through
  // _extractGradientColors(), which only returns /#[0-9a-fA-F]{6}/ matches, so
  // that sink is not reachable with a hostile value.
  const ChecklistCreatorModal = globalThis.ChecklistCreatorModal;

  function openCreator() {
    const creator = new ChecklistCreatorModal({});
    creator.open();
    return creator;
  }

  afterEach(() => {
    document.querySelectorAll('.creator-backdrop, .checklist-creator-backdrop')
      .forEach(el => el.remove());
  });

  it('injects nothing through a hostile colour', () => {
    const creator = openCreator();
    const list = creator.backdrop.querySelector('#creator-subtitle-lines-list');
    list.innerHTML = '';

    creator._addSubtitleLineRow({ key: 'yrs', label: 'Years', color: HOSTILE, pill: false });

    expect(list.querySelectorAll('img')).toHaveLength(0);
    expect(inlineHandlers(list)).toEqual([]);
    const colorInput = list.querySelector('input[type="color"]');
    expect(colorInput.getAttributeNames().sort()).toEqual(['title', 'type', 'value']);
  });

  it('still shows a normal colour', () => {
    const creator = openCreator();
    const list = creator.backdrop.querySelector('#creator-subtitle-lines-list');
    list.innerHTML = '';

    creator._addSubtitleLineRow({ key: 'yrs', label: 'Years', color: '#ff0000', pill: false });

    expect(list.querySelector('input[type="color"]').value).toBe('#ff0000');
  });
});

// ============================================================================
// Sink: the card editor's image preview
// ============================================================================

describe('CardEditorModal.updateImagePreview', () => {
  // Real call site: the preview is driven by the #editor-img input's value, so a
  // pasted data: URL reaches it verbatim.
  function makeEditor() {
    const editor = new CardEditorModal({ customFields: {}, cardTypes: [] });
    editor.init();
    return editor;
  }

  afterEach(() => {
    document.querySelectorAll('.card-editor-backdrop').forEach(el => el.remove());
  });

  it('injects nothing through a quote in a data: URL', () => {
    const editor = makeEditor();

    editor.updateImagePreview(`data:image/png;base64,AAA"><img src=x onerror=alert(1)>`);

    const preview = editor.backdrop.querySelector('.card-editor-image-preview');
    expect(preview.querySelectorAll('img')).toHaveLength(1);
    // Still the exact attribute set, so an attribute injected through src fails
    // here. onerror left the list when the inline handler became a delegated
    // listener (#693), so this now also fails if any inline handler comes back.
    expect(preview.querySelector('img').getAttributeNames().sort())
      .toEqual(['alt', 'src']);
  });
});
