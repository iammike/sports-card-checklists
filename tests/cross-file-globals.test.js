import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';

// build.js concatenates src/*.js into one script, so a top-level `const` there is
// a global lexical binding that every other file can see. tests/setup.js instead
// loads each file with its own `(0, eval)(code)`, and a `const` inside an eval is
// a binding in *that eval's* scope - invisible to the next one. So a cross-file
// `const` reference that works in the browser throws ReferenceError under test,
// from inside whatever handler happened to touch it (#704).
//
// The eight symbols that already crossed files were written `window.X = X`, which
// makes them ordinary global properties and works under both loaders. This guards
// the ninth: it fails when a new top-level `const`/`let` is read from another file
// without that export, instead of leaving it to be found as a confusing
// ReferenceError later.
//
// Note this asserts the symbol *resolves as a global*, not that a `window.X =`
// line exists in the source - any mechanism that makes it reachable is fine.

const SRC = resolve(import.meta.dirname, '..', 'src');

// A `/` opens a regex literal only where a value could not already have ended;
// after an identifier, a number, `)` or `]` it is division. '' is start-of-file.
const REGEX_PRECEDERS = new Set(
    ['', '(', '[', '{', ',', ';', ':', '=', '!', '&', '|', '?', '+', '-', '*', '%', '~', '^', '<', '>'],
);
const KEYWORD_BEFORE_REGEX = /(?:^|[^\w$])(?:return|typeof|case|in|of|new|delete|void|instanceof)\s*$/;

// Blanks out comments, string bodies, template text and regex literals so that a
// name appearing only in prose or in a quoted string is not counted as a
// reference. Template *interpolations* are kept, because `${CardRenderer.x()}` is
// real code. Newlines are preserved so line numbers stay meaningful.
//
// A hand-rolled scanner rather than a parser (there is no parser dependency here).
// The risk is desynchronising - the `"` inside `.replace(/"/g, ...)` read as a
// string start swallows the rest of the file, which is why regex literals are
// handled at all. That silently drops references and would make this guard quietly
// stop guarding, so the last test below checks for the leftover quote characters a
// desync leaves behind.
function stripNonCode(code) {
    let out = '';
    let prev = '';                  // last significant character kept
    let i = 0;
    const interpolations = [];      // brace depth inside each active `${...}`

    const keep = (ch) => { out += ch; if (!/\s/.test(ch)) prev = ch; };
    const blank = (ch) => { out += ch === '\n' ? '\n' : ' '; };
    const regexAllowed = () => REGEX_PRECEDERS.has(prev) || KEYWORD_BEFORE_REGEX.test(out.slice(-12));

    // Blanks template text up to the next `${`, or to the closing backtick.
    const skipTemplateText = () => {
        while (i < code.length) {
            if (code[i] === '\\') { blank(code[i]); blank(code[i + 1] || ''); i += 2; continue; }
            if (code[i] === '`') { blank(code[i]); i++; return; }
            if (code[i] === '$' && code[i + 1] === '{') {
                blank('$'); blank('{'); i += 2;
                interpolations.push(0);
                return;
            }
            blank(code[i]); i++;
        }
    };

    while (i < code.length) {
        const c = code[i];
        const n = code[i + 1];

        if (c === '/' && n === '/') {
            while (i < code.length && code[i] !== '\n') { blank(code[i]); i++; }
            continue;
        }
        if (c === '/' && n === '*') {
            blank(c); blank(n); i += 2;
            while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) { blank(code[i]); i++; }
            blank('*'); blank('/'); i += 2;
            continue;
        }
        if (c === '"' || c === "'") {
            blank(c); i++;
            while (i < code.length) {
                if (code[i] === '\\') { blank(code[i]); blank(code[i + 1] || ''); i += 2; continue; }
                const done = code[i] === c;
                blank(code[i]); i++;
                if (done) break;
            }
            continue;
        }
        if (c === '`') {
            blank(c); i++;
            skipTemplateText();
            continue;
        }
        if (c === '/' && regexAllowed()) {
            let inClass = false;
            blank(c); i++;
            while (i < code.length) {
                const r = code[i];
                if (r === '\\') { blank(r); blank(code[i + 1] || ''); i += 2; continue; }
                if (r === '\n') break;
                if (r === '[') inClass = true;
                else if (r === ']') inClass = false;
                else if (r === '/' && !inClass) { blank(r); i++; break; }
                blank(r); i++;
            }
            while (i < code.length && /[a-z]/.test(code[i])) { blank(code[i]); i++; }
            continue;
        }
        if (interpolations.length) {
            const depth = interpolations.length - 1;
            if (c === '{') {
                interpolations[depth]++;
            } else if (c === '}') {
                if (interpolations[depth] === 0) {
                    interpolations.pop();
                    blank(c); i++;
                    skipTemplateText();
                    continue;
                }
                interpolations[depth]--;
            }
        }
        keep(c); i++;
    }
    return out;
}

const files = readdirSync(SRC).filter(f => f.endsWith('.js')).sort();
const sources = new Map(
    files.map(f => [f, stripNonCode(readFileSync(resolve(SRC, f), 'utf-8'))]),
);

// Column-0 `const`/`let`, which is how every top-level declaration in src/ is
// written; anything indented is inside a function or block and cannot cross files.
function topLevelDeclarations() {
    const declared = new Map();
    for (const [file, code] of sources) {
        for (const m of code.matchAll(/^(?:const|let)\s+([A-Za-z_$][\w$]*)/gm)) {
            declared.set(m[1], file);
        }
    }
    return declared;
}

function crossFileSymbols() {
    return [...topLevelDeclarations()]
        .map(([name, declaredIn]) => {
            // Not preceded by `.` or a word character: skips `window.CardRenderer`
            // and any longer identifier that merely contains the name.
            const ref = new RegExp(`(?<![.\\w$])${name}\\b`);
            const readers = files.filter(f => f !== declaredIn && ref.test(sources.get(f)));
            return { name, declaredIn, readers };
        })
        .filter(s => s.readers.length > 0);
}

describe('cross-file top-level const/let must be reachable as globals', () => {
    // The nine that cross files today. Pinned by name rather than as an exact
    // count: this still fails if the scanner stops finding references (a count of
    // zero, or a desync that drops one), which is the vacuity this has to rule out
    // - see external-link-rel.test.js - but a tenth symbol that is exported
    // properly does not have to touch this list. A tenth that is *not* exported
    // fails the resolution test below, which is the point.
    const KNOWN_CROSS_FILE = [
        'AuthUI',
        'CARD_TYPES',
        'CardRenderer',
        'CollapsibleSections',
        'DynamicNav',
        'R2_IMAGE_BASE',
        'ShoppingList',
        'StatsAnimator',
        'imageEditor',
    ];

    it('finds the src/ top-level declarations at all', () => {
        expect(files.length).toBeGreaterThanOrEqual(11);
        expect(topLevelDeclarations().size).toBeGreaterThanOrEqual(19);
    });

    it('finds every symbol known to be read from another file', () => {
        const found = crossFileSymbols().map(s => s.name).sort();
        expect(found).toEqual(expect.arrayContaining(KNOWN_CROSS_FILE));
        expect(found.length).toBeGreaterThanOrEqual(KNOWN_CROSS_FILE.length);
    });

    it('resolves each of them as a global', () => {
        const unreachable = crossFileSymbols().filter(({ name }) => {
            try {
                // Indirect eval, the same resolution path setup.js gives each
                // source file: a bare identifier that only exists as another
                // eval's lexical binding throws here.
                return typeof (0, eval)(name) === 'undefined';
            } catch {
                return true;
            }
        });

        expect(
            unreachable.map(s => `${s.name} (src/${s.declaredIn}, read by ${s.readers.join(', ')})`),
        ).toEqual([]);
    });

    it('leaves no stray quotes behind, which would mean the scanner desynced', () => {
        const desynced = files.filter(f => /['"`]/.test(sources.get(f)));
        expect(desynced).toEqual([]);
    });
});
