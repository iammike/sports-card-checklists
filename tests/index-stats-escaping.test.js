import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const sanitizeText = globalThis.sanitizeText;
const isSafeColor = globalThis.isSafeColor;

// index.html builds each checklist card as an innerHTML string from stats that
// live in the gist. They land in text nodes rather than attributes, so they were
// out of #692's scope, but they carry the same trust level as everything that
// sweep hardened - escape them the same way.

// The card builder is an inline arrow in index.html, which tests/setup.js does
// not load (it only evals src/*.js). Extract the real source and evaluate it, so
// this asserts the shipped code rather than a copy. Same trick as
// tests/card-id-validation.test.js.
function loadRenderCard() {
    const html = readFileSync(resolve(import.meta.dirname, '..', 'index.html'), 'utf-8');
    const marker = 'dynamicEntries.forEach(entry => {';
    const start = html.indexOf(marker);
    if (start === -1) throw new Error('dynamicEntries.forEach not found in index.html');

    const bodyStart = html.indexOf('{', start + marker.length - 1);
    let depth = 0;
    let bodyEnd = -1;
    for (let i = bodyStart; i < html.length; i++) {
        if (html[i] === '{') depth++;
        else if (html[i] === '}') {
            depth--;
            if (depth === 0) {
                bodyEnd = i + 1;
                break;
            }
        }
    }
    if (bodyEnd === -1) throw new Error('unbalanced forEach body in index.html');

    const body = html.slice(bodyStart, bodyEnd);
    return new Function(
        'allGistStats',
        'PROGRESS_RING_CIRCUMFERENCE',
        'grid',
        'dynamicStats',
        'configs',
        'sanitizeText',
        'isSafeColor',
        `return (entry) => ${body};`,
    );
}

const buildRenderCard = loadRenderCard();

// Run the extracted builder for one registry entry and hand back the card it
// appended, so assertions can read either the markup or the rendered text.
function renderCard(entry, stats, config = null) {
    const grid = document.createElement('div');
    buildRenderCard(
        { [entry.id]: stats },
        2 * Math.PI * 20,
        grid,
        {},
        { [entry.id]: config },
        sanitizeText,
        isSafeColor,
    )(entry);
    return grid.querySelector('.checklist-card');
}

const ENTRY = { id: 'test', title: 'Test Checklist', type: 'dynamic' };

beforeEach(() => {
    document.body.innerHTML = '';
});

describe('index.html checklist card — the hasStats guard', () => {
    // owned and total are the two stats a hostile value cannot actually reach:
    // the guard demands a numeric owned and a total that compares > 0, and no
    // string containing markup survives either test. They are escaped for
    // consistency with the rest of the template, so the coverage that matters
    // here is that the guard really is what stops them.
    it('renders no progress section at all for a non-numeric total', () => {
        const card = renderCard(ENTRY, {
            owned: 3,
            total: '<img src=x onerror=alert(1)>',
            ownedValue: 100,
            neededValue: 50,
        });

        expect(card.querySelector('img')).toBeNull();
        expect(card.querySelector('.progress-main-text')).toBeNull();
        expect(card.textContent).toContain('No cards yet');
    });

    it('renders no progress section at all for a non-numeric owned count', () => {
        const card = renderCard(ENTRY, {
            owned: '<img src=x onerror=alert(1)>',
            total: 10,
            ownedValue: 100,
            neededValue: 50,
        });

        expect(card.querySelector('img')).toBeNull();
        expect(card.querySelector('.progress-main-text')).toBeNull();
        expect(card.textContent).toContain('No cards yet');
    });
});

describe('index.html checklist card — stats escaping', () => {
    it('escapes a hostile owned value instead of injecting markup', () => {
        const card = renderCard(ENTRY, {
            owned: 3,
            total: 10,
            ownedValue: '<img src=x onerror=alert(1)>',
            neededValue: 50,
        });

        expect(card.querySelector('img')).toBeNull();
        expect(card.querySelector('.value-owned').textContent)
            .toContain('<img src=x onerror=alert(1)>');
    });

    it('escapes a hostile needed value instead of injecting markup', () => {
        const card = renderCard(ENTRY, {
            owned: 3,
            total: 10,
            ownedValue: 100,
            neededValue: '<img src=x onerror=alert(1)>',
        });

        expect(card.querySelector('img')).toBeNull();
        expect(card.querySelector('.value-needed').textContent)
            .toContain('<img src=x onerror=alert(1)>');
    });

    it('escapes hostile extra-pill counts instead of injecting markup', () => {
        const entry = { ...ENTRY, extraPills: [{ id: 'auto', label: 'Autos' }] };
        const card = renderCard(entry, {
            owned: 3,
            total: 10,
            ownedValue: 100,
            neededValue: 50,
            autoOwned: '<img src=x onerror=alert(1)>',
            autoTotal: 5,
        });

        expect(card.querySelector('img')).toBeNull();
        expect(card.querySelector('.stat-pill .count').textContent)
            .toContain('<img src=x onerror=alert(1)>');
    });

    it('escapes a hostile extra-pill total instead of injecting markup', () => {
        // A pill total only has to be truthy and not the number 0 to render, so
        // unlike the main total it never passes through a numeric comparison.
        const entry = { ...ENTRY, extraPills: [{ id: 'auto', label: 'Autos' }] };
        const card = renderCard(entry, {
            owned: 3,
            total: 10,
            ownedValue: 100,
            neededValue: 50,
            autoOwned: 2,
            autoTotal: '<img src=x onerror=alert(1)>',
        });

        expect(card.querySelector('img')).toBeNull();
        expect(card.querySelector('.stat-pill .count').textContent)
            .toContain('<img src=x onerror=alert(1)>');
    });
});

describe('index.html checklist card — ordinary stats still render', () => {
    it('shows the owned and total counts', () => {
        const card = renderCard(ENTRY, { owned: 3, total: 10, ownedValue: 100, neededValue: 50 });

        expect(card.querySelector('.progress-main-text').textContent.trim())
            .toBe('3 of 10 cards');
    });

    it('renders a zero value as $0, not a blank', () => {
        // sanitizeText returns "0" for numeric 0 (#692); if it ever swallowed
        // falsy values again the dollar amounts here would silently blank out.
        const card = renderCard(ENTRY, { owned: 0, total: 10, ownedValue: 0, neededValue: 0 });

        expect(card.querySelector('.value-owned').textContent).toBe('$0 value');
        expect(card.querySelector('.value-needed').textContent).toBe('$0 to complete');
        expect(card.querySelector('.progress-main-text').textContent.trim())
            .toBe('0 of 10 cards');
    });

    it('renders extra-pill counts', () => {
        const entry = { ...ENTRY, extraPills: [{ id: 'auto', label: 'Autos' }] };
        const card = renderCard(entry, {
            owned: 3, total: 10, ownedValue: 100, neededValue: 50,
            autoOwned: 2, autoTotal: 5,
        });

        expect(card.querySelector('.stat-pill .count').textContent).toBe('2/5');
    });

    it('renders a zero extra-pill owned count as 0, not a blank', () => {
        const entry = { ...ENTRY, extraPills: [{ id: 'auto', label: 'Autos' }] };
        const card = renderCard(entry, {
            owned: 3, total: 10, ownedValue: 100, neededValue: 50,
            autoOwned: 0, autoTotal: 5,
        });

        expect(card.querySelector('.stat-pill .count').textContent).toBe('0/5');
    });
});
