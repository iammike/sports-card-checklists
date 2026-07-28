// The Stack Images suggest button doubles as its own status line, so its resting
// label and the two things that can go wrong live together.
const SUGGEST_STACK_LABEL = 'Suggest from checklist';
const SUGGEST_STACK_EMPTY = 'No images found';
const SUGGEST_STACK_FAILED = 'Could not load';

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
        this.isOwned = options.isOwned || (() => false); // callback to check if card is owned
        this.onOwnedChange = options.onOwnedChange || null; // callback when owned state changes
        this.getExistingIds = options.getExistingIds || (() => []); // callback listing card ids already in use
        // Checklists this card may link to, as [{ value: url, label }]. Read
        // synchronously while building the modal, so the caller is responsible for
        // returning whatever it already has rather than fetching on demand.
        this.getLinkTargets = options.getLinkTargets || (() => []);
        // Async counterpart to getLinkTargets: what the checklist a card links to
        // can say about itself, as { stackImages }. Optional - without it the stack
        // stays hand-entered, which is all it ever was.
        this.getLinkSuggestions = options.getLinkSuggestions || null;
        // Bumped by every request, by init(), and by the link dropdown, so an
        // answer that arrives after the selection moved on - or after the modal
        // was rebuilt on a different card - is recognized as being about the
        // wrong checklist and dropped.
        this._linkSuggestToken = 0;
        this.currentCard = null;
        this.currentCardId = null;
        this.isDirty = false;
        this.backdrop = null;
        this.isNewCard = false;
        this.imageProcessor = new ImageProcessor();
        this._initialOwned = false; // Track initial owned state to detect changes
        this._noCardStash = null; // Owned/price values captured when "no card exists" was ticked

        // Schema-driven custom fields
        // Format: { fieldName: { label, type, options?, placeholder?, fullWidth? } }
        // Types: 'text', 'select', 'checkbox'
        // For select: options is array of { value, label } or just strings
        this.customFields = options.customFields || {};
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

    // The swatch next to a custom field's label. Its color comes from the
    // checklist config and lands in a CSS declaration, so it is validated rather
    // than escaped - see isSafeColor in shared.js. A color that fails renders no
    // swatch, same as a field that defines none.
    colorHintHtml(config) {
        if (!isSafeColor(config.color)) return '';
        return `<span class="card-editor-color-hint" style="background:${sanitizeAttr(config.color)}"></span>`;
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
                const id = sanitizeAttr(`editor-${fieldName}`);
                if (config.type === 'checkbox') {
                    return `<label class="card-editor-attr-checkbox">
                        <input type="checkbox" id="${id}">
                        <span>${sanitizeText(config.label)}</span>
                    </label>`;
                } else {
                    // Text/number field (e.g., serial)
                    const extraAttrs = config.inputType === 'number' ? ' inputmode="numeric"' : '';
                    return `<div class="card-editor-attr-text">
                        <label for="${id}">${sanitizeText(config.label)}:</label>
                        <input type="text" class="card-editor-input" id="${id}" placeholder="${sanitizeAttr(config.placeholder || '')}"${extraAttrs}>
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
            const id = sanitizeAttr(`editor-${fieldName}`);
            const fullWidth = config.fullWidth ? ' full-width' : '';
            const placeholder = sanitizeAttr(config.placeholder || '');

            if (config.type === 'select') {
                const options = (config.options || []).map(opt => {
                    const value = typeof opt === 'string' ? opt : opt.value;
                    const label = typeof opt === 'string' ? opt : opt.label;
                    return `<option value="${sanitizeAttr(value)}">${sanitizeText(label)}</option>`;
                }).join('');
                return `<div class="card-editor-field${fullWidth}">
                    <label class="card-editor-label">${sanitizeText(config.label)}</label>
                    <select class="card-editor-select" id="${id}">${options}</select>
                </div>`;
            } else if (config.type === 'checkbox') {
                return `<div class="card-editor-field${fullWidth}">
                    <label class="card-editor-label">${sanitizeText(config.label)}</label>
                    <label class="card-editor-checkbox">
                        <input type="checkbox" id="${id}">
                        <span>${sanitizeText(config.checkboxLabel || 'Yes')}</span>
                    </label>
                </div>`;
            } else {
                // Default: text input
                const colorHint = this.colorHintHtml(config);
                return `<div class="card-editor-field${fullWidth}">
                    <label class="card-editor-label">${sanitizeText(config.label)}${colorHint}</label>
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
        const id = sanitizeAttr(`editor-${name}`);
        const placeholder = sanitizeAttr(config.placeholder || '');

        if (config.type === 'select') {
            const options = (config.options || []).map(opt => {
                const value = typeof opt === 'string' ? opt : opt.value;
                const label = typeof opt === 'string' ? opt : opt.label;
                return `<option value="${sanitizeAttr(value)}">${sanitizeText(label)}</option>`;
            }).join('');
            return `<div class="card-editor-field">
                <label class="card-editor-label">${sanitizeText(config.label)}</label>
                <select class="card-editor-select" id="${id}">${options}</select>
            </div>`;
        } else if (config.type === 'checkbox') {
            return `<div class="card-editor-field">
                <label class="card-editor-label">${sanitizeText(config.label)}</label>
                <label class="card-editor-checkbox">
                    <input type="checkbox" id="${id}">
                    <span>${sanitizeText(config.checkboxLabel || 'Yes')}</span>
                </label>
            </div>`;
        } else {
            const colorHint = this.colorHintHtml(config);
            return `<div class="card-editor-field">
                <label class="card-editor-label">${sanitizeText(config.label)}${colorHint}</label>
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
        // The wrappers carry ids so _applyCollectionLinkState can hide the fields
        // that describe a physical card without hiding the row they share.
        fields.push({
            html: `<div class="card-editor-field" id="editor-set-field">
                <label class="card-editor-label">Set Name</label>
                <input type="text" class="card-editor-input" id="editor-set" placeholder="2024 Panini Prizm">
            </div>`,
            size: 'wide'
        });
        fields.push({
            html: `<div class="card-editor-field" id="editor-num-field">
                <label class="card-editor-label">Card Number</label>
                <input type="text" class="card-editor-input" id="editor-num" placeholder="123">
            </div>`,
            size: 'narrow'
        });

        // 3. Card Type (wide, conditional)
        if (this.cardTypes.length > 0) {
            fields.push({
                html: `<div class="card-editor-field" id="editor-type-field">
                    <label class="card-editor-label">Card Type</label>
                    <select class="card-editor-select" id="editor-type">
                        ${this.cardTypes.map(t => `<option value="${sanitizeAttr(t)}">${sanitizeText(t)}</option>`).join('')}
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
                    <label class="card-editor-label">${sanitizeText(config.label)}</label>
                    <input type="text" class="card-editor-input" id="${sanitizeAttr(`editor-${name}`)}" placeholder="${sanitizeAttr(config.placeholder || '')}">
                </div>`,
                size: 'wide'
            });
        }

        // 6. Section dropdown (wide, conditional)
        if (this.categories) {
            const options = this.categories.map(c => {
                if (c.group) {
                    return `<optgroup label="${sanitizeAttr(c.group)}">${c.children.map(child =>
                        `<option value="${sanitizeAttr(child.value)}">${sanitizeText(child.label)}</option>`
                    ).join('')}</optgroup>`;
                }
                const label = typeof c === 'string' ? c.charAt(0).toUpperCase() + c.slice(1) : c.label;
                const value = typeof c === 'string' ? c : c.value;
                return `<option value="${sanitizeAttr(value)}">${sanitizeText(label)}</option>`;
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

    // The rows that turn a card into a collection link: which checklist it stands
    // in for, and the stack of images the tile shows in place of the image and set
    // a real card would have.
    //
    // A dropdown rather than a free-text field: the stored value is a URL that
    // every consumer parses an id back out of (see collectionLinkTargetId), so a
    // typo silently costs the card its linked stats, and only the registry knows
    // which ids exist. The caller filters out the checklist being edited, since a
    // checklist linking to itself is nonsense.
    //
    // These live inside the Advanced disclosure, out of mis-click range: this is
    // the only control in the editor that converts an ordinary card into
    // something else entirely, hiding half the form and dropping the card's
    // stored ownership on save. Opening a card that is already a collection link
    // expands Advanced (see _applyCollectionLinkState), so nothing about an
    // existing one is hidden behind a disclosure - only creating a new one asks
    // for the extra click.
    collectionLinkHtml() {
        const targets = this.getLinkTargets() || [];
        const options = ['<option value="">Not a collection link</option>']
            .concat(targets.map(t =>
                `<option value="${sanitizeAttr(t.value)}">${sanitizeText(t.label)}</option>`
            ))
            .join('');

        return `<div class="card-editor-row" style="grid-template-columns:1fr">
                <div class="card-editor-field" id="editor-collection-link-field">
                    <label class="card-editor-label" for="editor-collection-link">Links To Checklist</label>
                    <select class="card-editor-select" id="editor-collection-link">${options}</select>
                </div>
            </div>
            <div class="card-editor-row" style="grid-template-columns:1fr">
                <div class="card-editor-field" id="editor-stack-images-field">
                    <div class="card-editor-label-row">
                        <label class="card-editor-label" for="editor-stack-images">Stack Images</label>
                        <button type="button" class="card-editor-toggle-btn" id="editor-suggest-stack">${SUGGEST_STACK_LABEL}</button>
                    </div>
                    <textarea class="card-editor-input" id="editor-stack-images" rows="3" placeholder="One image URL per line"></textarea>
                </div>
            </div>`;
    }

    // Initialize - create modal DOM
    init() {
        // Every open rebuilds the modal, so any suggestion still in flight is about
        // the card that was open before this one. Retire it here rather than letting
        // it write into the fresh form.
        this._linkSuggestToken++;

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
                    <label class="card-editor-owned-toggle card-editor-no-card-toggle" id="editor-no-card-field" title="This person has no card in existence. Excluded from all totals.">
                        <input type="checkbox" id="editor-no-card">
                        <span class="owned-toggle-label">No Card</span>
                    </label>
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
                            ${this.collectionLinkHtml()}
                            <div class="card-editor-field full-width" id="editor-ebay-field">
                                <label class="card-editor-label">eBay Search Term</label>
                                <input type="text" class="card-editor-input" id="editor-ebay" placeholder="Defaults to player + set + number">
                            </div>
                            <div class="card-editor-field full-width" id="editor-price-search-field">
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

        // No-card checkbox - disables owned/price when this person has no card in existence.
        // Dirty tracking is handled here, not by the generic "input" loop below: a
        // browser click fires "input" before "change", so the generic handler would
        // already have marked the form dirty by the time a cancelled confirm (in
        // _applyNoCardState) reverts the checkbox - leaving the editor dirty for nothing.
        const noCardCheckbox = this.backdrop.querySelector('#editor-no-card');
        if (noCardCheckbox) {
            noCardCheckbox.addEventListener('change', () => {
                const wasDirty = this.isDirty;
                const cancelled = this._applyNoCardState({ fromUserToggle: true }) === false;
                this._applyCollectionLinkState();
                this.setDirty(cancelled ? wasDirty : true);
            });
        }

        // Choosing a checklist to link to switches the form between describing a
        // physical card and standing in for a collection. Dirty tracking is set
        // here rather than left to the generic "input" loop below: change is the
        // canonical event for a select, and this restructures the entire form, so
        // it must not depend on browsers also firing input alongside it - if that
        // assumption ever failed, closing the modal would discard the change with
        // no prompt. Assigning .value in _populateCollectionLink fires neither
        // event, so opening a card never starts out dirty.
        const linkSelect = this.backdrop.querySelector('#editor-collection-link');
        if (linkSelect) {
            linkSelect.addEventListener('change', () => {
                this._applyCollectionLinkState();
                this.setDirty(true);
                // Pointing the card at a different checklist cancels a stack
                // suggestion still in flight for the previous one: those images
                // describe a checklist this card no longer stands in for.
                this._linkSuggestToken++;
            });
        }

        const suggestStack = this.backdrop.querySelector('#editor-suggest-stack');
        if (suggestStack) {
            suggestStack.onclick = () => this._suggestStackImages();
        }

        // Delete button
        this.backdrop.querySelector('.card-editor-btn.delete').onclick = () => this.delete();

        // Track dirty state on input
        modal.querySelectorAll('input, select, textarea').forEach(input => {
            if (input === noCardCheckbox) return;
            input.oninput = () => this.setDirty(true);
        });

        // Toggle advanced fields visibility. The section's own display is the
        // expanded state, so read it back and let _setAdvancedExpanded own both
        // it and the button label - there is one place that can disagree.
        const advancedToggle = this.backdrop.querySelector('#editor-toggle-advanced');
        const advancedFields = this.backdrop.querySelector('.card-editor-advanced-fields');
        advancedToggle.onclick = () => {
            this._setAdvancedExpanded(advancedFields.style.display === 'none');
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

        // Broken preview image falls back to a placeholder
        this._initPreviewFallback();

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

    // Swap a preview image that fails to load for a placeholder. error does not
    // bubble, so the listener captures. The preview container is created once in
    // init() and updateImagePreview only rewrites its innerHTML, so one listener
    // covers every preview the editor ever renders.
    _initPreviewFallback() {
        const preview = this.backdrop.querySelector('.card-editor-image-preview');
        if (!preview) return;
        preview.addEventListener('error', (e) => {
            const img = e.target;
            if (img?.tagName !== 'IMG' || !img.parentNode) return;
            const placeholder = document.createElement('span');
            placeholder.className = 'placeholder';
            placeholder.textContent = 'Failed to load';
            img.replaceWith(placeholder);
        }, true);
    }

    // Update image preview
    updateImagePreview(url) {
        const preview = this.backdrop.querySelector('.card-editor-image-preview');

        // Only preview values we can actually load as an image:
        // - data: URLs used as-is
        // - Absolute http(s) URLs (incl. R2) go through sanitizeUrl
        // - Local relative paths under the image folder used as-is
        // Anything else (partial typing, a pasted non-URL) would resolve against
        // the page origin and fire a doomed request, so we skip it.
        //
        // This chain is already a scheme allowlist, and a stricter one than the
        // sanitizeLinkUrl that guards the other URL sinks - 'javascript:' matches
        // no branch and lands on the placeholder. sanitizeLinkUrl is deliberately
        // not used here because it would also blank 'data:', which the image
        // editor round-trip feeds in to preview a crop before it is uploaded.
        // sanitizeAttr below is still what stops the value breaking out of src.
        let src = null;
        if (url) {
            if (url.startsWith('data:')) {
                src = url;
            } else if (url.startsWith('http://') || url.startsWith('https://')) {
                src = sanitizeUrl(url);
            } else if (url.startsWith(this.imageFolder)) {
                src = url;
            }
        }

        if (src) {
            // No inline onerror: _initPreviewFallback's delegated listener swaps
            // a failed load for the placeholder.
            preview.innerHTML = `<img src="${sanitizeAttr(src)}" alt="Preview">`;
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
            this._handleImageError(error, 'Image edit failed:', 'Failed to edit image: ');
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
            this._handleImageError(error, 'Image processing failed:', 'Failed to process image: ');
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
            this._handleImageError(error, 'Image upload failed:', 'Failed to upload image: ');
        } finally {
            zone.classList.remove('processing');
            this.setImageProcessing(false);
        }
    }

    // Centralized error handling for image upload/edit flows. Ignores user
    // cancellations, prompts a clean re-login on an expired session, and falls
    // back to a generic alert for everything else.
    _handleImageError(error, logLabel, alertPrefix) {
        if (error.message === 'Cancelled') return;
        console.error(logLabel, error);
        if (error.authExpired) {
            if (confirm('Your session has expired. Sign in again to upload images?')) {
                githubSync.logout();
                window.location.reload();
            }
            return;
        }
        alert(alertPrefix + error.message);
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
        const ebayValue = cardData.search || cardData.ebay || '';
        this.backdrop.querySelector('#editor-ebay').value = ebayValue;
        this.backdrop.querySelector('#editor-img').value = cardData.img || '';

        // Populate price search field
        const priceSearchValue = cardData.priceSearch || '';
        this.backdrop.querySelector('#editor-price-search').value = priceSearchValue;

        // Show advanced section if either search field has a custom value
        this._syncAdvancedVisibility();

        this.updateImagePreview(cardData.img);
        this.updateProcessButton(cardData.img);
        this.updateImageActions(cardData.img);
        this.setDirty(false);

        // Set owned toggle
        const owned = this.isOwned(cardId);
        this._initialOwned = owned;
        this.backdrop.querySelector('#editor-owned').checked = owned;
        this._updateOwnedToggleVisibility();

        this._noCardStash = null;
        this.backdrop.querySelector('#editor-no-card').checked = !!cardData.noCard;
        this._applyNoCardState();

        this._populateCollectionLink(cardData);
        this._applyCollectionLinkState();

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

        // Hide advanced section by default for new cards - which is also what
        // keeps the link dropdown inside it out of mis-click range
        this.backdrop.querySelector('#editor-price-search').value = '';
        this._setAdvancedExpanded(false);

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

        this._noCardStash = null;
        this.backdrop.querySelector('#editor-no-card').checked = false;
        this._applyNoCardState();

        this._populateCollectionLink({});
        this._applyCollectionLinkState();

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

    // Owned and price do not apply to an entry with no card in existence.
    //
    // Ticking the box clears both, so a user toggle first confirms the loss and
    // stashes the pre-toggle values - unticking restores them, making a misclick
    // recoverable. The initial sync from open()/openNew() is not a user toggle:
    // it only updates the disabled state, so an already-flagged card can never
    // stash cleared values as the thing to restore.
    //
    // Returns false when a user toggle was cancelled at the confirm, so the
    // change handler can leave the dirty flag as it found it.
    _applyNoCardState({ fromUserToggle = false } = {}) {
        const checkbox = this.backdrop.querySelector('#editor-no-card');
        const noCard = !!checkbox?.checked;
        const owned = this.backdrop.querySelector('#editor-owned');
        const price = this.backdrop.querySelector('#editor-price');
        const priceWrap = this.backdrop.querySelector('#editor-header-price');
        const ownedWrap = this.backdrop.querySelector('#editor-owned-toggle');

        if (fromUserToggle && noCard && !this._noCardStash) {
            // A price of 0 is the same as no price for this check only - storage
            // and reads elsewhere are unaffected.
            const priceHasValue = price && price.value.trim() !== '' && parseFloat(price.value) !== 0;
            const hasData = (owned && owned.checked) || priceHasValue;
            if (hasData && !confirm('This entry is marked owned or has a price. Flagging it as no card exists clears both. Continue?')) {
                if (checkbox) checkbox.checked = false;
                return false;
            }
            this._noCardStash = {
                owned: owned ? owned.checked : false,
                price: price ? price.value : '',
            };
            if (owned) owned.checked = false;
            if (price) price.value = '';
        } else if (fromUserToggle && !noCard && this._noCardStash) {
            if (owned) owned.checked = this._noCardStash.owned;
            if (price) price.value = this._noCardStash.price;
            this._noCardStash = null;
        }

        if (owned) owned.disabled = noCard;
        if (price) price.disabled = noCard;
        if (priceWrap) priceWrap.classList.toggle('disabled', noCard);
        if (ownedWrap) ownedWrap.classList.toggle('disabled', noCard);
    }

    // A collection link card stands in for another checklist instead of describing
    // a physical card, so set name, card number, type, image, price and the owned
    // toggle do not apply and are hidden while a link is selected. Its owned state
    // is derived from the linked checklist's stats, not stored, so leaving a live
    // toggle would show the wrong value and write a card id nothing reads.
    //
    // Hidden, never cleared: the inputs keep whatever the card already held, so a
    // hand-written collection link card that uses a plain `img` instead of
    // stackImages doesn't lose it just because the editor was opened on it.
    //
    // noCard wins over collectionLink everywhere else (see createCardElement), so
    // the two are offered as alternatives here: setting either hides the other.
    _applyCollectionLinkState() {
        const select = this.backdrop.querySelector('#editor-collection-link');
        if (!select) return;

        const noCard = !!this.backdrop.querySelector('#editor-no-card')?.checked;
        const link = select.value;
        const isLink = !!link && !noCard;
        // Nothing to link to and nothing already linked - the row is just noise
        const offerLink = !noCard && (select.options.length > 1 || !!link);

        this._setFieldVisible('#editor-collection-link-field', offerLink);
        this._setFieldVisible('#editor-stack-images-field', isLink);

        this._setFieldVisible('#editor-set-field', !isLink);
        this._setFieldVisible('#editor-num-field', !isLink);
        this._setFieldVisible('#editor-type-field', !isLink);
        this._setFieldVisible('.card-editor-image-section', !isLink);
        this._setFieldVisible('#editor-header-price', !isLink);
        this._setFieldVisible('#editor-no-card-field', !isLink);
        // The eBay and price search overrides share Advanced with the link
        // dropdown, and a collection link tile renders neither search link - so
        // they hide, while the section around them stays open and usable.
        this._setFieldVisible('#editor-ebay-field', !isLink);
        this._setFieldVisible('#editor-price-search-field', !isLink);
        // A link card's defining control lives in Advanced, so the section has to
        // be open for the card to show what it is. Expand only, never collapse:
        // un-linking would otherwise slam the section shut the instant the user
        // used the dropdown inside it.
        if (isLink) this._setAdvancedExpanded(true);
        // Restoring the owned toggle is _updateOwnedToggleVisibility's call, not
        // ours - it stays hidden when no ownership callback is wired up at all.
        if (isLink) this._setFieldVisible('#editor-owned-toggle', false);
        else this._updateOwnedToggleVisibility();

        this._collapseEmptyRows();
    }

    _setFieldVisible(selector, visible) {
        const el = this.backdrop.querySelector(selector);
        if (el) el.style.display = visible ? '' : 'none';
    }

    // Expand or collapse Advanced, keeping the button label with it. The section's
    // own display doubles as its expanded state, so this is the single writer -
    // a caller that set one without the other would leave the label lying.
    _setAdvancedExpanded(expanded) {
        const fields = this.backdrop.querySelector('.card-editor-advanced-fields');
        const toggle = this.backdrop.querySelector('#editor-toggle-advanced');
        if (fields) fields.style.display = expanded ? 'flex' : 'none';
        if (toggle) toggle.textContent = expanded ? 'Hide advanced' : 'Advanced';
    }

    // Open Advanced on a card that has something to show there. Called from
    // open() for a stored search term; _applyCollectionLinkState adds the link
    // case, which it has to do itself because open() runs this before the
    // dropdown has been populated.
    _syncAdvancedVisibility() {
        const hasCustomSearch = this.backdrop.querySelector('#editor-ebay').value !== ''
            || this.backdrop.querySelector('#editor-price-search').value !== '';
        this._setAdvancedExpanded(hasCustomSearch);
    }

    // Rows are laid out as grids of paired fields, so a row whose fields are all
    // hidden still contributes its gap. Hide the row itself once it holds nothing.
    _collapseEmptyRows() {
        this.backdrop.querySelectorAll('.card-editor-row').forEach(row => {
            const fields = row.querySelectorAll('.card-editor-field');
            const anyVisible = Array.from(fields).some(f => f.style.display !== 'none');
            row.style.display = anyVisible ? '' : 'none';
        });
    }

    // Populate the collection link fields from card data
    _populateCollectionLink(cardData) {
        const select = this.backdrop.querySelector('#editor-collection-link');
        if (!select) return;

        const link = cardData.collectionLink || '';
        // A link the registry doesn't offer - it hasn't loaded, the target was
        // renamed, or the URL was written by hand - still has to round-trip, so
        // give it an option of its own rather than silently resetting the field.
        if (link && !Array.from(select.options).some(o => o.value === link)) {
            const option = document.createElement('option');
            option.value = link;
            option.textContent = link;
            select.appendChild(option);
        }
        select.value = link;

        const stack = this.backdrop.querySelector('#editor-stack-images');
        if (stack) stack.value = (Array.isArray(cardData.stackImages) ? cardData.stackImages : []).join('\n');
    }

    // Ask the caller what the currently selected checklist knows about itself.
    //
    // Resolves to { stale, suggestion }. `stale` means a newer request - or a
    // reopened modal - has taken over since this one went out, and the answer
    // describes a checklist the form may no longer point at; the only correct
    // response is to touch nothing. A failed fetch resolves as a plain absent
    // suggestion: the stack box is hand-editable and keeps whatever it holds, so
    // there is nothing to recover from beyond not writing anything.
    async _requestLinkSuggestions() {
        const token = ++this._linkSuggestToken;
        const link = this.backdrop.querySelector('#editor-collection-link')?.value.trim() || '';
        if (!link || !this.getLinkSuggestions) return { stale: false, suggestion: null };

        let suggestion = null;
        try {
            suggestion = await this.getLinkSuggestions(link);
        } catch (e) {
            console.warn('Could not read the linked checklist:', e);
        }
        if (token !== this._linkSuggestToken) return { stale: true, suggestion: null };
        return { stale: false, suggestion: suggestion || null };
    }

    // Fill the stack box with images from the linked checklist. Behind a button
    // rather than automatic, because three hand-picked images are a legitimate
    // choice and this replaces the lot - and because a button is the only trigger
    // that still works on a card whose stack is already filled in.
    //
    // The button is the whole status display: there is no other surface in the
    // editor for a suggestion that came back empty or failed, and inventing one for
    // a convenience feature is out of proportion. It resets to its resting label on
    // the next open, since init() rebuilds the modal.
    async _suggestStackImages() {
        const button = this.backdrop.querySelector('#editor-suggest-stack');
        const resting = button ? button.textContent : SUGGEST_STACK_LABEL;
        if (button) {
            button.disabled = true;
            button.textContent = 'Loading...';
        }

        const { stale, suggestion } = await this._requestLinkSuggestions();

        if (button) button.disabled = false;
        if (stale) {
            // Someone else's request now; say nothing about its outcome
            if (button) button.textContent = resting;
            return;
        }

        const images = Array.isArray(suggestion?.stackImages) ? suggestion.stackImages : [];
        if (images.length === 0) {
            if (button) button.textContent = suggestion ? SUGGEST_STACK_EMPTY : SUGGEST_STACK_FAILED;
            return;
        }

        const box = this.backdrop.querySelector('#editor-stack-images');
        if (box) {
            box.value = images.join('\n');
            this.setDirty(true);
        }
        if (button) button.textContent = SUGGEST_STACK_LABEL;
    }

    // One image URL per line. Blank lines are dropped so an empty box yields an
    // empty list - storing [''] would render a broken image in the card stack.
    parseStackImages(value) {
        return String(value || '')
            .split('\n')
            .map(line => line.trim())
            .filter(line => line !== '');
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
        this._noCardStash = null;
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

        const noCardChecked = !!this.backdrop.querySelector('#editor-no-card')?.checked;
        const link = this.backdrop.querySelector('#editor-collection-link')?.value.trim() || '';

        // Price - only include if explicitly set (stored as whole number). Neither
        // a no-card entry nor a collection link card has one, even if the field
        // still holds a stale value from before it was flagged or linked - see
        // _applyNoCardState and _applyCollectionLinkState, which hide it in both
        // states. A price stranded on a linked card would be unreachable without
        // un-linking first, and price-low/price-high sort still reads it, so the
        // tile would silently move under those sorts. Un-linking brings it back:
        // the input is hidden, never cleared.
        const priceVal = this.backdrop.querySelector('#editor-price').value.trim();
        if (priceVal !== '' && !noCardChecked && !link) {
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

        // No-card flag - always included, like img, so noCard: false acts as a
        // deletion marker that survives the merge with fresh gist data
        data.noCard = noCardChecked;

        // Collection link fields. Omitted rather than sent empty, so that clearing
        // the link records a deletion the gist merge honors (see _clearEmptyFields).
        // An empty stack must store nothing at all: [''] would render a broken
        // image, and [] is truthy so it would never be recognized as cleared.
        if (link && !noCardChecked) {
            data.collectionLink = link;
            const stack = this.parseStackImages(this.backdrop.querySelector('#editor-stack-images').value);
            if (stack.length > 0) data.stackImages = stack;
        }

        // Identity: neither a no-card entry nor a collection link card has a
        // set/num/variant to hash, so both need an explicit id. Assigned once and
        // never regenerated, even if the name changes. An unsafe existing id is not
        // honored anywhere (see isSafeCardId), so don't carry it forward - drop it
        // and let the entry get a fresh one.
        const existingId = this.currentCard && this.currentCard.id;
        if (isSafeCardId(existingId)) {
            data.id = existingId;
        } else if (noCardChecked) {
            data.id = this.generateNoCardId(data);
        } else if (data.collectionLink) {
            data.id = this.generateCollectionLinkId(data);
        }

        return data;
    }

    // Build a stable id for a no-card entry from the player name (or the first
    // top-position custom field), falling back to the set name.
    generateNoCardId(data) {
        return buildNoCardId(this.entryName(data) || data.set || '', this.getExistingIds());
    }

    // Same for a collection link card, falling back to the id of the checklist it
    // links to - a link is the one thing such a card always has.
    generateCollectionLinkId(data) {
        const source = this.entryName(data) || collectionLinkTargetId(data.collectionLink) || '';
        return buildCollectionLinkId(source, this.getExistingIds());
    }

    // What this checklist calls an entry: the first top-position custom field,
    // which is the player name on every config that has one.
    entryName(data) {
        const topField = Object.entries(this.customFields)
            .find(([_, config]) => (config.position || 'top') === 'top');
        return (topField && data[topField[0]]) || '';
    }

    // Validate form - require set name OR a top-position custom field (e.g. player name)
    validate() {
        const data = this.getFormData();
        if (data.set) return true;

        // A collection link card is identified by the checklist it stands in for,
        // and the set name field is hidden while a link is selected - so a config
        // with no top-position custom field would have nothing left to fill in.
        if (data.collectionLink) return true;

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
