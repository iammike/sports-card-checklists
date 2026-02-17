/**
 * Collapsible Sections - Makes section headers clickable to expand/collapse
 * Usage: CollapsibleSections.init() or CollapsibleSections.init({ persist: true, storageKey: 'myPage' })
 */
const CollapsibleSections = {
    init(options = {}) {
        const { persist = false, storageKey = 'collapsedSections' } = options;

        // Find all section and group headers
        const headers = document.querySelectorAll('.section-header, .group-header');

        headers.forEach(header => {
            // Skip if already initialized or explicitly marked non-collapsible
            if (header.dataset.collapsible || header.dataset.noCollapse) return;

            // Add collapsible class for styling
            header.classList.add('collapsible');

            // Find the associated content and wrap it for animation
            const section = header.closest('.section, [class*="-section"]');
            const sectionId = header.textContent.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
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

            // Mark as initialized to prevent duplicate listeners on re-init
            header.dataset.collapsible = 'true';

            // Add click handler
            header.addEventListener('click', () => {
                const isCollapsing = !header.classList.contains('collapsed');
                header.classList.toggle('collapsed');

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
            });
        });
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
