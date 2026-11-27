import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Hovering a no-image card (or a filter chip) on a dark checklist flashed a
// near-white #f0f0f0. The dark theme's own hover override lost on specificity,
// so the shared hover must be a translucent tint that works over any page
// background rather than a fixed light grey.

const css = readFileSync(resolve(import.meta.dirname, '..', 'shared.css'), 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, ''); // rationale comments name the declarations

const backgroundsOf = (selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const blocks = [...css.matchAll(new RegExp(`(?:^|[}\\s,])${escaped}\\s*\\{([^}]*)\\}`, 'g'))];
    return blocks.flatMap(b => [...b[1].matchAll(/background\s*:\s*([^;]+);/g)].map(m => m[1].trim()));
};

describe('hover backgrounds that sit over the page background', () => {
    for (const selector of ['.card-image.placeholder:hover:not(.no-card-badge)', '.filter-btn:hover']) {
        it(`${selector} uses a translucent tint`, () => {
            const values = backgroundsOf(selector);
            expect(values).toHaveLength(1);
            expect(values[0]).toMatch(/rgba\([^)]*,\s*0?\.\d+\s*\)/);
        });
    }

    it('keeps the no-card badge out of the placeholder hover', () => {
        expect(css).not.toMatch(/\.card-image\.placeholder:hover\s*\{/);
    });
});
