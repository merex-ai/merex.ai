// scripts/bundle-deps.js — Bundle browser dependencies for Mere Code
const { build } = require('esbuild');
const fs = require('fs');
const path = require('path');

const vendorDir = path.join(__dirname, '..', 'renderer', 'vendor');

if (!fs.existsSync(vendorDir)) {
  fs.mkdirSync(vendorDir, { recursive: true });
}

// Bundle xterm + addons into a single browser-friendly file
build({
  stdin: {
    contents: `
      export { Terminal } from '@xterm/xterm';
      export { FitAddon } from '@xterm/addon-fit';
      export { WebLinksAddon } from '@xterm/addon-web-links';
    `,
    resolveDir: path.join(__dirname, '..'),
    loader: 'js',
  },
  bundle: true,
  outfile: path.join(vendorDir, 'xterm.bundle.js'),
  format: 'iife',
  globalName: 'XtermBundle',
  platform: 'browser',
  minify: false,
}).then(() => {
  console.log('  ✓ xterm bundled');
}).catch((err) => {
  console.error('  ✗ xterm bundle failed:', err.message);
  process.exit(1);
});

// Copy xterm CSS
const cssPaths = [
  path.join(__dirname, '..', 'node_modules', '@xterm', 'xterm', 'css', 'xterm.css'),
  path.join(__dirname, '..', 'node_modules', 'xterm', 'css', 'xterm.css'),
];
for (const cssSource of cssPaths) {
  if (fs.existsSync(cssSource)) {
    fs.copyFileSync(cssSource, path.join(vendorDir, 'xterm.css'));
    console.log('  ✓ xterm CSS copied');
    break;
  }
}

console.log('  Mere Code dependencies bundled successfully.');
