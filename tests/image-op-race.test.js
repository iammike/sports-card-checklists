import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Regression coverage for the race where clicking Process/Edit/Upload/Remove
// while another of those was still in flight let both write to #editor-img,
// and for two follow-up bugs found in review:
//   - closing the modal mid-op used to leave the guard stuck true forever
//     (imageEditor.close() nulls the pending promise instead of settling it)
//   - even after that fix, a stale op finishing after the modal was reopened
//     on another card could still write into the fresh card's DOM and clear
//     its guard mid-flight

const CardEditorModal = globalThis.CardEditorModal;

function makeEditor() {
  const editor = new CardEditorModal({ customFields: {} });
  editor.init();
  return editor;
}

describe('CardEditorModal — image operation guard', () => {
  let editor;
  let originalIsLoggedIn;
  let originalUploadImage;
  let originalDeleteImage;
  let originalImageEditorOpen;
  let originalImageEditorCancel;

  beforeEach(() => {
    editor = makeEditor();
    originalIsLoggedIn = window.githubSync.isLoggedIn;
    window.githubSync.isLoggedIn = () => true;
    originalUploadImage = window.githubSync.uploadImage;
    originalDeleteImage = window.githubSync.deleteImage;
    originalImageEditorOpen = window.imageEditor.open;
    originalImageEditorCancel = window.imageEditor.cancel;
  });

  afterEach(() => {
    window.githubSync.isLoggedIn = originalIsLoggedIn;
    window.githubSync.uploadImage = originalUploadImage;
    window.githubSync.deleteImage = originalDeleteImage;
    window.imageEditor.open = originalImageEditorOpen;
    window.imageEditor.cancel = originalImageEditorCancel;
  });

  it('blocks every other image action while one is still awaiting the editor', async () => {
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
    expect(imgInput.disabled).toBe(true);
    expect(editor.backdrop.querySelector('#editor-upload-zone').classList.contains('disabled')).toBe(true);
    expect(editor.backdrop.querySelector('#editor-img-dropzone').classList.contains('disabled')).toBe(true);

    // Switch to a URL Process would accept, then try to trigger it mid-edit -
    // the guard must block it before it ever looks at the URL.
    imgInput.value = 'https://i.ebayimg.com/foo.jpg';
    const fetchSpy = vi.spyOn(editor.imageProcessor, 'fetchViaProxy');
    await editor.processImage();
    expect(fetchSpy).not.toHaveBeenCalled();

    // Upload and Remove must be blocked too, not just Process.
    const uploadFile = new window.File(['x'], 'card.jpg', { type: 'image/jpeg' });
    await editor.processLocalFile(uploadFile);
    expect(editor.backdrop.querySelector('#editor-img-file').value).toBe('');

    editor.removeImage();
    expect(imgInput.value).toBe('https://i.ebayimg.com/foo.jpg'); // unchanged - remove no-opped

    rejectOpen(new Error('Cancelled'));
    await editPromise;
  });

  it('clears the guard when the modal is closed mid-operation', async () => {
    let resolvePromise;
    let rejectPromise;
    window.imageEditor.open = vi.fn(() => new Promise((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
      // Mirror what the real open() does, so the real cancel() (not a stub)
      // has something to reject - this exercises the actual cancel() path
      // reviewed for this fix, not just that CardEditorModal called it.
      window.imageEditor.resolvePromise = resolvePromise;
      window.imageEditor.rejectPromise = rejectPromise;
      window.imageEditor.backdrop = { classList: { remove: () => {} } };
    }));

    const imgInput = editor.backdrop.querySelector('#editor-img');
    imgInput.value = 'images/foo.webp';

    const editPromise = editor.editExistingImage();
    await Promise.resolve();
    await Promise.resolve();
    expect(editor._imageOpInProgress).toBe(true);

    editor.close();

    await editPromise;
    expect(editor._imageOpInProgress).toBe(false);
  });

  it('resets the guard on reopen even if the previous op never settled', () => {
    window.imageEditor.open = vi.fn(() => new Promise(() => {})); // never settles

    const imgInput = editor.backdrop.querySelector('#editor-img');
    imgInput.value = 'images/foo.webp';
    editor.editExistingImage();
    expect(editor._imageOpInProgress).toBe(true);

    editor.init(); // reopening on another card rebuilds the backdrop
    expect(editor._imageOpInProgress).toBe(false);
    expect(editor.backdrop.querySelector('#editor-remove-img').disabled).toBe(false);
  });

  it('does not let a stale op finishing after reopen write into the new card or clear its guard', async () => {
    let resolveOpenA;
    window.imageEditor.open = vi.fn(() => new Promise((resolve) => { resolveOpenA = resolve; }));

    const imgInputA = editor.backdrop.querySelector('#editor-img');
    imgInputA.value = 'images/card-a.webp';
    window.githubSync.uploadImage = vi.fn(() => Promise.resolve('https://cards.example/images/card-a_stale.webp'));
    window.githubSync.deleteImage = vi.fn(() => Promise.resolve());

    const editPromiseA = editor.editExistingImage(); // card A's op, left hanging

    // Reopen the modal on a different card without resolving A's op - the
    // guard resets and a second op (card B) starts.
    editor.init();
    let resolveOpenB;
    window.imageEditor.open = vi.fn(() => new Promise((resolve) => { resolveOpenB = resolve; }));
    const imgInputB = editor.backdrop.querySelector('#editor-img');
    imgInputB.value = 'images/card-b.webp';
    const editPromiseB = editor.editExistingImage(); // card B's op, currently in flight
    await Promise.resolve();
    await Promise.resolve();
    expect(editor._imageOpInProgress).toBe(true);

    // Now let card A's stale op resolve. It must not touch card B's input or
    // clear card B's in-progress guard.
    resolveOpenA('data:image/webp;base64,AAAA');
    await editPromiseA;

    expect(imgInputB.value).toBe('images/card-b.webp'); // untouched by stale op A
    expect(editor._imageOpInProgress).toBe(true); // B's op still guarded
    expect(editor.backdrop.querySelector('#editor-remove-img').disabled).toBe(true);

    resolveOpenB('data:image/webp;base64,BBBB');
    await editPromiseB;
    expect(editor._imageOpInProgress).toBe(false);
  });

  it('save() does not persist an unprocessed URL if Enter races an in-flight image op', async () => {
    window.imageEditor.open = vi.fn(() => new Promise(() => {})); // never settles

    const imgInput = editor.backdrop.querySelector('#editor-img');
    imgInput.value = 'images/foo.webp';
    editor.editExistingImage();
    expect(editor._imageOpInProgress).toBe(true);

    const onSave = vi.fn();
    editor.onSave = onSave;
    editor.backdrop.querySelector('#editor-set').value = 'Prizm';
    await editor.save();

    expect(onSave).not.toHaveBeenCalled();
  });
});
