import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const CardEditorModal = globalThis.CardEditorModal;

function makeEditor() {
  const editor = new CardEditorModal({ customFields: {} });
  editor.init();
  return editor;
}

describe('CardEditorModal — no card exists toggle', () => {
  let editor;
  let originalConfirm;

  beforeEach(() => {
    // Ticking the box with owned/price data set asks for confirmation first
    originalConfirm = window.confirm;
    window.confirm = vi.fn(() => true);
    editor = makeEditor();
  });

  afterEach(() => {
    window.confirm = originalConfirm;
  });

  it('emits noCard false when unchecked so the flag can be cleared', () => {
    editor.backdrop.querySelector('#editor-set').value = 'Prizm';
    editor.backdrop.querySelector('#editor-no-card').checked = false;
    expect(editor.getFormData().noCard).toBe(false);
  });

  it('sets noCard true when checked', () => {
    editor.backdrop.querySelector('#editor-no-card').checked = true;
    expect(editor.getFormData().noCard).toBe(true);
  });

  it('disables owned and price inputs when checked', () => {
    const checkbox = editor.backdrop.querySelector('#editor-no-card');
    checkbox.checked = true;
    checkbox.dispatchEvent(new window.Event('change'));

    expect(editor.backdrop.querySelector('#editor-owned').disabled).toBe(true);
    expect(editor.backdrop.querySelector('#editor-price').disabled).toBe(true);
  });

  it('re-enables owned and price inputs when unchecked', () => {
    const checkbox = editor.backdrop.querySelector('#editor-no-card');
    checkbox.checked = true;
    checkbox.dispatchEvent(new window.Event('change'));
    checkbox.checked = false;
    checkbox.dispatchEvent(new window.Event('change'));

    expect(editor.backdrop.querySelector('#editor-owned').disabled).toBe(false);
    expect(editor.backdrop.querySelector('#editor-price').disabled).toBe(false);
  });

  it('clears price when flagged as no card', () => {
    editor.backdrop.querySelector('#editor-price').value = '50';
    const checkbox = editor.backdrop.querySelector('#editor-no-card');
    checkbox.checked = true;
    checkbox.dispatchEvent(new window.Event('change'));

    expect(editor.backdrop.querySelector('#editor-price').value).toBe('');
    expect('price' in editor.getFormData()).toBe(false);
  });

  it('omits price from form data when noCard is true, even if the disabled field still holds a value', () => {
    // open() on an already-flagged card populates the price field and only
    // disables it - it doesn't clear it, since there was nothing to stash.
    editor.backdrop.querySelector('#editor-price').value = '50';
    editor.backdrop.querySelector('#editor-no-card').checked = true;

    expect('price' in editor.getFormData()).toBe(false);
  });
});
