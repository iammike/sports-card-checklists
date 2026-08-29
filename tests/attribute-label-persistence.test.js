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

function openEditing(existingConfig) {
    const creator = new ChecklistCreatorModal({});
    creator.open();
    creator.editMode = true;
    creator.existingConfig = existingConfig;
    creator.backdrop.querySelector('#creator-title').value = 'Jayden Daniels Rookie Cards';
    creator.backdrop.querySelector('#creator-nav-label').value = 'DANIELS';
    return creator;
}

const RELIC_CONFIG = {
    title: 'Jayden Daniels Rookie Cards',
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
        const creator = openEditing({ title: 'x', customFields: { patch: { type: 'checkbox' } } });

        const cf = creator._buildConfig().customFields;

        expect(cf.patch.label).toBe('Patch');
        expect(cf.auto.label).toBe('Auto');
        expect(cf.serial.label).toBe('Run');
    });

    // A hand-edited gist can hold anything here, and a blank label would render
    // a nameless badge.
    it('falls back for a blank or non-string label', () => {
        const creator = openEditing({ title: 'x', customFields: {
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
