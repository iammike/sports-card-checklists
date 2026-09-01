import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// #745's "printable checklist" item. The old @media print block was five lines
// and left the nav bar, the dark page header and the gradient section bands on
// the page. Two things drive the rewrite:
//
//   - Toner. A checklist is printed to be carried around, not admired.
//   - Browsers print with "Background graphics" OFF by default, which drops
//     every gradient while keeping the white text that sat on it. Section
//     headers printed blank. So every rule states its own foreground colour
//     rather than trusting a background to survive.
//
// jsdom evaluates no media queries, so this reads the block from source. The
// rendered output was checked separately by printing the page to PDF in headless
// Chrome, in both the default and the dark theme.

const CSS = readFileSync(resolve(import.meta.dirname, '..', 'shared.css'), 'utf-8');

// Comments stripped first. The rationale comments inside this block name the
// very selectors asserted below - "'.card-actions' rather than '.search-link'"
// among them - so an unstripped slice is satisfied by the prose, and deleting
// the rule it explains leaves the test green. Caught by exactly that mutation.
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

// The @media print block only, so a rule that happens to exist elsewhere in the
// stylesheet cannot satisfy an assertion about what printing does.
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

// One rule out of the block, so "is it hidden" cannot be answered by a
// different selector's display: none.
const rule = (selector) => {
    const block = printBlock();
    const at = block.indexOf(selector);
    expect(at, selector).toBeGreaterThan(-1);
    return block.slice(at, block.indexOf('}', at));
};

describe('the print stylesheet drops what has no meaning on paper (#745)', () => {
    it('hides the nav bar', () => {
        expect(rule('.nav-bar')).toContain('display: none');
    });

    // Hiding only .search-link left the " · " between the two anchors printing
    // as a stray dot under every card.
    it('hides the whole search-links row, not just the anchors', () => {
        expect(printBlock()).toContain('.card-actions');
        expect(rule('.card-actions')).toContain('display: none');
    });

    // Both are generated content on the header itself, not elements: the
    // triangle printed as a glyph over the section name, and the accent bar
    // printed the checklist's theme colour across the rule below it.
    it('hides the disclosure triangle and the accent bar', () => {
        const block = printBlock();

        expect(block).toContain('.section-header.collapsible::before');
        expect(block).toContain('.section-header::after');
        expect(rule('.section-header.collapsible::before')).toContain('display: none');
        expect(rule('.section-header::after')).toContain('display: none');
    });

    // A card with no image printed an empty dashed frame the height of a real one.
    it('drops the no-image placeholder', () => {
        expect(rule('.card-image.placeholder')).toContain('display: none');
    });
});

describe('the print stylesheet states its own colours (#745)', () => {
    // The whole point: with backgrounds off, anything relying on one is
    // invisible. These are the elements that were white-on-gradient.
    it('gives the section headers a foreground colour and a real rule', () => {
        const r = rule('.section-header,');

        expect(r).toContain('color: #000');
        expect(r).toContain('background: none');
        expect(r).toContain('border-bottom');
    });

    // h1 is gradient-clipped text on a dark checklist, so it needs the fill
    // colour reset or it prints as nothing at all.
    it('un-clips the gradient title', () => {
        const r = rule('h1 {');

        expect(r).toContain('-webkit-text-fill-color: #000');
        expect(r).toContain('background: none');
    });

    // Filled pills cost toner and print as grey blocks; outlined ones read.
    it('outlines the badges instead of filling them', () => {
        const r = rule('.auto-badge,');

        expect(r).toContain('background: none');
        expect(r).toContain('color: #000');
        expect(r).toContain('border:');
    });
});

describe('the print stylesheet survives a dark checklist (#745)', () => {
    // A dark theme injects its palette into #dynamic-theme at runtime, after
    // shared.css - so without re-pointing the tokens the page prints as black
    // boxes, or as pale grey text on white once backgrounds are dropped.
    it('re-points the colour tokens inside the print block', () => {
        const r = rule(':root');

        ['--color-background', '--color-surface', '--color-text', '--color-border']
            .forEach(token => expect(r, token).toContain(token));
        expect(r).toContain('--color-text: #000');
    });

    it('forces the page background white regardless of the theme', () => {
        expect(rule('body {')).toContain('background: #fff !important');
    });
});

describe('the print stylesheet paginates sensibly (#745)', () => {
    it('keeps a card whole', () => {
        const r = rule('.card {');

        expect(r).toContain('break-inside: avoid');
        expect(r).toContain('page-break-inside: avoid');
    });

    // A section header alone at the foot of a page is a heading for nothing.
    it('never leaves a section header as the last thing on a page', () => {
        const r = rule('.section-header,');

        expect(r).toContain('break-after: avoid');
        expect(r).toContain('page-break-after: avoid');
    });

    it('fits more cards across than the screen does', () => {
        expect(rule('.card-grid')).toMatch(/grid-template-columns:\s*repeat\(4/);
    });
});
