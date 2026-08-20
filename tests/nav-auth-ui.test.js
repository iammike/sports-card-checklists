import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const ChecklistManager = globalThis.ChecklistManager;

// ChecklistManager.updateAuthUI() used to carry a full second copy of
// AuthUI.update()'s dropdown template. The two drifted apart when Shopping
// List was added to AuthUI's copy and never mirrored into this one, which
// silently hid it on every checklist page (only index.html called
// AuthUI.update() directly - every checklist page goes through
// ChecklistManager instead). updateAuthUI() now delegates to the real
// AuthUI.update() rather than reimplementing it, so these tests exercise the
// real nav.js AuthUI - not a mock of it - to prove the delegation actually
// happens and isn't just asserting a stub was called.
function makeManager({ loggedIn = true, owner = true } = {}) {
    window.githubSync = {
        isLoggedIn: () => loggedIn,
        getUser: () => ({ login: owner ? 'iammike' : 'someone-else', avatar_url: 'https://example.com/a.png' }),
        isPreview: () => false,
    };
    return new ChecklistManager({ checklistId: 'test' });
}

describe('ChecklistManager.updateAuthUI', () => {
    let realGithubSync;
    let realFetch;

    beforeEach(() => {
        realGithubSync = window.githubSync;
        document.body.innerHTML = '<div id="auth-content"></div>';
        // AuthUI.update() fetches version.json for the commit-hash footer link.
        realFetch = globalThis.fetch;
        globalThis.fetch = vi.fn(async () => ({ json: async () => ({ url: '#', commit: 'abc' }) }));
    });

    afterEach(() => {
        window.githubSync = realGithubSync;
        globalThis.fetch = realFetch;
    });

    it('delegates to the real AuthUI.update() so Shopping List renders, matching index.html', () => {
        makeManager().updateAuthUI();

        expect(document.getElementById('shopping-list-btn')).not.toBeNull();
        expect(document.getElementById('nav-avatar-btn')).not.toBeNull();
        expect(document.getElementById('auth-logout-btn')).not.toBeNull();
    });

    it('adds Add card and Clear All for the checklist owner', () => {
        makeManager({ owner: true }).updateAuthUI();

        expect(document.getElementById('add-card-btn')).not.toBeNull();
        expect(document.getElementById('clear-all-btn')).not.toBeNull();
    });

    it('does not add Add card/Clear All for a logged-in non-owner, but still shows Shopping List', () => {
        makeManager({ owner: false }).updateAuthUI();

        expect(document.getElementById('add-card-btn')).toBeNull();
        expect(document.getElementById('clear-all-btn')).toBeNull();
        expect(document.getElementById('shopping-list-btn')).not.toBeNull();
    });

    it('renders nothing when logged out, matching AuthUI.update()\'s own logged-out behavior', () => {
        makeManager({ loggedIn: false }).updateAuthUI();

        expect(document.getElementById('auth-content').innerHTML).toBe('');
    });

    it('groups owner items before Shopping List: Add card, Clear All, divider, then Shopping List', () => {
        makeManager({ owner: true }).updateAuthUI();

        const dropdown = document.getElementById('nav-dropdown');
        const ids = [...dropdown.children].map(el => el.id);
        const addIdx = ids.indexOf('add-card-btn');
        const clearIdx = ids.indexOf('clear-all-btn');
        const shopIdx = ids.indexOf('shopping-list-btn');

        expect(addIdx).toBeGreaterThan(-1);
        expect(addIdx).toBeLessThan(clearIdx);
        expect(clearIdx).toBeLessThan(shopIdx);
    });

    it('wires Clear All to call clearAll()', () => {
        const manager = makeManager({ owner: true });
        const clearAllSpy = vi.spyOn(manager, 'clearAll').mockImplementation(() => {});
        manager.updateAuthUI();

        document.getElementById('clear-all-btn').click();

        expect(clearAllSpy).toHaveBeenCalledTimes(1);
    });

    it('does not duplicate items across repeated calls', () => {
        const manager = makeManager({ owner: true });
        manager.updateAuthUI();
        manager.updateAuthUI();

        expect(document.querySelectorAll('#add-card-btn').length).toBe(1);
        expect(document.querySelectorAll('#clear-all-btn').length).toBe(1);
        expect(document.querySelectorAll('#shopping-list-btn').length).toBe(1);
    });
});
