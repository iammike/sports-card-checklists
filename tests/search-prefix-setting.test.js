import { describe, it, expect, afterEach } from 'vitest';

const ChecklistCreatorModal = globalThis.ChecklistCreatorModal;

// The creator is the only writer of config.searchPrefix, and _buildConfig()'s
// return value is exactly what save() hands to githubSync.saveChecklistConfig().
// Every fixture below therefore comes from a real modal instance rather than a
// hand-written config object.

function openCreator() {
    const creator = new ChecklistCreatorModal({});
    creator.open();
    return creator;
}

// Fill the two fields _buildConfig() refuses to build without.
function fillRequired(creator, title = 'Jayden Daniels Rookie Cards') {
    creator.backdrop.querySelector('#creator-title').value = title;
    creator.backdrop.querySelector('#creator-nav-label').value = 'DANIELS';
}

function setPrefix(creator, value) {
    creator.backdrop.querySelector('#creator-search-prefix').value = value;
}

// Toggle the checkbox the way a user does, so the change listener runs.
function toggleShowPlayer(creator) {
    creator.backdrop.querySelector('#creator-show-player').click();
}

function prefixField(creator) {
    return creator.backdrop.querySelector('#creator-search-prefix-field');
}

afterEach(() => {
    document.querySelectorAll('.checklist-creator-backdrop').forEach(el => el.remove());
});

describe('ChecklistCreatorModal — search prefix input', () => {
    it('renders a text input below the title field', () => {
        const creator = openCreator();
        const input = creator.backdrop.querySelector('#creator-search-prefix');

        expect(input).not.toBe(null);
        expect(input.type).toBe('text');
        expect(input.placeholder).toBe('e.g. Jayden Daniels');
        expect(input.title).toContain('eBay');

        // Comes after the title input in document order.
        const title = creator.backdrop.querySelector('#creator-title');
        expect(title.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING)
            .toBeTruthy();
    });

    it('is hidden while player names are shown', () => {
        const creator = openCreator();

        expect(creator.backdrop.querySelector('#creator-show-player').checked).toBe(true);
        expect(prefixField(creator).style.display).toBe('none');
    });

    it('appears when player names are turned off', () => {
        const creator = openCreator();

        toggleShowPlayer(creator);

        expect(creator.backdrop.querySelector('#creator-show-player').checked).toBe(false);
        expect(prefixField(creator).style.display).toBe('');
    });

    it('hides again when player names are turned back on', () => {
        const creator = openCreator();

        toggleShowPlayer(creator);
        toggleShowPlayer(creator);

        expect(prefixField(creator).style.display).toBe('none');
    });
});

describe('ChecklistCreatorModal — search prefix round trip', () => {
    it('saves the typed value to config.searchPrefix', () => {
        const creator = openCreator();
        fillRequired(creator);
        toggleShowPlayer(creator);
        setPrefix(creator, 'Jayden Daniels');

        const config = creator._buildConfig();

        expect(config.searchPrefix).toBe('Jayden Daniels');
        expect(config.cardDisplay.showPlayerName).toBe(false);
    });

    it('trims surrounding whitespace', () => {
        const creator = openCreator();
        fillRequired(creator);
        toggleShowPlayer(creator);
        setPrefix(creator, '  Jayden Daniels  ');

        expect(creator._buildConfig().searchPrefix).toBe('Jayden Daniels');
    });

    it('omits the key entirely when left blank', () => {
        const creator = openCreator();
        fillRequired(creator);
        toggleShowPlayer(creator);

        const config = creator._buildConfig();

        expect('searchPrefix' in config).toBe(false);
    });

    // The page keeps a single creator instance, so reopening means calling
    // openEdit() on the same modal. open() in between clears the form, which is
    // what makes these assertions about _populateForm() meaningful.
    it('populates the input when reopening a saved config', () => {
        const creator = openCreator();
        fillRequired(creator);
        toggleShowPlayer(creator);
        setPrefix(creator, 'Jayden Daniels');
        const saved = creator._buildConfig();

        creator.open();
        creator.openEdit(saved);

        expect(creator.backdrop.querySelector('#creator-search-prefix').value)
            .toBe('Jayden Daniels');
        // showPlayerName is false in the saved config, so the field is visible.
        expect(prefixField(creator).style.display).toBe('');
    });

    it('blanks and hides the input for a config without a prefix', () => {
        const creator = openCreator();
        fillRequired(creator, 'Washington QBs');
        const saved = creator._buildConfig();
        expect('searchPrefix' in saved).toBe(false);

        // Leave a stale prefix on screen, then load the prefix-less config.
        toggleShowPlayer(creator);
        setPrefix(creator, 'Stale Value');
        creator.openEdit(saved);

        expect(creator.backdrop.querySelector('#creator-search-prefix').value).toBe('');
        expect(prefixField(creator).style.display).toBe('none');
    });

    it('deletes an existing prefix when the input is cleared', () => {
        const creator = openCreator();
        fillRequired(creator);
        toggleShowPlayer(creator);
        setPrefix(creator, 'Jayden Daniels');
        const saved = creator._buildConfig();
        expect(saved.searchPrefix).toBe('Jayden Daniels');

        creator.openEdit(saved);
        setPrefix(creator, '');
        const updated = creator._buildConfig();

        expect('searchPrefix' in updated).toBe(false);
    });

    it('keeps the prefix when player names are turned back on', () => {
        // Hiding the field is presentation only: a stray toggle must not destroy
        // a prefix the user typed, and the engine ignores it while player names show.
        const creator = openCreator();
        fillRequired(creator);
        toggleShowPlayer(creator);
        setPrefix(creator, 'Jayden Daniels');
        toggleShowPlayer(creator);

        const config = creator._buildConfig();

        expect(config.cardDisplay.showPlayerName).toBe(true);
        expect(config.searchPrefix).toBe('Jayden Daniels');
    });

    it('clears the input when the modal is reused for a new checklist', () => {
        const creator = openCreator();
        fillRequired(creator);
        toggleShowPlayer(creator);
        setPrefix(creator, 'Jayden Daniels');

        creator.open();

        expect(creator.backdrop.querySelector('#creator-search-prefix').value).toBe('');
        fillRequired(creator, 'Washington QBs');
        toggleShowPlayer(creator);
        expect('searchPrefix' in creator._buildConfig()).toBe(false);
    });
});
