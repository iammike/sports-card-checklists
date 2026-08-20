import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ImageEditorModal = globalThis.ImageEditorModal;

// Both assertions here are about one thing: everything the image editor draws on
// top of the picture - the perspective corner handles, the guide quad, Cropper's
// own drag handles - is positioned against .image-editor-canvas, which is
// overflow:hidden. Anything sized against a different box than that container
// spills out and is silently clipped, which reads to the user as "the controls
// are gone" rather than as a layout bug.

// --- CSS: the canvas must be bounded by its container, not the viewport -------

// The canvas used to be capped at 60vh while .image-editor-canvas was capped at
// "90vh minus the modal chrome". Those differ on windows shorter than ~880px, and
// the excess was enough to clip all four handles out of sight.
//
// max-height:100% only fixes that while the height chain above it stays definite:
// a percentage against a content-sized ancestor computes to none, which is exactly
// what the modal's old max-height:90vh gave. Hence the second assertion - it is
// load-bearing for the first, and nothing else about the modal advertises that.
// Bodies of the rules whose selector is exactly `selector`. The leading boundary
// keeps descendant rules out: `.image-editor-backdrop.active .image-editor-modal`
// sets only a transform and would otherwise fail the height assertion.
function cssRules(selector) {
    const css = readFileSync(resolve(import.meta.dirname, '..', 'shared.css'), 'utf-8');
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rule = new RegExp('(?:^|[\n},])\\s*' + escaped + '\\s*\\{([^}]*)\\}', 'g');
    return [...css.matchAll(rule)].map(m => m[1]);
}

// --- Tab switching: the panel swap has to land before anything measures -------

// The crop panel is a two-row toolbar; the perspective panel is one line of hint
// text. Switching between them resizes the canvas container, and Cropper reads
// that container exactly once, at construction. Constructing it while the old
// panel is still shown leaves its box the wrong height for good.
function panelVisibility(backdrop) {
    const shown = (name) =>
        backdrop.querySelector(`[data-tab-content="${name}"]`).style.display !== 'none';
    return { crop: shown('crop'), perspective: shown('perspective') };
}

function makeEditorOnPerspectiveTab() {
    const editor = new ImageEditorModal();
    editor.init();
    editor.activeTab = 'perspective';
    editor.updateTabUI('perspective');
    // No perspectiveCanvas: switchTab then falls back to cacheBustedSrc rather
    // than calling toDataURL, which jsdom cannot do.
    editor.perspectiveCanvas = null;
    editor.cacheBustedSrc = 'data:image/png;base64,aaaa';
    return editor;
}

describe('image editor overlay layout', () => {
    afterEach(() => {
        document.querySelector('.image-editor-backdrop')?.remove();
        delete globalThis.Cropper;
    });

    it('sizes the perspective canvas against its container in every rule', () => {
        const rules = cssRules('.perspective-canvas');
        // Count first: a loop over zero matched rules passes without asserting.
        expect(rules.length).toBeGreaterThan(0);
        for (const rule of rules) {
            expect(rule).toMatch(/max-height:\s*100%/);
        }
    });

    it('gives the modal a definite height so that percentage resolves', () => {
        const rules = cssRules('.image-editor-modal');
        expect(rules.length).toBeGreaterThan(0);
        for (const rule of rules) {
            expect(rule).toMatch(/(^|[;{\s])height:\s*\d/);
        }
    });

    it('shows the crop panel before constructing Cropper', () => {
        const editor = makeEditorOnPerspectiveTab();

        let visibilityAtConstruction = null;
        globalThis.Cropper = class {
            constructor(img, options) {
                visibilityAtConstruction = panelVisibility(editor.backdrop);
                options.ready?.();
            }
            destroy() {}
        };

        editor.switchTab('crop');
        // jsdom never loads the src, so drive the handler the way a decode would.
        editor.backdrop.querySelector('#image-editor-img').onload();

        expect(visibilityAtConstruction).toEqual({ crop: true, perspective: false });
    });

    // The window between the two tabs' editors: activeTab already names the
    // destination, but neither Cropper nor the perspective canvas exists yet, so
    // both confirm() branches fall through to a reject that throws the edit away.
    it('ignores Done while a tab switch is in flight', () => {
        const editor = new ImageEditorModal();
        editor.init();
        editor.backdrop.classList.add('active');
        editor.switching = true;
        editor.activeTab = 'crop';
        editor.cropper = null;
        editor.resolvePromise = vi.fn();
        editor.rejectPromise = vi.fn();

        editor.confirm();

        expect(editor.rejectPromise).not.toHaveBeenCalled();
        expect(editor.resolvePromise).not.toHaveBeenCalled();
        // close() clears both handles, so the editor is still able to resolve later.
        expect(editor.backdrop.classList.contains('active')).toBe(true);
    });

    it('shows the perspective panel before laying out the corner handles', () => {
        const editor = new ImageEditorModal();
        editor.init();
        editor.updateTabUI('crop');
        editor.cacheBustedSrc = 'data:image/png;base64,aaaa';

        // switchTab decodes into a detached Image, which jsdom never loads.
        // Capture it so the test can fire the callback the decode would.
        const RealImage = globalThis.Image;
        let tempImg = null;
        globalThis.Image = class {
            constructor() {
                tempImg = this;
            }
        };

        let visibilityAtSetup = null;
        editor.setupPerspectiveCanvas = function () {
            visibilityAtSetup = panelVisibility(this.backdrop);
        };

        try {
            editor.switchTab('perspective');
            tempImg.onload();
        } finally {
            globalThis.Image = RealImage;
        }

        expect(visibilityAtSetup).toEqual({ crop: false, perspective: true });
    });
});
