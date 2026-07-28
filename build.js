const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

// Which files go into which bundle, shared with tests/setup.js so the test run
// loads exactly what the browser gets. See build-manifest.js.
const { sharedFiles, engineFile } = require('./build-manifest');

const srcDir = path.join(__dirname, 'src');

async function build() {
  const distDir = path.join(__dirname, 'dist');
  if (!fs.existsSync(distDir)) fs.mkdirSync(distDir);

  // Concatenate shared JS files
  const combined = sharedFiles
    .map(f => fs.readFileSync(path.join(srcDir, f), 'utf8'))
    .join('\n');

  // Minify concatenated JS -> dist/app.min.js
  const appResult = await esbuild.transform(combined, {
    minify: true,
    target: 'es2020',
  });
  fs.writeFileSync(path.join(distDir, 'app.min.js'), appResult.code);

  // Minify checklist-engine.js -> dist/checklist-engine.min.js
  const engineSrc = fs.readFileSync(path.join(srcDir, engineFile), 'utf8');
  const engineResult = await esbuild.transform(engineSrc, {
    minify: true,
    target: 'es2020',
  });
  fs.writeFileSync(path.join(distDir, 'checklist-engine.min.js'), engineResult.code);

  // Minify shared.css -> dist/shared.min.css
  const cssSrc = fs.readFileSync(path.join(__dirname, 'shared.css'), 'utf8');
  const cssResult = await esbuild.transform(cssSrc, {
    minify: true,
    loader: 'css',
  });
  fs.writeFileSync(path.join(distDir, 'shared.min.css'), cssResult.code);

  // Report sizes
  const appSize = Buffer.byteLength(appResult.code);
  const engineSize = Buffer.byteLength(engineResult.code);
  const cssSize = Buffer.byteLength(cssResult.code);
  console.log(`dist/app.min.js          ${(appSize / 1024).toFixed(1)} KB`);
  console.log(`dist/checklist-engine.min.js  ${(engineSize / 1024).toFixed(1)} KB`);
  console.log(`dist/shared.min.css      ${(cssSize / 1024).toFixed(1)} KB`);
}

build().catch(err => {
  console.error(err);
  process.exit(1);
});
