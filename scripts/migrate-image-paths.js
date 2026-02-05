#!/usr/bin/env node
/**
 * Migration script to update image paths in gist card data
 *
 * Transforms paths from old format to new format:
 * - jayden-daniels-cards/image.webp → images/jayden-daniels/image.webp
 * - washington-qbs-cards/image.webp → images/washington-qbs/image.webp
 * - jmu-cards/image.webp → images/jmu-pro-players/image.webp
 *
 * Usage: GITHUB_TOKEN=xxx node scripts/migrate-image-paths.js [--dry-run]
 */

const GIST_ID = '5f2b43f0588d72892273ae8f24f68c2d'; // Production gist

const PATH_MAPPINGS = {
    'jayden-daniels-cards/': 'images/jayden-daniels/',
    'washington-qbs-cards/': 'images/washington-qbs/',
    'jmu-cards/': 'images/jmu-pro-players/',
};

async function main() {
    const token = process.env.GITHUB_TOKEN;
    const dryRun = process.argv.includes('--dry-run');

    if (!token) {
        console.error('Error: GITHUB_TOKEN environment variable required');
        console.error('Usage: GITHUB_TOKEN=xxx node scripts/migrate-image-paths.js [--dry-run]');
        process.exit(1);
    }

    console.log(`Mode: ${dryRun ? 'DRY RUN (no changes will be saved)' : 'LIVE'}\n`);

    // Fetch gist
    console.log('Fetching gist data...');
    const response = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
        headers: { 'Authorization': `Bearer ${token}` },
    });

    if (!response.ok) {
        console.error(`Failed to fetch gist: ${response.status}`);
        process.exit(1);
    }

    const gist = await response.json();
    const updatedFiles = {};
    let totalChanges = 0;

    // Process each card data file
    for (const [filename, file] of Object.entries(gist.files)) {
        if (!filename.endsWith('-cards.json')) continue;

        console.log(`\nProcessing ${filename}...`);
        const data = JSON.parse(file.content);
        let fileChanges = 0;

        // Function to update img paths in a card
        function updateCard(card) {
            if (!card.img) return false;

            for (const [oldPrefix, newPrefix] of Object.entries(PATH_MAPPINGS)) {
                if (card.img.startsWith(oldPrefix)) {
                    const oldPath = card.img;
                    card.img = card.img.replace(oldPrefix, newPrefix);
                    console.log(`  ${oldPath} → ${card.img}`);
                    return true;
                }
            }
            return false;
        }

        // Handle different data structures
        if (data.categories && typeof data.categories === 'object') {
            // Jayden Daniels format: { categories: { panini: [...], topps: [...] } }
            for (const [category, cards] of Object.entries(data.categories)) {
                if (Array.isArray(cards)) {
                    for (const card of cards) {
                        if (updateCard(card)) fileChanges++;
                    }
                }
            }
        } else if (Array.isArray(data.cards)) {
            // Other formats: { cards: [...] }
            for (const card of data.cards) {
                if (updateCard(card)) fileChanges++;
            }
        } else if (Array.isArray(data)) {
            // Direct array format
            for (const card of data) {
                if (updateCard(card)) fileChanges++;
            }
        }

        if (fileChanges > 0) {
            console.log(`  → ${fileChanges} paths updated`);
            updatedFiles[filename] = { content: JSON.stringify(data, null, 2) };
            totalChanges += fileChanges;
        } else {
            console.log(`  → No changes needed`);
        }
    }

    console.log(`\n${'='.repeat(50)}`);
    console.log(`Total: ${totalChanges} image paths to update`);

    if (totalChanges === 0) {
        console.log('No changes needed. Exiting.');
        return;
    }

    if (dryRun) {
        console.log('\nDry run complete. Run without --dry-run to apply changes.');
        return;
    }

    // Save updates
    console.log('\nSaving changes to gist...');
    const updateResponse = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ files: updatedFiles }),
    });

    if (!updateResponse.ok) {
        console.error(`Failed to update gist: ${updateResponse.status}`);
        const error = await updateResponse.text();
        console.error(error);
        process.exit(1);
    }

    console.log('Done! Gist updated successfully.');
}

main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
