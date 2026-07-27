import { describe, it, expect } from 'vitest';

describe('sanitizeText', () => {
  const sanitizeText = globalThis.sanitizeText;

  it('returns empty string for null/undefined', () => {
    expect(sanitizeText(null)).toBe('');
    expect(sanitizeText(undefined)).toBe('');
    expect(sanitizeText('')).toBe('');
  });

  it('passes through plain text', () => {
    expect(sanitizeText('Hello World')).toBe('Hello World');
  });

  it('escapes HTML tags', () => {
    expect(sanitizeText('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert("xss")&lt;/script&gt;'
    );
  });

  it('escapes ampersands', () => {
    expect(sanitizeText('A & B')).toBe('A &amp; B');
  });

  // Why sanitizeAttr exists: text content does not need quotes escaped, so
  // sanitizeText alone cannot protect a value inside a quoted attribute.
  it('does not escape quotes', () => {
    expect(sanitizeText('a"b')).toBe('a"b');
    expect(sanitizeText("a'b")).toBe("a'b");
  });

  it('handles numbers by converting to string', () => {
    expect(sanitizeText(42)).toBe('42');
  });
});

describe('sanitizeAttr', () => {
  const sanitizeAttr = globalThis.sanitizeAttr;

  it('returns empty string for null/undefined', () => {
    expect(sanitizeAttr(null)).toBe('');
    expect(sanitizeAttr(undefined)).toBe('');
    expect(sanitizeAttr('')).toBe('');
  });

  it('passes through plain text', () => {
    expect(sanitizeAttr('card-1')).toBe('card-1');
  });

  it('escapes both quote characters', () => {
    expect(sanitizeAttr('a"b')).toBe('a&quot;b');
    expect(sanitizeAttr("a'b")).toBe('a&#39;b');
  });

  it('still escapes what sanitizeText escapes', () => {
    expect(sanitizeAttr('<a & b>')).toBe('&lt;a &amp; b&gt;');
  });

  it('produces an attribute that parses back to the original value', () => {
    const hostile = `x" onmouseover="alert(1)`;
    const el = document.createElement('div');
    el.innerHTML = `<span data-v="${sanitizeAttr(hostile)}"></span>`;
    const span = el.querySelector('span');

    expect(span.dataset.v).toBe(hostile);
    expect(span.getAttributeNames()).toEqual(['data-v']);
  });
});

describe('sanitizeUrl', () => {
  const sanitizeUrl = globalThis.sanitizeUrl;

  it('returns empty string for null/undefined', () => {
    expect(sanitizeUrl(null)).toBe('');
    expect(sanitizeUrl(undefined)).toBe('');
    expect(sanitizeUrl('')).toBe('');
  });

  it('allows http URLs', () => {
    expect(sanitizeUrl('http://example.com')).toBe('http://example.com');
  });

  it('allows https URLs', () => {
    expect(sanitizeUrl('https://example.com/path?q=1')).toBe(
      'https://example.com/path?q=1'
    );
  });

  it('blocks javascript: URLs', () => {
    expect(sanitizeUrl('javascript:alert(1)')).toBe('');
  });

  it('blocks data: URLs', () => {
    expect(sanitizeUrl('data:text/html,<h1>hi</h1>')).toBe('');
  });

  it('returns empty for invalid URLs', () => {
    expect(sanitizeUrl('not a url')).toBe('');
  });

  it('rejects the relative links that sanitizeLinkUrl exists to allow', () => {
    // Documents why the second helper is needed rather than reusing this one.
    expect(sanitizeUrl('checklist.html?id=x')).toBe('');
  });
});

// For navigation targets that may be relative. sanitizeUrl() rejects anything
// without a scheme, which would blank every collection link on the site.
describe('sanitizeLinkUrl', () => {
  const sanitizeLinkUrl = globalThis.sanitizeLinkUrl;

  it('returns empty string for null/undefined', () => {
    expect(sanitizeLinkUrl(null)).toBe('');
    expect(sanitizeLinkUrl(undefined)).toBe('');
    expect(sanitizeLinkUrl('')).toBe('');
  });

  it('allows a relative link and keeps it relative', () => {
    expect(sanitizeLinkUrl('checklist.html?id=x')).toBe('checklist.html?id=x');
    expect(sanitizeLinkUrl('/checklist.html?id=x')).toBe('/checklist.html?id=x');
    expect(sanitizeLinkUrl('./sub/page.html')).toBe('./sub/page.html');
  });

  it('allows absolute http(s) links unchanged', () => {
    expect(sanitizeLinkUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(sanitizeLinkUrl('http://example.com')).toBe('http://example.com');
  });

  it('blocks javascript: links', () => {
    expect(sanitizeLinkUrl('javascript:alert(1)')).toBe('');
    expect(sanitizeLinkUrl('JavaScript:alert(1)')).toBe('');
  });

  it('blocks data: links', () => {
    expect(sanitizeLinkUrl('data:text/html,<h1>hi</h1>')).toBe('');
  });

  it('keeps a quote in an otherwise valid link, leaving escaping to sanitizeAttr', () => {
    // The two guards are separate concerns: scheme here, quotes at the sink.
    expect(sanitizeLinkUrl(`page.html?q="x`)).toBe(`page.html?q="x`);
  });
});

describe('normalizeQuotes', () => {
  const normalizeQuotes = globalThis.normalizeQuotes;

  it('converts smart single quotes to ASCII', () => {
    expect(normalizeQuotes('O\u2019Neal')).toBe("O'Neal");
    expect(normalizeQuotes('\u2018hello\u2019')).toBe("'hello'");
  });

  it('converts smart double quotes to ASCII', () => {
    expect(normalizeQuotes('\u201Chello\u201D')).toBe('"hello"');
  });

  it('passes through regular quotes', () => {
    expect(normalizeQuotes("O'Neal")).toBe("O'Neal");
  });

  it('handles null/empty', () => {
    expect(normalizeQuotes(null)).toBe(null);
    expect(normalizeQuotes('')).toBe('');
  });
});
