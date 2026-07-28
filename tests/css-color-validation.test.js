import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const isSafeColor = globalThis.isSafeColor;
const sanitizeText = globalThis.sanitizeText;
const CardEditorModal = globalThis.CardEditorModal;

// Colors out of the gist used to be interpolated straight into a CSS
// declaration. style.cssText cannot execute script, but a value carrying a
// semicolon appends further declarations - `background: url(...)` among them,
// which makes an outbound request the moment the card renders.
//
// This is the shape that does it: a plausible-looking color, then a second
// declaration. It also proves the fallback is reached rather than merely that
// the payload was escaped, because the payload's own color would still be a
// valid one if it survived.
const HOSTILE = '#fff; background: url(https://evil.test/x.png)';

// The two colors below are real registry values (Commanders gold, and the black
// border that pairs with it), so the pass-through cases assert on the exact
// shapes production actually stores.
const REAL_ACCENT = '#ffb612';
const REAL_BORDER = '#000000';

const DEFAULT_ACCENT = '#667eea';

// jsdom normalizes a parsed color to rgb(), so an expectation about the border
// has to be written in those terms rather than as the hex that went in.
function rgb(hex) {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    return `rgb(${r}, ${g}, ${b})`;
}

// index.html's card builder is an inline arrow that tests/setup.js does not load
// (it only evals src/*.js). Extract the real source and evaluate it, so this
// asserts the shipped code rather than a copy. Same trick as
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
        'sanitizeText',
        'isSafeColor',
        `return (entry) => ${body};`,
    );
}

const buildRenderCard = loadRenderCard();

// Run the extracted builder for one registry entry and hand back the card it
// appended. Reading card.style rather than the source string matters: jsdom has
// parsed the declaration by then, so an injected declaration shows up as a
// property the element really carries.
function renderCard(entry) {
    const grid = document.createElement('div');
    buildRenderCard(
        { [entry.id]: { owned: 3, total: 10, ownedValue: 100, neededValue: 50 } },
        2 * Math.PI * 20,
        grid,
        {},
        sanitizeText,
        isSafeColor,
    )(entry);
    return grid.querySelector('.checklist-card');
}

const ENTRY = { id: 'test', title: 'Test Checklist', type: 'dynamic' };

describe('isSafeColor', () => {
    it('accepts six-digit hex in either case', () => {
        expect(isSafeColor(REAL_ACCENT)).toBe(true);
        expect(isSafeColor(REAL_BORDER)).toBe(true);
        expect(isSafeColor('#FFB612')).toBe(true);
    });

    it.each([
        ['a declaration-injecting payload', HOSTILE],
        ['a named color', 'red'],
        // Three-digit hex is rejected on purpose: the sinks append hex alpha, so
        // '#fff' + '0d' is '#fff0d', which is not a color at all.
        ['three-digit hex', '#fff'],
        ['an rgb() function', 'rgb(1,2,3)'],
        ['an empty string', ''],
        ['a bare hash', '#'],
        ['seven hex digits', '#1234567'],
        ['hex with a non-hex digit', '#gggggg'],
        ['leading whitespace', ' #ffb612'],
        ['null', null],
        ['undefined', undefined],
        ['a number', 0xffb612],
    ])('rejects %s', (_label, value) => {
        expect(isSafeColor(value)).toBe(false);
    });
});

describe('index.html checklist card - registry colors', () => {
    it('passes a valid accent and border through unchanged', () => {
        const card = renderCard({ ...ENTRY, accentColor: REAL_ACCENT, borderColor: REAL_BORDER });

        expect(card.style.getPropertyValue('--card-accent')).toBe(REAL_ACCENT);
        expect(card.style.getPropertyValue('border-left-color')).toBe(rgb(REAL_BORDER));
    });

    it('still builds the gradient from the appended hex alpha', () => {
        // '#ffb612' + '0d' has to parse as an 8-digit hex color for the gradient
        // to survive at all - the reason only six-digit hex is accepted.
        const card = renderCard({ ...ENTRY, accentColor: REAL_ACCENT, borderColor: REAL_BORDER });

        expect(card.style.getPropertyValue('background-image'))
            .toContain('rgba(255, 182, 18, 0.05)');
    });

    it('falls back to the default accent for a declaration-injecting value', () => {
        const card = renderCard({ ...ENTRY, accentColor: HOSTILE, borderColor: HOSTILE });

        expect(card.style.getPropertyValue('--card-accent')).toBe(DEFAULT_ACCENT);
        expect(card.style.cssText).not.toContain('evil.test');
        expect(card.style.cssText).not.toContain('url(');
        expect(card.style.getPropertyValue('background-image')).not.toContain('url(');
    });

    it.each([
        ['a named color', 'red'],
        ['three-digit hex', '#fff'],
        ['an rgb() function', 'rgb(1,2,3)'],
        ['an empty string', ''],
        ['null', null],
        ['undefined', undefined],
        ['a number', 0xffb612],
    ])('falls back to the default accent for %s', (_label, value) => {
        const card = renderCard({ ...ENTRY, accentColor: value });

        expect(card.style.getPropertyValue('--card-accent')).toBe(DEFAULT_ACCENT);
    });

    it('uses the accent as the border when no border color is set', () => {
        const card = renderCard({ ...ENTRY, accentColor: REAL_ACCENT });

        expect(card.style.getPropertyValue('border-left-color')).toBe(rgb(REAL_ACCENT));
    });

    it('uses the accent as the border when the border color is invalid', () => {
        const card = renderCard({ ...ENTRY, accentColor: REAL_ACCENT, borderColor: HOSTILE });

        expect(card.style.getPropertyValue('border-left-color')).toBe(rgb(REAL_ACCENT));
        expect(card.style.cssText).not.toContain('evil.test');
    });

    it('falls back for both when the accent is invalid and the border is absent', () => {
        const card = renderCard({ ...ENTRY, accentColor: 'red' });

        expect(card.style.getPropertyValue('--card-accent')).toBe(DEFAULT_ACCENT);
        expect(card.style.getPropertyValue('border-left-color')).toBe(rgb(DEFAULT_ACCENT));
    });
});

describe('card editor custom field color hint', () => {
    function makeEditor(customFields) {
        const editor = new CardEditorModal({ cardTypes: [], customFields });
        editor.init();
        return editor;
    }

    afterEach(() => {
        document.querySelectorAll('.card-editor-backdrop').forEach(el => el.remove());
    });

    it('renders the swatch for a valid color', () => {
        const editor = makeEditor({
            years: { label: 'Years', type: 'text', position: 'top', color: REAL_ACCENT },
        });

        const hint = editor.backdrop.querySelector('.card-editor-color-hint');
        expect(hint.style.getPropertyValue('background-color')).toBe(rgb(REAL_ACCENT));
    });

    it('renders no swatch, and no injected declaration, for a hostile color', () => {
        const editor = makeEditor({
            years: { label: 'Years', type: 'text', position: 'top', color: HOSTILE },
        });

        expect(editor.backdrop.querySelector('.card-editor-color-hint')).toBeNull();
        expect(editor.backdrop.innerHTML).not.toContain('evil.test');
    });

    it('renders no swatch for a named color', () => {
        const editor = makeEditor({
            years: { label: 'Years', type: 'text', position: 'top', color: 'red' },
        });

        expect(editor.backdrop.querySelector('.card-editor-color-hint')).toBeNull();
    });

    it('still renders no swatch when a field defines no color', () => {
        const editor = makeEditor({
            years: { label: 'Years', type: 'text', position: 'top' },
        });

        expect(editor.backdrop.querySelector('.card-editor-color-hint')).toBeNull();
    });
});
