import { describe, it, expect } from 'vitest';

const PriceUtils = globalThis.PriceUtils;

describe('PriceUtils.parseSerial', () => {
  it('parses /99 format', () => {
    expect(PriceUtils.parseSerial('/99')).toBe(99);
  });

  it('parses bare number', () => {
    expect(PriceUtils.parseSerial('99')).toBe(99);
  });

  it('parses 1/1', () => {
    expect(PriceUtils.parseSerial('1/1')).toBe(1);
  });

  it('parses numbered with prefix like 23/50', () => {
    expect(PriceUtils.parseSerial('23/50')).toBe(50);
  });

  it('returns null for null/undefined/empty', () => {
    expect(PriceUtils.parseSerial(null)).toBeNull();
    expect(PriceUtils.parseSerial(undefined)).toBeNull();
    expect(PriceUtils.parseSerial('')).toBeNull();
  });

  it('returns null for non-numeric strings', () => {
    expect(PriceUtils.parseSerial('abc')).toBeNull();
  });
});

describe('PriceUtils.getPriceClass', () => {
  it('returns empty string for low prices', () => {
    expect(PriceUtils.getPriceClass(1)).toBe('');
    expect(PriceUtils.getPriceClass(2.99)).toBe('');
  });

  it('returns mid for medium prices', () => {
    expect(PriceUtils.getPriceClass(3)).toBe('mid');
    expect(PriceUtils.getPriceClass(9.99)).toBe('mid');
  });

  it('returns high for high prices', () => {
    expect(PriceUtils.getPriceClass(10)).toBe('high');
    expect(PriceUtils.getPriceClass(100)).toBe('high');
  });
});

describe('PriceUtils.estimate', () => {
  it('returns explicit price when set', () => {
    expect(PriceUtils.estimate({ price: 25 })).toBe(25);
  });

  it('returns explicit price of 0', () => {
    expect(PriceUtils.estimate({ price: 0 })).toBe(0);
  });

  it('uses type-based base price', () => {
    expect(PriceUtils.estimate({ type: 'Base' })).toBe(1);
    expect(PriceUtils.estimate({ type: 'Insert' })).toBe(4);
    expect(PriceUtils.estimate({ type: 'Chase' })).toBe(15);
  });

  it('defaults to 1 for unknown type', () => {
    expect(PriceUtils.estimate({ type: 'Unknown' })).toBe(1);
    expect(PriceUtils.estimate({})).toBe(1);
  });

  it('applies set modifier', () => {
    const price = PriceUtils.estimate({ type: 'Base', set: '2024 Donruss Optic' });
    // Donruss Optic modifier is 1.3, so 1 * 1.3 = 1.3
    expect(price).toBe(1.3);
  });

  it('applies serial multiplier for numbered cards', () => {
    const price = PriceUtils.estimate({ type: 'Base', serial: '/10' });
    // 1 * max(3, (100/10)^1.3) = 1 * max(3, ~19.95) = ~20
    expect(price).toBeGreaterThan(15);
  });

  it('applies 1/1 multiplier', () => {
    const price = PriceUtils.estimate({ type: 'Base', serial: '1/1' });
    // 1 * 200 = 200
    expect(price).toBe(200);
  });

  it('applies auto multiplier', () => {
    const price = PriceUtils.estimate({ type: 'Base', auto: true });
    expect(price).toBe(5); // 1 * 5
  });

  it('applies patch multiplier', () => {
    const price = PriceUtils.estimate({ type: 'Base', patch: true });
    expect(price).toBe(2); // 1 * 2
  });

  it('applies RC multiplier', () => {
    const price = PriceUtils.estimate({ type: 'Base', rc: true });
    expect(price).toBe(1.5); // 1 * 1.5
  });

  it('stacks multipliers', () => {
    const price = PriceUtils.estimate({ type: 'Base', auto: true, rc: true });
    expect(price).toBe(7.5); // 1 * 5 * 1.5
  });

  it('detects patch from variant text', () => {
    const price = PriceUtils.estimate({ type: 'Base', variant: 'Jersey Relic' });
    expect(price).toBe(2); // 1 * 2
  });

  it('applies variant pricing overrides', () => {
    const price = PriceUtils.estimate({ type: 'Base', variant: 'Color Blast' });
    // Color Blast override = 500, base would be 1
    expect(price).toBe(500);
  });

  it('variant pricing takes max of base and override', () => {
    // auto + serial should produce high base, but Kaboom override is 200
    const price = PriceUtils.estimate({
      type: 'Base', auto: true, serial: '1/1', variant: 'Kaboom'
    });
    // base = 1 * 200 (1/1) * 5 (auto) = 1000, Kaboom = 200
    // max(1000, 200) = 1000
    expect(price).toBe(1000);
  });
});
