import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ChecklistEngine = globalThis.ChecklistEngine;
const ChecklistCreatorModal = globalThis.ChecklistCreatorModal;
const StatsAnimator = globalThis.StatsAnimator;

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

describe('checklist.html carries the elements the labels are written into', () => {
    const html = () => readFileSync(resolve(import.meta.dirname, '..', 'checklist.html'), 'utf-8');

    // The engine guards on `if (valueLabel)`, and every other test here builds
    // its own fixture - so without this, removing the id from the page leaves a
    // silent no-op and a green suite.
    it('has the value label id the engine writes to', () => {
        expect(html()).toContain('id="value-label"');
    });

    it('has the count label id, and the default text the engine restores', () => {
        const source = html();
        expect(source).toContain('id="total-label"');
        // _setPageMeta falls back to this exact string when no label is configured.
        expect(source).toContain('>Total Cards<');
    });

    it('has the needed-value element the breakdown suffix is written into', () => {
        expect(html()).toContain('id="needed-value"');
    });
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

    it('is false when there are no categories to compare', () => {
        expect(makeEngine({ dataShape: 'flat' })._countExcludesExtras()).toBe(false);
        expect(makeEngine({ categories: [] })._countExcludesExtras()).toBe(false);
    });

    // The two above pass whether or not the flat branch is handled, because
    // `categories` is absent either way. This is the case that needs the guard:
    // computeStats takes the flat branch and counts every card, so leftover
    // categories on a hand-edited flat config exclude nothing.
    it('is false for a flat checklist that still carries categories', () => {
        const engine = makeEngine({
            dataShape: 'flat',
            categories: [{ id: 'a' }, { id: 'b', isMain: false }],
        });

        expect(engine._countExcludesExtras()).toBe(false);
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

    it('leaves Est. Value unqualified with no categories to compare', () => {
        const engine = makeEngine({ title: 'T', dataShape: 'flat' });

        engine._setPageMeta();

        expect(valueLabel()).toBe('Est. Value');
    });

    // BLOCKING 1 from review: the count label was only ever assigned when the
    // config carried one, so clearing the new field in the settings modal left
    // the old heading on screen until a reload, contradicting the saved config.
    it('puts the default count label back when the config no longer sets one', () => {
        makeEngine({ title: 'T', totalLabel: 'Main Cards' })._setPageMeta();
        expect(totalLabel()).toBe('Main Cards');

        makeEngine({ title: 'T' })._setPageMeta();

        expect(totalLabel()).toBe('Total Cards');
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

// BLOCKING 2 from review: "$X to complete" is accumulated in the counted-
// categories loop only, so it shares the count's scope, not the value's. Sitting
// directly under "Est. Value (all cards)" it read as covering everything.
describe('ChecklistEngine._neededValueSuffix (#773)', () => {
    it('names its own scope where it differs from the value above it', () => {
        const engine = makeEngine({
            totalLabel: 'Main Cards',
            categories: [{ id: 'base' }, { id: 'inserts', isMain: false }],
        });

        expect(engine._neededValueSuffix()).toBe(' to complete (main cards)');
    });

    it('falls back to the default label name when none is configured', () => {
        const engine = makeEngine({ categories: [{ id: 'base' }, { id: 'x', isMain: false }] });

        expect(engine._neededValueSuffix()).toBe(' to complete (total cards)');
    });

    // Unqualified wherever the scopes match - the same rule the value label uses.
    it('stays plain when nothing is excluded', () => {
        expect(makeEngine({ categories: [{ id: 'a' }] })._neededValueSuffix()).toBe(' to complete');
        expect(makeEngine({ dataShape: 'flat' })._neededValueSuffix()).toBe(' to complete');
    });

    // The suffix has to survive the trip through StatsAnimator, which hardcoded
    // ' to complete' in both of its branches.
    it('reaches the DOM through the animator', () => {
        document.body.innerHTML += '<span id="needed-value"></span>';
        const el = document.getElementById('needed-value');
        // hasAnimated true takes the no-animation branch, which is synchronous;
        // the animated branch defers behind setTimeout and rAF.
        StatsAnimator.hasAnimated = true;

        StatsAnimator.animateStats({
            neededValue: { el, value: 50, text: null, suffix: ' to complete (main cards)' },
        });

        expect(el.textContent).toBe('$50 to complete (main cards)');
    });

    it('still renders the plain default when no suffix is passed', () => {
        document.body.innerHTML += '<span id="needed-value"></span>';
        const el = document.getElementById('needed-value');
        StatsAnimator.hasAnimated = true;

        StatsAnimator.animateStats({ neededValue: { el, value: 50, text: null } });

        expect(el.textContent).toBe('$50 to complete');
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
