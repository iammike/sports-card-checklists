import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const CardEditorModal = globalThis.CardEditorModal;

describe('CardEditorModal — no card exists toggle is recoverable', () => {
  let editor;
  let onOwnedChange;
  let onSave;
  let originalConfirm;

  beforeEach(() => {
    originalConfirm = window.confirm;
    window.confirm = vi.fn(() => true);
    onOwnedChange = vi.fn();
    onSave = vi.fn();
    editor = new CardEditorModal({
      customFields: {},
      isOwned: () => true,
      onOwnedChange,
      onSave,
    });
    editor.init();
  });

  afterEach(() => {
    window.confirm = originalConfirm;
  });

  function toggleNoCard(checked) {
    const checkbox = editor.backdrop.querySelector('#editor-no-card');
    checkbox.checked = checked;
    checkbox.dispatchEvent(new window.Event('change'));
    return checkbox;
  }

  it('restores owned and price when the box is ticked then unticked', () => {
    editor.open('abc123', { set: 'Prizm', num: '12', price: 50 });

    toggleNoCard(true);
    expect(editor.backdrop.querySelector('#editor-owned').checked).toBe(false);
    expect(editor.backdrop.querySelector('#editor-price').value).toBe('');

    toggleNoCard(false);
    expect(editor.backdrop.querySelector('#editor-owned').checked).toBe(true);
    expect(editor.backdrop.querySelector('#editor-price').value).toBe('50');
  });

  it('does not report an ownership change after a tick/untick round trip', async () => {
    editor.open('abc123', { set: 'Prizm', num: '12', price: 50 });

    toggleNoCard(true);
    toggleNoCard(false);
    await editor.save();

    expect(onOwnedChange).not.toHaveBeenCalled();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][1].price).toBe(50);
    expect(onSave.mock.calls[0][1].noCard).toBe(false);
  });

  it('confirms before clearing owned and price', () => {
    editor.open('abc123', { set: 'Prizm', num: '12', price: 50 });
    toggleNoCard(true);

    expect(window.confirm).toHaveBeenCalledTimes(1);
  });

  it('reverts the checkbox and leaves the fields alone when the confirm is cancelled', () => {
    window.confirm = vi.fn(() => false);
    editor.open('abc123', { set: 'Prizm', num: '12', price: 50 });

    const checkbox = toggleNoCard(true);

    expect(checkbox.checked).toBe(false);
    expect(editor.backdrop.querySelector('#editor-owned').checked).toBe(true);
    expect(editor.backdrop.querySelector('#editor-price').value).toBe('50');
    expect(editor.backdrop.querySelector('#editor-owned').disabled).toBe(false);
  });

  it('does not confirm when there is nothing to clear', () => {
    editor = new CardEditorModal({ customFields: {}, isOwned: () => false, onOwnedChange, onSave });
    editor.init();
    editor.open('abc123', { set: 'Prizm', num: '12' });

    toggleNoCard(true);

    expect(window.confirm).not.toHaveBeenCalled();
  });

  it('does not confirm when the price is zero', () => {
    editor = new CardEditorModal({ customFields: {}, isOwned: () => false, onOwnedChange, onSave });
    editor.init();
    editor.open('abc123', { set: 'Prizm', num: '12', price: 0 });

    toggleNoCard(true);

    expect(window.confirm).not.toHaveBeenCalled();
  });

  it('does not treat opening an already-flagged card as a user toggle', () => {
    editor.open('abc123', { set: 'Prizm', noCard: true });

    // Nothing was stashed, so unticking must not overwrite the fields with
    // values captured from an already-cleared form
    toggleNoCard(false);

    expect(editor._noCardStash).toBe(null);
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it('clears the stash between cards', () => {
    editor.open('abc123', { set: 'Prizm', num: '12', price: 50 });
    toggleNoCard(true);
    expect(editor._noCardStash).not.toBe(null);

    editor.open('def456', { set: 'Optic', num: '7' });

    expect(editor._noCardStash).toBe(null);
  });
});

describe('CardEditorModal — dirty state around the no-card confirm', () => {
  let editor;
  let onOwnedChange;
  let onSave;
  let originalConfirm;

  beforeEach(() => {
    originalConfirm = window.confirm;
    onOwnedChange = vi.fn();
    onSave = vi.fn();
    editor = new CardEditorModal({
      customFields: {},
      isOwned: () => true,
      onOwnedChange,
      onSave,
    });
    editor.init();
  });

  afterEach(() => {
    window.confirm = originalConfirm;
  });

  // A real click on the checkbox fires both "input" and "change", in that
  // order, before the toggle's own change handler runs _applyNoCardState.
  function clickNoCardCheckbox(checked) {
    const checkbox = editor.backdrop.querySelector('#editor-no-card');
    checkbox.checked = checked;
    checkbox.dispatchEvent(new window.Event('input', { bubbles: true }));
    checkbox.dispatchEvent(new window.Event('change', { bubbles: true }));
    return checkbox;
  }

  it('leaves the editor clean when the confirm is cancelled', () => {
    window.confirm = vi.fn(() => false);
    editor.open('abc123', { set: 'Prizm', num: '12', price: 50 });
    expect(editor.isDirty).toBe(false);

    clickNoCardCheckbox(true);

    expect(editor.isDirty).toBe(false);
  });

  it('restores a pre-existing dirty state when the confirm is cancelled', () => {
    window.confirm = vi.fn(() => false);
    editor.open('abc123', { set: 'Prizm', num: '12', price: 50 });
    editor.setDirty(true); // an earlier field edit already dirtied the form

    clickNoCardCheckbox(true);

    expect(editor.isDirty).toBe(true);
  });

  it('still marks the editor dirty when the toggle is accepted', () => {
    window.confirm = vi.fn(() => true);
    editor.open('abc123', { set: 'Prizm', num: '12', price: 50 });
    expect(editor.isDirty).toBe(false);

    clickNoCardCheckbox(true);

    expect(editor.isDirty).toBe(true);
  });
});
