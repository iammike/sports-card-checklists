import { describe, it, expect, beforeEach, vi } from 'vitest';

const CardEditorModal = globalThis.CardEditorModal;
const CardRenderer = globalThis.CardRenderer;

// #761: prices are whole dollars and cents are deliberately unsupported. The bug
// was not the rounding - it was rounding *to zero*. Zero is not "cheap" anywhere
// in this app: getPrice, renderPriceBadge and the shopping list all read it as
// "no price at all", so a hand-entered 40c price silently turned the card into
// an unpriced one. Worse, it happened on any save of that card, even one that
// never touched the price field, and the blur handler blanked the input just
// from tabbing through it.
//
// These drive the real CardEditorModal DOM rather than hand-built cardData; see
// the contract documented above formDataWithCleared in clear-field-merge.test.js.

function makeEditor() {
    const editor = new CardEditorModal({ customFields: {} });
    editor.init();
    return editor;
}

const priceInput = editor => editor.backdrop.querySelector('#editor-price');

describe('CardEditorModal — whole-dollar prices (#761)', () => {
    let editor;

    beforeEach(() => {
        window.confirm = vi.fn(() => true);
        editor = makeEditor();
        editor.backdrop.querySelector('#editor-set').value = '2024 Prizm';
        editor.backdrop.querySelector('#editor-num').value = '1';
    });

    it('keeps a sub-dollar price as a price instead of deleting it', () => {
        priceInput(editor).value = '0.40';

        expect(editor.getFormData().price).toBe(1);
    });

    it('rounds an ordinary price to whole dollars', () => {
        priceInput(editor).value = '45.60';
        expect(editor.getFormData().price).toBe(46);

        priceInput(editor).value = '45.40';
        expect(editor.getFormData().price).toBe(45);
    });

    it('still stores no price when the field is left blank', () => {
        priceInput(editor).value = '';

        expect(editor.getFormData().price).toBeUndefined();
    });

    // The reported symptom in its purest form: open the editor on a card that
    // carries a sub-dollar price, change nothing at all, save. The price used to
    // come back as 0 - the card silently stopped having a price.
    it('does not destroy a loaded sub-dollar price when nothing was touched', () => {
        editor.open('someid', { set: '2024 Prizm', num: '1', price: 0.4 });

        const data = editor.getFormData();

        expect(data.price).not.toBe(0);
        expect(data.price).toBe(1);
    });

    it('does not destroy it on an edit to a different field either', () => {
        editor.open('someid', { set: '2024 Prizm', num: '1', price: 0.4 });
        // Exactly what a user fixing a typo in the set name would do.
        editor.backdrop.querySelector('#editor-set').value = '2024 Panini Prizm';

        const data = editor.getFormData();

        expect(data.set).toBe('2024 Panini Prizm');
        expect(data.price).toBe(1);
    });

    // Tabbing through the field used to blank it outright: Math.round(0.4) is 0,
    // and the handler mapped anything <= 0 to ''.
    it('does not blank the input just because focus passed through it', () => {
        const input = priceInput(editor);
        input.value = '0.40';

        input.dispatchEvent(new window.Event('blur'));

        expect(input.value).not.toBe('');
        expect(input.value).toBe('1');
    });

    it('snaps the input to whole dollars on blur', () => {
        const input = priceInput(editor);
        input.value = '45.60';

        input.dispatchEvent(new window.Event('blur'));

        expect(input.value).toBe('46');
    });

    it('still clears the input for a genuinely empty or junk value', () => {
        const input = priceInput(editor);

        for (const junk of ['', '   ', '.', 'abc']) {
            input.value = junk;
            input.dispatchEvent(new window.Event('blur'));
            expect(input.value, `blur on ${JSON.stringify(junk)}`).toBe('');
        }
    });

    // What the blur handler leaves in the box must be what save() would store,
    // or the field lies about the value being kept.
    it('agrees with what save would store', () => {
        const input = priceInput(editor);

        for (const typed of ['0.40', '0.01', '45.60', '45.40', '3']) {
            input.value = typed;
            input.dispatchEvent(new window.Event('blur'));
            const shown = input.value;

            input.value = typed;
            expect(String(editor.getFormData().price), `typed ${typed}`).toBe(shown);
        }
    });
});

describe('CardRenderer price display follows the same rule (#761)', () => {
    // Assert the rendered text exactly. `not.toContain('$0')` would also reject
    // "$0.40", which is a different policy rather than the bug being pinned here.
    it('renders a sub-dollar card as exactly $1', () => {
        expect(CardRenderer.renderPriceBadge(0.4)).toContain('>$1</span>');
    });

    it('shows nothing at all when there is genuinely no price', () => {
        expect(CardRenderer.renderPriceBadge(0)).toBe('');
        expect(CardRenderer.renderPriceBadge(undefined)).toBe('');
    });

    // The price-class thresholds read the raw value, so a normalized sub-dollar
    // price must not accidentally cross into a "mid" or "high" badge.
    it('leaves a normalized sub-dollar price in the cheapest band', () => {
        expect(CardRenderer.getPriceClass(CardRenderer.normalizePrice(0.4))).toBe('');
    });
});
