/**
 * Collapsible Sections - Turns section headers into buttons that expand/collapse
 * their content, by mouse or keyboard
 * Usage: CollapsibleSections.init() or CollapsibleSections.init({ persist: true, storageKey: 'myPage' })
 */
const CollapsibleSections = {
    init(options = {}) {
        const { persist = false, storageKey = 'collapsedSections' } = options;

        // Find all section and group headers
        const headers = document.querySelectorAll('.section-header, .group-header');

        headers.forEach((header, index) => {
            // Skip if already initialized or explicitly marked non-collapsible
            if (header.dataset.collapsible || header.dataset.noCollapse) return;

            // Add collapsible class for styling
            header.classList.add('collapsible');

            // Find the associated content and wrap it for animation
            const section = header.closest('.section, [class*="-section"]');
            const sectionId = this.sectionKey(header, index);
            const wrapper = this.wrapContent(header, section);

            // Restore collapsed state from localStorage (instant, no animation on load)
            if (persist) {
                const collapsed = this.getCollapsedState(storageKey);
                if (collapsed.includes(sectionId)) {
                    header.classList.add('collapsed');
                    if (section) section.classList.remove('expanded');
                    if (wrapper) {
                        wrapper.style.transition = 'none';
                        wrapper.classList.add('collapsed');
                        // Re-enable transition after layout
                        requestAnimationFrame(() => {
                            wrapper.style.transition = '';
                        });
                    }
                }
            }

            // A div with a click handler is unreachable by keyboard and reads as
            // plain text to a screen reader. The markup comes from the caller, so
            // the tag is not ours to change - give it button semantics instead.
            // aria-expanded is set from the state restored above, not from the
            // default, so it is right before anyone clicks anything.
            header.setAttribute('role', 'button');
            header.setAttribute('tabindex', '0');
            header.setAttribute('aria-expanded', String(!header.classList.contains('collapsed')));
            const label = this.headerLabel(header);
            if (label) header.setAttribute('aria-label', label);
            if (wrapper) {
                wrapper.id = wrapper.id || this.uniqueId(`collapsible-${sectionId}`);
                header.setAttribute('aria-controls', wrapper.id);
            }

            // Mark as initialized to prevent duplicate listeners on re-init
            header.dataset.collapsible = 'true';

            const toggle = () => {
                const isCollapsing = !header.classList.contains('collapsed');
                header.classList.toggle('collapsed');
                header.setAttribute('aria-expanded', String(!isCollapsing));

                if (section) {
                    section.classList.toggle('expanded', !isCollapsing);
                }

                // Toggle content with animation
                if (wrapper) {
                    wrapper.classList.toggle('collapsed', isCollapsing);
                }

                // Persist state
                if (persist) {
                    this.saveCollapsedState(storageKey, sectionId, isCollapsing);
                }
            };

            header.addEventListener('click', toggle);

            // A real button would do this for free; role="button" does not, and
            // Space scrolls the page unless the default is cancelled.
            header.addEventListener('keydown', e => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                toggle();
            });
        });
    },

    // Ids have to be unique for aria-controls to resolve, and a category id can
    // contain anything the config author typed.
    uniqueId(base) {
        const safe = base.replace(/[^A-Za-z0-9_-]+/g, '-');
        let id = safe;
        let n = 2;
        while (document.getElementById(id)) id = `${safe}-${n++}`;
        return id;
    },

    // The header's own text, without the progress badge or anything else nested
    // inside it. Both the storage key and the accessible name start here.
    headerText(header) {
        return Array.from(header.childNodes)
            .filter(node => node.nodeType === Node.TEXT_NODE)
            .map(node => node.textContent)
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
    },

    // The name a screen reader announces. Left to the browser it would include
    // the ::before disclosure glyph ("black down-pointing triangle, Base Set"),
    // and a button is a leaf in the accessibility tree - the badge inside it is
    // not announced separately - so its own name has to be folded in here or it
    // is lost. Verified in Chrome's accessibility tree, both ways.
    headerLabel(header) {
        const parts = [this.headerText(header)];
        Array.from(header.children).forEach(child => {
            parts.push((child.getAttribute('aria-label') || child.textContent || '').trim());
        });
        return parts.filter(Boolean).join(', ');
    },

    // The key persisted collapse state is stored under. It has to survive a
    // re-render: keying on the header's whole textContent picked up the progress
    // badge, so marking a card owned changed the key and the section silently
    // reverted to its default state (#716).
    sectionKey(header, index) {
        const categoryClass = Array.from(header.classList).find(c => c.startsWith('cat-'));
        if (categoryClass) return categoryClass;

        // No category class (the single "All Cards" header a sorted view
        // renders). The header's own text is stable where its textContent was
        // not - the badge is what changes.
        const slug = this.headerText(header)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
        return slug || `section-${index}`;
    },

    wrapContent(header, section) {
        // Find content elements to wrap
        const elements = this.getContentElements(header, section);
        if (elements.length === 0) return null;

        // Save insertion point BEFORE moving elements
        const firstElement = elements[0];
        const parent = firstElement.parentNode;

        // Create wrapper for animation
        const wrapper = document.createElement('div');
        wrapper.className = 'collapsible-content';

        // Create inner div (needed for grid animation)
        const inner = document.createElement('div');
        wrapper.appendChild(inner);

        // Insert wrapper right before first element (while it's still in DOM)
        parent.insertBefore(wrapper, firstElement);

        // Now move elements into the inner div
        elements.forEach(el => inner.appendChild(el));

        return wrapper;
    },

    getContentElements(header, section) {
        const elements = [];

        // Check for note immediately after header
        let sibling = header.nextElementSibling;
        if (sibling && (sibling.classList.contains('section-note') || sibling.className.includes('-note'))) {
            elements.push(sibling);
            sibling = sibling.nextElementSibling;
        }

        // Find main content
        if (section) {
            const content = section.querySelector('.section-group, .card-grid');
            if (content && !elements.includes(content)) {
                elements.push(content);
            }
        } else {
            // Walk siblings to find content
            while (sibling) {
                if (sibling.classList.contains('section-group') || sibling.classList.contains('card-grid')) {
                    elements.push(sibling);
                    break;
                }
                if (sibling.classList.contains('section-header') || sibling.classList.contains('group-header')) {
                    break;
                }
                sibling = sibling.nextElementSibling;
            }
        }

        return elements;
    },

    getCollapsedState(key) {
        try {
            return JSON.parse(localStorage.getItem(key)) || [];
        } catch {
            return [];
        }
    },

    saveCollapsedState(key, sectionId, isCollapsed) {
        const collapsed = this.getCollapsedState(key);
        const index = collapsed.indexOf(sectionId);
        if (isCollapsed && index === -1) {
            collapsed.push(sectionId);
        } else if (!isCollapsed && index !== -1) {
            collapsed.splice(index, 1);
        }
        localStorage.setItem(key, JSON.stringify(collapsed));
    }
};


window.CollapsibleSections = CollapsibleSections;
