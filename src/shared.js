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
