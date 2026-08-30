import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ChecklistCreatorModal = globalThis.ChecklistCreatorModal;

// #787: the badge and the filter chip now render customFields[field].label. That
// only means anything if the label survives, and _buildConfig rebuilds
// customFields from the form on every save - so before this, a config carrying
// `patch: { label: "Relic" }` reverted to "Patch" the next time the owner saved
// any unrelated setting, a theme colour included.
//
// Driven through a real modal instance, because _buildConfig()'s return value is
// exactly what save() hands to githubSync.saveChecklistConfig().

// openEdit() is the real entry point the settings modal uses - it sets editMode,
// stores existingConfig and runs _populateForm. Assembling that state by hand
// instead left the wording inputs holding _resetForm's defaults, which is a
// state the app never reaches and which quietly inverted what these tests prove.
function openEditing(existingConfig) {
    const creator = new ChecklistCreatorModal({});
    creator.openEdit(existingConfig);
    return creator;
}

const RELABELLED_CONFIG = {
    title: 'Jayden Daniels Rookie Cards',
    navLabel: 'DANIELS',
    customFields: {
        auto: { label: 'Signed', type: 'checkbox', position: 'attributes' },
        patch: { label: 'Prime Patch', type: 'checkbox', position: 'attributes' },
        serial: { label: 'Numbered To', type: 'text', position: 'attributes' },
        variant: { label: 'Parallel', type: 'text', position: 'attributes' },
    },
};

afterEach(() => {
    document.querySelectorAll('.checklist-creator-backdrop').forEach(el => el.remove());
});

describe('a configured attribute label survives a settings save (#787)', () => {
    it('keeps every attribute label the config already carried', () => {
        const creator = openEditing(RELABELLED_CONFIG);

        const cf = creator._buildConfig().customFields;

        expect(cf.patch.label).toBe('Prime Patch');
        expect(cf.auto.label).toBe('Signed');
        expect(cf.serial.label).toBe('Numbered To');
        expect(cf.variant.label).toBe('Parallel');
    });

    // The rest of the field definition is still rebuilt from the form; only the
    // wording is carried across.
    it('still rebuilds the rest of the field from the form', () => {
        const creator = openEditing(RELABELLED_CONFIG);

        const cf = creator._buildConfig().customFields;

        expect(cf.patch.type).toBe('checkbox');
        expect(cf.patch.position).toBe('attributes');
        expect(cf.serial.inputType).toBe('number');
        expect(cf.serial.placeholder).toBe('99');
    });

    it('falls back to the built-in wording when the config carries none', () => {
        // All four declared, none labelled: an attribute the config omits is
        // switched off and _buildConfig drops it, so declaring only `patch`
        // would leave the other assertions reading undefined.
        const creator = openEditing({ title: 'x', navLabel: 'X', customFields: {
            variant: { type: 'text' },
            auto: { type: 'checkbox' },
            patch: { type: 'checkbox' },
            serial: { type: 'text' },
        } });

        const cf = creator._buildConfig().customFields;

        expect(cf.patch.label).toBe('Patch');
        expect(cf.auto.label).toBe('Auto');
        expect(cf.serial.label).toBe('Run');
        expect(cf.variant.label).toBe('Variant');
    });

    // An attribute the checklist does not declare stays off, and contributes no
    // field at all - the wording input for it is beside the point.
    it('drops an attribute the config does not declare', () => {
        const creator = openEditing({ title: 'x', navLabel: 'X', customFields: {
            patch: { label: 'Prime Patch', type: 'checkbox' },
        } });

        const cf = creator._buildConfig().customFields;

        expect(cf.patch.label).toBe('Prime Patch');
        expect(cf.auto).toBeUndefined();
        expect(cf.serial).toBeUndefined();
    });

    // A hand-edited gist can hold anything here, and a blank label would render
    // a nameless badge.
    it('falls back for a blank or non-string label', () => {
        const creator = openEditing({ title: 'x', navLabel: 'X', customFields: {
            patch: { label: '   ', type: 'checkbox' },
            auto: { label: 42, type: 'checkbox' },
        } });

        const cf = creator._buildConfig().customFields;

        expect(cf.patch.label).toBe('Patch');
        expect(cf.auto.label).toBe('Auto');
    });

    // A brand-new checklist has nothing to preserve and must not read whatever
    // existingConfig happens to be.
    it('uses the built-in wording when not editing', () => {
        const creator = new ChecklistCreatorModal({});
        creator.open();
        creator.existingConfig = RELABELLED_CONFIG;
        creator.backdrop.querySelector('#creator-title').value = 'New List';
        creator.backdrop.querySelector('#creator-nav-label').value = 'NEW';

        const cf = creator._buildConfig().customFields;

        expect(cf.patch.label).toBe('Patch');
        expect(cf.auto.label).toBe('Auto');
    });
});

// #801 added a fifth attribute. Its checkbox shipped without `checked` while
// _clearForm sets every attribute checked, so the markup and the behaviour
// disagreed about what a new checklist gets - and nothing pinned either.
describe('a new checklist gets every attribute (#801)', () => {
    function openNew() {
        const creator = new ChecklistCreatorModal({});
        creator.open();
        creator.backdrop.querySelector('#creator-title').value = 'New List';
        creator.backdrop.querySelector('#creator-nav-label').value = 'NEW';
        return creator;
    }

    it('ticks every attribute, relic included', () => {
        const creator = openNew();

        ChecklistCreatorModal.ATTRIBUTE_FIELDS.forEach(({ key }) => {
            expect(creator.backdrop.querySelector(`#creator-attr-${key}`).checked, key).toBe(true);
        });
    });

    it('writes them all into the config', () => {
        const cf = openNew()._buildConfig().customFields;

        expect(Object.keys(cf)).toEqual(expect.arrayContaining(
            ChecklistCreatorModal.ATTRIBUTE_FIELDS.map(f => f.key)));
        expect(cf.relic).toEqual({ label: 'Relic', type: 'checkbox', position: 'attributes' });
    });

    // The markup default and _clearForm have to agree, or reopening the modal
    // silently changes what a new checklist would get.
    it('marks the boxes checked in the markup too, not only via the reset', () => {
        const creator = new ChecklistCreatorModal({});
        creator.init();

        ChecklistCreatorModal.ATTRIBUTE_FIELDS.forEach(({ key }) => {
            expect(creator.backdrop.querySelector(`#creator-attr-${key}`)
                .hasAttribute('checked'), key).toBe(true);
        });
    });
});


// jsdom computes no layout, so this is read from source. Measured in Chrome:
// with `flex: 1` alone, five pills shrank to 76px each in the 480px modal and
// "Variant" spilled 8px past its own border, because min-width: 0 lets a flex
// item go under its content. With a basis the row wraps instead.
describe('the attribute row wraps rather than crushing its pills (#801)', () => {
    const rule = (selector) => {
        const sheet = readFileSync(resolve(import.meta.dirname, '..', 'shared.css'), 'utf-8');
        const start = sheet.indexOf('\n' + selector);
        expect(start, selector).toBeGreaterThan(-1);
        return sheet.slice(start, sheet.indexOf('}', start)).replace(/\/\*[\s\S]*?\*\//g, '');
    };

    it('gives each field a flex basis, not just a grow factor', () => {
        expect(rule('.creator-options-row .card-editor-checkbox {')).toMatch(/flex:\s*1\s+1\s+\d+px;/);
    });

    it('still lets a pill shrink below its natural width', () => {
        expect(rule('.creator-options-row .card-editor-checkbox {')).toContain('min-width: 0');
    });
});
