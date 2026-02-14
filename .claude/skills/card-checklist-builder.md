# Card Checklist Builder

Create config-driven card checklists for tracking sports card collections.

## When to Use

Use this skill when the user wants to create a new card checklist for a player, team, or set.

## Architecture

All checklists use the config-driven engine:
- **`checklist.html?id={checklist-id}`** - Generic page that loads any checklist
- **`checklist-engine.js`** - Renders cards, handles sorting/filtering/ownership
- **Config stored in GitHub Gist:** `{id}-config.json` (settings) + `{id}-cards.json` (card data)
- **Registry:** `checklists-registry.json` lists all checklists for the index page and nav

## Workflow

### 1. Verify Which Cards Actually Exist

**CRITICAL: Do not assume cards exist based on typical set releases. Always verify.**

Use SportsCardsPro to find cards that actually exist for a player:

```
https://www.sportscardspro.com/search-products?q=[PLAYER]+[YEAR]&type=prices
```

**Common mistakes to avoid:**
- Assuming a player is in Bowman University (they may not be)
- Confusing similar player names
- Assuming Leaf Draft exists when it's actually Leaf Trinity
- Listing "college" versions of NFL sets (Contenders Draft college vs NFL)

### 2. Create the Checklist

Use the ChecklistCreatorModal in the UI (login, click "+" button on the index page) or create the config JSON directly in the gist.

**Config structure (`{id}-config.json`):**
```json
{
    "id": "checklist-id",
    "title": "Display Title",
    "navLabel": "Short Nav Label",
    "categories": [
        { "id": "category-1", "label": "Category One" },
        { "id": "category-2", "label": "Category Two" }
    ],
    "showPlayerName": true,
    "cardDisplay": {},
    "theme": {
        "primaryColor": "#hex",
        "darkColor": "#hex",
        "accentColor": "#hex"
    },
    "sortOptions": ["default", "year", "set", "owned", "needed"]
}
```

**Card data structure (`{id}-cards.json`):**
```json
{
    "categories": {
        "category-1": [
            { "set": "2024 Prizm", "num": "#123", "player": "Player Name", "variant": "Base" }
        ],
        "category-2": [...]
    }
}
```

**Card object fields:**
- `set` - Full set name with year (e.g., "2024 Prizm")
- `num` - Card number with # prefix (e.g., "#8") or empty string
- `player` - Player name (when `showPlayerName: true`)
- `variant` - Card variant (e.g., "Base", "Silver Prizm")
- `price` - Price value
- `auto` - Boolean, autographed card
- `patch` - Boolean, patch/relic card
- `serial` - Print run (e.g., "/99", "/25")
- `rc` - Boolean, rookie card
- `img` - R2 image URL or empty string

### 3. Source Card Images

**Preferred method: eBay via Chrome DevTools**

1. Search eBay for the card
2. Use snapshot to find `i.ebayimg.com` URLs
3. Paste the URL into the card editor image field (or upload via the image editor)

**Images are stored in Cloudflare R2** - uploaded via `POST /upload-image` endpoint. The card editor handles this automatically.

### 4. Register the Checklist

Add an entry to `checklists-registry.json`:
```json
{
    "id": "checklist-id",
    "title": "Display Title",
    "navLabel": "Short Label",
    "description": "Brief description for index card",
    "type": "dynamic",
    "order": 10,
    "accentColor": "#hex",
    "borderColor": "#hex"
}
```

The ChecklistCreatorModal handles this automatically when creating via the UI.

## Testing

- Auth and data do not work locally - test on the deployed site
- GitHub Pages deploys in ~30-60 seconds after push
- For preview sites, sync the preview gist from production first

## References

- **Card verification:** https://www.sportscardspro.com
- **Price data:** https://www.pricecharting.com
- **eBay searches:** https://www.ebay.com
- **Card searcher skill:** `/Users/michaelcollins/.claude/skills/card-searcher` (for detailed search patterns)
