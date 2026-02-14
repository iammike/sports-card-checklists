import { describe, it, expect } from 'vitest';

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
});

describe('CardRenderer badge methods', () => {
  it('renderAutoBadge returns badge for auto cards', () => {
    expect(CardRenderer.renderAutoBadge({ auto: true })).toContain('AUTO');
    expect(CardRenderer.renderAutoBadge({ auto: false })).toBe('');
    expect(CardRenderer.renderAutoBadge({})).toBe('');
  });

  it('renderPatchBadge returns badge for patch cards', () => {
    expect(CardRenderer.renderPatchBadge({ patch: true })).toContain('PATCH');
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

describe('CardRenderer.renderAttributeBadges', () => {
  it('renders all badges when no customFields filter', () => {
    const html = CardRenderer.renderAttributeBadges(
      { auto: true, patch: true, serial: '/10' },
      null
    );
    expect(html).toContain('AUTO');
    expect(html).toContain('PATCH');
    expect(html).toContain('/10');
  });

  it('respects customFields filter', () => {
    const html = CardRenderer.renderAttributeBadges(
      { auto: true, patch: true, serial: '/10' },
      { auto: { enabled: true }, patch: null, serial: null }
    );
    // auto is truthy in customFields, patch and serial are null (falsy)
    expect(html).toContain('AUTO');
    expect(html).not.toContain('PATCH');
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
