#!/usr/bin/env node
/**
 * CLI tool to add cards to a checklist via the GitHub Gist API
 *
 * Setup:
 *   1. Create a GitHub Personal Access Token with 'gist' scope
 *   2. Create .env file: GITHUB_TOKEN=your_token_here
 *
 * Usage:
 *   # Add single card
 *   node scripts/add-cards.js jayden-daniels panini \
 *     --set "2024 Spectra" --num "#115" --search "jayden+daniels+2024+spectra+115"
 *
 *   # Add from JSON file
 *   node scripts/add-cards.js jayden-daniels --file cards-to-add.json
 *
 *   # Dry run (preview without saving)
 *   node scripts/add-cards.js jayden-daniels panini --set "2024 Test" --num "#1" --dry-run
 */

const fs = require('fs');
const path = require('path');

// Load .env file if present
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    for (const line of envContent.split('\n')) {
        const [key, ...valueParts] = line.split('=');
        if (key && valueParts.length) {
            process.env[key.trim()] = valueParts.join('=').trim();
        }
    }
}

const GIST_ID = '5f2b43f0588d72892273ae8f24f68c2d';

const CHECKLIST_FILES = {
    'jayden-daniels': 'jayden-daniels-cards.json',
    'washington-qbs': 'washington-qbs-cards.json',
    'jmu-pro-players': 'jmu-pro-players-cards.json'
};

const VALID_CATEGORIES = ['college', 'panini', 'topps', 'other', 'inserts', 'premium'];

function printUsage() {
    console.log(`
Usage:
  node scripts/add-cards.js <checklist> <category> [options]
  node scripts/add-cards.js <checklist> --file <json-file>

Checklists: ${Object.keys(CHECKLIST_FILES).join(', ')}
Categories: ${VALID_CATEGORIES.join(', ')}

Options:
  --set <name>       Card set name (required)
  --num <number>     Card number (required)
  --search <terms>   eBay search terms (auto-generated if omitted)
  --variant <text>   Variant info (e.g., "/99", "Silver Prizm")
  --type <text>      Card type (e.g., "Insert", "RPA", "SSP")
  --price <number>   Price estimate
  --img <path>       Image path
  --file <json>      Add multiple cards from JSON file
  --dry-run          Preview changes without saving

Example JSON file format:
[
  { "category": "panini", "set": "2024 Spectra", "num": "#115" },
  { "category": "chase", "set": "2024 Flawless", "num": "#99", "type": "RPA" }
]
`);
}

function parseArgs(args) {
    const result = { cards: [], dryRun: false };
    let i = 0;

    // First arg is checklist
    if (!args[0] || args[0].startsWith('--')) {
        return { error: 'Missing checklist name' };
    }
    result.checklist = args[0];
    i++;

    // Check for --file mode
    if (args[i] === '--file') {
        if (!args[i + 1]) return { error: 'Missing file path' };
        result.file = args[i + 1];
        i += 2;
    } else if (args[i] && !args[i].startsWith('--')) {
        // Category specified - single card mode
        result.category = args[i];
        i++;
    }

    // Parse remaining options
    const card = {};
    while (i < args.length) {
        const arg = args[i];
        if (arg === '--dry-run') {
            result.dryRun = true;
            i++;
        } else if (arg.startsWith('--')) {
            const key = arg.slice(2);
            const value = args[i + 1];
            if (!value || value.startsWith('--')) {
                return { error: `Missing value for ${arg}` };
            }
            if (key === 'price') {
                card[key] = parseFloat(value);
            } else {
                card[key] = value;
            }
            i += 2;
        } else {
            return { error: `Unexpected argument: ${arg}` };
        }
    }

    // If single card mode, add it
    if (result.category && Object.keys(card).length > 0) {
        card.category = result.category;
        result.cards = [card];
    }

    return result;
}

function generateSearch(checklist, card) {
    const playerMap = {
        'jayden-daniels': 'jayden+daniels',
        'washington-qbs': '', // varies by card
        'jmu-pro-players': '' // varies by card
    };
    const player = playerMap[checklist] || '';
    const set = (card.set || '').toLowerCase().replace(/\s+/g, '+');
    const num = (card.num || '').replace('#', '');
    return [player, set, num].filter(Boolean).join('+');
}

async function fetchGist() {
    const response = await fetch(`https://api.github.com/gists/${GIST_ID}`);
    if (!response.ok) {
        throw new Error(`Failed to fetch gist: ${response.status}`);
    }
    return response.json();
}

async function updateGist(files, token) {
    const response = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'X-GitHub-Api-Version': '2022-11-28'
        },
        body: JSON.stringify({ files })
    });
    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to update gist: ${response.status} - ${error}`);
    }
    return response.json();
}

async function main() {
    const args = process.argv.slice(2);

    if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
        printUsage();
        process.exit(0);
    }

    const parsed = parseArgs(args);
    if (parsed.error) {
        console.error(`Error: ${parsed.error}`);
        printUsage();
        process.exit(1);
    }

    const { checklist, dryRun } = parsed;
    let cards = parsed.cards;

    // Validate checklist
    if (!CHECKLIST_FILES[checklist]) {
        console.error(`Unknown checklist: ${checklist}`);
        console.error(`Valid options: ${Object.keys(CHECKLIST_FILES).join(', ')}`);
        process.exit(1);
    }

    // Load cards from file if specified
    if (parsed.file) {
        try {
            const fileContent = fs.readFileSync(parsed.file, 'utf8');
            cards = JSON.parse(fileContent);
            if (!Array.isArray(cards)) {
                cards = [cards];
            }
        } catch (err) {
            console.error(`Failed to read file: ${err.message}`);
            process.exit(1);
        }
    }

    if (cards.length === 0) {
        console.error('No cards to add. Use --set and --num, or --file.');
        process.exit(1);
    }

    // Validate cards
    for (const card of cards) {
        if (!card.set || !card.num) {
            console.error('Each card must have "set" and "num" fields');
            process.exit(1);
        }
        if (!card.category) {
            console.error(`Card "${card.set} ${card.num}" missing category`);
            process.exit(1);
        }
        if (!VALID_CATEGORIES.includes(card.category)) {
            console.error(`Invalid category "${card.category}" for ${card.set} ${card.num}`);
            console.error(`Valid categories: ${VALID_CATEGORIES.join(', ')}`);
            process.exit(1);
        }
        // Auto-generate search if missing
        if (!card.search) {
            card.search = generateSearch(checklist, card);
        }
    }

    // Check for token (not needed for dry run)
    const token = process.env.GITHUB_TOKEN;
    if (!dryRun && !token) {
        console.error('GITHUB_TOKEN not set. Create a .env file with your token.');
        console.error('Or use --dry-run to preview changes.');
        process.exit(1);
    }

    // Fetch current gist data
    console.log(`Fetching ${checklist} data from gist...`);
    const gist = await fetchGist();
    const fileName = CHECKLIST_FILES[checklist];
    const fileData = gist.files[fileName];

    if (!fileData) {
        console.error(`File ${fileName} not found in gist`);
        process.exit(1);
    }

    const checklistData = JSON.parse(fileData.content);

    // Add cards to appropriate categories
    for (const card of cards) {
        const category = card.category;
        delete card.category; // Don't store category in the card object

        if (!checklistData.categories[category]) {
            checklistData.categories[category] = [];
        }

        // Check for duplicates
        const existing = checklistData.categories[category].find(
            c => c.set === card.set && c.num === card.num
        );
        if (existing) {
            console.log(`  Skipping duplicate: ${card.set} ${card.num}`);
            continue;
        }

        checklistData.categories[category].push(card);
        // Sort by set name alphabetically
        checklistData.categories[category].sort((a, b) => a.set.localeCompare(b.set));
        console.log(`  Added: ${card.set} ${card.num} -> ${category}`);
    }

    if (dryRun) {
        console.log('\n[DRY RUN] Would update gist with:');
        console.log(JSON.stringify(checklistData, null, 2));
        return;
    }

    // Update gist
    console.log('\nUpdating gist...');
    await updateGist({
        [fileName]: {
            content: JSON.stringify(checklistData, null, 2)
        }
    }, token);

    console.log('Done!');
}

main().catch(err => {
    console.error(err.message);
    process.exit(1);
});
