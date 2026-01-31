# Sports Card Checklists

Interactive HTML checklists for tracking sports card collections.

**Live site: [iammike.github.io/sports-card-checklists](https://iammike.github.io/sports-card-checklists/)**

## Checklists

- **[Jayden Daniels Rookie Cards](jayden-daniels-rookie-checklist.html)** - 2023 College + 2024 NFL rookie cards
- **[Washington Commanders QBs](washington-qbs-checklist.html)** - Rookie cards of Washington starting QBs (1970-present)
- **[JMU Pro Players](jmu-pro-players-checklist.html)** - Cards of JMU alumni who played professionally

## Usage

Start a local server to view the checklists with images:

```bash
./serve.sh
```

Then open http://localhost:8000 in your browser.

Alternatively:
```bash
python3 -m http.server 8000
```

## Features

- Track owned cards with checkboxes (saved to localStorage)
- Filter by price range, card type, and owned status
- Direct links to eBay searches and price guides
- Export/import owned cards as JSON
- Print-friendly layout

## Structure

```
├── index.html                    # Landing page with all checklists
├── *-checklist.html              # Individual checklist pages
├── *-cards/                      # Card images for each checklist
│   └── *.webp
└── serve.sh                      # Local server script
```

## Adding New Checklists

1. Create a new HTML file based on an existing checklist
2. Create a corresponding images folder
3. Update the card data in the JavaScript section
4. Add the checklist to `index.html`
