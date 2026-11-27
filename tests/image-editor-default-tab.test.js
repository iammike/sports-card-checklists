import { describe, it, expect, afterEach, vi } from 'vitest';

const ImageEditorModal = globalThis.ImageEditorModal;

// The editor opens on the Perspective tab. open() decodes the source into a
// detached Image and builds the perspective canvas from it; jsdom never loads
// images, so each test captures those Images and fires their callbacks itself.
let images = [];
const RealImage = globalThis.Image;

function makeEditor() {
    images = [];
    globalThis.Image = class { constructor() { images.push(this); } };
    const editor = new ImageEditorModal();
    editor.loadCropperJS = async () => {};
    // Canvas drawing is out of reach in jsdom; record the call instead.
    editor.setupPerspectiveCanvas = vi.fn(function () { this.perspectiveCanvas = {}; });
    return editor;
}

// open() awaits loadCropperJS before it builds anything.
const settle = () => new Promise(r => setTimeout(r, 0));

describe('image editor opens on the Perspective tab', () => {
    afterEach(() => {
        globalThis.Image = RealImage;
        document.querySelector('.image-editor-backdrop')?.remove();
    });

    it('shows the perspective tab and panel, not crop', async () => {
        const editor = makeEditor();
        editor.open('data:image/png;base64,aaaa');
        await settle();

        const tabs = editor.backdrop.querySelectorAll('.image-editor-tab');
        expect(tabs).toHaveLength(2);
        expect(tabs[0].dataset.tab).toBe('perspective');
        expect(editor.backdrop.querySelector('.image-editor-tab.active').dataset.tab).toBe('perspective');
        expect(editor.backdrop.querySelector('[data-tab-content="perspective"]').style.display).toBe('');
        expect(editor.backdrop.querySelector('[data-tab-content="crop"]').style.display).toBe('none');
        expect(editor.activeTab).toBe('perspective');
        expect(editor.cropper).toBeNull();
    });

    it('holds Done and tab switches until the canvas is built', async () => {
        const editor = makeEditor();
        const opened = editor.open('data:image/png;base64,aaaa');
        let settled = false;
        opened.then(() => { settled = true; }, () => { settled = true; });
        await settle();

        expect(images).toHaveLength(1);
        expect(editor.switching).toBe(true);
        editor.confirm();
        await settle();
        expect(settled).toBe(false);
        expect(editor.backdrop.classList.contains('active')).toBe(true);

        images[0].onload();
        expect(editor.setupPerspectiveCanvas).toHaveBeenCalledTimes(1);
        expect(editor.setupPerspectiveCanvas).toHaveBeenCalledWith(images[0]);
        expect(editor.switching).toBe(false);
    });

    it('drops corners moved in an earlier session', async () => {
        const editor = makeEditor();
        editor.cornerPositions = [{ x: 0.2, y: 0.1 }, { x: 0.9, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
        editor.open('data:image/png;base64,aaaa');
        await settle();
        expect(editor.cornersAreDefault()).toBe(true);
    });

    it('ignores a load that finishes after the editor was reopened', async () => {
        const editor = makeEditor();
        editor.open('data:image/png;base64,first').catch(() => {});
        await settle();
        editor.cancel();
        editor.open('data:image/png;base64,second');
        await settle();

        expect(images).toHaveLength(2);
        images[0].onload();
        expect(editor.setupPerspectiveCanvas).not.toHaveBeenCalled();
        images[1].onload();
        expect(editor.setupPerspectiveCanvas).toHaveBeenCalledTimes(1);
        expect(editor.setupPerspectiveCanvas).toHaveBeenCalledWith(images[1]);
    });

    it('resolves with the on-screen image when Done is pressed with no edits', async () => {
        const editor = makeEditor();
        editor.setupPerspectiveCanvas = vi.fn(function () {
            this.perspectiveCanvas = { toDataURL: vi.fn(() => 'data:image/webp;base64,done'), remove() {} };
        });
        const opened = editor.open('data:image/png;base64,aaaa');
        await settle();
        images[0].onload();

        editor.confirm();
        await expect(opened).resolves.toBe('data:image/webp;base64,done');
        expect(editor.backdrop.classList.contains('active')).toBe(false);
        // Encoded from the canvas already held, not a refetch of the source.
        expect(images).toHaveLength(1);
    });

    it('rejects and closes instead of hanging when the canvas cannot be built', async () => {
        const editor = makeEditor();
        editor.setupPerspectiveCanvas = vi.fn(() => { throw new Error('Canvas 2D context unavailable'); });
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const opened = editor.open('data:image/png;base64,aaaa');
        const failure = expect(opened).rejects.toThrow('Failed to load image');
        await settle();

        images[0].onload();
        expect(editor.switching).toBe(false);
        expect(editor.backdrop.classList.contains('active')).toBe(false);
        await failure;
        console.error.mockRestore();
    });

    it('hands Cropper the source itself when switching to crop with corners untouched', async () => {
        const editor = makeEditor();
        const toDataURL = vi.fn(() => 'data:image/png;base64,encoded');
        editor.setupPerspectiveCanvas = vi.fn(function () { this.perspectiveCanvas = { toDataURL, remove() {} }; });
        globalThis.Cropper = class { constructor() {} destroy() {} };
        editor.open('data:image/png;base64,source').catch(() => {});
        await settle();
        images[0].onload();

        editor.switchTab('crop');
        expect(toDataURL).not.toHaveBeenCalled();
        expect(editor.backdrop.querySelector('#image-editor-img').getAttribute('src')).toBe('data:image/png;base64,source');
        delete globalThis.Cropper;
    });

    it('does not carry baked-in corners back to the perspective tab', async () => {
        const editor = makeEditor();
        editor.setupPerspectiveCanvas = vi.fn(function () {
            this.perspectiveCanvas = { width: 10, height: 10, toDataURL: () => 'data:image/png;base64,x', remove() {} };
            this.resetCornerHandles();
        });
        const transform = vi.spyOn(globalThis.PerspectiveTransform, 'transform')
            .mockReturnValue({ toDataURL: () => 'data:image/png;base64,straightened' });
        let cropperReady;
        globalThis.Cropper = class {
            constructor(img, options) { cropperReady = options.ready; }
            getCroppedCanvas() { return { toDataURL: () => 'data:image/png;base64,cropped' }; }
            destroy() {}
        };
        editor.open('data:image/png;base64,source').catch(() => {});
        await settle();
        images[0].onload();

        editor.cornerPositions[0] = { x: 0.2, y: 0.1 };
        editor.switchTab('crop');
        expect(transform).toHaveBeenCalledTimes(1);
        editor.backdrop.querySelector('#image-editor-img').onload();
        cropperReady();

        editor.switchTab('perspective');
        images[images.length - 1].onload();
        expect(editor.activeTab).toBe('perspective');
        // The image is already straightened; restored corners would warp it again.
        expect(editor.cornersAreDefault()).toBe(true);
        transform.mockRestore();
        delete globalThis.Cropper;
    });

    it('closes and rejects when the image fails to load switching back to perspective', async () => {
        const editor = makeEditor();
        globalThis.Cropper = class {
            constructor(img, options) { options.ready?.(); }
            getCroppedCanvas() { return { toDataURL: () => 'data:image/png;base64,cropped' }; }
            destroy() {}
        };
        editor.setupPerspectiveCanvas = vi.fn(function () { this.perspectiveCanvas = { remove() {} }; });
        const opened = editor.open('data:image/png;base64,source');
        const failure = expect(opened).rejects.toThrow('Failed to load image');
        await settle();
        images[0].onload();
        editor.switchTab('crop');
        editor.backdrop.querySelector('#image-editor-img').onload();

        editor.switchTab('perspective');
        images[images.length - 1].onerror();
        expect(editor.switching).toBe(false);
        expect(editor.backdrop.classList.contains('active')).toBe(false);
        await failure;
        delete globalThis.Cropper;
    });

    it('ignores a switch-back decode that finishes after the editor was reopened', async () => {
        const editor = makeEditor();
        globalThis.Cropper = class {
            constructor(img, options) { options.ready?.(); }
            getCroppedCanvas() { return { toDataURL: () => 'data:image/png;base64,cropped' }; }
            destroy() {}
        };
        editor.setupPerspectiveCanvas = vi.fn(function () { this.perspectiveCanvas = { remove() {} }; });
        editor.open('data:image/png;base64,first').catch(() => {});
        await settle();
        images[0].onload();
        editor.switchTab('crop');
        editor.backdrop.querySelector('#image-editor-img').onload();
        editor.switchTab('perspective');
        const staleDecode = images[images.length - 1];

        editor.cancel();
        const reopened = editor.open('data:image/png;base64,second');
        let settled = false;
        reopened.then(() => { settled = true; }, () => { settled = true; });
        await settle();

        staleDecode.onerror();
        await settle();
        expect(settled).toBe(false);
        expect(editor.backdrop.classList.contains('active')).toBe(true);
        expect(editor.switching).toBe(true);
        delete globalThis.Cropper;
    });

    it('rejects and closes when the image fails to load', async () => {
        const editor = makeEditor();
        const opened = editor.open('data:image/png;base64,aaaa');
        const failure = expect(opened).rejects.toThrow('Failed to load image');
        await settle();

        images[0].onerror();
        expect(editor.backdrop.classList.contains('active')).toBe(false);
        expect(editor.switching).toBe(false);
        await failure;
    });
});

describe('perspective working canvas size', () => {
    afterEach(() => {
        document.querySelector('.image-editor-backdrop')?.remove();
        vi.restoreAllMocks();
    });

    // Built for every open now, so a phone photo must not land on a full-size
    // canvas (iOS Safari refuses large ones outright).
    it.each([
        [6000, 4000, 2000, 1333],
        [3000, 4500, 1333, 2000],
        [640, 480, 640, 480],
    ])('draws a %ix%i source at %ix%i', (w, h, ew, eh) => {
        const drawImage = vi.fn();
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage });
        globalThis.ResizeObserver ??= class { observe() {} disconnect() {} };
        const editor = new ImageEditorModal();
        editor.init();
        editor.updateHandlePositions = () => {};
        editor.drawGuideLines = () => {};

        editor.setupPerspectiveCanvas({ naturalWidth: w, naturalHeight: h });
        expect(editor.perspectiveCanvas.width).toBe(ew);
        expect(editor.perspectiveCanvas.height).toBe(eh);
        expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, ew, eh);
    });

    it('throws rather than drawing nothing when the canvas has no 2D context', () => {
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
        const editor = new ImageEditorModal();
        editor.init();
        expect(() => editor.setupPerspectiveCanvas({ naturalWidth: 100, naturalHeight: 100 })).toThrow();
    });
});
