// Which src/ files go into which bundle.
//
// This lives on its own, with no dependencies, because two very different
// consumers need it: build.js (which pulls in esbuild) and tests/setup.js
// (which runs inside jsdom, where esbuild refuses to load). Keeping the lists
// here means the browser and the test run cannot load different files.

// Concatenated in this order into dist/app.min.js. Order matters: they are
// plain globals, not modules, and github-sync.js reads window.location at load.
const sharedFiles = [
  'github-sync.js',
  'shared.js',
  'collapsible-sections.js',
  'card-renderer.js',
  'checklist-manager.js',
  'image-editor.js',
  'card-editor.js',
  'shopping-list.js',
  'nav.js',
  'checklist-creator.js',
];

// Built separately into dist/checklist-engine.min.js. checklist.html loads it as
// its own script, so at runtime it shares no scope with the concatenation above.
const engineFile = 'checklist-engine.js';

module.exports = { sharedFiles, engineFile };
