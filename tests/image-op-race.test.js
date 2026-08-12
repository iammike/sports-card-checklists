import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Regression coverage for the race where clicking Process/Edit/Upload/Remove
// while another of those was still in flight let both write to #editor-img,
// and for the follow-up bug where the guard could get stuck true forever if
// the editor was closed while an image op was still awaiting imageEditor.open().

const CardEditorModal = globalThis.CardEditorModal;

function makeEditor() {
  const editor = new CardEditorModal({ customFields: {} });
  editor.init();
  return editor;
}

describe('CardEditorModal — image operation guard', () => {
  let editor;
  let originalIsLoggedIn;
  let originalImageEditorOpen;
  let originalImageEditorCancel;

  beforeEach(() => {
    editor = makeEditor();
    originalIsLoggedIn = window.githubSync.isLoggedIn;
    window.githubSync.isLoggedIn = () => true;
    originalImageEditorOpen = window.imageEditor.open;
    originalImageEditorCancel = window.imageEditor.cancel;
  });

  afterEach(() => {
    window.githubSync.isLoggedIn = originalIsLoggedIn;
    window.imageEditor.open = originalImageEditorOpen;
    window.imageEditor.cancel = originalImageEditorCancel;
  });

  it('blocks a second image action while the first is still awaiting the editor', async () => {
    let rejectOpen;
    window.imageEditor.open = vi.fn(() => new Promise((_resolve, reject) => { rejectOpen = reject; }));

    const imgInput = editor.backdrop.querySelector('#editor-img');
    imgInput.value = 'images/foo.webp';

    const editPromise = editor.editExistingImage();
    await Promise.resolve();
    await Promise.resolve();

    expect(editor._imageOpInProgress).toBe(true);
    expect(editor.backdrop.querySelector('#editor-process-img').disabled).toBe(true);
    expect(editor.backdrop.querySelector('#editor-remove-img').disabled).toBe(true);

    // Switch to a URL Process would accept, then try to trigger it mid-edit -
    // the guard must block it before it ever looks at the URL.
    imgInput.value = 'https://i.ebayimg.com/foo.jpg';
    const fetchSpy = vi.spyOn(editor.imageProcessor, 'fetchViaProxy');
    await editor.processImage();
    expect(fetchSpy).not.toHaveBeenCalled();

    rejectOpen(new Error('Cancelled'));
    await editPromise;
  });

  it('clears the guard when the modal is closed mid-operation', async () => {
    let rejectOpen;
    window.imageEditor.open = vi.fn(() => new Promise((_resolve, reject) => { rejectOpen = reject; }));
    window.imageEditor.cancel = vi.fn(() => rejectOpen(new Error('Cancelled')));

    const imgInput = editor.backdrop.querySelector('#editor-img');
    imgInput.value = 'images/foo.webp';

    const editPromise = editor.editExistingImage();
    await Promise.resolve();
    await Promise.resolve();
    expect(editor._imageOpInProgress).toBe(true);

    editor.close();
    expect(window.imageEditor.cancel).toHaveBeenCalled();

    await editPromise;
    expect(editor._imageOpInProgress).toBe(false);
  });

  it('resets the guard on reopen even if the previous op never settled', () => {
    window.imageEditor.open = vi.fn(() => new Promise(() => {})); // never settles

    const imgInput = editor.backdrop.querySelector('#editor-img');
    imgInput.value = 'images/foo.webp';
    editor.editExistingImage();
    editor._imageOpInProgress = true;

    editor.init(); // reopening on another card rebuilds the backdrop
    expect(editor._imageOpInProgress).toBe(false);
    expect(editor.backdrop.querySelector('#editor-remove-img').disabled).toBe(false);
  });
});
