import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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

    it('excludes noCard entries in flat data shape', () => {
        const cardData = { cards: [
            { set: 'Set A', num: '1' },
            { player: 'Nobody', noCard: true },
            { set: 'Set C', num: '3' },
        ]};
        const config = { dataShape: 'flat' };
        const result = ShoppingList.flattenCards(cardData, config);
        expect(result).toHaveLength(2);
        expect(result.map(c => c.set)).toEqual(['Set A', 'Set C']);
    });

    it('excludes noCard entries in category data shape', () => {
        const cardData = { categories: {
            base: [
                { set: 'Base', num: '1' },
                { player: 'Nobody', noCard: true },
            ],
        }};
        const config = { categories: [{ id: 'base', isMain: true }] };
        const result = ShoppingList.flattenCards(cardData, config);
        expect(result).toHaveLength(1);
        expect(result[0].set).toBe('Base');
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

describe('ShoppingList.generate', () => {
    let realSync;
    let realLoadRegistry;
    let realLoadJsPDF;
    let realBuildPDF;

    beforeEach(() => {
        realSync = window.githubSync;
        realLoadRegistry = DynamicNav.loadRegistry;
        realLoadJsPDF = ShoppingList.loadJsPDF;
        realBuildPDF = ShoppingList.buildPDF;

        DynamicNav.loadRegistry = async () => ({ checklists: [{ id: 'jayden-daniels' }] });
        ShoppingList.loadJsPDF = async () => {};
        ShoppingList.buildPDF = vi.fn();
    });

    afterEach(() => {
        window.githubSync = realSync;
        DynamicNav.loadRegistry = realLoadRegistry;
        ShoppingList.loadJsPDF = realLoadJsPDF;
        ShoppingList.buildPDF = realBuildPDF;
    });

    it('drops the collection-data cache before reading owned cards', async () => {
        // _cachedData is populated at page load and kept across saves, so by the
        // time someone opens the shopping list it can be older than their last
        // edit - every card they just marked owned would print as still needed.
        // The order is the assertion: clearing after the read buys nothing.
        const clearDataCache = vi.fn();
        const loadData = vi.fn(async () => {
            expect(clearDataCache).toHaveBeenCalled();
            return { checklists: {} };
        });
        window.githubSync = {
            clearDataCache,
            loadData,
            loadPublicData: async () => null,
            loadChecklistConfig: async () => null,
            loadPublicChecklistConfig: async () => null,
        };

        await ShoppingList.generate();

        expect(clearDataCache).toHaveBeenCalledTimes(1);
        expect(loadData).toHaveBeenCalled();
        // Reaching the PDF proves generate() ran to the end rather than dying
        // somewhere after the cache call.
        expect(ShoppingList.buildPDF).toHaveBeenCalled();
    });

    // The export is offered to logged-out visitors (the filter-row button in
    // checklist-engine.js), which rests entirely on every authenticated read
    // here having a public fallback. Without a token loadData/loadChecklistConfig/
    // loadCardData all return null, so this pins that the fallbacks carry it the
    // whole way to a PDF rather than yielding an empty list.
    it('builds the list from the public gist when there is no token', async () => {
        window.githubSync = {
            clearDataCache: vi.fn(),
            loadData: async () => null,
            loadPublicData: async () => ({ checklists: { 'jayden-daniels': ['owned-card'] } }),
            loadChecklistConfig: async () => null,
            loadPublicChecklistConfig: async () => ({ dataShape: 'flat', cardDisplay: {} }),
            loadCardData: async () => null,
            loadPublicCardData: async () => ({
                cards: [
                    { id: 'owned-card', set: '2024 Prizm', num: '1' },
                    { id: 'needed-card', set: '2024 Select', num: '2', price: 25 },
                ],
            }),
        };

        await ShoppingList.generate();

        expect(ShoppingList.buildPDF).toHaveBeenCalledTimes(1);
        const items = ShoppingList.buildPDF.mock.calls[0][0];
        expect(items.map(i => i.num)).toEqual(['2']);
        expect(items[0].price).toBe(25);
    });
});
