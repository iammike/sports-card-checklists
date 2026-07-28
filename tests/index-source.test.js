import { describe, it, expect } from 'vitest';
import { INDEX_HTML, balancedBlock, markupOf, sourceOf } from './index-source.js';

// Self-tests for the shared slicer in tests/index-source.js.
//
// It is shared by every index.html suite, so a silent-failure path in it reaches
// all of them at once - a wrong span that still reads as coverage. It had one:
// with no `{` at or after the offset, indexOf returned -1, the scan started at
// i = -1 and locked onto the *first* brace in the whole file, and the caller got
// a plausible-looking span that sliced to the empty string (#718).
//
// These tests pin both what it refuses to do and the one case it still gets
// wrong, so the limitation is documented behaviour rather than a latent surprise.
// A slicer that stops slicing correctly reports success everywhere, so treat a
// failure here as invalidating the other index.html suites too.

const OFFSET_OF = (src, needle) => src.indexOf(needle);

describe('balancedBlock — spans it can find', () => {
    it('returns the outermost block, counting nested braces', () => {
        const src = 'x = { a: { b: 1 }, c: 2 }; tail';

        const { bodyStart, end } = balancedBlock(src, OFFSET_OF(src, '{'), 'probe');

        expect(src.slice(bodyStart, end)).toBe('{ a: { b: 1 }, c: 2 }');
    });

    it('starts at the first brace at or after the offset, not at the offset itself', () => {
        // Callers pass the offset of a marker, and the brace is generally a few
        // characters further on.
        const src = 'function f() { body(); } tail';

        const { bodyStart } = balancedBlock(src, 0, 'probe');

        expect(bodyStart).toBe(OFFSET_OF(src, '{'));
    });
});

describe('balancedBlock — failures it refuses to guess at', () => {
    it('throws instead of scanning from -1 when no brace follows the offset', () => {
        // The #718 guard. Without it indexOf's -1 became the loop's start index,
        // every read before index 0 was undefined, and the scan silently picked up
        // the first brace in the file instead.
        const src = 'nothing here';

        expect(() => balancedBlock(src, 3, 'probe')).toThrow(/no '\{' at or after offset 3/);
    });

    it('names the offset and quotes the text there, so the miss is diagnosable', () => {
        const src = 'alpha beta gamma';

        expect(() => balancedBlock(src, 6, 'probe')).toThrow(/probe/);
        expect(() => balancedBlock(src, 6, 'probe')).toThrow(/beta gamma/);
    });

    it('throws rather than returning a truncated span when a block never closes', () => {
        const src = 'f() { a(); g();';

        expect(() => balancedBlock(src, OFFSET_OF(src, '{'), 'probe'))
            .toThrow(/unbalanced block opening at offset 4/);
    });

    it('throws on a stray opening brace, because nothing later closes it', () => {
        // A `{` inside a string inflates the depth permanently. index.html is
        // brace-balanced, so no surplus `}` exists to absorb it and the scan runs
        // to the end - which is why this direction fails loudly rather than
        // returning a too-long span.
        const src = "f() { const s = '{'; g(); }\nif (x) { y(); }";

        expect(() => balancedBlock(src, OFFSET_OF(src, '{'), 'probe'))
            .toThrow(/still open at end of input/);
    });
});

describe('balancedBlock — the case it still gets wrong', () => {
    it('truncates at a stray closing brace inside a string, without throwing', () => {
        // Pinned deliberately: this is a brace counter, not a parser, and this is
        // the one input that yields a wrong answer quietly. Documented here so the
        // limitation is visible; if it is ever fixed, this test should change on
        // purpose rather than start failing mysteriously.
        const src = "f() { const s = '}'; g(); } tail";

        const { bodyStart, end } = balancedBlock(src, OFFSET_OF(src, '{'), 'probe');

        expect(src.slice(bodyStart, end)).toBe("{ const s = '}");
    });

    it('leaves that truncated span un-compilable, which is what catches it downstream', () => {
        // The safety net is the consumer, not the slicer: every span this module
        // hands out is immediately compiled. A truncation lands mid-token, so the
        // compile fails instead of the suite passing on a wrong extraction.
        const src = "f() { const s = '}'; g(); } tail";
        const { bodyStart, end } = balancedBlock(src, OFFSET_OF(src, '{'), 'probe');

        expect(() => new Function(src.slice(bodyStart, end))).toThrow(SyntaxError);
    });

    it('mis-slices a stray opening brace only when a surplus closer absorbs it', () => {
        // Completes the picture from the throwing case above: the stray `{` is
        // harmless only because index.html has no unmatched `}`. Given one, the
        // span silently runs long.
        const src = "f() { const s = '{'; g(); }\n}";

        const { bodyStart, end } = balancedBlock(src, OFFSET_OF(src, '{'), 'probe');

        expect(src.slice(bodyStart, end)).toBe("{ const s = '{'; g(); }\n}");
    });
});

describe('sourceOf — the same guards, reached through the real page', () => {
    it('finds the blocks the index.html suites depend on', () => {
        // Positive control. Without it every assertion below would also pass
        // against a sourceOf that threw unconditionally.
        const { start, bodyStart, end } = sourceOf('function initChecklistFilters() {');

        expect(start).toBeGreaterThan(-1);
        expect(bodyStart).toBeGreaterThan(start);
        expect(end).toBeGreaterThan(bodyStart);
        expect(INDEX_HTML.slice(start, end)).toContain('function applyFilters()');
        expect(INDEX_HTML.slice(start, end).endsWith('}')).toBe(true);
    });

    it('throws for a marker that is not in the page at all', () => {
        expect(() => sourceOf('function noSuchFunction() {'))
            .toThrow(/function noSuchFunction\(\) \{ not found in index\.html/);
    });

    it('throws for a marker with no block after it, rather than slicing to nothing', () => {
        // The end-to-end shape of #718: a real marker at the very end of the file.
        // Before the guard this returned { bodyStart: -1, end: 1072 } - a span
        // pointing at the stylesheet at the top of the page - and sliced to ''.
        const marker = '</html>';
        expect(INDEX_HTML.indexOf(marker)).toBeGreaterThan(-1);
        expect(INDEX_HTML.indexOf('{', INDEX_HTML.indexOf(marker))).toBe(-1);

        expect(() => sourceOf(marker)).toThrow(/no '\{' at or after offset/);
    });
});

describe('markupOf — the matching guards on the element slicer', () => {
    it('returns the element and its descendants, balanced', () => {
        const markup = markupOf('<div class="checklist-filter-bar"');

        expect(markup.startsWith('<div class="checklist-filter-bar"')).toBe(true);
        expect(markup.endsWith('</div>')).toBe(true);
        expect(markup.match(/<div\b/g)).toHaveLength(markup.match(/<\/div>/g).length);
    });

    it('throws for a start tag that is not in the page', () => {
        expect(() => markupOf('<div class="no-such-element"'))
            .toThrow(/not found in index\.html/);
    });
});
