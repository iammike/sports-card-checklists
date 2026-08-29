import { describe, it, expect, afterEach } from 'vitest';

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

const RELIC_CONFIG = {
    title: 'Jayden Daniels Rookie Cards',
    navLabel: 'DANIELS',
    customFields: {
        auto: { label: 'Signed', type: 'checkbox', position: 'attributes' },
        patch: { label: 'Relic', type: 'checkbox', position: 'attributes' },
        serial: { label: 'Numbered To', type: 'text', position: 'attributes' },
        variant: { label: 'Parallel', type: 'text', position: 'attributes' },
    },
};

afterEach(() => {
    document.querySelectorAll('.checklist-creator-backdrop').forEach(el => el.remove());
});

describe('a configured attribute label survives a settings save (#787)', () => {
    it('keeps every attribute label the config already carried', () => {
        const creator = openEditing(RELIC_CONFIG);

        const cf = creator._buildConfig().customFields;

        expect(cf.patch.label).toBe('Relic');
        expect(cf.auto.label).toBe('Signed');
        expect(cf.serial.label).toBe('Numbered To');
        expect(cf.variant.label).toBe('Parallel');
    });

    // The rest of the field definition is still rebuilt from the form; only the
    // wording is carried across.
    it('still rebuilds the rest of the field from the form', () => {
        const creator = openEditing(RELIC_CONFIG);

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
            patch: { label: 'Relic', type: 'checkbox' },
        } });

        const cf = creator._buildConfig().customFields;

        expect(cf.patch.label).toBe('Relic');
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
        creator.existingConfig = RELIC_CONFIG;
        creator.backdrop.querySelector('#creator-title').value = 'New List';
        creator.backdrop.querySelector('#creator-nav-label').value = 'NEW';

        const cf = creator._buildConfig().customFields;

        expect(cf.patch.label).toBe('Patch');
        expect(cf.auto.label).toBe('Auto');
    });
});

// #797: the label was only settable by hand-editing the gist. These drive the
// input the settings modal now offers, through the real openEdit/_buildConfig
// round trip rather than by poking config objects.
describe('the settings modal can set the wording (#797)', () => {
    const labelInput = (creator, key) =>
        creator.backdrop.querySelector(`#creator-attr-${key}-label`);
    const checkbox = (creator, key) =>
        creator.backdrop.querySelector(`#creator-attr-${key}`);

    it('offers an input for every toggleable attribute', () => {
        const creator = openEditing(RELIC_CONFIG);

        const keys = ChecklistCreatorModal.ATTRIBUTE_FIELDS.map(f => f.key);
        expect(keys).toEqual(['variant', 'auto', 'patch', 'serial']);
        keys.forEach(key => {
            expect(labelInput(creator, key), key).not.toBeNull();
        });
    });

    // The input is not inside the <label>, or clicking to type would toggle the
    // attribute off.
    it('keeps the input out of the checkbox label', () => {
        const creator = openEditing(RELIC_CONFIG);

        expect(labelInput(creator, 'patch').closest('.card-editor-checkbox')).toBeNull();
    });

    it('shows the wording in force, not an empty box', () => {
        const creator = openEditing(RELIC_CONFIG);

        expect(labelInput(creator, 'patch').value).toBe('Relic');
        expect(labelInput(creator, 'auto').value).toBe('Signed');
    });

    it('shows the built-in wording for an attribute the config never labelled', () => {
        const creator = openEditing({ title: 'x', navLabel: 'X', customFields: {
            patch: { type: 'checkbox' },
        } });

        expect(labelInput(creator, 'patch').value).toBe('Patch');
    });

    it('saves what was typed', () => {
        const creator = openEditing(RELIC_CONFIG);
        labelInput(creator, 'patch').value = 'Memorabilia';

        expect(creator._buildConfig().customFields.patch.label).toBe('Memorabilia');
    });

    it('trims what was typed', () => {
        const creator = openEditing(RELIC_CONFIG);
        labelInput(creator, 'patch').value = '  Relic  ';

        expect(creator._buildConfig().customFields.patch.label).toBe('Relic');
    });

    // Clearing the box restores the default, which is what its placeholder
    // promises. The fixture has to carry a *stored* label: with an unlabelled
    // config the default and the stored value are the same string, so the test
    // passes either way - it did, while a cleared box was really re-saving
    // "Relic".
    it('falls back to the built-in wording when the box is cleared', () => {
        const creator = openEditing(RELIC_CONFIG);
        expect(labelInput(creator, 'patch').value).toBe('Relic');

        labelInput(creator, 'patch').value = '   ';

        expect(creator._buildConfig().customFields.patch.label).toBe('Patch');
    });

    // Same for an empty string, not just whitespace.
    it('falls back when the box is emptied outright', () => {
        const creator = openEditing(RELIC_CONFIG);
        labelInput(creator, 'patch').value = '';

        expect(creator._buildConfig().customFields.patch.label).toBe('Patch');
    });

    it('disables the input while its attribute is switched off', () => {
        const creator = openEditing({ title: 'x', navLabel: 'X', customFields: {
            patch: { type: 'checkbox' },
        } });

        expect(labelInput(creator, 'patch').disabled).toBe(false);
        expect(labelInput(creator, 'auto').disabled).toBe(true);
    });

    it('follows the checkbox as it is toggled', () => {
        const creator = openEditing(RELIC_CONFIG);
        expect(labelInput(creator, 'patch').disabled).toBe(false);

        checkbox(creator, 'patch').checked = false;
        checkbox(creator, 'patch').dispatchEvent(new Event('change'));

        expect(labelInput(creator, 'patch').disabled).toBe(true);
    });

    // The modal is dark; a bare input[type=text] picks up the light global rule,
    // whose specificity (0,1,1) beats .creator-attr-label (0,1,0). The dark rule
    // is `.card-editor-modal .card-editor-input`, so both halves of that
    // selector have to hold - the class, and the ancestor.
    it('is styled as a modal input rather than the light global default', () => {
        const creator = openEditing(RELIC_CONFIG);
        const input = labelInput(creator, 'patch');

        expect(input.classList.contains('card-editor-input')).toBe(true);
        expect(input.closest('.card-editor-modal')).not.toBeNull();
    });

    // Arbitrary wording reaches a badge sized for a short word: at 12px
    // uppercase it ellipsizes around 13-14 characters, so this bounds input
    // near what can actually show rather than at an arbitrary larger number.
    it('bounds the length', () => {
        const creator = openEditing(RELIC_CONFIG);

        expect(labelInput(creator, 'patch').getAttribute('maxlength')).toBe('16');
    });
});
