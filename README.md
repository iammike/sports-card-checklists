# Sports Card Checklists

A modern web app for tracking sports card collections with cloud sync, real-time stats, and inline editing.

**Live site: [cards.iammike.org](https://cards.iammike.org/)**

![JavaScript](https://img.shields.io/badge/JavaScript-Vanilla-yellow) ![GitHub Pages](https://img.shields.io/badge/Hosted-GitHub%20Pages-blue) ![Cloudflare](https://img.shields.io/badge/Auth-Cloudflare%20Workers-orange)

## Features

### Collection Tracking
- **Checkbox-based ownership** - Mark cards as owned with a single click
- **Progress tracking** - Owned/total counts and completion percentage per section and overall
- **Manual pricing** - Record purchase prices with color-coded badges
- **Card attribute badges** - AUTO (autograph), PATCH (relic), serial number (/99), and price badges rendered on each card
- **Serial tracking** - Record numbered cards (/99, /25, /1) with scarcity-based sorting
- **Drag-and-drop reordering** - Reorder cards within sections via drag (desktop) or touch-drag (mobile) when using Manual sort
- **Shopping List PDF** - Export all unowned cards as a printable PDF checklist

### Cloud Sync
- **GitHub OAuth authentication** - Secure login via GitHub
- **Gist-based storage** - Collection data synced to a public GitHub Gist
- **Cross-device sync** - Access your collection from any device
- **Public viewing** - Visitors can browse your collection read-only
- **Offline fallback** - Falls back to cached data if the gist is unreachable
- **Sync status indicator** - Real-time feedback on save progress
- **Multi-tab awareness** - Automatically refreshes data when switching browser tabs

### Filtering & Search
- **Status filter** - Show all cards, owned only, or needed to complete
- **Text search** - Find cards by name, set, variant, or any text
- **Custom filters** - Checklist-specific dropdown filters (e.g., sport, era, team)
- **Sort options** - Manual, year, set name, serial scarcity, price (low/high), and custom fields

### Inline Editing (Owner Only) · [Screenshot](docs/screenshots/card-editor.png)
- **Context menu** - Right-click or long-press for Edit, Delete, and Add Card options
- **Floating Add Card button** - Always-accessible button that follows your scroll position
- **Schema-driven forms** - Custom fields per checklist (text, dropdowns, checkboxes)
- **Delete checklist** - Remove a checklist and all associated data
- **Clear All** - Reset all ownership data for a checklist

### Image Tools (Owner Only) · [Crop](docs/screenshots/image-editor-crop.png) · [Perspective](docs/screenshots/image-editor-perspective.png)
- **Tab-based image editor** - Crop/rotate and perspective correction in a single editor
- **4-point perspective correction** - Drag corners to straighten angled card photos
- **Fine rotation** - Slider plus +/- buttons for precise straightening (0.5-degree increments)
- **Local file upload** - Upload from your computer via button or drag & drop
- **Multiple sources** - Fetch images from eBay or Beckett listings via CORS proxy
- **Auto-processing** - Resized to max 1000px, converted to WebP (JPEG fallback)
- **Edit existing images** - Re-edit previously saved images with one click
- **Cloudflare R2 storage** - Images uploaded instantly, no git involvement
- **Auto-cleanup** - Old R2 images deleted automatically when replaced

### Checklist Configuration (Owner Only) · [Screenshot](docs/screenshots/checklist-config.png)
- **Create from UI** - Set up new checklists with title, description, theme, and structure
- **Theme customization** - Primary/accent colors and dark mode toggle
- **Section management** - Organize cards into collapsible, color-coded sections
- **Sort and filter config** - Choose default sort mode and enable custom filter dropdowns
- **Custom fields** - Define checklist-specific data fields positioned anywhere in the editor
- **Collection link cards** - Special cards that display stats from linked checklists

### UI/UX
- **Animated stats** - Numbers count up on first load
- **Collapsible sections** - Click section headers to expand/collapse
- **Auto-hiding sections** - Empty sections hidden automatically
- **Extra category completion** - Index page pills show checkmarks when all cards in a category are owned
- **Dynamic navigation** - Checklist links loaded from gist registry
- **Responsive design** - Works on desktop and mobile
- **Print-friendly** - Clean layout for printing checklists
- **Direct eBay links** - One-click search for any card
- **Price guide links** - Quick access to price lookups

## Architecture

```
                              ┌──────────────────┐
                              │   GitHub Pages   │
                              │   (Hosting)      │
                              └────────┬─────────┘
                                       │
                              ┌────────▼─────────┐
                              │   checklist.html  │
                              │   + engine JS     │
                              │   (config-driven) │
                              └────────┬──────────┘
                                       │
          ┌────────────────────────────┼────────────────────────────┐
          │                            │                            │
          ▼                            ▼                            ▼
┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
│ Cloudflare      │         │ Cloudflare R2   │         │ GitHub Gist     │
│ Workers (OAuth  │         │ (Image storage) │         │ (Collection +   │
│  + image proxy) │         │                 │         │  config storage) │
└─────────────────┘         └─────────────────┘         └─────────────────┘
```

### Key Components

| File | Purpose |
|------|---------|
| `checklist.html` + `checklist-engine.js` | Config-driven checklist page (loads via `?id=xxx`) |
| `shared.js` + modules | Shared components split into focused modules (see Project Structure below) |
| `shared.css` | All shared styles |
| `github-sync.js` | OAuth flow, Gist CRUD, R2 image upload, GitHub API integration |
| `worker.js` | Cloudflare Worker for OAuth, image proxy, and R2 upload/serve |
| `index.html` | Landing page with dynamic checklist cards from gist registry |

### Security

- **OAuth proxy** - Client secret never exposed to browser
- **CORS restrictions** - Worker only accepts requests from allowed origins
- **CSRF protection** - State parameter validation on OAuth callback
- **XSS prevention** - All user content sanitized before rendering
- **URL validation** - Only allowed protocols and domains
- **Upload restrictions** - Image uploads restricted to production origin only

## Development

### Local Development
```bash
./serve.sh
# or
python3 -m http.server 8000
```

Then open http://localhost:8000

Note: Auth and gist data require the deployed domain. Local dev is useful for CSS/layout work only.

### Building
```bash
npm run build   # concatenate + minify JS/CSS into dist/
```

The build step concatenates the shared JS modules into `dist/app.min.js`, minifies `checklist-engine.js` into `dist/checklist-engine.min.js`, and minifies `shared.css` into `dist/shared.min.css`. HTML files reference the dist versions.

### Running Tests
```bash
npm test        # run once
npm run test:watch  # watch mode
```

Tests use vitest with jsdom and cover sanitization, card rendering, and search term generation.

### Preview Deployments

Cloudflare Pages builds preview deployments for each branch:
- Preview URLs: `<branch>.sports-card-checklists.pages.dev` (slashes become dashes, truncated to 28 chars)
- Isolated data storage with separate preview gist
- **Sync from Production** button to pull latest data into preview
- Separate OAuth app for preview sites

### Adding New Checklists

Checklists are config-driven and stored entirely in the GitHub Gist:

1. Log in on the live site
2. Use the "Create Checklist" button to configure title, theme, sections, sort options, and custom fields
3. Add cards through the inline card editor (saved to `{id}-cards.json`)
4. The checklist automatically appears on the index page via `checklists-registry.json`

No code changes needed to add a new checklist.

### Project Structure
```
├── index.html               # Landing page (loads checklists from gist registry)
├── checklist.html           # Config-driven checklist page (?id=xxx)
├── shared.css               # All shared styles
├── src/                     # JavaScript source modules
│   ├── github-sync.js       #   OAuth + Gist + R2 storage
│   ├── shared.js            #   Shared utilities (sanitize, filter, stats animation)
│   ├── card-renderer.js     #   Card HTML rendering and badge generation
│   ├── card-editor.js       #   CardEditorModal with schema-driven custom fields
│   ├── checklist-manager.js #   Ownership tracking, save/load, sync status
│   ├── checklist-creator.js #   Checklist creation/settings modal
│   ├── collapsible-sections.js # Expandable section headers
│   ├── image-editor.js      #   Image crop/rotate, perspective correction, upload
│   ├── shopping-list.js     #   Shopping List PDF export
│   ├── nav.js               #   Dynamic navigation, auth UI, dropdown menus
│   └── checklist-engine.js  #   Checklist engine (loads config from gist)
├── dist/                    # Built output (app.min.js, checklist-engine.min.js, shared.min.css)
├── tests/                   # Unit tests (vitest)
├── build.js                 # esbuild bundler (concatenates + minifies JS/CSS)
├── worker.js                # Cloudflare Worker (deploy separately via GitHub Actions)
├── wrangler.toml            # Cloudflare Worker config (R2 binding)
└── scripts/                 # Maintenance/migration scripts (gitignored)
```

## Tech Stack

- **Frontend**: Vanilla JavaScript (no frameworks), [Cropper.js](https://fengyuanchen.github.io/cropperjs/) for image editing, [SortableJS](https://sortablejs.github.io/Sortable/) for drag-and-drop
- **Hosting**: GitHub Pages (production), Cloudflare Pages (preview)
- **Auth**: GitHub OAuth via Cloudflare Workers (separate apps for production and preview)
- **Storage**: GitHub Gists (JSON config + card data)
- **Images**: Cloudflare R2, WebP format, processed client-side
- **Testing**: Vitest with jsdom
- **Build**: esbuild for JS/CSS concatenation and minification
- **CI/CD**: GitHub Actions for Worker deployment and version stamping

## License

MIT
