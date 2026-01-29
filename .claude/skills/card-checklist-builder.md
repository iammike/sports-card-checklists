# Card Checklist Builder

Create interactive HTML checklists for tracking sports card collections.

## When to Use

Use this skill when the user wants to create a new card checklist for a player, team, or set.

## Workflow

### 1. Verify Which Cards Actually Exist

**CRITICAL: Do not assume cards exist based on typical set releases. Always verify.**

Use SportsCardsPro to find cards that actually exist for a player:

```
https://www.sportscardspro.com/search-products?q=[PLAYER]+[YEAR]&type=prices
```

For specific sets:
```
https://www.sportscardspro.com/game/football-cards-[YEAR]-[SET]/[player-slug]-[number]
```

**Common mistakes to avoid:**
- Assuming a player is in Bowman University (they may not be)
- Confusing similar player names (e.g., "Jayden Daniels" vs "Jayden De Laura" vs "Jalon Daniels")
- Assuming Leaf Draft exists when it's actually Leaf Trinity
- Listing "college" versions of NFL sets (Contenders Draft college vs NFL)

### 2. Categorize Cards by Era/Type

Organize cards into logical sections:
- **College/Pre-Draft** - Cards from before the player was drafted (actual college sets)
- **NFL Rookie Year** - First-year NFL cards (the official "rookie cards")
- **By Manufacturer** - Panini, Topps, Leaf, etc.

### 3. Source Card Images

**Preferred method: eBay via Chrome DevTools**

1. Navigate to eBay search:
   ```
   https://www.ebay.com/sch/i.html?_nkw=[YEAR]+[SET]+[PLAYER]+[NUMBER]&LH_BIN=1&_sop=15
   ```

2. Take a snapshot to find image URLs:
   ```
   mcp__chrome-devtools__take_snapshot
   ```

3. Look for `i.ebayimg.com` URLs in the snapshot

4. Download images using curl:
   ```bash
   curl -o [output-path].webp "[ebayimg-url]"
   ```

5. Verify the downloaded image shows the correct player and card

**Image verification checklist:**
- [ ] Correct player name visible on card
- [ ] Correct team/uniform
- [ ] Correct set branding (SAGE, Leaf, Panini, etc.)
- [ ] Card number matches if applicable

### 4. Create the HTML Checklist

Use the existing template structure from `jayden-daniels-rookie-checklist.html`:

```javascript
const cards = {
    college: [
        { set: "YEAR SET_NAME", num: "#NUMBER", name: "Base", type: "Base",
          search: "search+terms+for+ebay", img: "player-cards/image.webp" },
    ],
    panini: [...],
    topps: [...],
    other: [...]
};
```

**Card object fields:**
- `set` - Full set name with year (e.g., "2023 SAGE")
- `num` - Card number with # prefix (e.g., "#8") or empty string
- `name` - Card variant name (e.g., "Base", "Silver", "Holo")
- `type` - Card type for filtering: "Base", "Base RC", "Parallel", "Insert", "Insert SSP"
- `search` - eBay search terms, plus-separated
- `img` - Relative path to image file, or empty string for placeholder

### 5. File Organization

```
sports-card-checklists/
├── [player]-rookie-checklist.html
├── [player]-cards/
│   ├── card_[year]_[set]_[variant].webp
│   └── ...
├── serve.sh
└── README.md
```

**Image naming convention:**
- `card_[year]_[set]_[variant].webp`
- Example: `card_2023_sage_base.webp`, `card_2024_prizm_silver.webp`

## Price Estimation

The template includes rough price estimation based on card type and set:

```javascript
const priceGuide = {
    'Base': 1, 'Base RC': 1.5,
    'Parallel': 5, 'Insert': 4, 'Insert SSP': 50,
};

const setMods = {
    'Score': 0.5, 'Donruss': 0.8, 'Prizm': 2, 'Select': 1.5,
    'Chrome': 2.5, 'Leaf': 0.5, 'SAGE': 0.3, ...
};
```

Adjust modifiers based on the player's popularity and card market.

## Testing

1. Start local server: `./serve.sh` or `python3 -m http.server 8000`
2. Open `http://localhost:8000/[checklist].html`
3. Verify all images load correctly
4. Test checkbox persistence (uses localStorage)
5. Test filters (price, type, status)

## References

- **Card verification:** https://www.sportscardspro.com
- **Price data:** https://www.pricecharting.com
- **eBay searches:** https://www.ebay.com
- **Card searcher skill:** `/Users/michaelcollins/.claude/skills/card-searcher` (for detailed search patterns)
