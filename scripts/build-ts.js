// scripts/build-ts.js — Compile renderer TypeScript sources to JavaScript
const { build } = require('esbuild');
const path = require('path');
const fs = require('fs');

const srcDir = path.join(__dirname, '..', 'renderer', 'src');
const outDir = path.join(__dirname, '..', 'renderer', 'js');

// Collect all .ts files, excluding declaration files (.d.ts)
function collectTsFiles(dir) {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...collectTsFiles(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      result.push(full);
    }
  }
  return result;
}

const entryPoints = collectTsFiles(srcDir);

if (entryPoints.length === 0) {
  console.error('  ✗ No TypeScript source files found in renderer/src/');
  process.exit(1);
}

console.log(`  Compiling ${entryPoints.length} TypeScript files...`);

build({
  entryPoints,
  bundle: false,      // Transform only — preserve ES module imports as-is
  outdir: outDir,
  outbase: srcDir,    // Preserves directory structure: src/foo.ts → js/foo.js
  format: 'esm',
  platform: 'browser',
  target: 'es2020',
  sourcemap: true,
  minify: false,
}).then(() => {
  const rel = path.relative(process.cwd(), outDir);
  console.log(`  ✓ TypeScript compiled → ${rel}/`);
  console.log(`  ✓ ${entryPoints.length} files processed`);
}).catch((err) => {
  console.error('  ✗ TypeScript compilation failed:', err.message);
  process.exit(1);
});
