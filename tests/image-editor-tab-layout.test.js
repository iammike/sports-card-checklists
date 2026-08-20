import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ImageEditorModal = globalThis.ImageEditorModal;

// The CSS assertions below are about the image editor's controls going missing on
// a short window. Two ways that happens. Everything drawn on top of the picture -
// the perspective corner handles, the guide quad, Cropper's own drag handles - is
// positioned against .image-editor-canvas, which is overflow:hidden, so anything
// sized against a different box spills out and is silently clipped. Separately,
// the toolbars go under the fold if the canvas stops yielding space to them.
// Both read to the user as "the controls are gone" rather than as a layout bug.
// The tests after the CSS group cover tab-switch ordering instead.

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
    // Comments stripped: a rule that only *mentions* a declaration in prose would
    // otherwise satisfy an assertion looking for it, and the rule these tests lean
    // on hardest is the one carrying the long explanatory comment.
    return [...css.matchAll(rule)].map(m => m[1].replace(/\/\*[\s\S]*?\*\//g, ''));
}

// The used vertical overflow. Last declaration wins, `overflow: <x> <y>` sets both
// axes in that order, and an axis left `visible` computes to `auto` when the other
// axis is neither `visible` nor `clip` - which is why neither line in the shipped
// pair is load-bearing alone. The `clip` half of that carve-out matters: a `clip`
// on the other axis leaves this one `visible`, so it cannot stand in for the
// scroll the way `hidden` does.
function usedOverflowY(rule) {
    const initial = ['initial', 'unset', 'revert', 'revert-layer'];
    const norm = (v) => (initial.includes(v) ? 'visible' : v);
    let x = 'visible', y = 'visible';
    // The lookbehind matters: without it `text-overflow: ellipsis` matches as an
    // `overflow` declaration and poisons the result.
    for (const [, axis, raw] of rule.matchAll(/(?<![\w-])overflow(-[xy])?:\s*([^;]+)/g)) {
        const [first, second] = raw.replace(/!important/gi, '').trim().toLowerCase().split(/\s+/);
        if (axis === '-x') x = norm(first);
        else if (axis === '-y') y = norm(first);
        else { x = norm(first); y = norm(second ?? first); }
    }
    return y === 'visible' && x !== 'visible' && x !== 'clip' ? 'auto' : y;
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

    // A pixel floor here stops the canvas yielding space to the toolbars. That no
    // longer re-clips the handles - the modal's definite height prevents it - but
    // it does push the crop toolbar under the fold on an ordinary window: roughly
    // 80px under at 600px tall, where the shipped rule fits everything on screen.
    it('leaves the canvas container free to shrink', () => {
        const rules = cssRules('.image-editor-canvas');
        expect(rules.length).toBeGreaterThan(0);
        // Every declaration, not just the first: the last one wins in CSS. And any
        // unit, not just px - a rem or calc() floor pins the canvas open too.
        // Dropping the declaration entirely is a floor as well, since min-height
        // then falls back to auto, so one has to be present and all have to be 0.
        const floors = rules
            .flatMap(rule => [...rule.matchAll(/(?<![\w-])min-height:\s*([^;]+)/g)])
            .map(m => m[1].replace(/!important/g, '').trim());
        expect(floors.length).toBeGreaterThan(0);
        // Every spelling of zero, since all of them leave the canvas free: 0, 0px,
        // 0%, 0.0rem. Anything else is a floor.
        for (const floor of floors) expect(floor).toMatch(/^0(\.0+)?\s*(%|[a-z]+)?$/i);
    });

    // The scrolling the .image-editor-body comment is about. Asserting on the
    // declaration text is not enough: clipping the axis instead - hidden, clip, or
    // a two-value shorthand with the axes the wrong way round - reads as "not
    // visible" while losing the rotate controls with no way to scroll to them,
    // which is worse than the overflow it replaced. So resolve the axis.
    it('lets the modal body scroll when the toolbars no longer fit', () => {
        const rules = cssRules('.image-editor-body');
        expect(rules.length).toBeGreaterThan(0);
        expect(rules.some(rule => ['auto', 'scroll'].includes(usedOverflowY(rule)))).toBe(true);
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

    // Nothing in switchTab sets img.onerror - the recovery comes from the handler
    // open() left on the shared <img>, which is invisible at the call site. Pinned
    // because confirm()'s switching guard means a latch stuck on means Done stops
    // working too, not just the tabs.
    it('recovers from a failed image load during the switch back to crop', async () => {
        const editor = new ImageEditorModal();
        editor.loadCropperJS = async () => {};
        globalThis.Cropper = class {
            constructor(img, options) { options.ready?.(); }
            destroy() {}
        };

        const opened = editor.open('https://example.test/card.png');
        const failure = expect(opened).rejects.toThrow('Failed to load image');
        await Promise.resolve();

        // Land on perspective, then switch back with a source that will not load.
        editor.activeTab = 'perspective';
        editor.perspectiveCanvas = null;
        editor.switchTab('crop');

        const img = editor.backdrop.querySelector('#image-editor-img');
        img.onerror();

        expect(editor.switching).toBe(false);
        expect(editor.backdrop.classList.contains('active')).toBe(false);
        await failure;
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
