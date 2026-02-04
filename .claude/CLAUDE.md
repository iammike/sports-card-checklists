# Sports Card Checklists Project

## Card Selection
- **Avoid print-on-demand cards** - Do not add Topps Now or Panini Instant cards. These are made-to-order products, not traditional trading cards.

## Data Storage
- **The GitHub Gist is the source of truth** for all collection data (owned cards, stats)
- Never use localStorage as the primary data source - it won't work for online visitors
- Stats displayed on the index page must be read from the gist, not re-calculated
- See `github-sync.js` for gist API methods: `saveChecklistStats()`, `loadAllStats()`, `loadPublicStats()`

## Testing
- **Auth and data do not work locally** - GitHub OAuth and gist data require the deployed domain
- Skip local preview for most changes; test on the live site after merge
- GitHub Pages deploys in ~30-60 seconds after push
- After a PR is merged, wait for user to test before pushing more fixes - create new PRs instead of adding to old branches
- **Preview gist sync** - Before testing on Cloudflare preview sites, remind user to sync preview gist from production (login on preview site, use "Sync from Production" button). Otherwise data may be stale or have outdated schema.
- **Preview URL truncation** - Cloudflare Pages truncates long branch names in preview URLs (e.g., `experiment-simplify-card-typ.sports-card-checklists.pages.dev`). Keep branch names short or check Cloudflare dashboard for exact URL.

## Consistency
- When making changes to a page or card component, consider applying the same change to all checklists/cards
- The index page has multiple checklist cards (Jayden Daniels, Washington QBs) - features should be consistent across them
- UI improvements, data displays, and styling should generally apply to all cards unless specifically scoped

## GitHub Issues
- When creating an issue, always add appropriate labels for **size** and **priority**
  - Size: `size:small` (< 1 hour), `size:medium` (1-4 hours), `size:large` (4+ hours)
  - Priority: `priority:low`, `priority:medium`, `priority:high`, `priority:critical`
- Also add a category label when applicable: `ui`, `refactor`, `content`, `bug`, `feature`, `infrastructure`
- Prefer consolidating related work into a single issue with a task checklist over creating multiple sub-issues
