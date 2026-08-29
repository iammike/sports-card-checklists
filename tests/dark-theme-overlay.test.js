import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Reported against the #788 preview: "In dark pages though that panel is
// transparent." _applyTheme sets --color-surface to rgba(255,255,255,0.05) for a
// dark checklist, which is right for a card sitting on the page background and
// wrong for anything floating over the card grid - the filter panel had the
// colour grid reading straight through it, labels barely legible. Predates #788;
// #785 introduced the panel and #788 only moved it over more content.

const css = () => readFileSync(resolve(import.meta.dirname, '..', 'shared.css'), 'utf-8');

// CSS comments are stripped first: the rationale comments beside these very
// declarations mention the property names, and a parser that reads those as
// declarations returns prose instead of a colour - which then looks opaque and
// passes. Non-nesting /* */ only, which is all CSS has.
const stripComments = (block) => block.replace(/\/\*[\s\S]*?\*\//g, '');

// The value of a custom property as the browser would resolve it from this
// block: last declaration wins.
const propIn = (block, name) => {
    const matches = [...stripComments(block).matchAll(new RegExp(`${name}\\s*:\\s*([^;]+);`, 'g'))];
    return matches.length ? matches[matches.length - 1][1].trim() : null;
};

// Anything with a fractional alpha lets the page through, which is the bug.
const isOpaque = (value) => {
    expect(value, 'property not declared at all').not.toBeNull();
    return !/rgba?\([^)]*,\s*(0?\.\d+|0)\s*\)/.test(value) && !/transparent/.test(value);
};

function applyTheme(theme) {
    document.body.innerHTML = '<style id="dynamic-theme"></style>';
    const engine = Object.create(globalThis.ChecklistEngine.prototype);
    engine.config = { theme };
    engine._applyTheme();
    return document.getElementById('dynamic-theme').textContent;
}

describe('a floating surface stays opaque on a dark checklist', () => {
    it('gives the dark theme an opaque overlay colour', () => {
        const emitted = applyTheme({ darkTheme: true });

        expect(isOpaque(propIn(emitted, '--color-surface-overlay'))).toBe(true);
    });

    // The contrast with --color-surface is the whole point: if someone later
    // "simplifies" the overlay token to reuse it, this fails rather than
    // silently restoring the see-through panel.
    it('keeps it distinct from the see-through card surface', () => {
        const emitted = applyTheme({ darkTheme: true });

        expect(isOpaque(propIn(emitted, '--color-surface'))).toBe(false);
        expect(propIn(emitted, '--color-surface-overlay'))
            .not.toBe(propIn(emitted, '--color-surface'));
    });

    // Undeclared until now, so every var(--color-border, #ddd) in the filter UI
    // - the panel, its footer rule, the chips, the price inputs - drew a
    // near-white line on a dark page.
    it('declares a border colour rather than leaving the light fallback', () => {
        const emitted = applyTheme({ darkTheme: true });

        expect(propIn(emitted, '--color-border')).not.toBeNull();
    });

    // A light checklist must not pick up the dark overrides; it inherits the
    // opaque white from :root instead.
    it('leaves a light checklist alone', () => {
        const emitted = applyTheme({ darkTheme: false });

        expect(propIn(emitted, '--color-surface')).toBeNull();
        expect(propIn(emitted, '--color-surface-overlay')).toBeNull();
    });
});

describe('the filter panel uses the overlay colour', () => {
    // Scoped to the .filter-panel rule, not the sheet: several in-flow surfaces
    // legitimately use --color-surface, so a file-wide assertion proves nothing.
    const panelRule = () => {
        const sheet = css();
        const start = sheet.indexOf('.filter-panel {');
        expect(start).toBeGreaterThan(-1);
        return sheet.slice(start, sheet.indexOf('}', start));
    };

    it('paints itself with the overlay token', () => {
        expect(panelRule()).toContain('background: var(--color-surface-overlay)');
    });

    it('does not fall back to the translucent card surface', () => {
        expect(panelRule()).not.toMatch(/background:\s*var\(--color-surface[,)]/);
    });

    it('defines the token in :root, so pages without a theme still get a colour', () => {
        const sheet = css();
        const root = sheet.slice(sheet.indexOf(':root {'), sheet.indexOf('}', sheet.indexOf(':root {')));

        expect(isOpaque(propIn(root, '--color-surface-overlay'))).toBe(true);
    });
});
