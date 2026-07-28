import { describe, it, expect, afterEach } from 'vitest';

const CardEditorModal = globalThis.CardEditorModal;
const CardContextMenu = globalThis.CardContextMenu;

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

// ============================================================================
// The real editor: built through the constructor and init(), nothing wired by
// hand. Everything above uses makeEditor, which skips init() entirely, so it
// would all still pass on an editor that never wired the fallback at all.
//
// The two things checked below - that init() wires the fallback, and that the
// markup it builds carries no inline handler - used to be asserted by grepping
// src/card-editor.js for a literal string (#699). Text matching proved a line
// existed, not that it ran: gutting _initPreviewFallback into a no-op, or moving
// the call somewhere it never executes, left the old test green. And the
// inline-handler regex required a quote straight after the `=`, so
// `onerror=${`alert(1)`}` inside a template literal slipped past it. Running the
// code and reading parsed attribute names has neither problem.
// ============================================================================

// Mirrors how checklist-engine builds the editor: custom fields at every
// position, categories and link targets, so the walk below covers the
// config-driven markup rather than only the static template.
const RICH_OPTIONS = {
    cardTypes: [],
    categories: [{ value: 'inserts', label: 'Inserts' }],
    getLinkTargets: () => [{ value: 'checklist.html?id=x', label: 'Another checklist' }],
    customFields: {
        years: { label: 'Years Active', type: 'text', position: 'top' },
        grade: {
            label: 'Grade', type: 'select', position: 'after-num',
            options: [{ value: 10, label: 'Ten' }],
        },
        auto: { label: 'Auto', type: 'checkbox', position: 'attributes' },
        note: { label: 'Note', type: 'text', position: 'bottom' },
    },
};

function makeRealEditor(options = RICH_OPTIONS) {
    const editor = new CardEditorModal(options);
    editor.init();
    return editor;
}

// Typing into #editor-img is what drives the preview in the real editor, so go
// through the input's own handler rather than calling updateImagePreview.
//
// The URLs typed below are repo-relative rather than R2 ones because the same
// handler also calls updateImageActions, which compares against R2_IMAGE_BASE - a
// top-level const in shared.js that the test setup evaluates into its own lexical
// scope, so card-editor.js cannot see it here the way it can in the browser. A
// path under imageFolder short-circuits that comparison. Same workaround as
// tests/collection-link-editor.test.js; the preview treats both kinds of value
// identically, so nothing under test turns on the choice.
const IMG_URL = 'images/card.webp';

function typeImageUrl(editor, url) {
    const input = editor.backdrop.querySelector('#editor-img');
    input.value = url;
    input.dispatchEvent(new window.Event('input'));
    return editor.backdrop.querySelector('.card-editor-image-preview');
}

describe('CardEditorModal.init wires the preview fallback', () => {
    afterEach(() => {
        document.querySelectorAll('.card-editor-backdrop').forEach(el => el.remove());
    });

    it('renders an image for a pasted URL', () => {
        // Guards the two tests below: they would both pass on an editor whose
        // preview never rendered an image to break in the first place.
        const preview = typeImageUrl(makeRealEditor(), IMG_URL);

        expect(preview.querySelectorAll('img')).toHaveLength(1);
        expect(preview.querySelector('img').getAttribute('src')).toBe(IMG_URL);
        expect(preview.querySelector('span.placeholder')).toBeNull();
    });

    it('replaces an image that fails to load with the placeholder', () => {
        const editor = makeRealEditor();
        const preview = typeImageUrl(editor, IMG_URL);

        // error does not bubble, so this only ever reaches a capturing listener -
        // which is what _initPreviewFallback attaches to the preview container.
        // jsdom runs the full capture path for a non-bubbling event, so an error
        // dispatched on the img propagates down through the container exactly as
        // a real failed load would.
        preview.querySelector('img').dispatchEvent(new window.Event('error'));

        expect(preview.querySelectorAll('img')).toHaveLength(0);
        expect(preview.querySelector('span.placeholder').textContent).toBe('Failed to load');
    });

    it('keeps working for an image rendered by a later preview update', () => {
        // One listener bound in init() has to cover every preview the editor
        // renders afterwards, since updateImagePreview rewrites the container's
        // innerHTML rather than replacing the container.
        const editor = makeRealEditor();
        typeImageUrl(editor, 'images/one.webp');
        typeImageUrl(editor, '');
        const preview = typeImageUrl(editor, 'images/two.webp');

        preview.querySelector('img').dispatchEvent(new window.Event('error'));

        expect(preview.querySelector('span.placeholder').textContent).toBe('Failed to load');
    });
});

// Every on* attribute on every element in a subtree. Asserting parsed attribute
// names is what closes the backtick hole: how the markup was written stops
// mattering, only what it parses to. It is also the only level that can tell an
// attribute from a value that looks like one - #692 tried an innerHTML regex and
// failed 13 tests against correct code, because a hostile card value survives
// verbatim inside an attribute and serialises as text containing ` onerror="`.
//
// Handlers assigned as properties (dropzone.ondrop = fn, btn.onclick = fn) set no
// attribute and are deliberately not covered: they take a function rather than a
// string, so no card or config value can be executed through one. The old regex
// did not flag them either.
function inlineHandlers(root) {
    return [...root.querySelectorAll('*')]
        .flatMap(el => el.getAttributeNames())
        .filter(name => name.startsWith('on'));
}

function parse(html) {
    const host = document.createElement('div');
    host.innerHTML = html;
    return host;
}

describe('the inline-handler guard itself detects a handler', () => {
    // Without these the walk below could report clean because the helper never
    // flags anything.
    it('flags a conventionally quoted handler', () => {
        expect(inlineHandlers(parse('<button onclick="alert(1)">x</button>'))).toEqual(['onclick']);
    });

    it('flags a handler the old source-text regex missed', () => {
        // What `<img src="x" onerror=${`alert(1)`}>` in a template literal
        // produces: an unquoted attribute value. The old regex required a quote
        // immediately after the `=`, so neither the source nor this markup
        // matched it.
        const html = '<img src="x" onerror=alert(1)>';

        expect(html).not.toMatch(/\son(error|click|change|load)\s*=\s*["']/);
        expect(inlineHandlers(parse(html))).toEqual(['onerror']);
    });

    it('ignores an attribute value that merely looks like a handler', () => {
        // The #692 false positive: nothing is injected here, and a text match on
        // the serialised markup would report a handler that does not exist.
        const host = parse(`<img alt='x" onerror="alert(1)'>`);

        expect(host.querySelector('img').getAttributeNames().sort()).toEqual(['alt']);
        expect(inlineHandlers(host)).toEqual([]);
    });
});

describe('the editor markup carries no inline event handler', () => {
    afterEach(() => {
        document.querySelectorAll('.card-editor-backdrop, .card-context-menu')
            .forEach(el => el.remove());
    });

    // Pins that the fixture really built the whole editor, so an empty handler
    // list means "walked the markup and found none" rather than "walked nothing".
    function expectWholeEditorWalked(editor) {
        const el = editor.backdrop;
        expect(el.querySelectorAll('.card-editor-modal')).toHaveLength(1);
        expect(el.querySelectorAll('button').length).toBeGreaterThanOrEqual(8);
        // One per custom field position, plus the two config-driven selects.
        for (const id of ['#editor-years', '#editor-grade', '#editor-auto', '#editor-note',
            '#editor-category', '#editor-collection-link', '#editor-img']) {
            expect(el.querySelector(id), id).not.toBeNull();
        }
        expect(el.querySelectorAll('*').length).toBeGreaterThan(60);
    }

    it('renders none anywhere in the modal init() builds', () => {
        const editor = makeRealEditor();

        expectWholeEditorWalked(editor);
        expect(inlineHandlers(editor.backdrop)).toEqual([]);
    });

    it('renders none on the preview image, nor on the placeholder replacing it', () => {
        const editor = makeRealEditor();
        const preview = typeImageUrl(editor, IMG_URL);
        expect(preview.querySelectorAll('img')).toHaveLength(1);
        expect(inlineHandlers(editor.backdrop)).toEqual([]);

        preview.querySelector('img').dispatchEvent(new window.Event('error'));

        expect(preview.querySelector('span.placeholder')).not.toBeNull();
        expect(inlineHandlers(editor.backdrop)).toEqual([]);
    });

    it('renders none in the card context menu', () => {
        // The other markup card-editor.js writes, and in scope for the old
        // whole-file regex, so it stays in scope here.
        const menu = new CardContextMenu(null);
        menu.createMenu();

        expect(menu.menu.querySelectorAll('.context-menu-item')).toHaveLength(3);
        expect(inlineHandlers(menu.menu)).toEqual([]);
    });
});
