// Sports Card Checklists - Shared JavaScript Utilities

// R2 image storage base URL
const R2_IMAGE_BASE = 'https://cards-oauth.iammikec.workers.dev/images/';

// Extract R2 key from a full R2 URL (e.g. "images/jayden/2025_base_1.webp")
function r2KeyFromUrl(url) {
    if (!url || !url.startsWith(R2_IMAGE_BASE)) return null;
    return url.slice(R2_IMAGE_BASE.length - 'images/'.length);
}

// Standard card types used across all checklists
const CARD_TYPES = ['Base', 'Insert', 'Chase'];

// Normalize smart/curly quotes to ASCII (iOS keyboards produce these)
function normalizeQuotes(text) {
    if (!text) return text;
    return text
        .replace(/[\u2018\u2019\u201A]/g, "'")   // smart single quotes
        .replace(/[\u201C\u201D\u201E]/g, '"');   // smart double quotes
}

// Build a stable, human-traceable id for a no-card entry: an "nc" prefix plus
// the alphanumerics of the entry's name (falling back to a generic label when
// there's no name to draw from), with a numeric suffix added only to break a
// collision with an id already in use. Deterministic and idempotent - the same
// source and taken set always produce the same id, so a re-derived id (e.g. on
// page reload, before the first save persists it) matches what was there
// before. Shared by the editor (on save) and the engine (backfilling entries
// added by hand-editing the gist).
function buildNoCardId(source, takenIds) {
    const cleaned = String(source || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 40);
    const base = 'nc' + (cleaned || 'Entry');

    const taken = new Set(takenIds || []);
    let id = base;
    for (let n = 2; taken.has(id); n++) id = base + n;
    return id;
}

// Sanitization helpers for XSS prevention
function sanitizeText(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}

function sanitizeUrl(url) {
    if (!url) return '';
    try {
        const parsed = new URL(url);
        return ['http:', 'https:'].includes(parsed.protocol) ? url : '';
    } catch {
        return '';
    }
}

// Export for use in pages
window.CARD_TYPES = CARD_TYPES;
