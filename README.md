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
- **Image processing** - Fetch eBay images, resize, convert to WebP, and commit via PR
- **Schema-driven forms** - Custom fields per checklist type

### UI/UX
- **Animated stats** - Numbers count up on first load
- **Responsive design** - Works on desktop and mobile
- **Print-friendly** - Clean layout for printing checklists
- **Direct eBay links** - One-click search for any card
- **Price guide links** - Quick access to SportsCardsPro pricing

## Checklists

- **[Jayden Daniels Rookie Cards](https://iammike.github.io/sports-card-checklists/jayden-daniels-rookie-checklist.html)** - 2023 College + 2024 NFL rookie cards
- **[Washington Commanders QBs](https://iammike.github.io/sports-card-checklists/washington-qbs-rookie-checklist.html)** - Rookie cards of Washington starting QBs (1970-present)
- **[JMU Pro Players](https://iammike.github.io/sports-card-checklists/jmu-pro-players-checklist.html)** - Cards of JMU alumni who played professionally

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
              │ Cloudflare      │              │ GitHub API      │              │ GitHub Gist     │
              │ Workers (OAuth) │              │ (Image commits) │              │ (Collection     │
              └─────────────────┘              └─────────────────┘              │  storage)       │
                                                                                └─────────────────┘
```

### Key Components

| File | Purpose |
|------|---------|
| `github-sync.js` | OAuth flow, Gist CRUD, GitHub API integration |
| `shared.js` | Reusable utilities (ChecklistManager, CardRenderer, PriceUtils, etc.) |
| `worker.js` | Cloudflare Worker for OAuth token exchange and image proxy |
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

### Project Structure
```
├── index.html                    # Landing page with all checklists
├── *-checklist.html              # Individual checklist pages
├── *-cards/                      # Card images (WebP format)
├── github-sync.js                # OAuth + Gist storage
├── shared.js                     # Shared utilities and components
├── shared.css                    # Shared styles
├── worker.js                     # Cloudflare Worker (deploy separately)
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
- **Images**: WebP format, processed client-side
- **CI/CD**: GitHub Actions for version.json updates

## License

MIT
