# Sports Card Checklists

Interactive HTML checklists for tracking sports card collections.

## Checklists

- **[Jayden Daniels Rookie Cards](jayden-daniels-rookie-checklist.html)** - 2023 College + 2024 NFL rookie cards

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
├── [player]-rookie-checklist.html    # Checklist page
├── [player]-cards/                   # Card images
│   └── *.webp
└── serve.sh                          # Local server script
```

## Adding New Checklists

1. Create a new HTML file based on an existing checklist
2. Create a corresponding images folder
3. Update the card data in the JavaScript section
