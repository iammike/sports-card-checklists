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

// #801 follow-up: _buildConfig writes the built-in wording again. Carrying an
// existing label across was right while an input could set one; once that input
// was removed the carry-across only preserved what it had written, and nothing
// could correct it - the Jayden checklist kept Patch labelled "Relic" through
// every save, which is the label the card editor shows on the checkbox.
describe('a settings save normalises a stale attribute label (#801)', () => {
    it('rewrites a relabelled attribute back to its built-in wording', () => {
        const creator = openEditing(RELABELLED_CONFIG);

        const cf = creator._buildConfig().customFields;

        expect(cf.patch.label).toBe('Patch');
        expect(cf.auto.label).toBe('Auto');
        expect(cf.serial.label).toBe('Run');
        expect(cf.variant.label).toBe('Variant');
    });

    it('still rebuilds the rest of the field from the form', () => {
        const creator = openEditing(RELABELLED_CONFIG);

        const cf = creator._buildConfig().customFields;

        expect(cf.patch.type).toBe('checkbox');
        expect(cf.patch.position).toBe('attributes');
        expect(cf.serial.inputType).toBe('number');
    });

    // An attribute the config does not declare stays off and contributes
    // nothing, label or otherwise.
    it('drops an attribute the config does not declare', () => {
        const creator = openEditing({ title: 'x', navLabel: 'X', customFields: {
            patch: { label: 'Relic', type: 'checkbox' },
        } });

        const cf = creator._buildConfig().customFields;

        expect(cf.patch.label).toBe('Patch');
        expect(cf.auto).toBeUndefined();
        expect(cf.serial).toBeUndefined();
    });
});
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
