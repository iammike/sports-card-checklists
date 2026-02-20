import { describe, it, expect } from 'vitest';

const ShoppingList = globalThis.ShoppingList;

describe('ShoppingList.flattenCards', () => {
    it('returns all non-collection-link cards for flat data shape', () => {
        const cardData = { cards: [
            { set: 'Set A', num: '1' },
            { set: 'Set B', num: '2', collectionLink: true },
            { set: 'Set C', num: '3' },
        ]};
        const config = { dataShape: 'flat' };
        const result = ShoppingList.flattenCards(cardData, config);
        expect(result).toHaveLength(2);
        expect(result[0].set).toBe('Set A');
        expect(result[1].set).toBe('Set C');
    });

    it('includes only main categories by default', () => {
        const cardData = { categories: {
            base: [{ set: 'Base', num: '1' }],
            inserts: [{ set: 'Insert', num: '1' }],
        }};
        const config = { categories: [
            { id: 'base', isMain: true },
            { id: 'inserts', isMain: false },
        ]};
        const result = ShoppingList.flattenCards(cardData, config);
        expect(result).toHaveLength(1);
        expect(result[0].set).toBe('Base');
    });

    it('includes extra categories when includeExtra is true', () => {
        const cardData = { categories: {
            base: [{ set: 'Base', num: '1' }],
            inserts: [{ set: 'Insert', num: '1' }],
        }};
        const config = { categories: [
            { id: 'base', isMain: true },
            { id: 'inserts', isMain: false },
        ]};
        const result = ShoppingList.flattenCards(cardData, config, true);
        expect(result).toHaveLength(2);
    });

    it('handles parent categories with children', () => {
        const cardData = { categories: {
            rookies: [{ set: 'Rookies', num: '1' }],
            vets: [{ set: 'Vets', num: '1' }],
            parallels: [{ set: 'Parallel', num: '1' }],
        }};
        const config = { categories: [
            { id: 'base', children: [{ id: 'rookies' }, { id: 'vets' }] },
            { id: 'parallels', isMain: false },
        ]};
        const result = ShoppingList.flattenCards(cardData, config);
        expect(result).toHaveLength(2);
        expect(result.map(c => c.set)).toEqual(['Rookies', 'Vets']);
    });

    it('excludes collection link cards from categories', () => {
        const cardData = { categories: {
            base: [
                { set: 'Card', num: '1' },
                { set: 'Link', collectionLink: true },
            ],
        }};
        const config = { categories: [{ id: 'base' }] };
        const result = ShoppingList.flattenCards(cardData, config);
        expect(result).toHaveLength(1);
        expect(result[0].set).toBe('Card');
    });
});

describe('ShoppingList.generateCardId', () => {
    it('generates id from set, num, and variant', () => {
        const card = { set: '2024 Donruss', num: '1', variant: 'Base' };
        const id = ShoppingList.generateCardId(card, {});
        expect(id).toBeTruthy();
        expect(typeof id).toBe('string');
    });

    it('uses card.id if present', () => {
        const card = { id: 'custom-id', set: 'Test', num: '1' };
        expect(ShoppingList.generateCardId(card, {})).toBe('custom-id');
    });

    it('includes player when config says so', () => {
        const card = { player: 'Player', set: 'Set', num: '1', variant: '' };
        const config = { cardDisplay: { includePlayerInCardId: true } };
        const withPlayer = ShoppingList.generateCardId(card, config);
        const withoutPlayer = ShoppingList.generateCardId(card, {});
        expect(withPlayer).not.toBe(withoutPlayer);
    });
});
