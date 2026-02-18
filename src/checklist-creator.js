/**
 * ChecklistCreatorModal - Form for creating new dynamic checklists
 * Also used for editing settings of existing checklists.
 */
class ChecklistCreatorModal {
    constructor(options = {}) {
        this.onCreated = options.onCreated || (() => {});
        this.backdrop = null;
        this.editMode = false;
        this.existingConfig = null;
    }

    // Built-in sort options (always shown as chips). Subtitle fields add dynamic chips automatically.
    static SORT_OPTIONS = {
        'year': 'Year',
        'set': 'Set/Brand',
        'price-low': 'Price Low',
        'price-high': 'Price High',
        'scarcity': 'Scarcity',
    };

    static DEFAULT_SORTS = ['year', 'set', 'price-low', 'price-high'];

    // Options for what "Default" sort means
    static DEFAULT_SORT_MODES = {
        'as-entered': 'As Entered (manual order)',
        'alphabetical': 'Alphabetical (player name)',
        'year': 'Year',
        'set': 'Set/Brand',
    };

    init() {
        if (this.backdrop) return;

        const backdrop = document.createElement('div');
        backdrop.className = 'card-editor-backdrop checklist-creator-backdrop';
        backdrop.innerHTML = `
            <div class="card-editor-modal checklist-creator-modal">
                <div class="card-editor-header">
                    <div>
                        <div class="card-editor-title">CREATE NEW CHECKLIST</div>
                        <div class="card-editor-subtitle">Set up your card collection</div>
                    </div>
                    <button class="card-editor-close" title="Close">&times;</button>
                </div>
                <div class="card-editor-body">
                    <div class="creator-section-label">Info</div>
                    <div class="card-editor-grid">
                        <div class="card-editor-field full-width">
                            <label class="card-editor-label">Checklist Title</label>
                            <input type="text" class="card-editor-input" id="creator-title" placeholder="My Card Collection" title="The main heading displayed at the top of your checklist page">
                        </div>
                        <div class="card-editor-field">
                            <label class="card-editor-label">Subtitle</label>
                            <input type="text" class="card-editor-input" id="creator-subtitle" placeholder="Optional subtitle" title="Smaller text shown below the title on the checklist page">
                        </div>
                        <div class="card-editor-field">
                            <label class="card-editor-label">Nav Label</label>
                            <input type="text" class="card-editor-input" id="creator-nav-label" placeholder="e.g. MY CARDS" maxlength="20" title="Short label shown in the top navigation bar">
                        </div>
                        <div class="card-editor-field full-width">
                            <label class="card-editor-label">Description</label>
                            <textarea class="card-editor-input creator-textarea" id="creator-description" rows="2" placeholder="Short description shown on the home page" title="Brief text shown on the index page card for this checklist"></textarea>
                        </div>
                    </div>

                    <div class="creator-section-divider"></div>
                    <div class="creator-section-label">Theme</div>

                    <div class="creator-theme-row">
                        <div class="creator-color-field" title="Main color used for the page header gradient and accents">
                            <label class="card-editor-label">Primary</label>
                            <div class="creator-color-picker">
                                <input type="color" id="creator-primary-color" value="#667eea">
                                <span class="creator-color-hex" id="creator-primary-hex">#667eea</span>
                            </div>
                        </div>
                        <div class="creator-color-field" title="Secondary color used for buttons, links, and highlights">
                            <label class="card-editor-label">Accent</label>
                            <div class="creator-color-picker">
                                <input type="color" id="creator-accent-color" value="#f39c12">
                                <span class="creator-color-hex" id="creator-accent-hex">#f39c12</span>
                            </div>
                        </div>
                        <label class="card-editor-checkbox creator-dark-toggle" title="Dark background with light text instead of the default light theme">
                            <input type="checkbox" id="creator-dark-theme">
                            <span>Dark theme</span>
                        </label>
                    </div>

                    <div class="creator-section-divider"></div>
                    <div class="creator-section-label">Structure</div>

                    <div class="card-editor-grid">
                        <div class="card-editor-field">
                            <label class="card-editor-checkbox" title="Group cards into named sections with headers. Uncheck for a single flat list.">
                                <input type="checkbox" id="creator-use-sections" checked>
                                <span>Organize cards into sections</span>
                            </label>
                        </div>
                        <div class="card-editor-field full-width" id="creator-categories-field">
                            <label class="card-editor-label">Sections</label>
                            <div class="creator-row-list" id="creator-categories-list"></div>
                            <button type="button" class="creator-add-row" id="creator-add-category">+ Add Section</button>
                        </div>
                    </div>

                    <div class="creator-section-divider"></div>
                    <div class="creator-section-label">Display</div>

                    <div class="creator-display-grid">
                        <div class="card-editor-field">
                            <label class="card-editor-label" title="How cards are ordered within each section by default">Default Sort</label>
                            <select class="card-editor-input card-editor-select" id="creator-default-sort" title="The sort applied when viewing the checklist normally"></select>
                            <label class="card-editor-checkbox" style="margin-top: 8px;" title="Show a player name field on each card. Useful for checklists organized by player.">
                                <input type="checkbox" id="creator-show-player">
                                <span>Show player name on cards</span>
                            </label>
                            <label class="card-editor-checkbox" title="Show a position field on each card (e.g. QB, DE, HC). Requires player name to be enabled.">
                                <input type="checkbox" id="creator-show-position">
                                <span>Show position on cards</span>
                            </label>
                        </div>
                        <div class="card-editor-field">
                            <label class="card-editor-label" title="Extra sort options available in the sort dropdown on the checklist page">Additional Sorts</label>
                            <div class="creator-sort-chips" id="creator-sort-chips" title="Click to toggle each sort option on or off"></div>
                        </div>
                    </div>

                    <div class="creator-section-divider"></div>
                    <div class="creator-section-label">Card Details</div>

                    <div class="creator-subsection-label" title="Custom text lines shown below the player name on each card">Subtitle Lines</div>
                    <div class="creator-hint" style="margin-bottom: 6px;">Text fields shown below the player name on each card</div>
                    <div class="creator-row-list" id="creator-subtitle-lines-list"></div>
                    <button type="button" class="creator-add-row" id="creator-add-subtitle-line">+ Add Subtitle Line</button>


                    <div class="creator-subsection-label" style="margin-top: 14px;" title="Toggle which attribute fields appear in the card editor">Attributes</div>
                    <div class="creator-options-row">
                        <label class="card-editor-checkbox" title="Text field for card variant (e.g. Silver Prizm, Blue Shimmer)">
                            <input type="checkbox" id="creator-attr-variant" checked>
                            <span>Variant</span>
                        </label>
                        <label class="card-editor-checkbox" title="Checkbox to mark autographed cards. Shows a gold AUTO badge.">
                            <input type="checkbox" id="creator-attr-auto" checked>
                            <span>Auto</span>
                        </label>
                        <label class="card-editor-checkbox" title="Checkbox to mark patch/relic cards. Shows a purple PATCH badge.">
                            <input type="checkbox" id="creator-attr-patch" checked>
                            <span>Patch</span>
                        </label>
                        <label class="card-editor-checkbox" title="Text field for serial numbered cards (e.g. /99, /25). Shows a serial badge.">
                            <input type="checkbox" id="creator-attr-serial" checked>
                            <span>Serial</span>
                        </label>
                    </div>

                    <div class="creator-subsection-label" style="margin-top: 14px;" title="Dollar thresholds for price badge colors: green (below mid), orange (mid to high), red (above high)">Price Badge Colors</div>
                    <div class="creator-price-thresholds">
                        <label title="Cards priced at or above this amount show an orange badge">
                            <span class="creator-threshold-color" style="background: var(--color-warning, #ff9800)"></span>
                            <span>$</span><input type="text" inputmode="numeric" id="creator-threshold-mid" value="3" class="creator-threshold-input">
                        </label>
                        <label title="Cards priced at or above this amount show a red badge">
                            <span class="creator-threshold-color" style="background: var(--color-error, #f44336)"></span>
                            <span>$</span><input type="text" inputmode="numeric" id="creator-threshold-high" value="10" class="creator-threshold-input">
                        </label>
                        <span class="creator-threshold-hint"><span>Cards below $<span id="creator-threshold-mid-label">3</span> are</span> <span class="creator-threshold-color" style="background: var(--color-success, #4caf50)"></span></span>
                    </div>

                </div>
                <div class="card-editor-footer">
                    <button class="card-editor-btn save" id="creator-save">Create Checklist</button>
                    <button class="card-editor-btn cancel" id="creator-cancel">Cancel</button>
                </div>
            </div>
        `;

        backdrop.querySelector('.card-editor-close').onclick = () => this.close();
        backdrop.querySelector('#creator-cancel').onclick = () => this.close();
        backdrop.querySelector('#creator-save').onclick = () => this.save();
        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) this.close();
        });

        // Toggle sections visibility
        backdrop.querySelector('#creator-use-sections').addEventListener('change', (e) => {
            if (!e.target.checked && this.editMode && this.existingConfig?.dataShape !== 'flat') {
                if (!confirm('Removing sections will move all cards into a single flat list. Card section assignments will be lost. Continue?')) {
                    e.target.checked = true;
                    return;
                }
            }
            backdrop.querySelector('#creator-categories-field').style.display = e.target.checked ? '' : 'none';
        });

        // Sync color hex displays
        backdrop.querySelector('#creator-primary-color').addEventListener('input', (e) => {
            backdrop.querySelector('#creator-primary-hex').textContent = e.target.value;
        });
        backdrop.querySelector('#creator-accent-color').addEventListener('input', (e) => {
            backdrop.querySelector('#creator-accent-hex').textContent = e.target.value;
        });

        // Position requires player name
        const playerCheck = backdrop.querySelector('#creator-show-player');
        const posCheck = backdrop.querySelector('#creator-show-position');
        const syncPos = () => {
            posCheck.disabled = !playerCheck.checked;
            if (!playerCheck.checked) posCheck.checked = false;
        };
        playerCheck.addEventListener('change', syncPos);
        syncPos();

        // Update green hint when mid threshold changes
        // Price threshold validation
        const validateThreshold = (input, fallback) => {
            let val = parseInt(input.value);
            if (isNaN(val) || val < 0) val = fallback;
            input.value = val;
            return val;
        };
        const midInput = backdrop.querySelector('#creator-threshold-mid');
        const highInput = backdrop.querySelector('#creator-threshold-high');
        const midLabel = backdrop.querySelector('#creator-threshold-mid-label');
        midInput.addEventListener('input', () => {
            midLabel.textContent = parseInt(midInput.value) || 0;
        });
        midInput.addEventListener('blur', () => {
            const mid = validateThreshold(midInput, 3);
            midLabel.textContent = mid;
            const high = parseInt(highInput.value) || 10;
            if (mid >= high) highInput.value = mid + 1;
        });
        highInput.addEventListener('blur', () => {
            const high = validateThreshold(highInput, 10);
            const mid = parseInt(midInput.value) || 3;
            if (high <= mid) highInput.value = mid + 1;
        });

        // Add category / subtitle line buttons
        backdrop.querySelector('#creator-add-category').onclick = () => this._addCategoryRow();
        backdrop.querySelector('#creator-add-subtitle-line').onclick = () => this._addSubtitleLineRow();

        // Escape key to close
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && backdrop.classList.contains('active')) {
                this.close();
            }
        });

        // Enter key to save (unless in a textarea or while saving)
        const modal = backdrop.querySelector('.card-editor-modal');
        modal.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !['TEXTAREA'].includes(e.target.tagName)) {
                const saveBtn = backdrop.querySelector('#creator-save');
                if (saveBtn && saveBtn.disabled) return;
                e.preventDefault();
                this.save();
            }
        });

        this.backdrop = backdrop;
        document.body.appendChild(backdrop);
        this._trackDirty();
    }

    open() {
        this.init();
        this.editMode = false;
        this.existingConfig = null;
        this.isDirty = false;
        this.backdrop.querySelector('.card-editor-title').textContent = 'CREATE NEW CHECKLIST';
        this.backdrop.querySelector('.card-editor-subtitle').textContent = 'Set up your card collection';
        this.backdrop.querySelector('#creator-save').textContent = 'Create Checklist';
        this._clearForm();
        this.backdrop.classList.add('active');
        this.backdrop.querySelector('#creator-title').focus();
    }

    openEdit(config) {
        this.init();
        this.editMode = true;
        this.existingConfig = config;
        this.isDirty = false;
        this.backdrop.querySelector('.card-editor-title').textContent = 'CHECKLIST SETTINGS';
        this.backdrop.querySelector('.card-editor-subtitle').textContent = 'Edit checklist configuration';
        this.backdrop.querySelector('#creator-save').textContent = 'Save Settings';
        this._populateForm(config);
        this.backdrop.classList.add('active');
    }

    close() {
        if (this.isDirty) {
            if (!confirm('You have unsaved changes. Close anyway?')) return;
        }
        if (this.backdrop) {
            this.backdrop.classList.remove('active');
        }
    }

    _trackDirty() {
        const modal = this.backdrop.querySelector('.card-editor-modal');
        modal.addEventListener('input', () => { this.isDirty = true; });
        modal.addEventListener('change', () => { this.isDirty = true; });
    }

    // ---- Sort options ----

    _renderSortControls(activeSorts, defaultSortMode, subtitleLines) {
        // Default sort dropdown
        const select = this.backdrop.querySelector('#creator-default-sort');
        if (select) {
            this._rebuildDefaultSortDropdown(defaultSortMode, subtitleLines);
        }

        // Sort chips (additional sorts beyond default)
        this._renderSortChips(activeSorts);
    }

    _renderSortChips(activeSorts) {
        const container = this.backdrop.querySelector('#creator-sort-chips');
        if (!container) return;

        // Remember currently active chips before rebuild
        const currentActive = activeSorts || this._getActiveChipKeys();
        container.innerHTML = '';

        // Built-in sort options
        Object.entries(ChecklistCreatorModal.SORT_OPTIONS).forEach(([key, label]) => {
            this._appendSortChip(container, key, label, currentActive.includes(key));
        });

        // Dynamic chips from subtitle lines
        const subtitleLines = this._getSubtitleLinesFromForm();
        subtitleLines.forEach(line => {
            const key = `field:${line.key}`;
            this._appendSortChip(container, key, line.label, currentActive.includes(key));
        });
    }

    _appendSortChip(container, key, label, isActive) {
        const chip = document.createElement('span');
        chip.className = 'creator-sort-chip' + (isActive ? ' active' : '');
        chip.textContent = label;
        chip.dataset.sort = key;
        chip.onclick = () => chip.classList.toggle('active');
        container.appendChild(chip);
    }

    _getActiveChipKeys() {
        const chips = this.backdrop.querySelectorAll('#creator-sort-chips .creator-sort-chip.active');
        return Array.from(chips).map(c => c.dataset.sort);
    }

    _refreshSortControls() {
        this._renderSortChips();
        this._refreshDefaultSortDropdown();
    }

    _refreshDefaultSortDropdown() {
        const select = this.backdrop.querySelector('#creator-default-sort');
        if (!select) return;
        const currentValue = select.value;
        this._rebuildDefaultSortDropdown(currentValue);
        if ([...select.options].some(o => o.value === currentValue)) {
            select.value = currentValue;
        }
    }

    _rebuildDefaultSortDropdown(selectedValue, subtitleLines) {
        const select = this.backdrop.querySelector('#creator-default-sort');
        if (!select) return;
        select.innerHTML = '';

        // Base modes (As Entered, Alphabetical, Year, Set/Brand)
        Object.entries(ChecklistCreatorModal.DEFAULT_SORT_MODES).forEach(([key, label]) => {
            const opt = document.createElement('option');
            opt.value = key;
            opt.textContent = label;
            select.appendChild(opt);
        });

        // Chip-based sorts (Price Low, Price High, Scarcity)
        Object.entries(ChecklistCreatorModal.SORT_OPTIONS).forEach(([key, label]) => {
            if (ChecklistCreatorModal.DEFAULT_SORT_MODES[key]) return;
            const opt = document.createElement('option');
            opt.value = key;
            opt.textContent = label;
            select.appendChild(opt);
        });

        // Subtitle line fields
        const lines = subtitleLines || this._getSubtitleLinesFromForm();
        lines.forEach(line => {
            const opt = document.createElement('option');
            opt.value = `field:${line.key}`;
            opt.textContent = `${line.label} (custom field)`;
            select.appendChild(opt);
        });

        select.value = selectedValue || 'as-entered';

        // Auto-enable chip when a sort chip option is selected as default
        select.onchange = () => {
            const val = select.value;
            const chip = this.backdrop.querySelector(`#creator-sort-chips .creator-sort-chip[data-sort="${val}"]`);
            if (chip && !chip.classList.contains('active')) chip.classList.add('active');
        };
    }

    _getSortOptionsFromForm() {
        const chips = this.backdrop.querySelectorAll('#creator-sort-chips .creator-sort-chip.active');
        // Always include 'default' as first option, then the selected additional sorts
        return ['default', ...Array.from(chips).map(c => c.dataset.sort)];
    }

    // ---- Category rows ----

    _slugify(label) {
        return label.toLowerCase()
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .substring(0, 30) || 'cat';
    }

    _addCategoryRow(data, parentEl) {
        const list = parentEl || this.backdrop.querySelector('#creator-categories-list');
        const row = document.createElement('div');
        row.className = 'creator-row-wrap';
        if (parentEl) row.classList.add('creator-subcategory');

        const colors = this._extractGradientColors(data?.gradient);
        const themePrimary = this.backdrop.querySelector('#creator-primary-color').value || '#667eea';
        const themeDark = this._darkenColor(themePrimary, 0.45);
        const color1 = colors[0] || (parentEl ? themeDark : themePrimary);
        const color2 = colors[1] || (parentEl ? this._darkenColor(themeDark, 0.3) : themeDark);
        const label = data?.label || '';
        const id = data?.id || '';
        const isMain = data ? data.isMain !== false : true;
        const note = data?.note || '';
        const isExisting = this.editMode && !!data?.id;
        const isParent = !parentEl;

        row.innerHTML = `
            <div class="creator-row-main">
                <input type="color" value="${color1}" title="Gradient start color">
                <input type="color" value="${color2}" title="Gradient end color">
                <div class="creator-row-label">
                    <input type="text" placeholder="${isParent ? 'Section name' : 'Subsection name'}" value="${this._escAttr(label)}">
                </div>
                <span class="creator-row-id ${isExisting ? 'locked' : ''}">${this._escHtml(id)}</span>
                ${isParent ? `<label class="creator-row-extra" title="Include this section in the main totals">
                    <input type="checkbox" ${isMain ? 'checked' : ''}>
                    <span>Counts</span>
                </label>
                <label class="creator-row-index ${isMain ? 'hidden' : ''}" title="Feature this section's stats on the homepage card">
                    <input type="checkbox" ${data?.showOnIndex ? 'checked' : ''}>
                    <span>Feature</span>
                </label>` : ''}
                <div class="creator-row-arrows">
                    <button type="button" class="creator-row-up" title="Move up">&#9650;</button>
                    <button type="button" class="creator-row-down" title="Move down">&#9660;</button>
                </div>
                <button type="button" class="creator-row-remove" title="Remove">&times;</button>
            </div>
            ${isParent ? `<div class="creator-row-note">
                <input type="text" placeholder="Note (shown under header)" value="${this._escAttr(note)}">
            </div>` : ''}
            ${isParent ? `<div class="creator-subcategory-list"></div>
            <button type="button" class="creator-add-subcategory">+ Subsection</button>` : ''}
        `;

        // Auto-generate ID from label (new categories only)
        const labelInput = row.querySelector('.creator-row-label input');
        const idSpan = row.querySelector('.creator-row-id');
        if (!isExisting) {
            labelInput.addEventListener('input', () => {
                idSpan.textContent = this._slugify(labelInput.value);
            });
        }

        // Counts checkbox toggles Feature visibility (Feature only available for non-counted sections)
        const countsCheckbox = row.querySelector('.creator-row-extra input');
        const indexLabel = row.querySelector('.creator-row-index');
        if (countsCheckbox && indexLabel) {
            countsCheckbox.onchange = () => {
                indexLabel.classList.toggle('hidden', countsCheckbox.checked);
                if (countsCheckbox.checked) indexLabel.querySelector('input').checked = false;
                this._updateIndexPillLimit();
            };
            // Index checkbox change updates limit state
            indexLabel.querySelector('input').onchange = () => this._updateIndexPillLimit();
        }

        // Remove button
        row.querySelector('.creator-row-remove').onclick = () => { row.remove(); this._updateIndexPillLimit(); };

        // Reorder arrows
        row.querySelector('.creator-row-up').onclick = () => {
            const prev = row.previousElementSibling;
            if (prev) {
                row.parentNode.insertBefore(row, prev);
                row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                row.classList.add('creator-row-flash');
                row.addEventListener('animationend', () => row.classList.remove('creator-row-flash'), { once: true });
            }
        };
        row.querySelector('.creator-row-down').onclick = () => {
            const next = row.nextElementSibling;
            if (next) {
                row.parentNode.insertBefore(next, row);
                row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                row.classList.add('creator-row-flash');
                row.addEventListener('animationend', () => row.classList.remove('creator-row-flash'), { once: true });
            }
        };

        // Add subcategory button (parent rows only)
        const addSubBtn = row.querySelector('.creator-add-subcategory');
        if (addSubBtn) {
            addSubBtn.onclick = () => {
                const subList = row.querySelector('.creator-subcategory-list');
                this._addCategoryRow(null, subList);
            };
        }

        list.appendChild(row);
        if (!data) labelInput.focus();

        // Populate existing children
        if (isParent && data?.children?.length > 0) {
            const subList = row.querySelector('.creator-subcategory-list');
            data.children.forEach(child => this._addCategoryRow(child, subList));
        }
    }

    _extractGradientColors(gradient) {
        if (!gradient) return [];
        const matches = gradient.match(/#[0-9a-fA-F]{6}/g);
        return matches || [];
    }

    _dedupeId(id, usedIds) {
        let unique = id;
        let suffix = 2;
        while (usedIds.has(unique)) {
            unique = `${id}-${suffix}`;
            suffix++;
        }
        usedIds.add(unique);
        return unique;
    }

    _updateIndexPillLimit() {
        const indexCheckboxes = this.backdrop.querySelectorAll('.creator-row-index input[type="checkbox"]');
        const checkedCount = [...indexCheckboxes].filter(cb => cb.checked).length;
        const atLimit = checkedCount >= 3;
        indexCheckboxes.forEach(cb => {
            if (!cb.checked) {
                cb.disabled = atLimit;
                cb.closest('.creator-row-index').title = atLimit
                    ? 'Maximum of 3 featured sections reached'
                    : 'Feature this section\'s stats on the homepage card';
            }
        });
    }

    _getCategoriesFromForm() {
        // Only get top-level rows (not subcategories nested inside)
        const rows = this.backdrop.querySelectorAll('#creator-categories-list > .creator-row-wrap');
        const categories = [];
        const usedIds = new Set();
        rows.forEach(row => {
            const label = row.querySelector(':scope > .creator-row-main .creator-row-label input').value.trim();
            if (!label) return;
            const idText = row.querySelector(':scope > .creator-row-main .creator-row-id').textContent.trim();
            const id = this._dedupeId(idText || this._slugify(label), usedIds);
            const colors = row.querySelectorAll(':scope > .creator-row-main input[type="color"]');
            const themePrimary = this.backdrop.querySelector('#creator-primary-color').value || '#667eea';
            const themeDark = this._darkenColor(themePrimary, 0.45);
            const color1 = colors[0]?.value || themePrimary;
            const color2 = colors[1]?.value || themeDark;
            const countsInput = row.querySelector(':scope > .creator-row-main .creator-row-extra input');
            const isMain = countsInput ? countsInput.checked : true;
            const indexInput = row.querySelector(':scope > .creator-row-main .creator-row-index input');
            const showOnIndex = indexInput ? indexInput.checked : false;
            const noteInput = row.querySelector(':scope > .creator-row-note input');
            const note = noteInput ? noteInput.value.trim() : '';

            const cat = { id, label, isMain };
            // Only store gradient if it differs from the theme default
            if (color1 !== themePrimary || color2 !== themeDark) {
                cat.gradient = `linear-gradient(135deg, ${color1}, ${color2})`;
            }
            if (note) cat.note = note;
            if (showOnIndex) cat.showOnIndex = true;

            // Collect subcategories
            const subRows = row.querySelectorAll(':scope > .creator-subcategory-list > .creator-row-wrap');
            if (subRows.length > 0) {
                cat.children = [];
                subRows.forEach(subRow => {
                    const subLabel = subRow.querySelector('.creator-row-label input').value.trim();
                    if (!subLabel) return;
                    const subIdText = subRow.querySelector('.creator-row-id').textContent.trim();
                    const subId = this._dedupeId(subIdText || this._slugify(subLabel), usedIds);
                    const subColors = subRow.querySelectorAll('input[type="color"]');
                    const subDefault1 = this._darkenColor(themePrimary, 0.45);
                    const subDefault2 = this._darkenColor(subDefault1, 0.3);
                    const sc1 = subColors[0]?.value || subDefault1;
                    const sc2 = subColors[1]?.value || subDefault2;
                    const child = { id: subId, label: subLabel };
                    // Only store gradient if non-default
                    if (sc1 !== subDefault1 || sc2 !== subDefault2) {
                        child.gradient = `linear-gradient(135deg, ${sc1}, ${sc2})`;
                    }
                    cat.children.push(child);
                });
                if (cat.children.length === 0) delete cat.children;
            }

            categories.push(cat);
        });
        return categories;
    }

    // ---- Subtitle line rows ----

    _addSubtitleLineRow(data) {
        const list = this.backdrop.querySelector('#creator-subtitle-lines-list');
        const row = document.createElement('div');
        row.className = 'creator-row';

        const color = data?.color || '#888888';
        const label = data?.label || '';
        const key = data?.key || '';
        const pill = data?.pill || false;
        const isExisting = this.editMode && !!data?.key;

        row.innerHTML = `
            <input type="color" value="${color}" title="Text color for this line">
            <button type="button" class="creator-pill-toggle ${pill ? 'active' : ''}" title="Toggle pill background">pill</button>
            <div class="creator-row-label">
                <input type="text" placeholder="Field label (e.g. Years Active)" value="${this._escAttr(label)}">
            </div>
            <span class="creator-row-id ${isExisting ? 'locked' : ''}">${this._escHtml(key)}</span>
            <div class="creator-row-arrows">
                <button type="button" class="creator-row-up" title="Move up">&#9650;</button>
                <button type="button" class="creator-row-down" title="Move down">&#9660;</button>
            </div>
            <button type="button" class="creator-row-remove" title="Remove">&times;</button>
        `;

        row.querySelector('.creator-pill-toggle').onclick = (e) => {
            e.currentTarget.classList.toggle('active');
        };

        const labelInput = row.querySelector('.creator-row-label input');
        const idSpan = row.querySelector('.creator-row-id');
        if (!isExisting) {
            labelInput.addEventListener('input', () => {
                idSpan.textContent = this._slugify(labelInput.value);
                this._refreshSortControls();
            });
        }

        row.querySelector('.creator-row-up').onclick = () => {
            const prev = row.previousElementSibling;
            if (prev) {
                row.parentNode.insertBefore(row, prev);
                row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                row.classList.add('creator-row-flash');
                row.addEventListener('animationend', () => row.classList.remove('creator-row-flash'), { once: true });
            }
        };
        row.querySelector('.creator-row-down').onclick = () => {
            const next = row.nextElementSibling;
            if (next) {
                row.parentNode.insertBefore(next, row);
                row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                row.classList.add('creator-row-flash');
                row.addEventListener('animationend', () => row.classList.remove('creator-row-flash'), { once: true });
            }
        };
        row.querySelector('.creator-row-remove').onclick = () => {
            row.remove();
            this._refreshSortControls();
        };
        list.appendChild(row);
        if (!data) labelInput.focus();
        this._refreshSortControls();
    }

    _getSubtitleLinesFromForm() {
        const rows = this.backdrop.querySelectorAll('#creator-subtitle-lines-list .creator-row');
        const lines = [];
        rows.forEach(row => {
            const label = row.querySelector('.creator-row-label input').value.trim();
            if (!label) return;
            const idText = row.querySelector('.creator-row-id').textContent.trim();
            const key = idText || this._slugify(label);
            const color = row.querySelector('input[type="color"]').value;
            const pill = row.querySelector('.creator-pill-toggle')?.classList.contains('active') || false;
            lines.push({ key, label, color, pill });
        });
        return lines;
    }

    // ---- HTML helpers ----

    _escAttr(str) {
        return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    }

    _escHtml(str) {
        return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    _darkenColor(hex, amount) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        const dr = Math.round(r * (1 - amount));
        const dg = Math.round(g * (1 - amount));
        const db = Math.round(b * (1 - amount));
        return `#${dr.toString(16).padStart(2, '0')}${dg.toString(16).padStart(2, '0')}${db.toString(16).padStart(2, '0')}`;
    }

    // ---- Form clear / populate ----

    _clearForm() {
        this.backdrop.querySelector('#creator-title').value = '';
        this.backdrop.querySelector('#creator-subtitle').value = '';
        this.backdrop.querySelector('#creator-nav-label').value = '';
        this.backdrop.querySelector('#creator-primary-color').value = '#667eea';
        this.backdrop.querySelector('#creator-primary-hex').textContent = '#667eea';
        this.backdrop.querySelector('#creator-accent-color').value = '#f39c12';
        this.backdrop.querySelector('#creator-accent-hex').textContent = '#f39c12';
        this.backdrop.querySelector('#creator-dark-theme').checked = false;
        this.backdrop.querySelector('#creator-use-sections').checked = true;
        this.backdrop.querySelector('#creator-show-player').checked = true;
        this.backdrop.querySelector('#creator-show-position').checked = false;
        this.backdrop.querySelector('#creator-show-player').dispatchEvent(new Event('change'));
        this.backdrop.querySelector('#creator-description').value = '';

        // Reset attribute checkboxes to checked
        this.backdrop.querySelector('#creator-attr-variant').checked = true;
        this.backdrop.querySelector('#creator-attr-auto').checked = true;
        this.backdrop.querySelector('#creator-attr-patch').checked = true;
        this.backdrop.querySelector('#creator-attr-serial').checked = true;

        // Reset price thresholds
        this.backdrop.querySelector('#creator-threshold-mid').value = '3';
        this.backdrop.querySelector('#creator-threshold-high').value = '10';
        this.backdrop.querySelector('#creator-threshold-mid-label').textContent = '3';

        // Show categories
        this.backdrop.querySelector('#creator-categories-field').style.display = '';

        // Reset category rows - add one default
        this.backdrop.querySelector('#creator-categories-list').innerHTML = '';
        this._addCategoryRow({ id: 'base', label: 'Base Cards', isMain: true });

        // Clear subtitle lines
        this.backdrop.querySelector('#creator-subtitle-lines-list').innerHTML = '';

        // Reset sort controls to defaults
        this._renderSortControls(ChecklistCreatorModal.DEFAULT_SORTS, 'as-entered');
    }

    _populateForm(config) {
        const primaryColor = config.theme?.primaryColor || '#667eea';
        const accentColor = config.theme?.accentColor || '#f39c12';
        this.backdrop.querySelector('#creator-title').value = config.title || '';
        this.backdrop.querySelector('#creator-subtitle').value = config.subtitle || '';
        this.backdrop.querySelector('#creator-nav-label').value = config.navLabel || '';
        this.backdrop.querySelector('#creator-primary-color').value = primaryColor;
        this.backdrop.querySelector('#creator-primary-hex').textContent = primaryColor;
        this.backdrop.querySelector('#creator-accent-color').value = accentColor;
        this.backdrop.querySelector('#creator-accent-hex').textContent = accentColor;
        this.backdrop.querySelector('#creator-dark-theme').checked = config.theme?.darkTheme || false;
        this.backdrop.querySelector('#creator-use-sections').checked = config.dataShape !== 'flat';
        this.backdrop.querySelector('#creator-show-player').checked = config.cardDisplay?.showPlayerName !== false;
        this.backdrop.querySelector('#creator-show-position').checked = config.cardDisplay?.showPosition || !!config.customFields?.position;
        this.backdrop.querySelector('#creator-show-player').dispatchEvent(new Event('change'));
        this.backdrop.querySelector('#creator-description').value = config.indexCard?.description || '';

        // Categories as rows
        this.backdrop.querySelector('#creator-categories-list').innerHTML = '';
        if (config.categories && config.categories.length > 0) {
            config.categories.forEach(c => this._addCategoryRow(c));
        } else {
            this._addCategoryRow({ id: 'base', label: 'Base Cards', isMain: true });
        }
        this._updateIndexPillLimit();

        // Subtitle lines: extract from customFields (position: 'bottom', type: 'text', key != 'player')
        this.backdrop.querySelector('#creator-subtitle-lines-list').innerHTML = '';
        if (config.customFields) {
            Object.entries(config.customFields).forEach(([key, field]) => {
                if (field.position === 'bottom' && field.type === 'text' && key !== 'player') {
                    this._addSubtitleLineRow({ key, label: field.label, color: field.color || '#888888', pill: field.pill || false });
                }
            });
        }

        // Attribute toggles (default to checked if no customFields yet, otherwise check if present)
        const cf = config.customFields || {};
        this.backdrop.querySelector('#creator-attr-variant').checked = !config.customFields || 'variant' in cf;
        this.backdrop.querySelector('#creator-attr-auto').checked = !config.customFields || 'auto' in cf;
        this.backdrop.querySelector('#creator-attr-patch').checked = !config.customFields || 'patch' in cf;
        this.backdrop.querySelector('#creator-attr-serial').checked = !config.customFields || 'serial' in cf;

        // Price thresholds
        const thresholds = config.cardDisplay?.priceThresholds || { mid: 3, high: 10 };
        this.backdrop.querySelector('#creator-threshold-mid').value = thresholds.mid;
        this.backdrop.querySelector('#creator-threshold-high').value = thresholds.high;
        this.backdrop.querySelector('#creator-threshold-mid-label').textContent = thresholds.mid;

        // Sort options - extract subtitle lines for the default sort dropdown
        const subtitleLines = [];
        if (config.customFields) {
            Object.entries(config.customFields).forEach(([key, field]) => {
                if (field.position === 'bottom' && field.type === 'text' && key !== 'player') {
                    subtitleLines.push({ key, label: field.label });
                }
            });
        }
        const activeSorts = (config.sortOptions || ChecklistCreatorModal.DEFAULT_SORTS).filter(s => s !== 'default');
        this._renderSortControls(activeSorts, config.defaultSortMode || 'as-entered', subtitleLines);

        // Toggle visibility
        const useSections = config.dataShape !== 'flat';
        this.backdrop.querySelector('#creator-categories-field').style.display = useSections ? '' : 'none';
    }

    _generateId(title) {
        return title.toLowerCase()
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .substring(0, 40);
    }

    _buildConfig() {
        const title = this.backdrop.querySelector('#creator-title').value.trim();
        if (!title) {
            alert('Title is required');
            return null;
        }

        const navLabel = this.backdrop.querySelector('#creator-nav-label').value.trim();
        if (!navLabel) {
            alert('Nav label is required');
            return null;
        }

        const id = this.editMode ? this.existingConfig.id : this._generateId(title);
        const useSections = this.backdrop.querySelector('#creator-use-sections').checked;
        const dataShape = useSections ? 'categories' : 'flat';

        // Start from existing config in edit mode to preserve unmanaged properties
        const config = this.editMode
            ? JSON.parse(JSON.stringify(this.existingConfig))
            : {};

        // Overlay form values
        config.id = id;
        config.title = title;
        config.subtitle = this.backdrop.querySelector('#creator-subtitle').value.trim() || undefined;
        config.navLabel = navLabel;
        const primaryColor = this.backdrop.querySelector('#creator-primary-color').value;
        config.theme = {
            ...(config.theme || {}),
            primaryColor,
            accentColor: this.backdrop.querySelector('#creator-accent-color').value,
            darkColor: this._darkenColor(primaryColor, 0.45),
            darkTheme: this.backdrop.querySelector('#creator-dark-theme').checked,
        };
        config.dataShape = dataShape;
        const midThreshold = parseInt(this.backdrop.querySelector('#creator-threshold-mid').value) || 3;
        const highThreshold = parseInt(this.backdrop.querySelector('#creator-threshold-high').value) || 10;
        const showPosition = this.backdrop.querySelector('#creator-show-position').checked;
        config.cardDisplay = {
            ...(config.cardDisplay || {}),
            showPlayerName: this.backdrop.querySelector('#creator-show-player').checked,
            showPosition: showPosition || undefined,
            priceThresholds: { mid: midThreshold, high: highThreshold },
        };

        // Build customFields from form
        const customFields = {};

        // Player field (if showing player names)
        if (config.cardDisplay.showPlayerName) {
            customFields.player = { label: 'Player Name', type: 'text', fullWidth: !showPosition };
            config.cardDisplay.includePlayerInCardId = true;
        } else {
            delete config.cardDisplay.includePlayerInCardId;
        }

        // Position field (next to player name)
        if (showPosition) {
            customFields.position = { label: 'Position', type: 'text', narrow: true };
        }

        // Subtitle lines
        const subtitleLines = this._getSubtitleLinesFromForm();
        subtitleLines.forEach(line => {
            customFields[line.key] = {
                label: line.label,
                type: 'text',
                position: 'bottom',
                color: line.color !== '#888888' ? line.color : undefined,
                pill: line.pill || undefined,
            };
        });

        // Standard attribute fields (toggleable)
        if (this.backdrop.querySelector('#creator-attr-variant').checked) {
            customFields.variant = { label: 'Variant', type: 'text', placeholder: 'Silver Prizm', fullWidth: true, position: 'attributes' };
        }
        if (this.backdrop.querySelector('#creator-attr-auto').checked) {
            customFields.auto = { label: 'Auto', type: 'checkbox', position: 'attributes' };
        }
        if (this.backdrop.querySelector('#creator-attr-patch').checked) {
            customFields.patch = { label: 'Patch', type: 'checkbox', position: 'attributes' };
        }
        if (this.backdrop.querySelector('#creator-attr-serial').checked) {
            customFields.serial = { label: 'Run', type: 'text', inputType: 'number', placeholder: '99', position: 'attributes' };
        }


        config.customFields = customFields;

        // Sort options from chips (always includes 'default' first)
        config.sortOptions = this._getSortOptionsFromForm();

        // Default sort mode
        const defaultSortMode = this.backdrop.querySelector('#creator-default-sort').value;
        config.defaultSortMode = defaultSortMode !== 'as-entered' ? defaultSortMode : undefined;

        config.indexCard = {
            ...(config.indexCard || {}),
            description: this.backdrop.querySelector('#creator-description').value.trim() || undefined,
        };

        // Parse categories or flat
        if (useSections) {
            const categories = this._getCategoriesFromForm();
            if (categories.length === 0) {
                alert('At least one section is required');
                return null;
            }
            config.categories = categories;
            delete config.groups;
            delete config.groupField;
        } else {
            delete config.categories;
            delete config.groups;
            delete config.groupField;
        }

        // Clean undefined values at top level
        Object.keys(config).forEach(k => { if (config[k] === undefined) delete config[k]; });

        return config;
    }

    async save() {
        const config = this._buildConfig();
        if (!config) return;

        const saveBtn = this.backdrop.querySelector('#creator-save');
        saveBtn.disabled = true;
        saveBtn.textContent = this.editMode ? 'Saving...' : 'Creating...';

        // Extract extra category pills for the registry (max 3)
        const extraPills = (config.categories || [])
            .filter(c => c.showOnIndex)
            .slice(0, 3)
            .map(c => ({ id: c.id, label: c.label }));

        try {
            if (this.editMode) {
                // Save updated config
                const success = await githubSync.saveChecklistConfig(config.id, config);
                if (!success) throw new Error('Failed to save config');

                // Config saved - update local state (and migrate cards if shape changed)
                this.isDirty = false;
                this.close();
                await this.onCreated(config);

                // Best-effort: update registry (nav label, pills, etc.)
                try {
                    const registry = await githubSync.loadRegistry();
                    if (registry) {
                        const entry = registry.checklists.find(c => c.id === config.id);
                        if (entry) {
                            entry.title = config.title;
                            entry.navLabel = config.navLabel;
                            entry.description = config.indexCard?.description || '';
                            // Only update colors if theme was explicitly set (not defaults)
                            if (config.theme?.accentColor && config.theme.accentColor !== '#667eea') {
                                entry.accentColor = config.theme.accentColor;
                            }
                            if (config.theme?.primaryColor && config.theme.primaryColor !== '#667eea') {
                                entry.borderColor = config.theme.primaryColor;
                            }
                            // Only update extraPills if categories have showOnIndex set
                            if (extraPills.length > 0) {
                                entry.extraPills = extraPills;
                            }
                            await githubSync.saveRegistry(registry);
                        }
                    }
                    DynamicNav._registry = null;
                    sessionStorage.removeItem(DynamicNav._getSessionKey());
                } catch (regError) {
                    console.warn('Config saved but registry update failed:', regError);
                }
                return;
            } else {
                // Load or create registry
                let registry = await githubSync.loadRegistry();
                if (!registry) {
                    registry = { checklists: [] };
                }

                // Check for ID conflict
                if (registry.checklists.find(c => c.id === config.id)) {
                    alert('A checklist with this ID already exists. Try a different title.');
                    return;
                }

                // Add to registry
                registry.checklists.push({
                    id: config.id,
                    title: config.title,
                    navLabel: config.navLabel,
                    description: config.indexCard?.description || '',
                    accentColor: config.theme?.accentColor || config.theme?.primaryColor || '#667eea',
                    borderColor: config.theme?.primaryColor || '#667eea',
                    extraPills: extraPills.length > 0 ? extraPills : undefined,
                    type: 'dynamic',
                    order: registry.checklists.length,
                });

                // Create checklist (config + empty cards + updated registry)
                const success = await githubSync.createChecklist(config.id, config, registry);
                if (!success) throw new Error('Failed to create checklist');

                // Clear nav cache
                DynamicNav._registry = null;
                sessionStorage.removeItem(DynamicNav._getSessionKey());
            }

            this.isDirty = false;
            this.close();
            this.onCreated(config);
        } catch (error) {
            console.error('Failed to save checklist:', error);
            alert('Failed to save: ' + error.message);
        } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = this.editMode ? 'Save Settings' : 'Create Checklist';
        }
    }
}

window.ChecklistCreatorModal = ChecklistCreatorModal;
