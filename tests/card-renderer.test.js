import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const CardRenderer = globalThis.CardRenderer;

describe('CardRenderer.getYear', () => {
  it('extracts 4-digit year from set name', () => {
    expect(CardRenderer.getYear({ set: '2024 Donruss' })).toBe(2024);
  });

  it('returns 0 for no set', () => {
    expect(CardRenderer.getYear({})).toBe(0);
    expect(CardRenderer.getYear({ set: null })).toBe(0);
  });

  it('returns 0 for set without year prefix', () => {
    expect(CardRenderer.getYear({ set: 'Donruss Chrome' })).toBe(0);
  });

  it('only matches year at start of string', () => {
    expect(CardRenderer.getYear({ set: 'Set from 2024' })).toBe(0);
  });
});

describe('CardRenderer.getSetName', () => {
  it('strips year prefix and lowercases', () => {
    expect(CardRenderer.getSetName({ set: '2024 Donruss Chrome' })).toBe('donruss chrome');
  });

  it('handles set without year', () => {
    expect(CardRenderer.getSetName({ set: 'Donruss Chrome' })).toBe('donruss chrome');
  });

  it('returns empty string for no set', () => {
    expect(CardRenderer.getSetName({})).toBe('');
    expect(CardRenderer.getSetName({ set: null })).toBe('');
  });
});

// Moved here from checklist-export.test.js when the helper became shared.
// #755 made these keep cents; #761 reversed that decision - prices are whole
// dollars and cents are deliberately unsupported - so what they pin now is that
// a sub-dollar value normalizes UP to $1 rather than down to $0. Zero is not
// "cheap" anywhere in this app: getPrice, renderPriceBadge and the shopping list
// all read it as "no price at all".
describe('CardRenderer.normalizePrice', () => {
  it('lifts a positive sub-dollar price to the smallest supported one', () => {
    expect(CardRenderer.normalizePrice(0.4)).toBe(1);
    expect(CardRenderer.normalizePrice(0.01)).toBe(1);
    expect(CardRenderer.normalizePrice(0.99)).toBe(1);
  });

  it('rounds to whole dollars at a dollar and above', () => {
    expect(CardRenderer.normalizePrice(45.6)).toBe(46);
    expect(CardRenderer.normalizePrice(45.4)).toBe(45);
    expect(CardRenderer.normalizePrice(1)).toBe(1);
  });

  // Zero has to survive as zero, or "no price" becomes "$1" everywhere.
  it('leaves no-price alone rather than inventing one', () => {
    expect(CardRenderer.normalizePrice(0)).toBe(0);
    expect(CardRenderer.normalizePrice(null)).toBe(0);
    expect(CardRenderer.normalizePrice(undefined)).toBe(0);
    expect(CardRenderer.normalizePrice('not a price')).toBe(0);
    expect(CardRenderer.normalizePrice(-5)).toBe(0);
  });
});

describe('CardRenderer.formatPrice', () => {
  it('prints whole dollars, with no decimal point', () => {
    expect(CardRenderer.formatPrice(45.6)).toBe('46');
    expect(CardRenderer.formatPrice(1)).toBe('1');
  });

  it('shows a sub-dollar price as what the next save would store', () => {
    expect(CardRenderer.formatPrice(0.4)).toBe('1');
  });

  // A totality guard, not a live path: every caller gates on `price > 0` and
  // coerces upstream. It pins what the helper does if that ever stops being true.
  it('coerces a non-numeric price rather than printing NaN', () => {
    expect(CardRenderer.formatPrice('12')).toBe('12');
    expect(CardRenderer.formatPrice('not a price')).toBe('0');
  });
});

describe('CardRenderer.parseSerial', () => {
  it('parses /99 format', () => {
    expect(CardRenderer.parseSerial('/99')).toBe(99);
  });

  it('parses bare number', () => {
    expect(CardRenderer.parseSerial('99')).toBe(99);
  });

  it('parses 1/1', () => {
    expect(CardRenderer.parseSerial('1/1')).toBe(1);
  });

  it('parses numbered with prefix like 23/50', () => {
    expect(CardRenderer.parseSerial('23/50')).toBe(50);
  });

  it('returns null for null/undefined/empty', () => {
    expect(CardRenderer.parseSerial(null)).toBeNull();
    expect(CardRenderer.parseSerial(undefined)).toBeNull();
    expect(CardRenderer.parseSerial('')).toBeNull();
  });

  it('returns null for non-numeric strings', () => {
    expect(CardRenderer.parseSerial('abc')).toBeNull();
  });
});

describe('CardRenderer.getEbayUrl', () => {
  it('generates eBay search URL', () => {
    const url = CardRenderer.getEbayUrl('Jayden+Daniels+Rookie');
    expect(url).toContain('ebay.com');
    expect(url).toContain('Jayden+Daniels+Rookie');
    expect(url).toContain('LH_BIN=1');
  });
});

describe('CardRenderer.getScpUrl', () => {
  it('generates SportsCardsPro search URL', () => {
    const url = CardRenderer.getScpUrl('Jayden+Daniels');
    expect(url).toContain('sportscardspro.com');
    expect(url).toContain('Jayden+Daniels');
  });
});

describe('CardRenderer.getPriceClass', () => {
  it('uses default thresholds', () => {
    expect(CardRenderer.getPriceClass(1)).toBe('');
    expect(CardRenderer.getPriceClass(5)).toBe('mid');
    expect(CardRenderer.getPriceClass(15)).toBe('high');
  });

  it('accepts custom thresholds', () => {
    expect(CardRenderer.getPriceClass(5, { mid: 10, high: 50 })).toBe('');
    expect(CardRenderer.getPriceClass(20, { mid: 10, high: 50 })).toBe('mid');
    expect(CardRenderer.getPriceClass(100, { mid: 10, high: 50 })).toBe('high');
  });
});

describe('CardRenderer.renderPriceBadge', () => {
  it('returns empty for no price', () => {
    expect(CardRenderer.renderPriceBadge(0)).toBe('');
    expect(CardRenderer.renderPriceBadge(null)).toBe('');
    expect(CardRenderer.renderPriceBadge(undefined)).toBe('');
  });

  it('renders badge with rounded price', () => {
    const html = CardRenderer.renderPriceBadge(5.7);
    expect(html).toContain('$6');
    expect(html).toContain('price-badge');
    expect(html).toContain('mid');
  });

  it('renders high price badge', () => {
    const html = CardRenderer.renderPriceBadge(25);
    expect(html).toContain('$25');
    expect(html).toContain('high');
  });

  // #755 made this print $0.40; #761 chose whole dollars instead. What must not
  // come back either way is the "$0" badge on a card that does have a price.
  it('shows a sub-dollar card as $1, never as $0', () => {
    const html = CardRenderer.renderPriceBadge(0.4);
    expect(html).toContain('$1');
    expect(html).not.toContain('$0');
  });
});

describe('CardRenderer badge methods', () => {
  // The badge carries the readable label now, not a baked-in capital string
  // (#787) - text-transform does the uppercasing, which is asserted from the
  // stylesheet in the block below.
  it('renderAutoBadge returns badge for auto cards', () => {
    expect(CardRenderer.renderAutoBadge({ auto: true })).toContain('Auto');
    expect(CardRenderer.renderAutoBadge({ auto: false })).toBe('');
    expect(CardRenderer.renderAutoBadge({})).toBe('');
  });

  it('renderPatchBadge returns badge for patch cards', () => {
    expect(CardRenderer.renderPatchBadge({ patch: true })).toContain('Patch');
    expect(CardRenderer.renderPatchBadge({ patch: false })).toBe('');
  });

  it('renderSerialBadge returns badge with slash prefix', () => {
    const html = CardRenderer.renderSerialBadge({ serial: '99' });
    expect(html).toContain('/99');
    expect(html).toContain('serial-badge');
  });

  it('renderSerialBadge preserves existing slash', () => {
    const html = CardRenderer.renderSerialBadge({ serial: '/25' });
    expect(html).toContain('/25');
    expect(html).not.toContain('//25');
  });

  it('renderSerialBadge returns empty for no serial', () => {
    expect(CardRenderer.renderSerialBadge({})).toBe('');
  });
});

// #801: RPA - Rookie/Patch/Auto - is the term because a patch and a plain
// swatch relic are different things. Relic is a distinct attribute, not a
// rename of Patch, and the two are independent: a card can carry either, both
// or neither.
describe('CardRenderer relic badge (#801)', () => {
  it('renders for a relic card', () => {
    expect(CardRenderer.renderRelicBadge({ relic: true })).toContain('Relic');
    expect(CardRenderer.renderRelicBadge({ relic: false })).toBe('');
    expect(CardRenderer.renderRelicBadge({})).toBe('');
  });

  it('is independent of patch, in both directions', () => {
    const relicOnly = CardRenderer.renderAttributeBadges(
      { relic: true }, { patch: {}, relic: {} });
    const patchOnly = CardRenderer.renderAttributeBadges(
      { patch: true }, { patch: {}, relic: {} });

    expect(relicOnly).toContain('relic-badge');
    expect(relicOnly).not.toContain('patch-badge');
    expect(patchOnly).toContain('patch-badge');
    expect(patchOnly).not.toContain('relic-badge');
  });

  it('renders both when a card is both', () => {
    const html = CardRenderer.renderAttributeBadges(
      { patch: true, relic: true }, { patch: {}, relic: {} });

    expect(html).toContain('patch-badge');
    expect(html).toContain('relic-badge');
  });

  it('stays absent on a checklist that does not declare it', () => {
    const html = CardRenderer.renderAttributeBadges(
      { auto: true, relic: true }, { auto: {}, patch: {} });

    expect(html).toContain('auto-badge');
    expect(html).not.toContain('relic-badge');
  });
});

// The three top-left badges share one positioned container; the serial badge
// sits bottom-left and stays outside it.
describe('CardRenderer badge stacking (#801)', () => {
  const ALL = { auto: {}, patch: {}, relic: {}, serial: {} };

  it('wraps all three top-left badges in one container', () => {
    const html = CardRenderer.renderAttributeBadges(
      { auto: true, patch: true, relic: true }, ALL);

    expect(html.match(/class="card-badges"/g)).toHaveLength(1);
    const container = html.slice(html.indexOf('<div class="card-badges">'), html.indexOf('</div>'));
    ['auto-badge', 'patch-badge', 'relic-badge'].forEach(cls => {
      expect(container, cls).toContain(cls);
    });
  });

  it('leaves the serial badge outside the stack', () => {
    const html = CardRenderer.renderAttributeBadges(
      { auto: true, serial: '/99' }, ALL);
    const container = html.slice(html.indexOf('<div class="card-badges">'), html.indexOf('</div>'));

    expect(container).not.toContain('serial-badge');
    expect(html).toContain('serial-badge');
  });

  // An empty positioned container would still occupy the corner.
  it('emits no container when nothing is stacked', () => {
    const html = CardRenderer.renderAttributeBadges({ serial: '/99' }, ALL);

    expect(html).not.toContain('card-badges');
    expect(html).toContain('serial-badge');
  });

  it('emits nothing at all for a card with no attributes', () => {
    expect(CardRenderer.renderAttributeBadges({}, ALL)).toBe('');
  });
});

// #801 follow-up: the wording is fixed again. While the settings modal could
// set a label, the Jayden checklist had Patch relabelled "Relic"; removing that
// input left the value stored and unreachable, so a PATCH card badged RELIC.
describe('CardRenderer ignores a stored attribute label', () => {
  it('badges a patch card Patch even where the config says otherwise', () => {
    const html = CardRenderer.renderAttributeBadges(
      { patch: true }, { patch: { label: 'Relic' } });

    expect(html).toContain('<span class="patch-badge">Patch</span>');
    expect(html).not.toContain('Relic');
  });

  // The collision that made it obvious: both chips and both badges would have
  // read Relic on that checklist.
  it('keeps patch and relic distinct when the config confuses them', () => {
    const html = CardRenderer.renderAttributeBadges(
      { patch: true, relic: true },
      { patch: { label: 'Relic' }, relic: { label: 'Relic' } });

    expect(html).toContain('<span class="patch-badge">Patch</span>');
    expect(html).toContain('<span class="relic-badge">Relic</span>');
  });

  it('takes no label argument at all', () => {
    expect(CardRenderer.renderPatchBadge({ patch: true }, 'Relic'))
      .toContain('>Patch<');
    expect(CardRenderer.renderAutoBadge({ auto: true }, 'Signed'))
      .toContain('>Auto<');
    expect(CardRenderer.renderRelicBadge({ relic: true }, 'Memorabilia'))
      .toContain('>Relic<');
  });
});
describe('the badge stylesheet supplies the caps (#787)', () => {
  const readSheet = () => readFileSync(resolve(import.meta.dirname, '..', 'shared.css'), 'utf-8');
  const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

  // The rule that *opens* with this selector, skipping any grouped selector the
  // name merely appears in: '\n.relic-badge {' matches the last line of
  // '.auto-badge,\n.patch-badge,\n.relic-badge {' before it reaches the
  // standalone rule, and slicing that returns the shared shape with no colour.
  const rule = (selector) => {
    const sheet = readSheet();
    let from = 0;
    let start = -1;
    for (;;) {
      const i = sheet.indexOf('\n' + selector, from);
      if (i === -1) break;
      if (!sheet.slice(0, i).trimEnd().endsWith(',')) { start = i; break; }
      from = i + 1;
    }
    expect(start, selector).toBeGreaterThan(-1);
    return stripComments(sheet.slice(start, sheet.indexOf('}', start)));
  };

  // Sizing and caps live on the grouped selector now, so a fourth attribute
  // inherits them rather than copying them (#801).
  const sharedBadgeRule = () => rule('.auto-badge,');

  it('uppercases the configurable badges', () => {
    expect(sharedBadgeRule()).toContain('text-transform: uppercase');
  });

  // The wording is arbitrary, and the badges sit top-left under a price badge
  // pinned top-right at the same z-index. The container holds the gap; the
  // badges only have to fit inside it.
  it('reserves the price badge room on the container', () => {
    // Pinned, not just present: a cap that reserves nothing (max-width:
    // calc(100% - 8px)) would satisfy a bare toContain while the overlap
    // returns. 90px is the price badge's own width plus its 8px inset.
    expect(rule('.card-badges {')).toContain('max-width: calc(100% - 90px)');
  });

  it('ellipsizes a long label inside that container', () => {
    expect(sharedBadgeRule()).toContain('text-overflow: ellipsis');
    expect(sharedBadgeRule()).toContain('white-space: nowrap');
    expect(sharedBadgeRule()).toContain('max-width: 100%');
  });

  // Two badges used to coexist only via `.auto-badge + .patch-badge`, which
  // hardcodes exactly two in source order. A third makes that four
  // combinations, so the container stacks them instead.
  it('stacks the badges rather than positioning each one', () => {
    const container = rule('.card-badges {');

    expect(container).toContain('flex-direction: column');
    expect(container).toContain('position: absolute');
    expect(stripComments(readSheet())).not.toContain('.auto-badge + .patch-badge');
  });

  it('gives each badge its own colour and no positioning of its own', () => {
    for (const sel of ['.auto-badge {', '.patch-badge {', '.relic-badge {']) {
      expect(rule(sel), sel).toContain('background:');
      expect(rule(sel), sel).not.toContain('position: absolute');
    }
  });
});

describe('CardRenderer.renderAttributeBadges', () => {
  it('renders all badges when no customFields filter', () => {
    const html = CardRenderer.renderAttributeBadges(
      { auto: true, patch: true, serial: '/10' },
      null
    );
    expect(html).toContain('Auto');
    expect(html).toContain('Patch');
    expect(html).toContain('/10');
  });

  it('respects customFields filter', () => {
    const html = CardRenderer.renderAttributeBadges(
      { auto: true, patch: true, serial: '/10' },
      { auto: { enabled: true }, patch: null, serial: null }
    );
    // auto is truthy in customFields, patch and serial are null (falsy)
    expect(html).toContain('Auto');
    expect(html).not.toContain('Patch');
    expect(html).not.toContain('/10');
  });
});

describe('CardRenderer.renderOwnedControl', () => {
  it('renders checkbox when editable', () => {
    const html = CardRenderer.renderOwnedControl('card-1', false, false);
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('card-1');
    expect(html).not.toContain('checked');
  });

  it('renders checked checkbox for owned card', () => {
    const html = CardRenderer.renderOwnedControl('card-1', true, false);
    expect(html).toContain('checked');
  });

  it('renders owned badge in read-only mode', () => {
    const html = CardRenderer.renderOwnedControl('card-1', true, true);
    expect(html).toContain('Owned');
    expect(html).not.toContain('checkbox');
  });

  it('returns empty for unowned in read-only mode', () => {
    expect(CardRenderer.renderOwnedControl('card-1', false, true)).toBe('');
  });

  it('carries the card id in data-card-id for the delegated listener', () => {
    const html = CardRenderer.renderOwnedControl('card-1', false, false);
    expect(html).toContain('data-card-id="card-1"');
  });

  it('renders no inline event handler', () => {
    const html = CardRenderer.renderOwnedControl('card-1', false, false);
    expect(html).not.toContain('onchange');
    expect(html).not.toMatch(/\son[a-z]+=/);
  });
});

// The id used to be interpolated into an inline onchange="toggleOwned('...')",
// where one quote closed the JS string and the rest executed. There is no inline
// handler now, and the id is attribute-escaped where it still lands in markup.
describe('CardRenderer.renderOwnedControl — a card id cannot break out of the markup', () => {
  function parse(html) {
    const host = document.createElement('div');
    host.innerHTML = html;
    return host;
  }

  const HOSTILE = {
    'double quote': 'x" onmouseover="alert(1)',
    'single quote': "x' onmouseover='alert(1)",
    'both quotes and a bracket': `x"'><img src=x onerror=alert(1)>`,
  };

  for (const [label, cardId] of Object.entries(HOSTILE)) {
    describe(label, () => {
      it('renders exactly one input with no injected attribute or element', () => {
        const host = parse(CardRenderer.renderOwnedControl(cardId, false, false));

        expect(host.querySelectorAll('input')).toHaveLength(1);
        expect(host.querySelectorAll('img')).toHaveLength(0);
        const input = host.querySelector('input');
        expect(input.getAttributeNames().sort()).toEqual(['data-card-id', 'id', 'type']);
        expect(input.getAttribute('onmouseover')).toBe(null);
      });

      it('round-trips the id through the DOM unchanged', () => {
        const input = parse(CardRenderer.renderOwnedControl(cardId, false, false))
          .querySelector('input');
        expect(input.dataset.cardId).toBe(cardId);
      });

      it('keeps the label bound to the checkbox', () => {
        const host = parse(CardRenderer.renderOwnedControl(cardId, false, false));
        const input = host.querySelector('input');
        const label = host.querySelector('label');

        expect(input.id).toBe(cardId);
        expect(label.htmlFor).toBe(input.id);
        expect(label.control).toBe(input);
      });
    });
  }
});

describe('CardRenderer.renderSearchLinks', () => {
  it('renders eBay-only link', () => {
    const html = CardRenderer.renderSearchLinks('https://ebay.com/search');
    expect(html).toContain('eBay');
    expect(html).not.toContain('Prices');
  });

  it('renders eBay + SCP links', () => {
    const html = CardRenderer.renderSearchLinks('https://ebay.com/search', 'https://scp.com/search');
    expect(html).toContain('eBay');
    expect(html).toContain('Prices');
  });
});

describe('CardRenderer.renderAchievements', () => {
  it('returns empty for no badges', () => {
    expect(CardRenderer.renderAchievements(null)).toBe('');
    expect(CardRenderer.renderAchievements([])).toBe('');
  });

  it('renders array of badges', () => {
    const html = CardRenderer.renderAchievements(['RC', 'SP']);
    expect(html).toContain('RC, SP');
    expect(html).toContain('achievement');
  });

  it('renders string badge', () => {
    const html = CardRenderer.renderAchievements('MVP');
    expect(html).toContain('MVP');
  });
});

describe('CardRenderer.renderCardImage', () => {
  it('renders image tag with src', () => {
    const html = CardRenderer.renderCardImage('img.jpg', 'Card', 'https://ebay.com');
    expect(html).toContain('src="img.jpg"');
    expect(html).toContain('card-image');
  });

  it('renders placeholder when no image', () => {
    const html = CardRenderer.renderCardImage(null, 'Card', 'https://ebay.com');
    expect(html).toContain('placeholder');
    expect(html).toContain('No image');
  });
});

describe('CardRenderer.renderNoCardBadge', () => {
  it('defaults to NO CARD when no label given', () => {
    const html = CardRenderer.renderNoCardBadge();
    expect(html).toContain('NO CARD');
    expect(html).toContain('no-card-badge');
  });

  it('falls back to NO CARD for a blank label', () => {
    expect(CardRenderer.renderNoCardBadge('   ')).toContain('NO CARD');
  });

  it('uses a configured label', () => {
    const html = CardRenderer.renderNoCardBadge('DID NOT PLAY');
    expect(html).toContain('DID NOT PLAY');
    expect(html).not.toContain('NO CARD');
  });

  it('escapes a malicious label', () => {
    const html = CardRenderer.renderNoCardBadge('<img src=x onerror=alert(1)>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;');
  });
});
