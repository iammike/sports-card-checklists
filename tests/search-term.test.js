import { describe, it, expect } from 'vitest';

const CardRenderer = globalThis.CardRenderer;

describe('CardRenderer.buildDefaultSearch', () => {
    it('combines prefix, set, number, and variant', () => {
        const card = { set: '2024 Donruss', num: '#101', variant: 'Silver' };
        expect(CardRenderer.buildDefaultSearch(card, 'Jayden Daniels'))
            .toBe('Jayden Daniels 2024 Donruss #101 Silver');
    });

    it('includes a non-Base variant', () => {
        const card = { set: 'Set', variant: 'Silver Prizm' };
        expect(CardRenderer.buildDefaultSearch(card, 'Player'))
            .toBe('Player Set Silver Prizm');
    });

    it('excludes the Base variant', () => {
        const card = { set: 'Set', variant: 'Base' };
        expect(CardRenderer.buildDefaultSearch(card, 'Player')).toBe('Player Set');
    });

    it('omits the variant when absent', () => {
        const card = { set: '2024 Donruss', num: '#5' };
        expect(CardRenderer.buildDefaultSearch(card, 'Jayden Daniels'))
            .toBe('Jayden Daniels 2024 Donruss #5');
    });

    it('collapses whitespace when the card number is missing', () => {
        const card = { set: '2024 Donruss', variant: 'Silver' };
        expect(CardRenderer.buildDefaultSearch(card, 'Jayden Daniels'))
            .toBe('Jayden Daniels 2024 Donruss Silver');
    });

    it('works with an empty prefix', () => {
        const card = { set: '2024 Topps Chrome' };
        expect(CardRenderer.buildDefaultSearch(card, '')).toBe('2024 Topps Chrome');
    });

    it('handles a completely empty card', () => {
        expect(CardRenderer.buildDefaultSearch({}, '')).toBe('');
    });
});
