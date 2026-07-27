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

// Build a stable, human-traceable id for a no-card entry: an "nc" prefix, the
// alphanumerics of the entry's name, and a suffix that keeps entries sharing a
// name - or having no name at all - distinct. Shared by the editor (on save)
// and the engine (backfilling entries added by hand-editing the gist).
function buildNoCardId(source, takenIds) {
    const base = 'nc' + String(source || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 40);
    const suffix = Date.now().toString(36);

    const taken = new Set(takenIds || []);
    let id = base + suffix;
    for (let n = 2; taken.has(id); n++) id = base + suffix + n;
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
