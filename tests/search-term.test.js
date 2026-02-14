import { describe, it, expect } from 'vitest';

const CardEditorModal = globalThis.CardEditorModal;

// Helper: create a minimal editor instance to test generateSearchTerm
function makeEditor(playerName = '') {
    const editor = Object.create(CardEditorModal.prototype);
    editor.playerName = playerName;
    return editor;
}

describe('CardEditorModal.generateSearchTerm', () => {
    it('combines player, set, number, and variant', () => {
        const editor = makeEditor('Jayden Daniels');
        const result = editor.generateSearchTerm('2024 Donruss', '#101', 'Silver', null);
        expect(result).toBe('jayden+daniels+2024+donruss+101+silver');
    });

    it('uses card-level player over default playerName', () => {
        const editor = makeEditor('Default Player');
        const result = editor.generateSearchTerm('2024 Donruss', null, null, 'Jayden Daniels');
        expect(result).toBe('jayden+daniels+2024+donruss');
    });

    it('falls back to playerName when no card player', () => {
        const editor = makeEditor('Jayden Daniels');
        const result = editor.generateSearchTerm('2024 Donruss', null, null, null);
        expect(result).toBe('jayden+daniels+2024+donruss');
    });

    it('strips # prefix from card number', () => {
        const editor = makeEditor('Player');
        const result = editor.generateSearchTerm('Set', '#42', null, null);
        expect(result).toBe('player+set+42');
    });

    it('excludes Base variant', () => {
        const editor = makeEditor('Player');
        const result = editor.generateSearchTerm('Set', null, 'Base', null);
        expect(result).toBe('player+set');
    });

    it('includes non-Base variant', () => {
        const editor = makeEditor('Player');
        const result = editor.generateSearchTerm('Set', null, 'Silver Prizm', null);
        expect(result).toBe('player+set+silver+prizm');
    });

    it('works with no playerName and no card player', () => {
        const editor = makeEditor('');
        const result = editor.generateSearchTerm('2024 Donruss', '#5', null, null);
        expect(result).toBe('2024+donruss+5');
    });

    it('lowercases everything and replaces spaces with +', () => {
        const editor = makeEditor('JAYDEN DANIELS');
        const result = editor.generateSearchTerm('2024 Panini Prizm', null, null, null);
        expect(result).toBe('jayden+daniels+2024+panini+prizm');
    });

    it('handles all empty inputs', () => {
        const editor = makeEditor('');
        const result = editor.generateSearchTerm('', null, null, null);
        expect(result).toBe('');
    });

    it('handles only set name', () => {
        const editor = makeEditor('');
        const result = editor.generateSearchTerm('2024 Topps Chrome', null, null, null);
        expect(result).toBe('2024+topps+chrome');
    });
});
