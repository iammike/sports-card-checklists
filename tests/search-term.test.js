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

    it('appends Auto for an autographed card', () => {
        const card = { set: '2024 Donruss', num: '#101', variant: 'Silver', auto: true };
        expect(CardRenderer.buildDefaultSearch(card, 'Jayden Daniels'))
            .toBe('Jayden Daniels 2024 Donruss #101 Silver Auto');
    });

    it('omits Auto when the card is not autographed', () => {
        // The editor never submits auto: false - unchecked checkboxes are
        // omitted entirely (see .claude/CLAUDE.md) - so this models the real shape.
        const card = { set: '2024 Donruss', num: '#101' };
        expect(CardRenderer.buildDefaultSearch(card, 'Jayden Daniels'))
            .toBe('Jayden Daniels 2024 Donruss #101');
    });

    it('does not double up when the variant already says Auto', () => {
        const card = { set: '2020 Panini Contenders', num: '#217', variant: 'Rookie Ticket Auto', auto: true };
        expect(CardRenderer.buildDefaultSearch(card, 'Ben DiNucci'))
            .toBe('Ben DiNucci 2020 Panini Contenders #217 Rookie Ticket Auto');
    });

    it('does not append Auto when the variant already says Autographs/Signatures', () => {
        expect(CardRenderer.buildDefaultSearch(
            { set: '2000 Sage', num: '#A23', variant: 'Autographs Red', auto: true }, 'Curtis Keaton'
        )).toBe('Curtis Keaton 2000 Sage #A23 Autographs Red');

        expect(CardRenderer.buildDefaultSearch(
            { set: '2019 Panini National Treasures', num: '#185', variant: 'Rookie Signatures', auto: true }, 'Jimmy Moreland'
        )).toBe('Jimmy Moreland 2019 Panini National Treasures #185 Rookie Signatures');
    });
});
