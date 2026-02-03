#!/usr/bin/env node
/**
 * Migration script to update owned card IDs from name-based to variant-based
 *
 * Usage: node scripts/migrate-owned-ids.js
 *
 * This script:
 * 1. Reads the backup gist data from /tmp/gist-owned-backup.json
 * 2. Loads the current seed data (which uses 'variant' instead of 'name')
 * 3. Decodes old IDs and matches them to cards in seed data
 * 4. Generates new IDs using the variant field
 * 5. Outputs the migrated data to /tmp/gist-owned-migrated.json
 */

const fs = require('fs');
const path = require('path');

// Load data
const backupPath = '/tmp/gist-owned-backup.json';
const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));

const seedDir = path.join(__dirname, '..', 'seed');
const jaydenData = JSON.parse(fs.readFileSync(path.join(seedDir, 'jayden-daniels.json'), 'utf8'));
const qbsData = JSON.parse(fs.readFileSync(path.join(seedDir, 'washington-qbs.json'), 'utf8'));
const jmuData = JSON.parse(fs.readFileSync(path.join(seedDir, 'jmu-pro-players.json'), 'utf8'));

// Helper to decode base64
function decodeId(id) {
    try {
        return Buffer.from(id, 'base64').toString('utf8');
    } catch {
        return null;
    }
}

// Helper to encode base64 (same as btoa in browser)
function encodeId(str) {
    return Buffer.from(str).toString('base64').replace(/[^a-zA-Z0-9]/g, '');
}

// Generate new ID for a card (matches the updated getCardId logic)
function getNewCardId(card, includePlayer = false) {
    if (card.id) return card.id;
    if (includePlayer && card.player) {
        const str = (card.player || '') + (card.set || '') + (card.num || '') + (card.variant || '');
        return encodeId(str);
    }
    const str = (card.set || '') + (card.num || '') + (card.variant || '');
    return encodeId(str);
}

// Flatten all cards from categories
function flattenCards(data, includePlayer = false) {
    const cards = [];
    if (data.categories) {
        for (const [category, categoryCards] of Object.entries(data.categories)) {
            for (const card of categoryCards) {
                cards.push({ ...card, category });
            }
        }
    }
    if (data.cards) {
        for (const card of data.cards) {
            cards.push(card);
        }
    }
    return cards;
}

// Find card by old ID pattern
function findCardByOldId(oldId, cards, includePlayer = false) {
    const decoded = decodeId(oldId);
    if (!decoded) return null;

    // Try to match by constructing similar patterns
    for (const card of cards) {
        // Old pattern: set + num + name (or player + set + num + name for JMU)
        let oldPattern;
        if (includePlayer && card.player) {
            oldPattern = (card.player || '') + (card.set || '') + (card.num || '') + (card.variant || '');
        } else {
            oldPattern = (card.set || '') + (card.num || '') + (card.variant || '');
        }

        // Check if decoded starts with the pattern (handles truncation)
        if (decoded.startsWith(oldPattern.substring(0, decoded.length)) ||
            oldPattern.startsWith(decoded)) {
            return card;
        }
    }

    // Fuzzy match - try matching set + num
    for (const card of cards) {
        const setNum = (card.set || '') + (card.num || '');
        if (decoded.includes(setNum) || setNum.includes(decoded.split('#')[0])) {
            return card;
        }
    }

    return null;
}

// Migrate owned cards for a checklist
function migrateChecklist(checklistId, oldIds, cards, includePlayer = false) {
    const newIds = [];
    const migrations = [];
    const unmapped = [];

    for (const oldId of oldIds) {
        // Skip non-base64 IDs (like plain player names in QBs)
        const decoded = decodeId(oldId);
        if (!decoded || decoded.length < 10) {
            console.log(`  Skipping invalid/short ID: ${oldId}`);
            unmapped.push({ oldId, reason: 'invalid or too short' });
            continue;
        }

        const card = findCardByOldId(oldId, cards, includePlayer);
        if (card) {
            const newId = getNewCardId(card, includePlayer);
            newIds.push(newId);
            migrations.push({
                oldId,
                decoded,
                newId,
                card: { set: card.set, num: card.num, variant: card.variant, player: card.player }
            });
        } else {
            unmapped.push({ oldId, decoded, reason: 'no match found' });
        }
    }

    return { newIds, migrations, unmapped };
}

// Main migration
console.log('=== Owned Cards ID Migration ===\n');

const migrated = {
    checklists: {},
    lastUpdated: new Date().toISOString(),
    stats: backup.stats
};

// Migrate Jayden Daniels
console.log('Migrating jayden-daniels...');
const jdCards = flattenCards(jaydenData);
const jdResult = migrateChecklist('jayden-daniels', backup.checklists['jayden-daniels'] || [], jdCards, false);
migrated.checklists['jayden-daniels'] = jdResult.newIds;
console.log(`  Migrated: ${jdResult.migrations.length}, Unmapped: ${jdResult.unmapped.length}`);
if (jdResult.unmapped.length > 0) {
    console.log('  Unmapped:', jdResult.unmapped.map(u => u.decoded || u.oldId));
}

// Migrate Washington QBs (uses player in ID)
console.log('\nMigrating washington-qbs...');
const qbCards = flattenCards(qbsData);
// QBs don't use variant/name in IDs - they use player + set + num
const qbResult = migrateChecklist('washington-qbs', backup.checklists['washington-qbs'] || [], qbCards, false);
// For QBs, the ID is player + set + num (no variant)
const qbNewIds = [];
const qbMigrations = [];
const qbUnmapped = [];
for (const oldId of backup.checklists['washington-qbs'] || []) {
    const decoded = decodeId(oldId);
    if (!decoded || decoded.length < 10) {
        qbUnmapped.push({ oldId, reason: 'invalid or too short (likely old player-name-only format)' });
        continue;
    }

    // Find matching QB card
    let found = null;
    for (const card of qbCards) {
        // QBs pattern: player + set + num (no name/variant)
        const pattern = (card.player || '') + (card.set || '') + (card.num || '');
        if (decoded.startsWith(pattern.substring(0, Math.min(pattern.length, decoded.length)))) {
            found = card;
            break;
        }
    }

    if (found) {
        // QBs use player + set + num for ID (no variant)
        const newId = encodeId((found.player || '') + (found.set || '') + (found.num || ''));
        qbNewIds.push(newId);
        qbMigrations.push({ oldId, decoded, newId, card: found });
    } else {
        qbUnmapped.push({ oldId, decoded, reason: 'no match' });
    }
}
migrated.checklists['washington-qbs'] = qbNewIds;
console.log(`  Migrated: ${qbMigrations.length}, Unmapped: ${qbUnmapped.length}`);
if (qbUnmapped.length > 0) {
    console.log('  Unmapped:', qbUnmapped.map(u => u.decoded || u.oldId));
}

// Migrate JMU (uses player in ID)
console.log('\nMigrating jmu-pro-players...');
const jmuCards = flattenCards(jmuData);
const jmuResult = migrateChecklist('jmu-pro-players', backup.checklists['jmu-pro-players'] || [], jmuCards, true);
migrated.checklists['jmu-pro-players'] = jmuResult.newIds;
console.log(`  Migrated: ${jmuResult.migrations.length}, Unmapped: ${jmuResult.unmapped.length}`);
if (jmuResult.unmapped.length > 0) {
    console.log('  Unmapped:', jmuResult.unmapped.map(u => u.decoded || u.oldId));
}

// Copy any other data (like stats)
if (backup['jayden-daniels-base-stats']) {
    migrated['jayden-daniels-base-stats'] = backup['jayden-daniels-base-stats'];
}

// Write output
const outputPath = '/tmp/gist-owned-migrated.json';
fs.writeFileSync(outputPath, JSON.stringify(migrated, null, 2));
console.log(`\n=== Migration complete ===`);
console.log(`Output written to: ${outputPath}`);

// Also output detailed migration log
const logPath = '/tmp/migration-log.json';
fs.writeFileSync(logPath, JSON.stringify({
    'jayden-daniels': { migrations: jdResult.migrations, unmapped: jdResult.unmapped },
    'washington-qbs': { migrations: qbMigrations, unmapped: qbUnmapped },
    'jmu-pro-players': { migrations: jmuResult.migrations, unmapped: jmuResult.unmapped }
}, null, 2));
console.log(`Detailed log written to: ${logPath}`);
