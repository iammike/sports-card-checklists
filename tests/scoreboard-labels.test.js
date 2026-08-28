import { describe, it, expect, beforeEach, vi } from 'vitest';

const ChecklistEngine = globalThis.ChecklistEngine;
const ChecklistCreatorModal = globalThis.ChecklistCreatorModal;

// #773: the four header tiles do not all count the same cards. computeStats
// counts main categories only - unless none is marked main, in which case it
// counts every category - but ownedValue deliberately adds the extras back in.
// So "Main Cards 60 ... Est. Value $1,200" reported two different scopes under
// one heading, with nothing saying so. And totalLabel, the one label that could
// be changed at all, had no control in the settings modal, so it could only be
// set by hand-editing the gist - which is why it drifted across ten checklists.

function makeEngine(config) {
    const engine = Object.create(ChecklistEngine.prototype);
    engine.id = 'test';
    engine.config = config;
    return engine;
}

const valueLabel = () => document.getElementById('value-label').textContent;
const totalLabel = () => document.getElementById('total-label').textContent;

beforeEach(() => {
    document.body.innerHTML = '<h1 id="page-title"></h1>'
        + '<p id="page-subtitle"></p><div id="page-intro"></div>'
        + '<div class="stat-label" id="total-label">Total Cards</div>'
        + '<div class="stat-label" id="value-label">Est. Value</div>';
});

describe('ChecklistEngine._countExcludesExtras (#773)', () => {
    it('is true when the checklist has both main and extra categories', () => {
        const engine = makeEngine({ categories: [{ id: 'base' }, { id: 'inserts', isMain: false }] });
        expect(engine._countExcludesExtras()).toBe(true);
    });

    it('is false when every category counts', () => {
        const engine = makeEngine({ categories: [{ id: 'a' }, { id: 'b' }] });
        expect(engine._countExcludesExtras()).toBe(false);
    });

    // computeStats falls back to counting every category when none is main, so
    // nothing is excluded - eagles-legends is exactly this shape, and its
    // "Total Cards" is correct.
    it('is false when no category is marked main, because then all of them count', () => {
        const engine = makeEngine({
            categories: [{ id: 'a', isMain: false }, { id: 'b', isMain: false }],
        });
        expect(engine._countExcludesExtras()).toBe(false);
    });

    it('is false for a flat checklist with no categories at all', () => {
        expect(makeEngine({ dataShape: 'flat' })._countExcludesExtras()).toBe(false);
        expect(makeEngine({ categories: [] })._countExcludesExtras()).toBe(false);
    });
});

describe('ChecklistEngine — scoreboard labels (#773)', () => {
    it('qualifies Est. Value where the count leaves cards out', () => {
        const engine = makeEngine({
            title: 'T',
            categories: [{ id: 'base' }, { id: 'inserts', isMain: false }],
        });

        engine._setPageMeta();

        expect(valueLabel()).toBe('Est. Value (all cards)');
    });

    // The qualifier has to be earned: on a checklist where the two scopes are
    // identical it is noise, and noise that implies a distinction that isn't there.
    it('leaves Est. Value unqualified when the two scopes are the same', () => {
        const engine = makeEngine({ title: 'T', categories: [{ id: 'a' }, { id: 'b' }] });

        engine._setPageMeta();

        expect(valueLabel()).toBe('Est. Value');
    });

    it('leaves Est. Value unqualified on a flat checklist', () => {
        const engine = makeEngine({ title: 'T', dataShape: 'flat' });

        engine._setPageMeta();

        expect(valueLabel()).toBe('Est. Value');
    });

    // Set from a stale render, the label must go back rather than stick.
    it('clears a stale qualifier when re-run for a checklist without extras', () => {
        makeEngine({ title: 'T', categories: [{ id: 'a' }, { id: 'x', isMain: false }] })._setPageMeta();
        expect(valueLabel()).toBe('Est. Value (all cards)');

        makeEngine({ title: 'T', categories: [{ id: 'a' }] })._setPageMeta();

        expect(valueLabel()).toBe('Est. Value');
    });

    it('still applies a configured count label', () => {
        makeEngine({ title: 'T', totalLabel: 'Main Cards' })._setPageMeta();
        expect(totalLabel()).toBe('Main Cards');
    });

    it('leaves the default count label alone when the config sets none', () => {
        makeEngine({ title: 'T' })._setPageMeta();
        expect(totalLabel()).toBe('Total Cards');
    });
});

describe('ChecklistCreatorModal — the count label is editable (#773)', () => {
    let creator;

    beforeEach(() => {
        window.confirm = vi.fn(() => true);
        creator = new ChecklistCreatorModal({});
        creator.init();
    });

    const field = () => creator.backdrop.querySelector('#creator-total-label');

    it('renders a control for it at all', () => {
        expect(field()).not.toBeNull();
    });

    it('loads the existing value when editing', () => {
        creator.openEdit({ id: 'x', title: 'T', navLabel: 'T', totalLabel: 'Main Cards' });

        expect(field().value).toBe('Main Cards');
    });

    it('leaves the box empty when the config sets none', () => {
        creator.openEdit({ id: 'x', title: 'T', navLabel: 'T' });

        expect(field().value).toBe('');
    });

    it('writes a typed label into the config', () => {
        creator.openEdit({ id: 'x', title: 'T', navLabel: 'T' });
        field().value = '  Main Cards  ';

        expect(creator._buildConfig().totalLabel).toBe('Main Cards');
    });

    // Blank means "use the default", which is a real choice - storing "" would
    // set the heading to an empty string rather than falling back.
    it('removes the key when the box is cleared, rather than storing empty', () => {
        creator.openEdit({ id: 'x', title: 'T', navLabel: 'T', totalLabel: 'Main Cards' });
        field().value = '';

        const config = creator._buildConfig();

        expect('totalLabel' in config).toBe(false);
    });
});
