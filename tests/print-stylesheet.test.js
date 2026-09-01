import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// #745's "printable checklist" item. The old @media print block was five lines
// and left the nav bar, the dark page header and a gradient band per section on
// the page. Three things drive the rewrite:
//
//   - Toner. A checklist is printed to be carried around.
//   - Browsers print with "Background graphics" OFF by default. Measured over
//     CDP, that does not skip painting a background - it forces the fill to
//     white. So a gradient becomes a white box, and the white text that sat on
//     it is then white on white: the section headers printed blank.
//   - #dynamic-theme is injected AFTER shared.css, at equal specificity, so it
//     wins. Every colour and border in the block has to be !important or it is
//     decoration - which is exactly what the first pass shipped.
//
// jsdom evaluates no media queries, so this reads the block from source. The
// rendered result was checked separately by printing to PDF in headless Chrome.

const CSS = readFileSync(resolve(import.meta.dirname, '..', 'shared.css'), 'utf-8');

// Comments stripped first. The rationale comments inside this block name the
// very selectors asserted below, so an unstripped slice is satisfied by the
// prose and deleting the rule it explains leaves the test green.
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const printBlock = () => {
    const start = CSS.indexOf('@media print {');
    expect(start, '@media print').toBeGreaterThan(-1);
    let depth = 0;
    for (let i = CSS.indexOf('{', start); i < CSS.length; i++) {
        if (CSS[i] === '{') depth++;
        else if (CSS[i] === '}' && --depth === 0) return stripComments(CSS.slice(start, i + 1));
    }
    throw new Error('unbalanced @media print');
};

const rule = (selector) => {
    const block = printBlock();
    const at = block.indexOf(selector);
    expect(at, selector).toBeGreaterThan(-1);
    return block.slice(at, block.indexOf('}', at));
};

// Named individually rather than as a group. A grouped `display: none` is
// satisfied by any one member, so asserting the group through one selector
// lets the others be deleted silently - which is how `.filters`, the single
// most important print rule and the one the old block already had, went
// untested through the first pass.
const HIDDEN = [
    '.nav-bar',            // the whole site chrome
    '.filters',            // the filter bar
    '.clear-btn',
    '.no-matches-state',
    '.add-card-btn',       // position: fixed, lands on top of page one
    '.save-error-banner',  // position: fixed, white on red
    '.search-links',       // and the " · " between the two anchors
];

describe('the print stylesheet drops what has no meaning on paper (#745)', () => {
    it.each(HIDDEN)('hides %s', (selector) => {
        expect(rule(selector)).toContain('display: none');
    });

    // .card-actions wraps the owned control as well as the links, so hiding the
    // row took the one thing the sheet is carried to a show to consult - what
    // you already own - off the page.
    it('keeps the owned indicator, hiding only the links inside the row', () => {
        const block = printBlock();

        expect(block).not.toMatch(/\.card-actions[^{]*\{[^}]*display:\s*none/);
        expect(rule('.owned-badge')).toContain('color: #000');
    });

    // Both are generated content on the header itself, not elements.
    it.each([
        '.section-header.collapsible::before',
        '.section-header::after',
    ])('hides %s', (selector) => {
        expect(rule(selector)).toContain('display: none');
    });

    // A section collapsed while browsing is persisted in localStorage, so it
    // would print as a heading with nothing under it and - with the triangle
    // hidden - no sign anything was missing.
    it('expands a collapsed section rather than printing an empty heading', () => {
        expect(rule('.collapsible-content.collapsed {')).toContain('grid-template-rows: 1fr');
        expect(rule('.collapsible-content.collapsed > *')).toContain('visibility: visible');
    });
});

describe('the print stylesheet outranks the injected theme (#745)', () => {
    // The point of the whole rewrite: #dynamic-theme is a later stylesheet at
    // equal specificity, so anything here without !important loses to it.
    it.each([
        ['body {', 'background: #fff !important'],
        ['.card {', 'border: 1px solid #999 !important'],
        ['.stat {', 'border: 1px solid #999 !important'],
        ['.page-header {', 'border-bottom: 1px solid #999 !important'],
        ['.section-header,', 'border-bottom: 2px solid #000 !important'],
    ])('marks %s important', (selector, declaration) => {
        expect(rule(selector)).toContain(declaration);
    });

    it('marks every token in the print :root important', () => {
        const r = rule(':root');
        const tokens = r.match(/--[\w-]+:[^;]+;/g) || [];

        expect(tokens.length).toBeGreaterThan(5);
        tokens.forEach(t => expect(t, t).toContain('!important'));
    });

    // _applyTheme writes .player-name and .group-header as direct rules, which
    // no token re-point can reach. #ccc on white is about 1.6:1 - the player
    // name printed as good as blank.
    it.each([
        ['.card-title,', 'color: #000 !important'],
        ['.card-number,', 'color: #333 !important'],
    ])('restates %s, which a token cannot reach', (selector, declaration) => {
        expect(rule(selector)).toContain(declaration);
    });

    it('covers player-name specifically', () => {
        expect(rule('.card-title,')).toContain('.player-name');
    });
});

describe('the print stylesheet states its own colours (#745)', () => {
    it('gives the section headers a foreground colour and a real rule', () => {
        const r = rule('.section-header,');

        expect(r).toContain('color: #000');
        expect(r).toContain('background: none');
    });

    // Gradient-clipped text on a dark checklist prints as nothing at all.
    it('un-clips the gradient title', () => {
        const r = rule('h1 {');

        expect(r).toContain('-webkit-text-fill-color: #000');
        expect(r).toContain('background: none');
    });

    it.each(['.subtitle', '.stat-value', '.needed-value'])('colours %s', (selector) => {
        expect(rule(selector)).toMatch(/color:\s*#[0-9a-f]{3,6}/i);
    });

    // White, not transparent: these sit at the corners of the card image, and
    // an unfilled one prints the artwork straight through - "AUTO" over a photo
    // was unreadable. `background: none` emits no fill in either print mode;
    // `#fff` emits an opaque one in both, since backgrounds-off forces white
    // rather than skipping the paint.
    it('backs the badges in white rather than leaving them transparent', () => {
        const r = rule('.auto-badge,');

        expect(r).toContain('background: #fff !important');
        expect(r).not.toContain('background: none');
        expect(r).toContain('color: #000');
        expect(r).toContain('border:');
    });

    // Named individually, and as a list, so a badge added to .card-image-wrapper
    // has to be added here too. .collection-badge was exactly this gap: same
    // wrapper, same absolute corner, same card art underneath, and the print
    // block never mentioned it.
    it.each([
        '.auto-badge',
        '.patch-badge',
        '.relic-badge',
        '.serial-badge',
        '.price-badge',
        '.collection-badge',
    ])('gives %s an opaque background', (selector) => {
        expect(rule('.auto-badge,')).toContain(selector);
    });

    it('leaves no overlay badge with a theme gradient', () => {
        const block = printBlock();

        expect(rule('.collection-cta')).toContain('background: none');
        expect(block).not.toMatch(/\.collection-badge[^,{]*\{[^}]*linear-gradient/);
    });
});

describe('the print stylesheet paginates sensibly (#745)', () => {
    it('keeps a card whole', () => {
        const r = rule('.card {');

        expect(r).toContain('break-inside: avoid');
        expect(r).toContain('page-break-inside: avoid');
    });

    it('never leaves a section header as the last thing on a page', () => {
        const r = rule('.section-header,');

        expect(r).toContain('break-after: avoid');
        expect(r).toContain('page-break-after: avoid');
    });

    // !important because the max-width: 600px block later in the file
    // re-declares this; a narrow print area would silently revert to two.
    it('fits four cards across, and outranks the narrow-screen rule', () => {
        expect(rule('.card-grid')).toMatch(/grid-template-columns:\s*repeat\(4,\s*1fr\)\s*!important/);
    });

    // The wrapper reserves its height with padding-top, so hiding the
    // placeholder removed the label and kept a 249px blank box.
    it('collapses the reserved image box on a card with no image', () => {
        expect(rule('.card-image-wrapper:has(.card-image.placeholder)'))
            .toContain('padding-top: 0 !important');
        expect(rule('.card.no-card')).toContain('opacity: 1');
    });
});

describe('the print stylesheet is not outranked by the narrow-screen rules (#745)', () => {
    // The @media (max-width: 600px) block re-declares .card-grid's columns, gap
    // and padding, h1's font-size and .card's padding - all of which the print
    // block also sets. A small print area (A5, or wide margins) is narrow enough
    // to match it, so whichever comes second wins. Chrome's letter-size print
    // viewport measures wider than 600, which is why this never bit in the PDFs.
    it('comes after every narrow-screen block in the file', () => {
        const printAt = CSS.indexOf('@media print {');
        const narrow = [...CSS.matchAll(/@media \(max-width/g)].map(m => m.index);

        expect(narrow.length).toBeGreaterThan(0);
        expect(Math.max(...narrow)).toBeLessThan(printAt);
    });

    // Source order settles it today; these keep it settled if anything is ever
    // appended below the print block.
    it.each([
        ['h1 {', 'font-size: 18pt !important'],
        ['.card-grid', 'gap: 8px !important'],
        ['.card-grid', 'padding: 0 !important'],
        ['.card {', 'padding: 6px !important'],
    ])('marks the layout on %s important too', (selector, declaration) => {
        expect(rule(selector)).toContain(declaration);
    });
});

describe('the print stylesheet keeps what a show needs (#745)', () => {
    // The wrapper clips, and the badges are positioned against it - so
    // collapsing it took the price off every card with no image. Price is the
    // reason the sheet is at a show.
    it('lets the badges flow when the image frame collapses', () => {
        expect(rule('.card-image-wrapper:has(.card-image.placeholder) {'))
            .toContain('overflow: visible !important');
        expect(rule('.card-image-wrapper:has(.card-image.placeholder) .card-badges,'))
            .toContain('position: static !important');
    });

    // "No image" says nothing the absence of an image does not. "NO CARD" means
    // the player has no card at all, which a blank space does not convey.
    it('drops the no-image label but keeps the no-card one', () => {
        expect(rule('.card-image.placeholder:not(.no-card-badge)')).toContain('display: none');

        const block = printBlock();
        expect(block).toContain('.no-card-badge {');
        expect(rule('.no-card-badge {')).not.toContain('display: none');
    });

    // The page fades in via `animation: pageFadeIn ... both` on html, so opacity
    // is 0 until the delay elapses. Print before then and the whole sheet is
    // blank - found by printing a page that screenshotted correctly and
    // produced an empty PDF.
    it('cannot print a blank page while the fade-in is pending', () => {
        const r = rule('html {');

        expect(r).toContain('animation: none !important');
        expect(r).toContain('opacity: 1 !important');
    });
});
