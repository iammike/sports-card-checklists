import { describe, it, expect } from 'vitest';

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
});
