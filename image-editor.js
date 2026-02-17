/**
 * Image Processor - handles fetching, resizing, and converting images
 */
class ImageProcessor {
    constructor() {
        this.proxyUrl = 'https://cards-oauth.iammikec.workers.dev/proxy-image';
        this.maxSize = 800;      // Max width/height in pixels
        this.quality = 0.6;      // WebP quality (0-1)
        this.sharpen = 0.5;      // Sharpen amount (0-1)
        this.smooth = 0.2;       // Smooth/anti-alias amount (0-1)
        this.resizeQuality = 'high'; // Canvas resize quality
        this.allowedDomains = ['ebay', 'beckett'];
    }

    // Check if URL is from a supported image domain
    isProcessableUrl(url) {
        if (!url) return false;
        try {
            const parsed = new URL(url);
            return this.allowedDomains.some(domain => parsed.hostname.includes(domain));
        } catch {
            return false;
        }
    }

    // Fetch image via proxy to bypass CORS
    async fetchViaProxy(url) {
        const response = await fetch(this.proxyUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to fetch image');
        }

        return response.json(); // { base64, contentType }
    }

    // Load image from base64 data
    loadImage(base64, contentType) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('Failed to load image'));
            img.src = `data:${contentType};base64,${base64}`;
        });
    }

    // Sharpen filter (unsharp mask)
    sharpenCanvas(ctx, width, height, amount) {
        if (amount <= 0) return;

        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;
        const copy = new Uint8ClampedArray(data);

        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const i = (y * width + x) * 4;
                for (let c = 0; c < 3; c++) {
                    const idx = i + c;
                    const top = copy[idx - width * 4];
                    const bottom = copy[idx + width * 4];
                    const left = copy[idx - 4];
                    const right = copy[idx + 4];
                    const center = copy[idx];
                    const blur = (top + bottom + left + right) / 4;
                    const sharpened = center + amount * (center - blur);
                    data[idx] = Math.max(0, Math.min(255, sharpened));
                }
            }
        }
        ctx.putImageData(imageData, 0, 0);
    }

    // Smooth/anti-alias filter
    smoothCanvas(ctx, width, height, amount) {
        if (amount <= 0) return;

        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;
        const copy = new Uint8ClampedArray(data);

        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const i = (y * width + x) * 4;
                for (let c = 0; c < 3; c++) {
                    const idx = i + c;
                    const tl = copy[idx - width * 4 - 4];
                    const t  = copy[idx - width * 4];
                    const tr = copy[idx - width * 4 + 4];
                    const l  = copy[idx - 4];
                    const center = copy[idx];
                    const r  = copy[idx + 4];
                    const bl = copy[idx + width * 4 - 4];
                    const b  = copy[idx + width * 4];
                    const br = copy[idx + width * 4 + 4];
                    const avg = (tl + t + tr + l + center + r + bl + b + br) / 9;
                    const smoothed = center * (1 - amount) + avg * amount;
                    data[idx] = Math.max(0, Math.min(255, smoothed));
                }
            }
        }
        ctx.putImageData(imageData, 0, 0);
    }

    // Resize and convert to WebP using canvas
    async processImage(img) {
        // Calculate new dimensions maintaining aspect ratio
        let width = img.width;
        let height = img.height;

        if (width > this.maxSize || height > this.maxSize) {
            if (width > height) {
                height = Math.round(height * (this.maxSize / width));
                width = this.maxSize;
            } else {
                width = Math.round(width * (this.maxSize / height));
                height = this.maxSize;
            }
        }

        // Create canvas and draw resized image
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = this.resizeQuality;
        ctx.drawImage(img, 0, 0, width, height);

        // Apply sharpen then smooth
        this.sharpenCanvas(ctx, width, height, this.sharpen);
        this.smoothCanvas(ctx, width, height, this.smooth);

        // Convert to WebP
        const dataUrl = canvas.toDataURL('image/webp', this.quality);
        // Extract base64 content (remove data URL prefix)
        const base64 = dataUrl.split(',')[1];

        return { base64, width, height };
    }

    // Generate filename from card data
    generateFilename(cardData, addTimestamp = false) {
        const parts = [];

        // Set name (required)
        if (cardData.set) {
            parts.push(cardData.set.toLowerCase().replace(/\s+/g, '_'));
        }

        // Card name/variant if present
        if (cardData.name) {
            parts.push(cardData.name.toLowerCase().replace(/\s+/g, '_').replace(/\//g, '-'));
        }

        // Card number
        if (cardData.num) {
            parts.push(cardData.num.replace('#', ''));
        }

        // Add short timestamp suffix to avoid filename collisions when re-uploading
        if (addTimestamp) {
            parts.push(Date.now().toString(36));
        }

        // Create filename, sanitize for filesystem
        const name = parts.join('_').replace(/[^a-z0-9_-]/g, '');
        // Fall back to timestamp if all card fields are empty
        return `${name || Date.now().toString(36)}.webp`;
    }

    // Full pipeline: fetch, process, return base64 content (for committing)
    async processFromUrl(url) {
        // Fetch via proxy
        const { base64: rawBase64, contentType } = await this.fetchViaProxy(url);

        // Load into image element
        const img = await this.loadImage(rawBase64, contentType);

        // Resize and convert to WebP
        const { base64 } = await this.processImage(img);

        // Return base64 content (not data URL) for GitHub commit
        return base64;
    }

    // Process a local/existing image URL (for conversion script)
    async processFromLocalUrl(url) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = async () => {
                try {
                    const { base64 } = await this.processImage(img);
                    resolve(`data:image/webp;base64,${base64}`);
                } catch (e) {
                    reject(e);
                }
            };
            img.onerror = () => reject(new Error('Failed to load image'));
            img.src = url;
        });
    }
}

/**
 * Perspective transform math - 4-point homography with bilinear interpolation
 */
const PerspectiveTransform = {
    // Solve 8x8 system via Gaussian elimination for homography coefficients
    computeHomography(src, dst) {
        // Build 8x9 augmented matrix (Ah = 0, with h8 = 1)
        const A = [];
        for (let i = 0; i < 4; i++) {
            const sx = src[i].x, sy = src[i].y, dx = dst[i].x, dy = dst[i].y;
            A.push([sx, sy, 1, 0, 0, 0, -dx * sx, -dx * sy, dx]);
            A.push([0, 0, 0, sx, sy, 1, -dy * sx, -dy * sy, dy]);
        }
        // Gaussian elimination with partial pivoting
        for (let col = 0; col < 8; col++) {
            let maxRow = col, maxVal = Math.abs(A[col][col]);
            for (let row = col + 1; row < 8; row++) {
                if (Math.abs(A[row][col]) > maxVal) { maxVal = Math.abs(A[row][col]); maxRow = row; }
            }
            [A[col], A[maxRow]] = [A[maxRow], A[col]];
            const pivot = A[col][col];
            if (Math.abs(pivot) < 1e-10) return null;
            for (let j = col; j < 9; j++) A[col][j] /= pivot;
            for (let row = 0; row < 8; row++) {
                if (row === col) continue;
                const factor = A[row][col];
                for (let j = col; j < 9; j++) A[row][j] -= factor * A[col][j];
            }
        }
        return [A[0][8], A[1][8], A[2][8], A[3][8], A[4][8], A[5][8], A[6][8], A[7][8], 1];
    },

    applyHomography(H, x, y) {
        const w = H[6] * x + H[7] * y + H[8];
        return { x: (H[0] * x + H[1] * y + H[2]) / w, y: (H[3] * x + H[4] * y + H[5]) / w };
    },

    bilinearSample(data, w, h, x, y) {
        const x0 = Math.floor(x), y0 = Math.floor(y);
        if (x0 < 0 || y0 < 0 || x0 >= w || y0 >= h) return [0, 0, 0, 0];
        const x1 = Math.min(x0 + 1, w - 1), y1 = Math.min(y0 + 1, h - 1);
        const fx = x - x0, fy = y - y0;
        const i00 = (y0 * w + x0) * 4, i10 = (y0 * w + x1) * 4;
        const i01 = (y1 * w + x0) * 4, i11 = (y1 * w + x1) * 4;
        const d = data;
        return [0, 1, 2, 3].map(c =>
            (1 - fx) * (1 - fy) * d[i00 + c] + fx * (1 - fy) * d[i10 + c] +
            (1 - fx) * fy * d[i01 + c] + fx * fy * d[i11 + c]
        );
    },

    // Apply perspective correction: srcCorners (4 points on source) -> rectangular output
    transform(srcCanvas, srcCorners) {
        const sw = srcCanvas.width, sh = srcCanvas.height;
        const srcCtx = srcCanvas.getContext('2d');
        const srcData = srcCtx.getImageData(0, 0, sw, sh).data;

        // Compute output dimensions from corner distances
        const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
        const outW = Math.round(Math.max(dist(srcCorners[0], srcCorners[1]), dist(srcCorners[3], srcCorners[2])));
        const outH = Math.round(Math.max(dist(srcCorners[0], srcCorners[3]), dist(srcCorners[1], srcCorners[2])));

        const dstCorners = [{ x: 0, y: 0 }, { x: outW, y: 0 }, { x: outW, y: outH }, { x: 0, y: outH }];
        const H = this.computeHomography(dstCorners, srcCorners);
        if (!H) return null;

        const outCanvas = document.createElement('canvas');
        outCanvas.width = outW;
        outCanvas.height = outH;
        const outCtx = outCanvas.getContext('2d');
        const outImg = outCtx.createImageData(outW, outH);

        for (let y = 0; y < outH; y++) {
            for (let x = 0; x < outW; x++) {
                const s = this.applyHomography(H, x, y);
                const pixel = this.bilinearSample(srcData, sw, sh, s.x, s.y);
                const idx = (y * outW + x) * 4;
                outImg.data[idx] = pixel[0];
                outImg.data[idx + 1] = pixel[1];
                outImg.data[idx + 2] = pixel[2];
                outImg.data[idx + 3] = pixel[3];
            }
        }

        outCtx.putImageData(outImg, 0, 0);
        return outCanvas;
    }
};

/**
 * Image Editor Modal - crop and rotate images before processing
 * Uses Cropper.js for crop functionality
 */
class ImageEditorModal {
    constructor() {
        this.backdrop = null;
        this.cropper = null;
        this.currentImage = null;
        this.resolvePromise = null;
        this.rejectPromise = null;
        this.rotation = 0;
        // Tab-based UI state
        this.activeTab = 'crop'; // 'crop' | 'perspective'
        this.switching = false;
        this.perspectiveCanvas = null;
        this.perspectiveOverlay = null;
        this.cornerHandles = [];
        this.cornerPositions = []; // normalized 0-1 coordinates
        this.savedCornerPositions = null;
        this.originalImageSrc = null;
        this.cacheBustedSrc = null;
    }

    // Load Cropper.js from CDN if not already loaded
    async loadCropperJS() {
        if (window.Cropper) return;

        // Load CSS
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.6.1/cropper.min.css';
        document.head.appendChild(link);

        // Load JS
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.6.1/cropper.min.js';
            script.onload = resolve;
            script.onerror = () => reject(new Error('Failed to load Cropper.js'));
            document.head.appendChild(script);
        });
    }

    // Initialize - create modal DOM
    init() {
        if (document.querySelector('.image-editor-backdrop')) return;

        const backdrop = document.createElement('div');
        backdrop.className = 'image-editor-backdrop';
        backdrop.innerHTML = `
            <div class="image-editor-modal">
                <div class="image-editor-header">
                    <h2 class="image-editor-title">EDIT IMAGE</h2>
                    <button class="image-editor-close" title="Cancel">×</button>
                </div>
                <div class="image-editor-body">
                    <div class="image-editor-tabs">
                        <button type="button" class="image-editor-tab active" data-tab="crop">Crop & Rotate</button>
                        <button type="button" class="image-editor-tab" data-tab="perspective">Perspective</button>
                    </div>
                    <div class="image-editor-canvas">
                        <img id="image-editor-img" src="" alt="Edit">
                    </div>
                    <div data-tab-content="crop" class="image-editor-tab-panel">
                        <div class="image-editor-controls">
                            <div class="image-editor-controls-row">
                                <button class="image-editor-tool" data-action="rotate-left" title="Rotate 90° Left">
                                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M7.11 8.53L5.7 7.11C4.8 8.27 4.24 9.61 4.07 11h2.02c.14-.87.49-1.72 1.02-2.47zM6.09 13H4.07c.17 1.39.72 2.73 1.62 3.89l1.41-1.42c-.52-.75-.87-1.59-1.01-2.47zm1.01 5.32c1.16.9 2.51 1.44 3.9 1.61V17.9c-.87-.15-1.71-.49-2.46-1.03L7.1 18.32zM13 4.07V1L8.45 5.55 13 10V6.09c2.84.48 5 2.94 5 5.91s-2.16 5.43-5 5.91v2.02c3.95-.49 7-3.85 7-7.93s-3.05-7.44-7-7.93z"/></svg>
                                </button>
                                <button class="image-editor-tool" data-action="rotate-right" title="Rotate 90° Right">
                                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M15.55 5.55L11 1v3.07C7.06 4.56 4 7.92 4 12s3.05 7.44 7 7.93v-2.02c-2.84-.48-5-2.94-5-5.91s2.16-5.43 5-5.91V10l4.55-4.45zM19.93 11c-.17-1.39-.72-2.73-1.62-3.89l-1.42 1.42c.54.75.88 1.6 1.02 2.47h2.02zM13 17.9v2.02c1.39-.17 2.74-.71 3.9-1.61l-1.44-1.44c-.75.54-1.59.89-2.46 1.03zm3.89-2.42l1.42 1.41c.9-1.16 1.45-2.5 1.62-3.89h-2.02c-.14.87-.48 1.72-1.02 2.48z"/></svg>
                                </button>
                                <button class="image-editor-step-btn" id="rotate-minus" title="Decrease 0.1°">−</button>
                                <input type="range" class="image-editor-slider" id="image-editor-rotate" min="-45" max="45" value="0" step="0.1">
                                <button class="image-editor-step-btn" id="rotate-plus" title="Increase 0.1°">+</button>
                                <button class="image-editor-tool" data-action="flip-h" title="Flip Horizontal">
                                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M15 21h2v-2h-2v2zm4-12h2V7h-2v2zM3 5v14c0 1.1.9 2 2 2h4v-2H5V5h4V3H5c-1.1 0-2 .9-2 2zm16-2v2h2c0-1.1-.9-2-2-2zm-8 20h2V1h-2v22zm8-6h2v-2h-2v2zM15 5h2V3h-2v2zm4 8h2v-2h-2v2zm0 8c1.1 0 2-.9 2-2h-2v2z"/></svg>
                                </button>
                                <button class="image-editor-tool" data-action="flip-v" title="Flip Vertical">
                                    <svg viewBox="0 0 24 24" fill="currentColor" style="transform: rotate(90deg)"><path d="M15 21h2v-2h-2v2zm4-12h2V7h-2v2zM3 5v14c0 1.1.9 2 2 2h4v-2H5V5h4V3H5c-1.1 0-2 .9-2 2zm16-2v2h2c0-1.1-.9-2-2-2zm-8 20h2V1h-2v22zm8-6h2v-2h-2v2zM15 5h2V3h-2v2zm4 8h2v-2h-2v2zm0 8c1.1 0 2-.9 2-2h-2v2z"/></svg>
                                </button>
                            </div>
                            <div class="image-editor-controls-row">
                                <input type="text" class="image-editor-rotation-input" id="image-editor-rotate-value" value="0°" inputmode="decimal">
                            </div>
                        </div>
                    </div>
                    <div data-tab-content="perspective" class="image-editor-tab-panel" style="display:none">
                        <div class="perspective-controls">
                            <div class="perspective-hint">Drag the corners to correct perspective</div>
                        </div>
                    </div>
                </div>
                <div class="image-editor-footer">
                    <button class="image-editor-tool" data-action="reset" title="Reset">
                        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/></svg>
                    </button>
                    <div class="image-editor-footer-spacer"></div>
                    <button class="image-editor-btn cancel">Cancel</button>
                    <button class="image-editor-btn confirm">Done</button>
                </div>
            </div>
        `;

        document.body.appendChild(backdrop);
        this.backdrop = backdrop;

        this.bindEvents();
    }

    // Bind modal events
    bindEvents() {
        // Close button
        this.backdrop.querySelector('.image-editor-close').onclick = () => this.cancel();

        // Backdrop click to close
        this.backdrop.onclick = (e) => {
            if (e.target === this.backdrop) {
                if (!confirm('Discard image edits?')) return;
                this.cancel();
            }
        };

        // Cancel button
        this.backdrop.querySelector('.image-editor-btn.cancel').onclick = () => this.cancel();

        // Confirm button
        this.backdrop.querySelector('.image-editor-btn.confirm').onclick = () => this.confirm();

        // Tab switching
        this.backdrop.querySelectorAll('.image-editor-tab').forEach(tab => {
            tab.onclick = () => {
                if (this.switching) return;
                const tabName = tab.dataset.tab;
                if (tabName !== this.activeTab) this.switchTab(tabName);
            };
        });

        // Toolbar buttons
        this.backdrop.querySelectorAll('.image-editor-tool').forEach(btn => {
            btn.onclick = () => this.handleToolAction(btn.dataset.action);
        });

        // Rotation slider for fine-grained straightening
        // Track fine rotation value and base rotation separately
        this.fineRotation = 0;
        this.baseRotation = 0;
        const rotateSlider = this.backdrop.querySelector('#image-editor-rotate');
        const rotateInput = this.backdrop.querySelector('#image-editor-rotate-value');
        if (rotateSlider && rotateInput) {
            // Set fine rotation (relative to base from 90° buttons)
            const setFineRotation = (val, updateInput = true) => {
                // Strip ° if present, then parse and round to 1 decimal
                const numVal = parseFloat(String(val).replace('°', '')) || 0;
                const rounded = Math.round(numVal * 10) / 10;
                const clamped = Math.max(-45, Math.min(45, rounded));

                this.fineRotation = clamped;
                rotateSlider.value = clamped;
                if (updateInput) rotateInput.value = clamped + '°';

                // Apply total rotation (base + fine), then refit canvas to container
                if (this.cropper) {
                    const oldCanvas = this.cropper.getCanvasData();
                    const crop = this.cropper.getCropBoxData();
                    // Save crop box as proportions of canvas
                    const rel = {
                        left: (crop.left - oldCanvas.left) / oldCanvas.width,
                        top: (crop.top - oldCanvas.top) / oldCanvas.height,
                        width: crop.width / oldCanvas.width,
                        height: crop.height / oldCanvas.height
                    };
                    this.cropper.rotateTo(this.baseRotation + this.fineRotation);
                    // Clear crop box so viewMode 1 doesn't prevent canvas from shrinking
                    this.cropper.clear();
                    // Refit canvas to container
                    const container = this.cropper.getContainerData();
                    const canvas = this.cropper.getCanvasData();
                    const ratio = Math.min(container.width / canvas.width, container.height / canvas.height);
                    const w = canvas.width * ratio;
                    const h = canvas.height * ratio;
                    const newLeft = (container.width - w) / 2;
                    const newTop = (container.height - h) / 2;
                    this.cropper.setCanvasData({ left: newLeft, top: newTop, width: w, height: h });
                    // Re-enable crop box and restore proportions
                    this.cropper.crop();
                    const fitted = this.cropper.getCanvasData();
                    this.cropper.setCropBoxData({
                        left: fitted.left + rel.left * fitted.width,
                        top: fitted.top + rel.top * fitted.height,
                        width: rel.width * fitted.width,
                        height: rel.height * fitted.height
                    });
                }
            };
            // Store for use in handleToolAction
            this.setFineRotation = setFineRotation;

            // Slider input - update in real-time
            rotateSlider.oninput = () => setFineRotation(rotateSlider.value);

            // Text input - only apply on blur/enter to allow typing "-" and "."
            rotateInput.onchange = () => setFineRotation(rotateInput.value);
            rotateInput.onkeydown = (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    setFineRotation(rotateInput.value);
                    rotateInput.blur();
                }
            };
            // Select all on focus for easy replacement
            rotateInput.onfocus = () => rotateInput.select();

            // Double-click slider to reset
            rotateSlider.ondblclick = () => setFineRotation(0);

            // +/- buttons for fine adjustment
            this.backdrop.querySelector('#rotate-minus').onclick = () => setFineRotation(parseFloat(rotateSlider.value) - 0.1);
            this.backdrop.querySelector('#rotate-plus').onclick = () => setFineRotation(parseFloat(rotateSlider.value) + 0.1);
        }

        // Escape key to close
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.backdrop.classList.contains('active')) {
                this.cancel();
            }
        });
    }

    // Handle toolbar actions
    handleToolAction(action) {
        if (action === 'reset') {
            if (this.activeTab === 'perspective') {
                this.resetCornerHandles();
            } else if (this.cropper) {
                this.baseRotation = 0;
                this.fineRotation = 0;
                this.cropper.reset();
                if (this.setFineRotation) this.setFineRotation(0);
            }
            return;
        }
        if (!this.cropper) return;

        switch (action) {
            case 'rotate-left':
                this.baseRotation -= 90;
                this.fineRotation = 0;
                if (this.setFineRotation) this.setFineRotation(0);
                break;
            case 'rotate-right':
                this.baseRotation += 90;
                this.fineRotation = 0;
                if (this.setFineRotation) this.setFineRotation(0);
                break;
            case 'flip-h':
                this.cropper.scaleX(-this.cropper.getData().scaleX || -1);
                break;
            case 'flip-v':
                this.cropper.scaleY(-this.cropper.getData().scaleY || -1);
                break;
        }
    }

    // Open editor with image URL or data URL
    async open(imageSrc) {
        await this.loadCropperJS();
        this.init();

        // Destroy existing cropper
        if (this.cropper) {
            this.cropper.destroy();
            this.cropper = null;
        }

        // Reset state
        this.activeTab = 'crop';
        this.switching = false;
        this.savedCornerPositions = null;
        this.originalImageSrc = imageSrc;
        this.baseRotation = 0;
        this.fineRotation = 0;
        const slider = this.backdrop.querySelector('#image-editor-rotate');
        const rotateInput = this.backdrop.querySelector('#image-editor-rotate-value');
        if (slider) slider.value = 0;
        if (rotateInput) rotateInput.value = '0°';

        // Cache-bust http(s) URLs to avoid browser serving a cached non-CORS response
        const isHttpUrl = imageSrc.startsWith('http');
        this.cacheBustedSrc = isHttpUrl ? imageSrc + (imageSrc.includes('?') ? '&' : '?') + '_cb=1' : imageSrc;

        // Show the Crop & Rotate tab by default
        this.updateTabUI('crop');

        // Show modal
        this.backdrop.classList.add('active');

        // Load the image into Cropper.js
        const img = this.backdrop.querySelector('#image-editor-img');
        img.crossOrigin = 'anonymous';
        img.style.display = '';

        return new Promise((resolve, reject) => {
            this.resolvePromise = resolve;
            this.rejectPromise = reject;

            img.onload = () => {
                this.cropper = new Cropper(img, this.cropperOptions);
            };
            img.onerror = () => {
                this.close();
                reject(new Error('Failed to load image'));
            };
            img.src = this.cacheBustedSrc;
        });
    }

    // Confirm (Done) - output result from whichever tab is active
    confirm() {
        if (this.activeTab === 'perspective') {
            // If corners moved, apply perspective transform then output
            if (!this.cornersAreDefault()) {
                const srcCorners = this.cornerPositions.map(p => ({
                    x: p.x * this.perspectiveCanvas.width,
                    y: p.y * this.perspectiveCanvas.height,
                }));
                const resultCanvas = PerspectiveTransform.transform(this.perspectiveCanvas, srcCorners);
                if (!resultCanvas) {
                    console.error('Perspective transform failed');
                    return;
                }
                const dataUrl = resultCanvas.toDataURL('image/webp', 0.85);
                const resolve = this.resolvePromise;
                this.close();
                if (resolve) resolve(dataUrl);
            } else {
                // Corners not moved - output original image as-is
                this.outputOriginalImage();
            }
            return;
        }

        // Crop & Rotate tab
        if (!this.cropper) {
            const reject = this.rejectPromise;
            this.close();
            if (reject) reject(new Error('Image editor not ready'));
            return;
        }

        try {
            const canvas = this.cropper.getCroppedCanvas({
                maxWidth: 1200,
                maxHeight: 1200,
            });

            if (!canvas) {
                throw new Error('Failed to get cropped image');
            }

            const dataUrl = canvas.toDataURL('image/webp', 0.85);
            const resolve = this.resolvePromise;
            this.close();
            if (resolve) resolve(dataUrl);
        } catch (error) {
            console.error('ImageEditor: Error in confirm():', error);
            const reject = this.rejectPromise;
            this.close();
            if (reject) reject(error);
        }
    }

    // Output the original image without any edits
    outputOriginalImage() {
        // Draw original onto a canvas to get a webp data URL
        const tempImg = new Image();
        tempImg.crossOrigin = 'anonymous';
        tempImg.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = tempImg.naturalWidth;
            canvas.height = tempImg.naturalHeight;
            canvas.getContext('2d').drawImage(tempImg, 0, 0);
            const dataUrl = canvas.toDataURL('image/webp', 0.85);
            const resolve = this.resolvePromise;
            this.close();
            if (resolve) resolve(dataUrl);
        };
        tempImg.onerror = () => {
            const reject = this.rejectPromise;
            this.close();
            if (reject) reject(new Error('Failed to load original image'));
        };
        tempImg.src = this.cacheBustedSrc;
    }

    // Cancel - always exit (no "go back" behavior)
    cancel() {
        const reject = this.rejectPromise;
        this.close();
        if (reject) {
            reject(new Error('Cancelled'));
        }
    }

    // Cropper.js config
    get cropperOptions() {
        return {
            viewMode: 1, dragMode: 'move', aspectRatio: NaN, autoCropArea: 1,
            restore: false, guides: true, center: true, highlight: false,
            cropBoxMovable: true, cropBoxResizable: true, toggleDragModeOnDblclick: false, background: true,
        };
    }

    // Check if corners are at default (unmoved) positions
    cornersAreDefault() {
        if (!this.cornerPositions.length) return true;
        const defaults = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
        return this.cornerPositions.every((p, i) =>
            Math.abs(p.x - defaults[i].x) < 0.001 && Math.abs(p.y - defaults[i].y) < 0.001
        );
    }

    // Switch between Perspective and Crop & Rotate tabs
    switchTab(tabName) {
        if (this.switching) return;
        this.switching = true;

        if (tabName === 'crop') {
            // Perspective -> Crop & Rotate
            this.savedCornerPositions = this.cornerPositions.map(p => ({ ...p }));

            // Get the image to feed into Cropper
            let imageSrc;
            if (!this.cornersAreDefault()) {
                // Apply perspective transform
                const srcCorners = this.cornerPositions.map(p => ({
                    x: p.x * this.perspectiveCanvas.width,
                    y: p.y * this.perspectiveCanvas.height,
                }));
                const resultCanvas = PerspectiveTransform.transform(this.perspectiveCanvas, srcCorners);
                imageSrc = resultCanvas ? resultCanvas.toDataURL('image/png') : this.cacheBustedSrc;
            } else {
                // Use perspective canvas as-is (preserves any previous crop)
                imageSrc = this.perspectiveCanvas
                    ? this.perspectiveCanvas.toDataURL('image/png')
                    : this.cacheBustedSrc;
            }

            // Clean up perspective DOM
            this.cleanupPerspective();

            // Show <img> and init Cropper
            const img = this.backdrop.querySelector('#image-editor-img');
            img.style.display = '';
            img.crossOrigin = 'anonymous';

            // Reset crop rotation state (crop was baked into perspective image)
            this.baseRotation = 0;
            this.fineRotation = 0;
            if (this.setFineRotation) this.setFineRotation(0);

            img.onload = () => {
                this.cropper = new Cropper(img, {
                    ...this.cropperOptions,
                    ready: () => {
                        this.activeTab = 'crop';
                        this.updateTabUI('crop');
                        this.switching = false;
                    },
                });
            };
            img.src = imageSrc;
        } else {
            // Crop & Rotate -> Perspective
            // Get cropped image before destroying cropper
            let croppedSrc = null;
            if (this.cropper) {
                const croppedCanvas = this.cropper.getCroppedCanvas();
                if (croppedCanvas) croppedSrc = croppedCanvas.toDataURL('image/png');
                this.cropper.destroy();
                this.cropper = null;
            }

            // Hide <img>
            const img = this.backdrop.querySelector('#image-editor-img');
            img.style.display = 'none';

            // Load cropped (or original) image into perspective canvas
            const tempImg = new Image();
            tempImg.crossOrigin = 'anonymous';
            tempImg.onload = () => {
                this.setupPerspectiveCanvas(tempImg);
                // Restore saved corner positions if available (the deferred
                // rAF in setupPerspectiveCanvas will pick up the restored positions)
                if (this.savedCornerPositions) {
                    this.cornerPositions = this.savedCornerPositions.map(p => ({ ...p }));
                }
                this.activeTab = 'perspective';
                this.updateTabUI('perspective');
                this.switching = false;
            };
            tempImg.onerror = () => {
                this.switching = false;
            };
            tempImg.src = croppedSrc || this.cacheBustedSrc;
        }
    }

    // Update tab button active states and panel visibility
    updateTabUI(tabName) {
        if (!this.backdrop) return;
        this.backdrop.querySelectorAll('.image-editor-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.tab === tabName);
        });
        this.backdrop.querySelectorAll('.image-editor-tab-panel').forEach(p => {
            p.style.display = p.dataset.tabContent === tabName ? '' : 'none';
        });
    }

    // Create perspective canvas, overlay, and corner handles from an image
    setupPerspectiveCanvas(img) {
        const container = this.backdrop.querySelector('.image-editor-canvas');

        // Create perspective canvas
        this.perspectiveCanvas = document.createElement('canvas');
        this.perspectiveCanvas.className = 'perspective-canvas';
        this.perspectiveCanvas.width = img.naturalWidth;
        this.perspectiveCanvas.height = img.naturalHeight;
        this.perspectiveCanvas.getContext('2d').drawImage(img, 0, 0);
        container.appendChild(this.perspectiveCanvas);

        // Create overlay canvas for guide lines
        this.perspectiveOverlay = document.createElement('canvas');
        this.perspectiveOverlay.className = 'perspective-overlay';
        container.appendChild(this.perspectiveOverlay);

        // Initialize corner positions and create handles
        this.resetCornerHandles();
        this.cornerHandles = [];
        for (let i = 0; i < 4; i++) {
            const handle = document.createElement('div');
            handle.className = 'perspective-handle';
            handle.dataset.index = i;
            container.appendChild(handle);
            this.cornerHandles.push(handle);
            this.makeHandleDraggable(handle, i);
        }

        // Update positions once layout and modal transition have settled.
        // The modal animates transform: scale(0.9)->scale(1) over 200ms,
        // which skews getBoundingClientRect. On cached images the onload
        // fires before the transition finishes, so we need both paths.
        const update = () => {
            this.updateHandlePositions();
            this.drawGuideLines();
        };
        // Double rAF for first-open (transition already done, image was slow)
        requestAnimationFrame(() => requestAnimationFrame(update));
        // transitionend for repeat-open (image cached, loads mid-transition)
        const modal = this.backdrop.querySelector('.image-editor-modal');
        modal.addEventListener('transitionend', () => requestAnimationFrame(update), { once: true });

        // Keep handles and guide lines in sync on resize
        if (this._resizeObserver) this._resizeObserver.disconnect();
        this._resizeObserver = new ResizeObserver(update);
        this._resizeObserver.observe(this.perspectiveCanvas);
    }

    // Reset corner handles to default inset positions
    resetCornerHandles() {
        const inset = 0;
        this.cornerPositions = [
            { x: inset, y: inset },
            { x: 1 - inset, y: inset },
            { x: 1 - inset, y: 1 - inset },
            { x: inset, y: 1 - inset },
        ];
        if (this.cornerHandles.length) {
            this.updateHandlePositions();
            this.drawGuideLines();
        }
    }

    // Make a corner handle draggable with pointer events
    makeHandleDraggable(handle, index) {
        handle.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            handle.setPointerCapture(e.pointerId);
            handle.classList.add('dragging');

            // Record offset between handle position and corner position
            const offset = this.getHandleOffset(index);
            const corner = this.cornerPositions[index];
            const diffX = offset.x - corner.x;
            const diffY = offset.y - corner.y;

            const onMove = (e) => {
                const canvasRect = this.perspectiveCanvas.getBoundingClientRect();
                // Mouse is on the offset handle; subtract diff to get actual corner
                const mx = (e.clientX - canvasRect.left) / canvasRect.width;
                const my = (e.clientY - canvasRect.top) / canvasRect.height;
                const x = Math.max(0, Math.min(1, mx - diffX));
                const y = Math.max(0, Math.min(1, my - diffY));
                this.cornerPositions[index] = { x, y };
                this.updateHandlePositions();
                this.drawGuideLines();
            };

            const onUp = () => {
                handle.classList.remove('dragging');
                handle.removeEventListener('pointermove', onMove);
                handle.removeEventListener('pointerup', onUp);
            };

            handle.addEventListener('pointermove', onMove);
            handle.addEventListener('pointerup', onUp);
        });
    }

    // Compute the offset handle position (inward from corner toward quad center)
    getHandleOffset(cornerIdx) {
        const pos = this.cornerPositions[cornerIdx];
        // Center of the quad
        const cx = this.cornerPositions.reduce((s, p) => s + p.x, 0) / 4;
        const cy = this.cornerPositions.reduce((s, p) => s + p.y, 0) / 4;
        // Direction from corner toward center
        const dx = cx - pos.x, dy = cy - pos.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 0.001) return { x: pos.x, y: pos.y };
        // Offset by a fixed pixel distance (30px), converted to normalized coords
        const rect = this.perspectiveCanvas?.getBoundingClientRect();
        if (!rect || !rect.width) return { x: pos.x, y: pos.y };
        const offsetPx = 30;
        const offsetX = (dx / len) * offsetPx / rect.width;
        const offsetY = (dy / len) * offsetPx / rect.height;
        return { x: pos.x + offsetX, y: pos.y + offsetY };
    }

    // Position handles on screen based on normalized coordinates (offset inward)
    updateHandlePositions() {
        if (!this.perspectiveCanvas) return;
        const rect = this.perspectiveCanvas.getBoundingClientRect();
        const containerRect = this.perspectiveCanvas.parentElement.getBoundingClientRect();

        this.cornerHandles.forEach((handle, i) => {
            const offset = this.getHandleOffset(i);
            handle.style.left = (rect.left - containerRect.left + offset.x * rect.width) + 'px';
            handle.style.top = (rect.top - containerRect.top + offset.y * rect.height) + 'px';
        });
    }

    // Draw guide lines connecting the 4 corners on the overlay
    drawGuideLines() {
        if (!this.perspectiveOverlay || !this.perspectiveCanvas) return;
        const rect = this.perspectiveCanvas.getBoundingClientRect();
        const containerRect = this.perspectiveCanvas.parentElement.getBoundingClientRect();

        this.perspectiveOverlay.width = containerRect.width;
        this.perspectiveOverlay.height = containerRect.height;
        this.perspectiveOverlay.style.width = containerRect.width + 'px';
        this.perspectiveOverlay.style.height = containerRect.height + 'px';

        const ctx = this.perspectiveOverlay.getContext('2d');
        ctx.clearRect(0, 0, this.perspectiveOverlay.width, this.perspectiveOverlay.height);

        const offsetX = rect.left - containerRect.left;
        const offsetY = rect.top - containerRect.top;
        const points = this.cornerPositions.map(p => ({
            x: offsetX + p.x * rect.width,
            y: offsetY + p.y * rect.height,
        }));

        // Fill the quadrilateral
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < 4; i++) ctx.lineTo(points[i].x, points[i].y);
        ctx.closePath();
        ctx.fillStyle = 'rgba(102, 126, 234, 0.08)';
        ctx.fill();

        // Draw edges
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < 4; i++) ctx.lineTo(points[i].x, points[i].y);
        ctx.closePath();
        ctx.strokeStyle = 'rgba(102, 126, 234, 0.7)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Draw arm lines from offset handles to actual corner points + corner dots
        for (let i = 0; i < 4; i++) {
            const offset = this.getHandleOffset(i);
            const hx = offsetX + offset.x * rect.width;
            const hy = offsetY + offset.y * rect.height;

            // Arm line
            ctx.beginPath();
            ctx.moveTo(hx, hy);
            ctx.lineTo(points[i].x, points[i].y);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            // Corner dot
            ctx.beginPath();
            ctx.arc(points[i].x, points[i].y, 3, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
            ctx.fill();
        }
    }

    // Clean up perspective mode DOM elements
    cleanupPerspective() {
        if (this._resizeObserver) { this._resizeObserver.disconnect(); this._resizeObserver = null; }
        this.cornerHandles.forEach(h => h.remove());
        this.cornerHandles = [];
        if (this.perspectiveCanvas) { this.perspectiveCanvas.remove(); this.perspectiveCanvas = null; }
        if (this.perspectiveOverlay) { this.perspectiveOverlay.remove(); this.perspectiveOverlay = null; }
    }

    // Close modal
    close() {
        if (!this.backdrop) return;
        this.backdrop.classList.remove('active');
        if (this.cropper) {
            this.cropper.destroy();
            this.cropper = null;
        }
        this.cleanupPerspective();
        this.activeTab = 'crop';
        this.switching = false;
        this.savedCornerPositions = null;
        this.resolvePromise = null;
        this.rejectPromise = null;
    }
}

// Singleton instance
const imageEditor = new ImageEditorModal();


window.ImageProcessor = ImageProcessor;
window.ImageEditorModal = ImageEditorModal;
window.imageEditor = imageEditor;
