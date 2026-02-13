# Sports Card Checklists

A modern web app for tracking sports card collections with cloud sync, real-time stats, and inline editing.

**Live site: [iammike.github.io/sports-card-checklists](https://iammike.github.io/sports-card-checklists/)**

![JavaScript](https://img.shields.io/badge/JavaScript-Vanilla-yellow) ![GitHub Pages](https://img.shields.io/badge/Hosted-GitHub%20Pages-blue) ![Cloudflare](https://img.shields.io/badge/Auth-Cloudflare%20Workers-orange)

## Features

### Collection Tracking
- **Checkbox-based ownership** - Mark cards as owned with a single click
- **Progress tracking** - See owned/total counts and completion percentage
- **Price estimates** - Automatic price estimation based on card type, set, and rarity
- **Value calculations** - Track total collection value and remaining cost to complete

### Cloud Sync
- **GitHub OAuth authentication** - Secure login via GitHub
- **Gist-based storage** - Collection data synced to public GitHub Gist
- **Cross-device sync** - Access your collection from any device
- **Public viewing** - Visitors can view your collection (read-only)
- **CSRF protection** - Secure OAuth flow with state parameter validation

### Filtering & Search
- **Status filter** - Show all, owned only, or needed cards
- **Text search** - Find cards by name, set, or any text

### Inline Editing (Owner Only)
- **Add new cards** - Add cards directly from the UI
- **Edit card details** - Right-click or long-press to edit any card
- **Delete cards** - Remove cards with confirmation
- **Schema-driven forms** - Custom fields per checklist type

### Image Tools (Owner Only)
- **Image editor** - Full-featured editor with crop, rotate, and flip tools (powered by Cropper.js)
- **Edit existing images** - Re-edit previously saved images with one click
- **Fine rotation** - Slider plus +/- buttons for precise straightening (0.5° increments)
- **Local file upload** - Upload images from your computer via button or drag & drop
- **Multiple sources** - Fetch images from eBay or Beckett listings
- **Auto-processing** - Images automatically resized and converted to WebP on save
- **Cloudflare R2 storage** - Images uploaded instantly, no git involvement

### UI/UX
- **Animated stats** - Numbers count up on first load
- **Collapsible sections** - Click section headers to expand/collapse
- **Auto-hiding sections** - Empty sections automatically hidden
- **Responsive design** - Works on desktop and mobile
- **Print-friendly** - Clean layout for printing checklists
- **Direct eBay links** - One-click search for any card
- **Price guide links** - Quick access to price lookups

## Checklists

- **[Jayden Daniels Rookie Cards](https://iammike.github.io/sports-card-checklists/checklist.html?id=jayden-daniels)** - College and NFL rookie cards
- **[Washington Commanders QBs](https://iammike.github.io/sports-card-checklists/washington-qbs-rookie-checklist.html)** - Rookie cards of Washington starting QBs (1970-present)
- **[JMU Pro Players](https://iammike.github.io/sports-card-checklists/checklist.html?id=jmu-pro-players)** - Cards of JMU alumni who played professionally

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   GitHub Pages  │────▶│   Static HTML    │────▶│   Browser JS    │
│   (Hosting)     │     │   + CSS + JS     │     │   (Vanilla)     │
└─────────────────┘     └──────────────────┘     └────────┬────────┘
                                                          │
                        ┌─────────────────────────────────┼─────────────────────────────────┐
                        │                                 │                                 │
                        ▼                                 ▼                                 ▼
              ┌─────────────────┐              ┌─────────────────┐              ┌─────────────────┐
              │ Cloudflare      │              │ Cloudflare R2   │              │ GitHub Gist     │
              │ Workers (OAuth  │              │ (Image storage) │              │ (Collection     │
              │  + image proxy) │              └─────────────────┘              │  storage)       │
              └─────────────────┘                                               └─────────────────┘
```

### Key Components

| File | Purpose |
|------|---------|
| `github-sync.js` | OAuth flow, Gist CRUD, GitHub API integration |
| `shared.js` | Reusable utilities (ChecklistManager, CardRenderer, PriceUtils, etc.) |
| `worker.js` | Cloudflare Worker for OAuth, image proxy, and R2 image upload/serve |
| `*-checklist.html` | Individual checklist pages with card data |

### Security Features

- **OAuth proxy** - Client secret never exposed to browser
- **CORS restrictions** - Worker only accepts requests from allowed origins
- **CSRF protection** - State parameter validation on OAuth callback
- **XSS prevention** - All user content sanitized before rendering
- **URL validation** - Only allowed protocols and domains

## Development

### Local Development
```bash
./serve.sh
# or
python3 -m http.server 8000
```

Then open http://localhost:8000

### Preview Deployments

Cloudflare Pages preview deployments allow testing changes without affecting production:
- Branch previews at `<branch>.sports-card-checklists.pages.dev`
- Isolated data storage (changes don't affect production)
- Image uploads work on preview sites (stored in R2, shared with production)

### Project Structure
```
├── index.html                    # Landing page with all checklists
├── *-checklist.html              # Individual checklist pages
├── images/                       # Legacy card images (migrated to R2)
├── github-sync.js                # OAuth + Gist storage
├── shared.js                     # Shared utilities and components
├── shared.css                    # Shared styles
├── worker.js                     # Cloudflare Worker (deploy separately)
├── wrangler.toml                 # Cloudflare Worker config (R2 binding)
└── serve.sh                      # Local server script
```

### Adding New Checklists

1. Create a new HTML file based on an existing checklist
2. Create a corresponding images folder
3. Update the card data in the JavaScript section
4. Add the checklist to `index.html`
5. Configure ChecklistManager with appropriate checklistId

## Tech Stack

- **Frontend**: Vanilla JavaScript (no frameworks)
- **Hosting**: GitHub Pages (production), Cloudflare Pages (preview)
- **Auth**: GitHub OAuth via Cloudflare Workers
- **Storage**: GitHub Gists (JSON)
- **Images**: Cloudflare R2, WebP format, processed client-side
- **CI/CD**: GitHub Actions for Worker deploys

## License

MIT
