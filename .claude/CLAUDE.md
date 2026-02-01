# Sports Card Checklists Project

## Data Storage
- **The GitHub Gist is the source of truth** for all collection data (owned cards, stats)
- Never use localStorage as the primary data source - it won't work for online visitors
- Stats displayed on the index page must be read from the gist, not re-calculated
- See `github-sync.js` for gist API methods: `saveChecklistStats()`, `loadAllStats()`, `loadPublicStats()`

## Deployment
- GitHub Pages takes 1-2 minutes to deploy changes after pushing
- Wait before testing live site changes

## Local Preview
- For visual/layout changes (CSS, spacing, styling), open the file locally for user review before committing
- Use `open index.html` or `open <filename>.html` to preview in browser
- Wait for user approval before creating a PR for layout tweaks

## Consistency
- When making changes to a page or card component, consider applying the same change to all checklists/cards
- The index page has multiple checklist cards (Jayden Daniels, Washington QBs) - features should be consistent across them
- UI improvements, data displays, and styling should generally apply to all cards unless specifically scoped
