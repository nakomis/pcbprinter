/**
 * Node.js standalone bundle build script.
 *
 * Builds a CJS bundle for use with pkg or direct Node.js execution.
 * Fixes the import.meta.url issue by post-processing esbuild's CJS output:
 * esbuild emits `var import_meta = {}` — we patch it to include the
 * correct file URL so manifold-3d can resolve manifold.wasm at runtime.
 */
import esbuild from 'esbuild';
import { copyFileSync, readFileSync, writeFileSync } from 'fs';

await esbuild.build({
  entryPoints: ['src/cli.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  outfile: 'dist/cli.bundled.cjs',
  logLevel: 'info',
});

// Post-process: patch import_meta.url so manifold-3d WASM loading works.
// esbuild emits `var import_meta = {};` — replace with a proper URL.
let code = readFileSync('dist/cli.bundled.cjs', 'utf8');
const patched = code.replace(
  'var import_meta = {};',
  'var import_meta = { url: require("url").pathToFileURL(__filename).href };',
);
if (patched === code) {
  console.warn('Warning: Could not patch import_meta — manifold.wasm loading may fail.');
} else {
  writeFileSync('dist/cli.bundled.cjs', patched);
  console.log('Patched import_meta.url in dist/cli.bundled.cjs');
}

// Copy manifold.wasm alongside the bundle
copyFileSync('node_modules/manifold-3d/manifold.wasm', 'dist/manifold.wasm');
console.log('Copied manifold.wasm → dist/manifold.wasm');
