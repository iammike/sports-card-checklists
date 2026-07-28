// Shared DOM assertions for the inline-handler guards in
// tests/attribute-escaping.test.js and tests/image-preview.test.js.
//
// Not named *.test.js, so vitest's default include does not collect it as a suite.
// The guard's own self-tests live in tests/image-preview.test.js, under "the
// inline-handler guard itself detects a handler" - run them after changing
// anything here, since a guard that silently stops flagging reports success on
// every file that uses it.
//
// One copy rather than one per file on purpose. This was two near-identical
// copies, and both had the same bug: neither included the root element, so a
// handler on a rendered root passed the whole suite. Fixing one and leaving the
// other is how the pair drifted apart to begin with.

// Every element in a subtree, the root included. querySelectorAll('*') leaves the
// root out, and the roots these guards are handed are themselves rendered markup -
// a rendered .card, the card editor's backdrop, the context-menu container - so a
// handler landing on one of those would be invisible to a guard whose entire job
// is to see it.
export function walk(root) {
    return [root, ...root.querySelectorAll('*')];
}

// Every on* attribute on every walked element.
//
// Asserting parsed attribute names rather than grepping innerHTML matters twice
// over. A hostile value survives verbatim inside an attribute value, so the
// serialised markup legitimately contains the text " onerror=alert(1)" when
// nothing was injected - #692 tried the regex approach and it failed 13 tests
// against correct code. And source text can hide a real handler: a quote-anchored
// regex misses `onerror=${`alert(1)`}` in a template literal (#699). Only the
// parsed DOM tells an attribute from a string that looks like one, in either
// direction.
//
// Handlers assigned as properties (dropzone.ondrop = fn, btn.onclick = fn) set no
// attribute and are deliberately not covered: they take a function rather than a
// string, so no card or config value can be executed through one.
export function inlineHandlers(root) {
    return walk(root)
        .flatMap(el => el.getAttributeNames())
        .filter(name => name.startsWith('on'));
}
