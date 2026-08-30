import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ChecklistCreatorModal = globalThis.ChecklistCreatorModal;

// The built-in attributes carry fixed wording. They were briefly renameable
// from the settings modal (#787 read the label, #799 added the input), until
// #801 established that Relic is its own attribute rather than a rename of
// Patch and the input was removed. A checklist edited in between can still hold
// a stale label, so both the read side and the write side normalise it.
//
// Driven through a real modal instance, because _buildConfig()'s return value
// is exactly what save() hands to githubSync.saveChecklistConfig().

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
        patch: { label: 'Relic', type: 'checkbox', position: 'attributes' },
        relic: { label: 'Swatch', type: 'checkbox', position: 'attributes' },
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
        expect(cf.relic.label).toBe('Relic');
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
        expect(cf.serial.placeholder).toBe('99');
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
// #801 added a fifth attribute. Its checkbox shipped without `checked` while
// _clearForm ticks every attribute, so the markup and the behaviour disagreed
// about what a new checklist gets - and nothing pinned either.
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

// The read side. _buildConfig only corrects the stored value once a save
// happens, and that save rebuilds customFields and categories wholesale from
// the form - so it is not something to prescribe as the cure. This fixes what
// the card editor shows on deploy, with no gist write at all.
describe('the card editor shows the fixed wording regardless of the config (#801)', () => {
    const ChecklistEngine = globalThis.ChecklistEngine;

    function fieldsHandedToEditor(customFields) {
        const engine = Object.create(ChecklistEngine.prototype);
        engine.config = { dataShape: 'flat', customFields, categories: [] };
        engine.cards = [];
        engine.checklistManager = { isOwner: () => true, getCardId: () => 'x' };
        let handed = null;
        const RealModal = globalThis.CardEditorModal;
        globalThis.CardEditorModal = function (options) {
            handed = options.customFields;
            return { init() {}, open() {} };
        };
        try {
            engine._initCardEditor();
        } finally {
            globalThis.CardEditorModal = RealModal;
        }
        return handed;
    }

    it('rewrites a stale label before the editor ever sees it', () => {
        const fields = fieldsHandedToEditor({
            patch: { label: 'Relic', type: 'checkbox', position: 'attributes' },
            relic: { label: 'Swatch', type: 'checkbox', position: 'attributes' },
        });

        expect(fields.patch.label).toBe('Patch');
        expect(fields.relic.label).toBe('Relic');
    });

    // The exact reported state: two checkboxes both reading "Relic".
    it('leaves no two attributes sharing a label', () => {
        const fields = fieldsHandedToEditor({
            patch: { label: 'Relic', type: 'checkbox' },
            relic: { label: 'Relic', type: 'checkbox' },
        });

        expect(fields.patch.label).not.toBe(fields.relic.label);
    });

    it('keeps everything else about the field', () => {
        const fields = fieldsHandedToEditor({
            patch: { label: 'Relic', type: 'checkbox', position: 'attributes' },
        });

        expect(fields.patch.type).toBe('checkbox');
        expect(fields.patch.position).toBe('attributes');
    });

    it('does not invent an attribute the checklist never declared', () => {
        const fields = fieldsHandedToEditor({ patch: { label: 'Relic', type: 'checkbox' } });

        expect(fields.relic).toBeUndefined();
        expect(fields.auto).toBeUndefined();
    });

    // Only the config's copy is rewritten for display; nothing is written back.
    it('does not mutate a config that was already correct', () => {
        const fields = fieldsHandedToEditor({ patch: { label: 'Patch', type: 'checkbox' } });

        expect(fields.patch.label).toBe('Patch');
    });
});
