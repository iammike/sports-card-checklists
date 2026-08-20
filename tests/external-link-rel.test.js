import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const CardRenderer = globalThis.CardRenderer;
const ChecklistEngine = globalThis.ChecklistEngine;
const ChecklistManager = globalThis.ChecklistManager;
const AuthUI = globalThis.AuthUI;

// Every anchor that opens a new tab should carry rel. This is hygiene rather than
// a live hole: browsers have implied noopener for target="_blank" since ~2021, so
// the reverse-tabnabbing vector is already closed by default everywhere current.
// noreferrer is NOT implied, and being explicit costs nothing.
//
// These tests deliberately assert over `a[target="_blank"]` in real rendered
// output instead of pinning the anchors that exist today, so a new one added to
// any covered render path fails without anyone remembering to extend the list.
//
// Scope limit worth knowing about: this only covers anchors produced by a render
// path. Static anchors written directly into index.html or checklist.html are
// invisible to it - the "View on GitHub" footer link in index.html is one, and it
// has to be kept correct by review. Do not assume a green suite means every
// new-tab anchor in the repo carries rel.
const EXPECTED_REL = 'noopener noreferrer';

// Walks the parsed DOM, not innerHTML: an attribute *value* can legitimately
// contain the text `target="_blank"` and a string match would report it as an
// anchor that does not exist.
function newTabAnchors(root) {
  return [...root.querySelectorAll('a[target="_blank"]')];
}

function missingRel(root) {
  return newTabAnchors(root)
    .filter(a => (a.getAttribute('rel') || '') !== EXPECTED_REL)
    .map(a => a.outerHTML);
}

// Asserts the subtree contains new-tab anchors *and* that all of them carry rel.
// The count check matters: without it a test would pass by finding nothing.
function expectAllNewTabAnchorsHaveRel(root, count) {
  expect(newTabAnchors(root)).toHaveLength(count);
  expect(missingRel(root)).toEqual([]);
}

function parse(html) {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host;
}

const SEARCH_URL = 'https://www.ebay.com/sch/i.html?_nkw=x';
const SCP_URL = 'https://www.sportscardspro.com/search-products?q=x';

// Mirrors checklist-engine.js init(): a real ChecklistManager with onOwnedChange
// re-rendering. Only updateStats is stubbed - it reads stat elements this fixture
// has no page for.
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

describe('the guard itself detects a missing rel', () => {
  // Without this the suite could pass because the helper never flags anything.
  it('flags a new-tab anchor with no rel', () => {
    const host = parse('<a href="/x" target="_blank">x</a>');
    expect(missingRel(host)).toEqual(['<a href="/x" target="_blank">x</a>']);
  });

  it('flags a new-tab anchor with only a partial rel', () => {
    // Bare noopener is the specific value the footer link used before this change,
    // so it is the pattern most likely to reappear by someone copying the old
    // markup. A guard that only checked for the presence of rel would miss it.
    const host = parse('<a href="/x" target="_blank" rel="noopener">x</a>');
    expect(missingRel(host)).toHaveLength(1);
  });

  it('ignores same-tab anchors', () => {
    const host = parse('<a href="/x">x</a>');
    expect(missingRel(host)).toEqual([]);
    expect(newTabAnchors(host)).toHaveLength(0);
  });
});

describe('CardRenderer.renderCardImage', () => {
  it('sets rel on the image wrapper', () => {
    expectAllNewTabAnchorsHaveRel(
      parse(CardRenderer.renderCardImage('a.jpg', 'Card', SEARCH_URL)), 1
    );
  });

  it('sets rel on the "No image" placeholder link', () => {
    expectAllNewTabAnchorsHaveRel(
      parse(CardRenderer.renderCardImage(null, 'Card', SEARCH_URL)), 1
    );
  });
});

describe('CardRenderer.renderSearchLinks', () => {
  it('sets rel on the eBay-only link', () => {
    expectAllNewTabAnchorsHaveRel(parse(CardRenderer.renderSearchLinks(SEARCH_URL)), 1);
  });

  it('sets rel on both links in the eBay + Prices branch', () => {
    expectAllNewTabAnchorsHaveRel(
      parse(CardRenderer.renderSearchLinks(SEARCH_URL, SCP_URL)), 2
    );
  });
});

describe('a rendered card carries rel on every new-tab anchor', () => {
  // Goes through the real render path, so this covers whatever anchors a card
  // actually ends up with rather than the ones the unit tests know about.
  beforeEach(() => {
    document.body.innerHTML = '<div id="sections-container"></div>';
  });

  it('covers a card with an image (wrapper + eBay + Prices)', () => {
    makeEngine([{ set: '2024 Prizm', num: '1', img: 'a.jpg' }]).renderCards();
    expectAllNewTabAnchorsHaveRel(container(), 3);
  });

  it('covers a card with no image (placeholder + eBay + Prices)', () => {
    makeEngine([{ set: '2024 Prizm', num: '1' }]).renderCards();
    expectAllNewTabAnchorsHaveRel(container(), 3);
  });

  it('covers a collection-link card', () => {
    makeEngine([{ player: 'Someone', collectionLink: 'checklist.html?id=x' }]).renderCards();
    // The image wrapper opens a new tab; the "View Full Collection" cta does not.
    expectAllNewTabAnchorsHaveRel(container(), 1);
  });

  it('keeps rel on the wrapper after a broken image is swapped for the placeholder', () => {
    // The fallback replaces only the <img>, so the wrapping anchor survives - this
    // pins that the anchor it leaves behind is still a well-formed external link.
    const engine = makeEngine([{ set: '2024 Prizm', num: '1', img: 'broken.jpg' }]);
    engine._initImageFallback();
    engine.renderCards();

    container().querySelector('img.card-image').dispatchEvent(new window.Event('error'));

    expect(container().querySelector('.card-image.placeholder').textContent).toBe('No image');
    expectAllNewTabAnchorsHaveRel(container(), 3);
  });

  it('covers a no-card entry, which renders no new-tab anchors at all', () => {
    makeEngine([{ set: '2024 Prizm', noCard: true }]).renderCards();
    expect(newTabAnchors(container())).toHaveLength(0);
  });
});

describe('the commit-hash link', () => {
  // Real call site: AuthUI.loadCommitHash fetches version.json and writes an
  // anchor into #commit-hash. Only fetch is stubbed.
  //
  // ChecklistManager used to carry a full second copy of this (and of the
  // whole nav dropdown render) - the two drifted apart when Shopping List was
  // added to AuthUI's copy and never mirrored into ChecklistManager's, which
  // silently hid it on every checklist page. ChecklistManager.updateAuthUI()
  // now delegates to AuthUI.update() instead of re-implementing it, so
  // there's only one commit-hash renderer left to cover.
  const VERSION = { url: 'https://github.com/iammike/sports-card-checklists/commit/abc', commit: 'abc' };
  let originalFetch;

  beforeEach(() => {
    document.body.innerHTML = '<span id="commit-hash"></span>';
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => ({ json: async () => VERSION }));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function commitHash() {
    return document.getElementById('commit-hash');
  }

  it('sets rel when rendered by AuthUI', async () => {
    await AuthUI.loadCommitHash();

    expect(commitHash().querySelector('a').textContent).toBe('abc');
    expectAllNewTabAnchorsHaveRel(commitHash(), 1);
  });
});
