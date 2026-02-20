/**
 * Card Context Menu - right-click menu for editing/deleting cards
 */
class CardContextMenu {
    constructor(checklistManager) {
        this.checklistManager = checklistManager;
        this.menu = null;
        this.currentCard = null;
        this.currentCardId = null;
        this.onEdit = null;
        this.onDelete = null;
        this.onAddCard = null;
    }

    // SVG icons
    static ICON_EDIT = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';
    static ICON_DELETE = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';
    static ICON_LINK = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/></svg>';

    // Initialize context menu
    init() {
        this.createMenu();
        this.attachCardListeners();
        this.attachAddCardButton();
    }

    // Create the context menu element
    createMenu() {
        this.menu = document.createElement('div');
        this.menu.className = 'card-context-menu';
        this.menu.innerHTML = `
            <button class="context-menu-item" data-action="copy-link">
                ${CardContextMenu.ICON_LINK}
                <span>Copy link</span>
            </button>
            <div class="context-menu-divider owner-only"></div>
            <button class="context-menu-item owner-only" data-action="edit">
                ${CardContextMenu.ICON_EDIT}
                <span>Edit card</span>
            </button>
            <button class="context-menu-item danger owner-only" data-action="delete">
                ${CardContextMenu.ICON_DELETE}
                <span>Delete card</span>
            </button>
        `;
        document.body.appendChild(this.menu);

        // Handle menu item clicks
        this.menu.addEventListener('click', (e) => {
            const item = e.target.closest('.context-menu-item');
            if (!item) return;

            const action = item.dataset.action;
            if (action === 'copy-link') {
                this._copyCardLink();
            } else if (action === 'edit' && this.onEdit) {
                this.onEdit(this.currentCardId, this.currentCard);
            } else if (action === 'delete' && this.onDelete) {
                if (confirm('Delete this card?')) {
                    this.onDelete(this.currentCardId);
                }
            }
            this.hide();
        });
    }

    // Attach right-click and long-press listeners to cards (uses event delegation)
    attachCardListeners() {
        // Right-click (desktop)
        document.addEventListener('contextmenu', (e) => {
            const card = e.target.closest('.card');
            if (!card) return;

            e.preventDefault();
            this.show(e.clientX, e.clientY, card);
        });

        // Long-press (mobile) - 500ms touch and hold
        let longPressTimer = null;
        let touchStartPos = null;
        const LONG_PRESS_DURATION = 500;
        const MOVE_THRESHOLD = 10; // pixels

        document.addEventListener('touchstart', (e) => {
            const card = e.target.closest('.card');
            if (!card) return;

            const touch = e.touches[0];
            touchStartPos = { x: touch.clientX, y: touch.clientY };

            longPressTimer = setTimeout(() => {
                // Vibrate if supported (haptic feedback)
                if (navigator.vibrate) navigator.vibrate(50);
                this.show(touch.clientX, touch.clientY, card);
                longPressTimer = null;
            }, LONG_PRESS_DURATION);
        }, { passive: true });

        document.addEventListener('touchmove', (e) => {
            if (!longPressTimer || !touchStartPos) return;

            const touch = e.touches[0];
            const dx = Math.abs(touch.clientX - touchStartPos.x);
            const dy = Math.abs(touch.clientY - touchStartPos.y);

            // Cancel if finger moved too far
            if (dx > MOVE_THRESHOLD || dy > MOVE_THRESHOLD) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
            }
        }, { passive: true });

        document.addEventListener('touchend', () => {
            if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
            }
        });

        // Hide menu on click/tap outside or ESC
        document.addEventListener('click', (e) => {
            if (!this.menu.contains(e.target)) {
                this.hide();
            }
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this.hide();
        });
    }

    // Show menu at position
    show(x, y, cardElement) {
        // Get card ID from checkbox, data attribute, or element id
        const checkbox = cardElement.querySelector('input[type="checkbox"]');
        this.currentCardId = checkbox?.id || cardElement.dataset.cardId || cardElement.id?.replace(/^card-/, '');
        this.currentCard = cardElement;

        // Show/hide owner-only items (Edit, Delete)
        const isOwner = this.checklistManager?.isOwner();
        this.menu.querySelectorAll('.owner-only').forEach(el => {
            el.style.display = isOwner ? '' : 'none';
        });

        // Position menu
        this.menu.style.left = `${x}px`;
        this.menu.style.top = `${y}px`;
        this.menu.classList.add('visible');

        // Adjust if menu goes off screen
        requestAnimationFrame(() => {
            const rect = this.menu.getBoundingClientRect();
            if (rect.right > window.innerWidth) {
                this.menu.style.left = `${x - rect.width}px`;
            }
            if (rect.bottom > window.innerHeight) {
                this.menu.style.top = `${y - rect.height}px`;
            }
        });
    }

    // Hide menu
    hide() {
        if (this.menu) {
            this.menu.classList.remove('visible');
        }
        this.currentCard = null;
        this.currentCardId = null;
    }

    // Copy a direct link to the card
    _copyCardLink() {
        if (!this.currentCardId) return;
        const url = new URL(window.location.href);
        url.hash = `card-${this.currentCardId}`;
        navigator.clipboard.writeText(url.toString()).then(() => {
            this._showCopiedToast();
        }).catch(() => {
            // Fallback: select+copy for older browsers
            const textarea = document.createElement('textarea');
            textarea.value = url.toString();
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            textarea.remove();
            this._showCopiedToast();
        });
    }

    // Show brief "Link copied!" toast
    _showCopiedToast() {
        const existing = document.querySelector('.copy-toast');
        if (existing) existing.remove();
        const toast = document.createElement('div');
        toast.className = 'copy-toast';
        toast.textContent = 'Link copied!';
        document.body.appendChild(toast);
        toast.addEventListener('animationend', () => toast.remove());
    }

    // Attach Add Card button in nav dropdown
    attachAddCardButton() {
        const addBtn = document.getElementById('add-card-btn');
        if (!addBtn) return;

        addBtn.onclick = (e) => {
            e.stopPropagation();
            // Close dropdown
            document.getElementById('nav-avatar-btn')?.classList.remove('menu-open');
            document.getElementById('nav-dropdown')?.classList.remove('open');
            // Trigger add card
            if (this.onAddCard) {
                this.onAddCard();
            }
        };
    }
}

/**
 * Card Editor Modal - handles card editing UI
 */
class CardEditorModal {
    constructor(options = {}) {
        this.onSave = options.onSave || (() => {});
        this.onDelete = options.onDelete || (() => {});
        this.cardTypes = options.cardTypes || CARD_TYPES;
        this.categories = options.categories || null; // e.g., ['panini', 'topps', 'inserts', 'premium']
        this.imageFolder = options.imageFolder || 'images'; // folder for processed images
        this.playerName = options.playerName || ''; // player name for search term generation
        this.isOwned = options.isOwned || (() => false); // callback to check if card is owned
        this.onOwnedChange = options.onOwnedChange || null; // callback when owned state changes
        this.currentCard = null;
        this.currentCardId = null;
        this.isDirty = false;
        this.backdrop = null;
        this.isNewCard = false;
        this.imageProcessor = new ImageProcessor();
        this._initialOwned = false; // Track initial owned state to detect changes

        // Schema-driven custom fields
        // Format: { fieldName: { label, type, options?, placeholder?, fullWidth? } }
        // Types: 'text', 'select', 'checkbox'
        // For select: options is array of { value, label } or just strings
        this.customFields = options.customFields || {};
    }

    // Generate eBay search term from card data
    generateSearchTerm(set, num, variant, player) {
        const parts = [player || this.playerName, set];
        // Add card number without # prefix
        if (num) {
            parts.push(num.replace(/^#/, ''));
        }
        // Add variant if not "Base"
        if (variant && variant !== 'Base') {
            parts.push(variant);
        }
        return parts.filter(Boolean).join('+').toLowerCase().replace(/\s+/g, '+');
    }

    // Check if running on a preview site (not production)
    isPreviewSite() {
        const hostname = window.location.hostname;
        // Preview sites are on .pages.dev but not the main domain
        if (hostname.endsWith('.pages.dev') && !hostname.startsWith('sports-card-checklists.')) {
            return true;
        }
        return false;
    }

    // Generate HTML for custom fields based on schema
    // position: 'top' (before set), 'after-num' (after card number), 'attributes' (horizontal row), 'bottom' (after attributes)
    generateCustomFieldsHtml(position = 'top') {
        const fields = Object.entries(this.customFields)
            .filter(([_, config]) => (config.position || 'top') === position);

        if (fields.length === 0 && position !== 'attributes') return '';

        // Attributes position renders as a compact horizontal row with price
        if (position === 'attributes') {
            // fullWidth fields (e.g. variant) are rendered inline in the template grid, not here
            const rowFields = fields.filter(([_, c]) => !c.fullWidth);

            // If no custom attribute fields, price is rendered in the header bar
            if (rowFields.length === 0) return '';

            const innerHtml = rowFields.map(([fieldName, config]) => {
                const id = `editor-${fieldName}`;
                if (config.type === 'checkbox') {
                    return `<label class="card-editor-attr-checkbox">
                        <input type="checkbox" id="${id}">
                        <span>${config.label}</span>
                    </label>`;
                } else {
                    // Text/number field (e.g., serial)
                    const extraAttrs = config.inputType === 'number' ? ' inputmode="numeric"' : '';
                    return `<div class="card-editor-attr-text">
                        <label for="${id}">${config.label}:</label>
                        <input type="text" class="card-editor-input" id="${id}" placeholder="${config.placeholder || ''}"${extraAttrs}>
                    </div>`;
                }
            }).join('');
            return `<div class="card-editor-field full-width card-editor-attributes">
                <label class="card-editor-label">Attributes</label>
                <div class="card-editor-attr-row">
                    ${innerHtml}
                </div>
            </div>`;
        }

        const fieldHtml = fields.map(([fieldName, config]) => {
            const id = `editor-${fieldName}`;
            const fullWidth = config.fullWidth ? ' full-width' : '';
            const placeholder = config.placeholder || '';

            if (config.type === 'select') {
                const options = (config.options || []).map(opt => {
                    const value = typeof opt === 'string' ? opt : opt.value;
                    const label = typeof opt === 'string' ? opt : opt.label;
                    return `<option value="${value}">${label}</option>`;
                }).join('');
                return `<div class="card-editor-field${fullWidth}">
                    <label class="card-editor-label">${config.label}</label>
                    <select class="card-editor-select" id="${id}">${options}</select>
                </div>`;
            } else if (config.type === 'checkbox') {
                return `<div class="card-editor-field${fullWidth}">
                    <label class="card-editor-label">${config.label}</label>
                    <label class="card-editor-checkbox">
                        <input type="checkbox" id="${id}">
                        <span>${config.checkboxLabel || 'Yes'}</span>
                    </label>
                </div>`;
            } else {
                // Default: text input
                const colorHint = config.color ? `<span class="card-editor-color-hint" style="background:${config.color}"></span>` : '';
                return `<div class="card-editor-field${fullWidth}">
                    <label class="card-editor-label">${config.label}${colorHint}</label>
                    <input type="text" class="card-editor-input" id="${id}" placeholder="${placeholder}">
                </div>`;
            }
        }).join('');

        // Bottom fields get their own equal-column grid
        if (position === 'bottom') {
            const cols = fields.length === 1 ? '1fr' : 'repeat(2, 1fr)';
            return `<div class="card-editor-field full-width" style="display:grid;grid-template-columns:${cols};gap:16px;">
                ${fieldHtml}
            </div>`;
        }

        return fieldHtml;
    }

    // Populate custom fields from card data
    populateCustomFields(cardData) {
        for (const [fieldName, config] of Object.entries(this.customFields)) {
            const el = this.backdrop.querySelector(`#editor-${fieldName}`);
            if (!el) continue;

            const value = cardData[fieldName];
            if (config.type === 'checkbox') {
                el.checked = !!value;
            } else if (config.type === 'select') {
                el.value = value || (config.options?.[0]?.value ?? config.options?.[0] ?? '');
            } else {
                // Text field - handle arrays (like achievements)
                if (Array.isArray(value)) {
                    el.value = value.join(', ');
                } else {
                    el.value = value || '';
                }
            }
        }
    }

    // Clear custom fields for new card
    clearCustomFields() {
        for (const [fieldName, config] of Object.entries(this.customFields)) {
            const el = this.backdrop.querySelector(`#editor-${fieldName}`);
            if (!el) continue;

            if (config.type === 'checkbox') {
                el.checked = false;
            } else if (config.type === 'select') {
                el.value = config.options?.[0]?.value ?? config.options?.[0] ?? '';
            } else {
                el.value = '';
            }
        }
    }

    // Gather custom field values
    getCustomFieldData() {
        const data = {};
        for (const [fieldName, config] of Object.entries(this.customFields)) {
            const el = this.backdrop.querySelector(`#editor-${fieldName}`);
            if (!el) continue;

            if (config.type === 'checkbox') {
                if (el.checked) data[fieldName] = true;
            } else if (config.type === 'select') {
                data[fieldName] = el.value;
            } else {
                const val = normalizeQuotes(el.value.trim());
                // Parse comma-separated values if configured
                if (config.parseArray) {
                    data[fieldName] = val ? val.split(',').map(v => v.trim()).filter(v => v) : [];
                } else {
                    // Always include the value (even empty string) so calling code can clear fields
                    data[fieldName] = val;
                }
            }
        }
        return data;
    }

    // Render a single custom field as HTML
    renderCustomField(name, config) {
        const id = `editor-${name}`;
        const placeholder = config.placeholder || '';

        if (config.type === 'select') {
            const options = (config.options || []).map(opt => {
                const value = typeof opt === 'string' ? opt : opt.value;
                const label = typeof opt === 'string' ? opt : opt.label;
                return `<option value="${value}">${label}</option>`;
            }).join('');
            return `<div class="card-editor-field">
                <label class="card-editor-label">${config.label}</label>
                <select class="card-editor-select" id="${id}">${options}</select>
            </div>`;
        } else if (config.type === 'checkbox') {
            return `<div class="card-editor-field">
                <label class="card-editor-label">${config.label}</label>
                <label class="card-editor-checkbox">
                    <input type="checkbox" id="${id}">
                    <span>${config.checkboxLabel || 'Yes'}</span>
                </label>
            </div>`;
        } else {
            const colorHint = config.color ? `<span class="card-editor-color-hint" style="background:${config.color}"></span>` : '';
            return `<div class="card-editor-field">
                <label class="card-editor-label">${config.label}${colorHint}</label>
                <input type="text" class="card-editor-input" id="${id}" placeholder="${placeholder}">
            </div>`;
        }
    }

    // Build editor field rows with per-row grid columns based on field sizes
    buildEditorRows() {
        const fields = [];

        // 1. Top custom fields (player, position)
        for (const [name, config] of Object.entries(this.customFields)) {
            if ((config.position || 'top') !== 'top') continue;
            const size = config.fullWidth ? 'full' : (config.narrow ? 'narrow' : 'wide');
            fields.push({ html: this.renderCustomField(name, config), size });
        }

        // 2. Set Name (wide) + Card Number (narrow)
        fields.push({
            html: `<div class="card-editor-field">
                <label class="card-editor-label">Set Name</label>
                <input type="text" class="card-editor-input" id="editor-set" placeholder="2024 Panini Prizm">
            </div>`,
            size: 'wide'
        });
        fields.push({
            html: `<div class="card-editor-field">
                <label class="card-editor-label">Card Number</label>
                <input type="text" class="card-editor-input" id="editor-num" placeholder="123">
            </div>`,
            size: 'narrow'
        });

        // 3. Card Type (wide, conditional)
        if (this.cardTypes.length > 0) {
            fields.push({
                html: `<div class="card-editor-field">
                    <label class="card-editor-label">Card Type</label>
                    <select class="card-editor-select" id="editor-type">
                        ${this.cardTypes.map(t => `<option value="${t}">${t}</option>`).join('')}
                    </select>
                </div>`,
                size: 'wide'
            });
        }

        // 4. After-num custom fields
        for (const [name, config] of Object.entries(this.customFields)) {
            if ((config.position || 'top') !== 'after-num') continue;
            fields.push({ html: this.renderCustomField(name, config), size: config.narrow ? 'narrow' : 'wide' });
        }

        // 5. Full-width attribute fields (variant) - rendered inline as wide
        for (const [name, config] of Object.entries(this.customFields)) {
            if ((config.position || 'top') !== 'attributes' || !config.fullWidth) continue;
            fields.push({
                html: `<div class="card-editor-field">
                    <label class="card-editor-label">${config.label}</label>
                    <input type="text" class="card-editor-input" id="editor-${name}" placeholder="${config.placeholder || ''}">
                </div>`,
                size: 'wide'
            });
        }

        // 6. Section dropdown (wide, conditional)
        if (this.categories) {
            const options = this.categories.map(c => {
                if (c.group) {
                    return `<optgroup label="${c.group}">${c.children.map(child =>
                        `<option value="${child.value}">${child.label}</option>`
                    ).join('')}</optgroup>`;
                }
                const label = typeof c === 'string' ? c.charAt(0).toUpperCase() + c.slice(1) : c.label;
                const value = typeof c === 'string' ? c : c.value;
                return `<option value="${value}">${label}</option>`;
            }).join('');
            fields.push({
                html: `<div class="card-editor-field">
                    <label class="card-editor-label">Section</label>
                    <select class="card-editor-select" id="editor-category">${options}</select>
                </div>`,
                size: 'wide'
            });
        }

        // Pair fields into rows with per-row grid-template-columns
        const rows = [];
        let i = 0;
        while (i < fields.length) {
            const a = fields[i];
            // Full-width fields always get their own row
            if (a.size === 'full') {
                rows.push(`<div class="card-editor-row" style="grid-template-columns:1fr">${a.html}</div>`);
                i++;
            } else if (i + 1 < fields.length && fields[i + 1].size !== 'full') {
                const b = fields[i + 1];
                let cols;
                if (a.size === 'wide' && b.size === 'narrow') cols = '3fr 1fr';
                else if (a.size === 'narrow' && b.size === 'wide') cols = '1fr 3fr';
                else cols = '1fr 1fr';
                rows.push(`<div class="card-editor-row" style="grid-template-columns:${cols}">${a.html}${b.html}</div>`);
                i += 2;
            } else {
                rows.push(`<div class="card-editor-row" style="grid-template-columns:1fr">${a.html}</div>`);
                i++;
            }
        }

        return rows.join('');
    }

    // Initialize - create modal DOM
    init() {
        // Remove existing card editor backdrop so re-init works after settings changes
        // Use :not(.checklist-creator-backdrop) to avoid removing the creator modal
        const existing = document.querySelector('.card-editor-backdrop:not(.checklist-creator-backdrop)');
        if (existing) existing.remove();

        const backdrop = document.createElement('div');
        backdrop.className = 'card-editor-backdrop';
        backdrop.innerHTML = `
            <div class="card-editor-modal">
                <div class="card-editor-header">
                    <div class="card-editor-header-left">
                        <h2 class="card-editor-title">EDIT CARD</h2>
                        <div class="card-editor-subtitle">Update card details</div>
                    </div>
                    <div class="card-editor-header-price" id="editor-header-price">
                        <label for="editor-price">$</label>
                        <input type="text" class="card-editor-input" id="editor-price" placeholder="" inputmode="numeric">
                    </div>
                    <label class="card-editor-owned-toggle" id="editor-owned-toggle">
                        <input type="checkbox" id="editor-owned">
                        <span class="owned-toggle-label">Owned</span>
                    </label>
                    <button class="card-editor-close" title="Close">×</button>
                </div>
                <div class="card-editor-body">
                    <div class="card-editor-grid">
                        ${this.buildEditorRows()}
                        ${this.generateCustomFieldsHtml('attributes')}
                        ${this.generateCustomFieldsHtml('bottom')}
                        <div class="card-editor-field full-width card-editor-advanced-toggle">
                            <button type="button" class="card-editor-toggle-btn" id="editor-toggle-advanced">Advanced</button>
                        </div>
                        <div class="card-editor-advanced-fields" style="display: none;">
                            <div class="card-editor-field full-width">
                                <label class="card-editor-label">eBay Search Term</label>
                                <input type="text" class="card-editor-input" id="editor-ebay" placeholder="Defaults to player + set + number">
                            </div>
                            <div class="card-editor-field full-width">
                                <label class="card-editor-label">Price Search Term</label>
                                <input type="text" class="card-editor-input" id="editor-price-search" placeholder="Defaults to player + set + number">
                            </div>
                        </div>
                        <div class="card-editor-field full-width card-editor-image-section">
                            <label class="card-editor-label">Image</label>
                            <div class="card-editor-image-tabs">
                                <button type="button" class="card-editor-image-tab active" data-tab="url">Paste URL</button>
                                <button type="button" class="card-editor-image-tab" data-tab="upload">Upload</button>
                            </div>
                            <div class="card-editor-tab-content" data-tab-content="url">
                                <div class="card-editor-image-url-row">
                                    <input type="text" class="card-editor-input" id="editor-img" placeholder="Paste eBay or image URL...">
                                    <button type="button" class="card-editor-process-btn" id="editor-process-img" title="Process image">
                                        <span class="process-text">Process</span>
                                        <span class="process-spinner"></span>
                                    </button>
                                </div>
                            </div>
                            <div class="card-editor-tab-content" data-tab-content="upload" style="display: none;">
                                <input type="file" id="editor-img-file" accept="image/*" style="display: none;">
                                <div class="card-editor-upload-zone" id="editor-upload-zone">
                                    <span class="upload-zone-icon">&#8682;</span>
                                    <span class="upload-zone-text">Click to upload or drag & drop</span>
                                    <span class="upload-zone-spinner"></span>
                                </div>
                            </div>
                            <div class="card-editor-image-preview" id="editor-img-dropzone">
                                <span class="placeholder">No image</span>
                            </div>
                            <div class="card-editor-image-actions" id="editor-image-actions" style="display: none;">
                                <button type="button" class="card-editor-edit-btn" id="editor-edit-img" title="Edit existing image">
                                    <span class="edit-text">Edit</span>
                                    <span class="edit-spinner"></span>
                                </button>
                                <button type="button" class="card-editor-remove-btn" id="editor-remove-img" title="Remove image">Remove</button>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="card-editor-footer">
                    <button class="card-editor-btn delete">Delete</button>
                    <button class="card-editor-btn cancel">Cancel</button>
                    <button class="card-editor-btn save">Save Changes</button>
                </div>
            </div>
        `;

        document.body.appendChild(backdrop);
        this.backdrop = backdrop;

        // Bind events
        this.bindEvents();
    }

    // Bind modal events
    bindEvents() {
        const modal = this.backdrop.querySelector('.card-editor-modal');

        // Close button
        this.backdrop.querySelector('.card-editor-close').onclick = () => this.close();

        // Backdrop click to close
        this.backdrop.onclick = (e) => {
            if (e.target === this.backdrop) this.close();
        };

        // Cancel button
        this.backdrop.querySelector('.card-editor-btn.cancel').onclick = () => this.close();

        // Save button
        this.backdrop.querySelector('.card-editor-btn.save').onclick = () => this.save();

        // Delete button
        this.backdrop.querySelector('.card-editor-btn.delete').onclick = () => this.delete();

        // Track dirty state on input
        modal.querySelectorAll('input, select').forEach(input => {
            input.oninput = () => this.setDirty(true);
        });

        // Toggle advanced fields visibility
        const advancedToggle = this.backdrop.querySelector('#editor-toggle-advanced');
        const advancedFields = this.backdrop.querySelector('.card-editor-advanced-fields');
        advancedToggle.onclick = () => {
            const isHidden = advancedFields.style.display === 'none';
            advancedFields.style.display = isHidden ? 'flex' : 'none';
            advancedToggle.textContent = isHidden ? 'Hide advanced' : 'Advanced';
        };

        this.backdrop.querySelector('#editor-ebay').oninput = () => {
            this.setDirty(true);
        };

        // Price field validation - strip non-numeric, round to whole number on blur
        const priceInput = this.backdrop.querySelector('#editor-price');
        if (priceInput) {
            priceInput.addEventListener('blur', () => {
                let val = priceInput.value.trim().replace(/[^0-9.]/g, '');
                if (val === '' || val === '.') { priceInput.value = ''; return; }
                const num = Math.round(parseFloat(val));
                priceInput.value = isNaN(num) || num <= 0 ? '' : num;
            });
        }

        // Serial/Run field validation - clean up on blur
        const serialInput = this.backdrop.querySelector('#editor-serial');
        if (serialInput) {
            serialInput.addEventListener('blur', () => {
                let val = serialInput.value.trim();
                if (!val) return;
                // Strip leading zeros from numbers, normalize "/099" to "/99"
                val = val.replace(/^\/0+(\d)/, '/$1').replace(/^0+(\d)/, '$1');
                serialInput.value = val;
            });
        }

        // Image tab switching
        this.backdrop.querySelectorAll('.card-editor-image-tab').forEach(tab => {
            tab.onclick = () => {
                // Block switching while processing
                const saveBtn = this.backdrop.querySelector('.card-editor-btn.save');
                if (saveBtn && saveBtn.disabled) return;

                this.backdrop.querySelectorAll('.card-editor-image-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                const tabName = tab.dataset.tab;
                this.backdrop.querySelectorAll('.card-editor-tab-content').forEach(c => {
                    c.style.display = c.dataset.tabContent === tabName ? '' : 'none';
                });
            };
        });

        // Image preview on URL change
        this.backdrop.querySelector('#editor-img').oninput = (e) => {
            this.updateImagePreview(e.target.value);
            this.updateProcessButton(e.target.value);
            this.updateImageActions(e.target.value);
        };

        // Process image button
        this.backdrop.querySelector('#editor-process-img').onclick = () => this.processImage();

        // Edit existing image button
        this.backdrop.querySelector('#editor-edit-img').onclick = () => this.editExistingImage();

        // Remove image button
        this.backdrop.querySelector('#editor-remove-img').onclick = () => this.removeImage();

        // Upload zone click
        this.backdrop.querySelector('#editor-upload-zone').onclick = () => {
            this.backdrop.querySelector('#editor-img-file').click();
        };

        // File input change handler
        this.backdrop.querySelector('#editor-img-file').onchange = (e) => {
            if (e.target.files && e.target.files[0]) {
                this.processLocalFile(e.target.files[0]);
            }
        };

        // Drag and drop on upload zone
        const uploadZone = this.backdrop.querySelector('#editor-upload-zone');
        uploadZone.ondragover = (e) => {
            e.preventDefault();
            uploadZone.classList.add('dragover');
        };
        uploadZone.ondragleave = () => {
            uploadZone.classList.remove('dragover');
        };
        uploadZone.ondrop = (e) => {
            e.preventDefault();
            uploadZone.classList.remove('dragover');
            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                this.processLocalFile(e.dataTransfer.files[0]);
            }
        };

        // Drag and drop on preview area (fallback)
        const dropzone = this.backdrop.querySelector('#editor-img-dropzone');
        dropzone.ondragover = (e) => {
            e.preventDefault();
            dropzone.classList.add('dragover');
        };
        dropzone.ondragleave = () => {
            dropzone.classList.remove('dragover');
        };
        dropzone.ondrop = (e) => {
            e.preventDefault();
            dropzone.classList.remove('dragover');
            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                this.processLocalFile(e.dataTransfer.files[0]);
            }
        };

        // Escape key to close
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.backdrop.classList.contains('active')) {
                this.close();
            }
        });

        // Enter key to save (unless in a select, textarea, or image editor is open)
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && this.backdrop.classList.contains('active')
                && !document.querySelector('.image-editor-backdrop.active')
                && !['SELECT', 'TEXTAREA'].includes(e.target.tagName)) {
                e.preventDefault();
                this.save();
            }
        });
    }

    // Update image preview
    updateImagePreview(url) {
        const preview = this.backdrop.querySelector('.card-editor-image-preview');
        if (url) {
            // Determine the source URL:
            // - data: URLs used as-is
            // - Relative paths (local images) used as-is
            // - Absolute URLs (http/https) go through sanitizeUrl
            let src;
            if (url.startsWith('data:')) {
                src = url;
            } else if (url.startsWith('http://') || url.startsWith('https://')) {
                src = sanitizeUrl(url);
            } else {
                // Relative path - use as-is
                src = url;
            }
            preview.innerHTML = `<img src="${src}" alt="Preview" onerror="this.outerHTML='<span class=\\'placeholder\\'>Failed to load</span>'">`;
        } else {
            preview.innerHTML = '<span class="placeholder">No image</span>';
        }
    }

    // Update process button visibility based on URL
    updateProcessButton(url) {
        const btn = this.backdrop.querySelector('#editor-process-img');
        if (!btn) return;

        const isEbay = this.imageProcessor.isProcessableUrl(url);
        btn.style.display = isEbay ? 'flex' : 'none';
    }

    // Update image actions row visibility (show for any image, edit only for R2/local)
    updateImageActions(url) {
        const actionsRow = this.backdrop.querySelector('#editor-image-actions');
        const editBtn = this.backdrop.querySelector('#editor-edit-img');
        if (!actionsRow) return;

        const hasImage = url && url.trim() !== '';
        actionsRow.style.display = hasImage ? 'flex' : 'none';

        if (editBtn) {
            const isEditable = hasImage && (url.startsWith(this.imageFolder) || url.startsWith(R2_IMAGE_BASE));
            editBtn.style.display = isEditable ? 'flex' : 'none';
        }
    }

    // Remove image from card
    removeImage() {
        if (!confirm('Remove this image?')) return;

        const imgInput = this.backdrop.querySelector('#editor-img');
        const oldUrl = imgInput.value.trim();

        // Delete old R2 image (fire-and-forget)
        const oldKey = r2KeyFromUrl(oldUrl);
        if (oldKey) {
            githubSync.deleteImage(oldKey).catch(() => {});
        }

        imgInput.value = '';
        this.updateImagePreview('');
        this.updateImageActions('');
        this.setDirty(true);
    }

    // Reset image tabs to "Paste URL"
    resetImageTabs() {
        this.backdrop.querySelectorAll('.card-editor-image-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.tab === 'url');
        });
        this.backdrop.querySelectorAll('.card-editor-tab-content').forEach(c => {
            c.style.display = c.dataset.tabContent === 'url' ? '' : 'none';
        });
    }

    // Set image processing state - disables Save button while processing
    setImageProcessing(isProcessing) {
        const saveBtn = this.backdrop.querySelector('.card-editor-btn.save');
        if (saveBtn) {
            saveBtn.disabled = isProcessing;
            if (isProcessing) {
                saveBtn.dataset.originalText = saveBtn.textContent;
                saveBtn.textContent = 'Processing...';
            } else if (saveBtn.dataset.originalText) {
                saveBtn.textContent = saveBtn.dataset.originalText;
            }
        }
    }

    // Edit existing image: load into editor, save new version
    async editExistingImage() {
        const imgInput = this.backdrop.querySelector('#editor-img');
        const url = imgInput.value.trim();
        const btn = this.backdrop.querySelector('#editor-edit-img');

        if (!url || !(url.startsWith(this.imageFolder) || url.startsWith(R2_IMAGE_BASE))) return;

        // Check if githubSync is available and logged in
        if (typeof githubSync === 'undefined' || !githubSync.isLoggedIn()) {
            alert('Please sign in to edit images');
            return;
        }

        btn.classList.add('processing');
        btn.disabled = true;
        this.setImageProcessing(true);

        try {
            // Open the existing image in the editor
            const editedDataUrl = await imageEditor.open(url);
            if (!editedDataUrl) {
                throw new Error('Cancelled');
            }

            // Convert data URL to base64
            const base64Data = editedDataUrl.split(',')[1];

            // Generate new filename (add timestamp suffix)
            const timestamp = Date.now();
            // For R2 URLs, extract the key path; for local paths, use as-is
            const pathForKey = url.startsWith(R2_IMAGE_BASE)
                ? url.slice(R2_IMAGE_BASE.length - 'images/'.length) // keep "images/..." prefix
                : url;
            const baseName = pathForKey.replace(/\.webp$/, '');
            const newKey = `${baseName}_${timestamp}.webp`;
            const filename = newKey.split('/').pop();

            // Upload to R2
            btn.title = 'Uploading...';
            const oldKey = r2KeyFromUrl(url);
            const r2Url = await githubSync.uploadImage(newKey, base64Data);

            // Clean up old R2 image (fire-and-forget)
            if (oldKey && oldKey !== newKey) {
                githubSync.deleteImage(oldKey).catch(() => {});
            }

            // Update the input field with the R2 URL
            imgInput.value = r2Url;
            this.updateImagePreview(`data:image/webp;base64,${base64Data}`);
            this.updateProcessButton(r2Url);
            this.updateImageActions(r2Url);
            this.setDirty(true);

            btn.title = 'Done! Image uploaded';

        } catch (error) {
            if (error.message !== 'Cancelled') {
                console.error('Image edit failed:', error);
                alert('Failed to edit image: ' + error.message);
            }
        } finally {
            btn.classList.remove('processing');
            btn.disabled = false;
            this.setImageProcessing(false);
        }
    }

    // Process image: fetch, optionally show editor, resize, upload to R2, update field with URL
    async processImage({ skipEditor = false } = {}) {
        const imgInput = this.backdrop.querySelector('#editor-img');
        const url = imgInput.value.trim();
        const btn = this.backdrop.querySelector('#editor-process-img');

        if (!url || !this.imageProcessor.isProcessableUrl(url)) return;

        // Check if githubSync is available and logged in
        if (typeof githubSync === 'undefined' || !githubSync.isLoggedIn()) {
            alert('Please sign in to process images');
            return;
        }

        // Capture old R2 key before upload replaces the URL
        const oldKey = r2KeyFromUrl(url);

        // Show loading state
        btn.classList.add('processing');
        btn.disabled = true;
        btn.title = 'Fetching image...';
        this.setImageProcessing(true);

        try {
            // Fetch the image via proxy
            const { base64: rawBase64, contentType } = await this.imageProcessor.fetchViaProxy(url);
            const rawDataUrl = `data:${contentType};base64,${rawBase64}`;

            // Show image editor for crop/rotate (unless skipped for auto-save)
            let editedDataUrl;
            if (skipEditor) {
                editedDataUrl = rawDataUrl;
            } else {
                btn.title = 'Edit image...';
                editedDataUrl = await imageEditor.open(rawDataUrl);
            }

            // User confirmed - now process the edited image
            btn.title = 'Processing...';

            // Load edited image into Image element
            const img = await new Promise((resolve, reject) => {
                const image = new Image();
                image.onload = () => resolve(image);
                image.onerror = reject;
                image.src = editedDataUrl;
            });

            // Get card data from form to generate filename
            const cardData = {
                set: this.backdrop.querySelector('#editor-set')?.value || '',
                num: this.backdrop.querySelector('#editor-num')?.value || ''
            };

            // Generate filename and key
            const filename = this.imageProcessor.generateFilename(cardData, true);
            const key = `${this.imageFolder}/${filename}`;

            // Resize and convert to WebP
            const { base64: base64Content } = await this.imageProcessor.processImage(img);

            // Upload to R2
            btn.title = 'Uploading...';
            const r2Url = await githubSync.uploadImage(key, base64Content);

            // Clean up old R2 image (fire-and-forget)
            if (oldKey && oldKey !== key) {
                githubSync.deleteImage(oldKey).catch(() => {});
            }

            // Update the input field with the R2 URL
            imgInput.value = r2Url;
            this.updateImagePreview(`data:image/webp;base64,${base64Content}`);
            this.updateProcessButton(r2Url);
            this.updateImageActions(r2Url);
            this.setDirty(true);

            btn.title = 'Done! Image uploaded';

        } catch (error) {
            // Don't show error if user just cancelled
            if (error.message !== 'Cancelled') {
                console.error('Image processing failed:', error);
                alert('Failed to process image: ' + error.message);
            }
        } finally {
            btn.classList.remove('processing');
            btn.disabled = false;
            this.setImageProcessing(false);
        }
    }

    // Process a local file: read, show editor, resize, upload to R2, update field with URL
    async processLocalFile(file) {
        const imgInput = this.backdrop.querySelector('#editor-img');
        const zone = this.backdrop.querySelector('#editor-upload-zone');

        // Check if githubSync is available and logged in
        if (typeof githubSync === 'undefined' || !githubSync.isLoggedIn()) {
            alert('Please sign in to upload images');
            return;
        }

        // Validate file type
        if (!file.type.startsWith('image/')) {
            alert('Please select an image file');
            return;
        }

        // Capture old R2 key before upload replaces the URL
        const oldKey = r2KeyFromUrl(imgInput.value.trim());

        // Show loading state
        zone.classList.add('processing');
        this.setImageProcessing(true);

        try {
            // Read file as data URL
            const dataUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => resolve(e.target.result);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });

            // Show image editor for crop/rotate
            const editedDataUrl = await imageEditor.open(dataUrl);

            // User confirmed - now process the edited image

            // Load edited image into Image element
            const img = await new Promise((resolve, reject) => {
                const image = new Image();
                image.onload = () => resolve(image);
                image.onerror = reject;
                image.src = editedDataUrl;
            });

            // Get card data from form to generate filename
            const cardData = {
                set: this.backdrop.querySelector('#editor-set')?.value || '',
                num: this.backdrop.querySelector('#editor-num')?.value || ''
            };

            // Generate filename and key
            const filename = this.imageProcessor.generateFilename(cardData, true);
            const key = `${this.imageFolder}/${filename}`;

            // Process the image (resize, convert to webp)
            const { base64: base64Content } = await this.imageProcessor.processImage(img);

            // Upload to R2
            const r2Url = await githubSync.uploadImage(key, base64Content);

            // Clean up old R2 image (fire-and-forget)
            if (oldKey && oldKey !== key) {
                githubSync.deleteImage(oldKey).catch(() => {});
            }

            // Update the input field with the R2 URL
            imgInput.value = r2Url;
            this.updateImagePreview(`data:image/webp;base64,${base64Content}`);
            this.updateProcessButton(r2Url);
            this.updateImageActions(r2Url);
            this.setDirty(true);

            // Clear file input for future uploads
            this.backdrop.querySelector('#editor-img-file').value = '';

        } catch (error) {
            // Don't show error if user just cancelled
            if (error.message !== 'Cancelled') {
                console.error('Image upload failed:', error);
                alert('Failed to upload image: ' + error.message);
            }
        } finally {
            zone.classList.remove('processing');
            this.setImageProcessing(false);
        }
    }

    // Set dirty state
    setDirty(dirty) {
        this.isDirty = dirty;
        this.backdrop.querySelector('.card-editor-modal').classList.toggle('dirty', dirty);
    }

    // Open modal for editing existing card
    open(cardId, cardData) {
        this.init();
        this.currentCardId = cardId;
        this.currentCard = cardData;
        this.isNewCard = false;

        // Update title
        this.backdrop.querySelector('.card-editor-title').textContent = 'EDIT CARD';
        this.backdrop.querySelector('.card-editor-subtitle').textContent = 'Update card details';
        this.backdrop.querySelector('.card-editor-btn.save').textContent = 'Save Changes';
        this.backdrop.querySelector('.card-editor-btn.delete').style.display = '';

        // Reset image tabs to "Paste URL"
        this.resetImageTabs();

        // Populate custom fields
        this.populateCustomFields(cardData);

        // Populate core fields
        this.backdrop.querySelector('#editor-set').value = cardData.set || '';
        // Set category if dropdown exists
        const categoryField = this.backdrop.querySelector('#editor-category');
        if (categoryField && cardData.category) {
            categoryField.value = cardData.category;
        }
        // Strip # from card number for editing
        this.backdrop.querySelector('#editor-num').value = (cardData.num || '').replace(/^#/, '');
        const typeEl = this.backdrop.querySelector('#editor-type');
        if (typeEl) typeEl.value = cardData.type || 'Base';
        this.backdrop.querySelector('#editor-price').value = cardData.price !== undefined ? cardData.price : '';
        const ebayValue = cardData.ebay || '';
        this.backdrop.querySelector('#editor-ebay').value = ebayValue;
        this.backdrop.querySelector('#editor-img').value = cardData.img || '';

        // Populate price search field
        const priceSearchValue = cardData.priceSearch || '';
        this.backdrop.querySelector('#editor-price-search').value = priceSearchValue;

        // Show advanced section if either search field has a custom value
        const hasCustomSearch = ebayValue !== '' || priceSearchValue !== '';
        const advancedFields = this.backdrop.querySelector('.card-editor-advanced-fields');
        const advancedToggle = this.backdrop.querySelector('#editor-toggle-advanced');
        advancedFields.style.display = hasCustomSearch ? 'flex' : 'none';
        advancedToggle.textContent = hasCustomSearch ? 'Hide advanced' : 'Advanced';

        this.updateImagePreview(cardData.img);
        this.updateProcessButton(cardData.img);
        this.updateImageActions(cardData.img);
        this.setDirty(false);

        // Set owned toggle
        const owned = this.isOwned(cardId);
        this._initialOwned = owned;
        this.backdrop.querySelector('#editor-owned').checked = owned;
        this._updateOwnedToggleVisibility();

        // Show modal
        this.backdrop.classList.add('active');
    }

    // Open modal for adding new card
    openNew(category = null) {
        this.init();
        this.currentCardId = null;
        this.currentCard = { category };
        this.isNewCard = true;

        // Update title
        this.backdrop.querySelector('.card-editor-title').textContent = 'ADD NEW CARD';
        this.backdrop.querySelector('.card-editor-subtitle').textContent = 'Enter card details';
        this.backdrop.querySelector('.card-editor-btn.save').textContent = 'Add Card';
        this.backdrop.querySelector('.card-editor-btn.delete').style.display = 'none';

        // Reset image tabs to "Paste URL"
        this.resetImageTabs();

        // Clear core form fields
        this.backdrop.querySelector('#editor-set').value = '';
        this.backdrop.querySelector('#editor-num').value = '';
        const typeEl = this.backdrop.querySelector('#editor-type');
        if (typeEl) typeEl.value = 'Base';
        this.backdrop.querySelector('#editor-price').value = '';
        this.backdrop.querySelector('#editor-ebay').value = '';
        this.backdrop.querySelector('#editor-img').value = '';

        // Hide advanced section by default for new cards
        this.backdrop.querySelector('#editor-price-search').value = '';
        this.backdrop.querySelector('.card-editor-advanced-fields').style.display = 'none';
        this.backdrop.querySelector('#editor-toggle-advanced').textContent = 'Advanced';

        // Clear custom fields
        this.clearCustomFields();

        // Set category if dropdown exists
        const categoryField = this.backdrop.querySelector('#editor-category');
        if (categoryField && category) {
            categoryField.value = category;
        }
        this.updateImagePreview('');
        this.updateProcessButton('');
        this.updateImageActions('');
        this.setDirty(false);

        // Default owned to unchecked for new cards
        this._initialOwned = false;
        this.backdrop.querySelector('#editor-owned').checked = false;
        this._updateOwnedToggleVisibility();

        // Show modal
        this.backdrop.classList.add('active');
        // Focus first top-position custom field, or set name
        const topField = Object.entries(this.customFields)
            .find(([_, c]) => (c.position || 'top') === 'top');
        const firstField = topField
            ? this.backdrop.querySelector(`#editor-${topField[0]}`)
            : this.backdrop.querySelector('#editor-set');
        if (firstField) firstField.focus();
    }

    // Show/hide owned toggle based on whether callbacks are configured
    _updateOwnedToggleVisibility() {
        const toggle = this.backdrop.querySelector('#editor-owned-toggle');
        if (toggle) toggle.style.display = this.onOwnedChange ? '' : 'none';
    }

    // Close modal
    close() {
        if (this.isDirty) {
            if (!confirm('You have unsaved changes. Close anyway?')) return;
        }
        this.backdrop.classList.remove('active');
        this.currentCard = null;
        this.currentCardId = null;
        this.isNewCard = false;
        // Close image editor if it was left open
        imageEditor.close();
    }

    // Gather form data
    getFormData() {
        // Strip # prefix from card number (renderer adds it for display)
        let num = this.backdrop.querySelector('#editor-num').value.trim().replace(/^#/, '');

        // Core fields (normalize smart quotes from mobile keyboards)
        const data = {
            set: normalizeQuotes(this.backdrop.querySelector('#editor-set').value.trim()),
            num: num,
            type: this.backdrop.querySelector('#editor-type')?.value || ''
        };

        // Image - always include so merge with fresh gist data doesn't restore deleted images
        data.img = this.backdrop.querySelector('#editor-img').value.trim();

        // Category - only include if field exists
        const categoryField = this.backdrop.querySelector('#editor-category');
        if (categoryField) {
            data.category = categoryField.value;
        }

        // Price - only include if explicitly set (stored as whole number)
        const priceVal = this.backdrop.querySelector('#editor-price').value.trim();
        if (priceVal !== '') {
            data.price = Math.round(parseFloat(priceVal)) || 0;
        }

        // eBay search term - only include if explicitly set
        const ebayVal = this.backdrop.querySelector('#editor-ebay').value.trim();
        if (ebayVal !== '') {
            data.ebay = ebayVal;
        }

        // Price search term - only include if explicitly set
        const priceSearchVal = this.backdrop.querySelector('#editor-price-search').value.trim();
        if (priceSearchVal !== '') {
            data.priceSearch = priceSearchVal;
        }

        // Preserve category if editing and no category dropdown exists
        if (!categoryField && this.currentCard && this.currentCard.category) {
            data.category = this.currentCard.category;
        }

        // Add custom field data
        Object.assign(data, this.getCustomFieldData());

        return data;
    }

    // Validate form - require set name OR a top-position custom field (e.g. player name)
    validate() {
        const data = this.getFormData();
        if (data.set) return true;

        // Check if any top-position custom field has a value
        const hasTopField = Object.entries(this.customFields)
            .some(([name, config]) => (config.position || 'top') === 'top' && data[name]);
        if (hasTopField) return true;

        // Nothing filled in - focus the first visible field
        const topField = Object.entries(this.customFields)
            .find(([_, c]) => (c.position || 'top') === 'top');
        if (topField) {
            alert(`${topField[1].label} or Set Name is required`);
            this.backdrop.querySelector(`#editor-${topField[0]}`)?.focus();
        } else {
            alert('Set name is required');
            this.backdrop.querySelector('#editor-set').focus();
        }
        return false;
    }

    // Check if image URL needs processing (external URL from supported domain)
    needsImageProcessing(url) {
        if (!url) return false;
        // Already a local path, data URL, or R2 URL
        if (url.startsWith(this.imageFolder) || url.startsWith('data:') || url.startsWith(R2_IMAGE_BASE) || !url.startsWith('http')) {
            return false;
        }
        return this.imageProcessor.isProcessableUrl(url);
    }

    // Save card (auto-processes image if needed)
    async save() {
        if (!this.validate()) return;

        const imgUrl = this.backdrop.querySelector('#editor-img').value.trim();

        // Auto-process image if it's from a supported domain and not yet processed
        // Skip the editor on save - just fetch, process, and upload directly
        if (this.needsImageProcessing(imgUrl)) {
            const btn = this.backdrop.querySelector('.card-editor-btn.save');
            const originalText = btn.textContent;
            btn.textContent = 'Processing image...';
            btn.disabled = true;

            try {
                await this.processImage({ skipEditor: true });
            } catch (error) {
                console.error('Auto-process failed:', error);
                // Continue with save even if processing fails
            } finally {
                btn.textContent = originalText;
                btn.disabled = false;
            }
        }

        const data = this.getFormData();

        // If user manually set an eBay search override, store it; otherwise
        // the renderer generates the search term at page load from card fields.
        if (data.ebay) {
            data.search = data.ebay;
            delete data.ebay;
        }

        // Close editor first so user sees the card update immediately
        this.setDirty(false);
        this.backdrop.classList.remove('active');

        // Handle owned state change
        if (this.onOwnedChange) {
            const nowOwned = this.backdrop.querySelector('#editor-owned').checked;
            if (nowOwned !== this._initialOwned) {
                this.onOwnedChange(data, nowOwned);
            }
        }

        // Fire save (awaited so errors propagate to the async chain)
        if (this.isNewCard) {
            await this.onSave(null, data, true);
        } else {
            await this.onSave(this.currentCardId, data, false);
        }
    }

    // Delete card
    delete() {
        if (!this.currentCardId) return;

        if (confirm('Delete this card? This cannot be undone.')) {
            this.onDelete(this.currentCardId);
            this.setDirty(false);
            this.backdrop.classList.remove('active');
        }
    }
}

/**
 * Add Card Button - floating button to add new cards in edit mode
 */
class AddCardButton {
    constructor(options = {}) {
        this.onClick = options.onClick || (() => {});
        this.button = null;
        this.scrollHandler = null;
        this.navHeight = 60; // Height of nav bar
        this.restingTop = 68; // Initial position below nav
        this.minTop = 10; // Position when nav scrolled away
    }

    init() {
        if (document.querySelector('.add-card-btn')) return;

        const btn = document.createElement('button');
        btn.className = 'add-card-btn';
        btn.innerHTML = '+ Add Card';
        btn.title = 'Add new card';
        btn.style.display = 'none';
        btn.onclick = () => this.onClick();

        document.body.appendChild(btn);
        this.button = btn;

        // Scroll handler to adjust position as nav scrolls away
        this.scrollHandler = () => {
            const scrollY = window.scrollY;
            const newTop = Math.max(this.minTop, this.restingTop - scrollY);
            this.button.style.top = newTop + 'px';
        };
    }

    show() {
        if (!this.button) this.init();
        this.button.style.display = '';
        this.scrollHandler(); // Set initial position
        window.addEventListener('scroll', this.scrollHandler, { passive: true });
    }

    hide() {
        if (this.button) {
            this.button.style.display = 'none';
        }
        if (this.scrollHandler) {
            window.removeEventListener('scroll', this.scrollHandler);
        }
    }
}

window.CardEditorModal = CardEditorModal;
window.AddCardButton = AddCardButton;
window.CardContextMenu = CardContextMenu;
