import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const CardEditorModal = globalThis.CardEditorModal;

// Build a minimal editor whose backdrop has just the preview container,
// so updateImagePreview can run without the full modal.
function makeEditor(imageFolder = 'images/test') {
    const editor = Object.create(CardEditorModal.prototype);
    editor.imageFolder = imageFolder;
    const backdrop = document.createElement('div');
    backdrop.innerHTML = '<div class="card-editor-image-preview"></div>';
    editor.backdrop = backdrop;
    return editor;
}

function previewHtml(editor) {
    return editor.backdrop.querySelector('.card-editor-image-preview').innerHTML;
}

describe('CardEditorModal.updateImagePreview', () => {
    it('renders an <img> for absolute http(s) URLs', () => {
        const editor = makeEditor();
        editor.updateImagePreview('https://example.com/card.jpg');
        expect(previewHtml(editor)).toContain('<img');
        expect(previewHtml(editor)).toContain('https://example.com/card.jpg');
    });

    it('renders an <img> for data URLs', () => {
        const editor = makeEditor();
        editor.updateImagePreview('data:image/webp;base64,AAAA');
        expect(previewHtml(editor)).toContain('<img');
        expect(previewHtml(editor)).toContain('data:image/webp;base64,AAAA');
    });

    it('renders an <img> for local paths under the image folder', () => {
        const editor = makeEditor('images/jayden-daniels');
        editor.updateImagePreview('images/jayden-daniels/card.webp');
        expect(previewHtml(editor)).toContain('<img');
        expect(previewHtml(editor)).toContain('images/jayden-daniels/card.webp');
    });

    it('shows the placeholder for empty input', () => {
        const editor = makeEditor();
        editor.updateImagePreview('');
        expect(previewHtml(editor)).not.toContain('<img');
        expect(previewHtml(editor)).toContain('No image');
    });

    it('does NOT load a protocol-less value as a relative image (the 404 bug)', () => {
        const editor = makeEditor();
        editor.updateImagePreview('api.github.com/gists/5f2b43f0588d72892273ae8f24f68c2d');
        expect(previewHtml(editor)).not.toContain('<img');
        expect(previewHtml(editor)).toContain('No image');
    });

    it('does NOT load partial typing as an image', () => {
        const editor = makeEditor();
        editor.updateImagePreview('https:/');
        expect(previewHtml(editor)).not.toContain('<img');
    });

    it('writes no inline event handler onto the preview image', () => {
        // The last inline handler in src/. Behaviour moved to a delegated
        // listener; the attribute must not come back.
        const editor = makeEditor();
        editor.updateImagePreview('https://example.com/card.jpg');
        const img = editor.backdrop.querySelector('img');
        expect(img.hasAttribute('onerror')).toBe(false);
        expect(previewHtml(editor)).not.toContain('onerror');
    });
});

// A preview image that fails to load is replaced by a placeholder. The listener
// is attached once, to the preview container built in init(), so it has to keep
// working for every image updateImagePreview renders after that.
function makeWiredEditor(imageFolder = 'images/test') {
    const editor = makeEditor(imageFolder);
    editor._initPreviewFallback();
    return editor;
}

function failLoad(editor) {
    const img = editor.backdrop.querySelector('img');
    // error does not bubble, so this only reaches a capturing listener.
    img.dispatchEvent(new window.Event('error'));
    return img;
}

describe('CardEditorModal preview fallback', () => {
    it('replaces a failed image with the placeholder', () => {
        const editor = makeWiredEditor();
        editor.updateImagePreview('https://example.com/card.jpg');

        failLoad(editor);

        expect(previewHtml(editor)).not.toContain('<img');
        const span = editor.backdrop.querySelector('span.placeholder');
        expect(span).not.toBeNull();
        expect(span.textContent).toBe('Failed to load');
    });

    it('keeps working for images rendered by later preview updates', () => {
        // updateImagePreview rewrites the container's innerHTML rather than
        // replacing the container, so the one listener survives.
        const editor = makeWiredEditor();
        editor.updateImagePreview('https://example.com/one.jpg');
        editor.updateImagePreview('');
        editor.updateImagePreview('https://example.com/two.jpg');

        failLoad(editor);

        expect(editor.backdrop.querySelector('span.placeholder').textContent)
            .toBe('Failed to load');
    });

    it('leaves an image that loads fine alone', () => {
        const editor = makeWiredEditor();
        editor.updateImagePreview('https://example.com/card.jpg');

        expect(editor.backdrop.querySelector('img')).not.toBeNull();
        expect(editor.backdrop.querySelector('span.placeholder')).toBeNull();
    });

    it('ignores an error from something that is not an image', () => {
        const editor = makeWiredEditor();
        const preview = editor.backdrop.querySelector('.card-editor-image-preview');
        preview.innerHTML = '<div id="not-an-image"></div>';

        preview.querySelector('#not-an-image').dispatchEvent(new window.Event('error'));

        expect(preview.querySelector('#not-an-image')).not.toBeNull();
        expect(preview.querySelector('span.placeholder')).toBeNull();
    });

    it('does nothing when there is no preview container to bind to', () => {
        const editor = Object.create(CardEditorModal.prototype);
        editor.backdrop = document.createElement('div');

        expect(() => editor._initPreviewFallback()).not.toThrow();
    });
});

describe('CardEditorModal.init — the preview fallback is actually wired', () => {
    // makeEditor skips init(), so the tests above would still pass if init()
    // never called _initPreviewFallback. Check the real call site.
    it('calls _initPreviewFallback from init', () => {
        const src = readFileSync(
            resolve(import.meta.dirname, '..', 'src', 'card-editor.js'),
            'utf-8',
        );
        expect(src).toContain('this._initPreviewFallback();');
    });

    it('leaves no inline event handler anywhere in the editor markup', () => {
        const src = readFileSync(
            resolve(import.meta.dirname, '..', 'src', 'card-editor.js'),
            'utf-8',
        );
        expect(src).not.toMatch(/\son(error|click|change|load)\s*=\s*["']/);
    });
});
