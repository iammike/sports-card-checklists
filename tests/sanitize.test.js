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

  it('escapes ampersands and quotes', () => {
    expect(sanitizeText('A & B')).toBe('A &amp; B');
  });

  it('handles numbers by converting to string', () => {
    expect(sanitizeText(42)).toBe('42');
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
});
