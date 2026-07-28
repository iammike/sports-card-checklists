# Sports Card Checklists Project

## Card Selection
- **Avoid print-on-demand cards** - Generally don't add Topps Now or Panini Instant cards. Exception: players with very limited card options where this is their only/best card.

## Architecture
- **All checklists are config-driven** - `checklist.html` + `checklist-engine.js` loads config from gist via `?id=xxx`
- **No per-checklist HTML files** - Checklists are added via gist registry, not by creating new HTML pages
- Config stored in gist: `checklists-registry.json`, `{id}-config.json`, `{id}-cards.json`
- Images stored in Cloudflare R2, served via Worker - no git-based image flow
- `dist/` bundles (`app.min.js`, `checklist-engine.min.js`, `shared.min.css`) are built in CI, not committed - `deploy.yml` builds them for production, `deploy-preview.yml` builds them for PR previews (`wrangler pages deploy`). Run `npm run build` locally whenever you need `index.html`/`checklist.html` to reflect `src/*.js` or `shared.css` changes (they load `dist/*.min.*` directly) - just don't commit the result; push the source changes and let CI rebuild

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
- **Unit tests** - Run `npm test` (vitest). Tests cover sanitize, CardRenderer, and CardEditorModal search term generation.
- **Test fixtures must match what the editor actually submits** - tests that hand-build `cardData` for the engine, or stub `ChecklistManager`, routinely model shapes the real code never produces, which makes broken code look correct. Read `getFormData()`/`save()` in `card-editor.js` before writing one. Known traps: `save()` renames `ebay` -> `search` before calling `onSave`; `getCustomFieldData` skips any field the config doesn't declare; unchecked checkboxes are omitted entirely; a stub `ChecklistManager` that skips `onOwnedChange` hides the re-render that `toggleOwned` triggers. The contract is documented above `formDataWithCleared` in `tests/clear-field-merge.test.js`.
- **Guard tests must assert a count, not just values** - a test that loops over `querySelectorAll(...)` passes trivially when it finds nothing. See `tests/external-link-rel.test.js`.
- **Preview gist sync** - Before testing on Cloudflare preview sites, remind user to sync preview gist from production (login on preview site, use "Sync from Production" button). Otherwise data may be stale or have outdated schema.
- **Preview URL format** - Cloudflare Pages converts branch names: slashes become dashes, then truncated to exactly 28 characters. Count AFTER converting slashes. Example: `fix/consolidate-search-toggles` -> `fix-consolidate-search-toggles` (30 chars) -> truncate to `fix-consolidate-search-toggl` (28 chars) -> `https://fix-consolidate-search-toggl.sports-card-checklists.pages.dev`

## Pull Requests
- **Never force-merge with `--admin`** - Let CI checks run and merge only after they pass

## Consistency
- When making changes to a page or card component, consider applying the same change to all checklists/cards
- The index page has multiple checklist cards (Jayden Daniels, Washington QBs) - features should be consistent across them
- UI improvements, data displays, and styling should generally apply to all cards unless specifically scoped
- **Fix sinks by class, not by instance** - when fixing an escaping, deletion-marker or inline-handler bug, enumerate every occurrence of the pattern before stopping. Past fixes repeatedly patched one site and left identical ones in adjacent files.

## Rendering and escaping
- **No inline event handlers in the card render path** - use a delegated listener on `#sections-container`, which persists across `renderCards()` (only its `innerHTML` is replaced). Image errors need a **capture-phase** listener; `error` does not bubble.
- **Three escaping helpers, distinct jobs** - `sanitizeText` for text nodes (does NOT escape quotes), `sanitizeAttr` for attribute values (does), `sanitizeLinkUrl` for navigation targets (scheme allowlist only, resolves relative URLs against `document.baseURI` - it does not escape, so pair it with `sanitizeAttr`). Plain `sanitizeUrl` blanks relative URLs and is unusable for this app's hrefs.
- **Deleting a card field requires a marker** - `_mergeCardArrays` merges `{...freshCard, ...localCard}` with the gist as base, so simply removing a key locally is undone on the next save. Deletions ride on `img: ''`, `noCard: false`, or the non-enumerable `_clearedKeys`, and only fields this checklist's editor manages may be recorded as cleared.

## GitHub Issues
- When creating an issue, always add appropriate labels for **size** and **priority**
  - Size: `size:small` (< 1 hour), `size:medium` (1-4 hours), `size:large` (4+ hours)
  - Priority: `priority:low`, `priority:medium`, `priority:high`, `priority:critical`
- Also add a category label when applicable: `ui`, `refactor`, `content`, `bug`, `feature`, `infrastructure`
- Prefer consolidating related work into a single issue with a task checklist over creating multiple sub-issues
