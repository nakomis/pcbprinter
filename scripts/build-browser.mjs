/**
 * Browser bundle build script.
 *
 * Uses an esbuild plugin to replace the Node.js `module` built-in (used only
 * in an `if (ENVIRONMENT_IS_NODE)` branch in manifold.js) with an empty stub,
 * so the browser bundle has no unresolvable Node-only imports.
 */
import esbuild from 'esbuild';
import { copyFileSync } from 'fs';

const nodeModuleStubPlugin = {
  name: 'node-module-stub',
  setup(build) {
    // Stub out Node.js built-ins that appear in manifold-3d's ENVIRONMENT_IS_NODE
    // branch. These are never executed in browser context.
    const nodeBuiltins = ['module', 'path', 'fs', 'url', 'crypto', 'os', 'stream', 'buffer'];
    for (const mod of nodeBuiltins) {
      build.onResolve({ filter: new RegExp(`^${mod}$`) }, () => ({
        path: mod,
        namespace: 'node-builtin-stub',
      }));
    }
    build.onLoad({ filter: /.*/, namespace: 'node-builtin-stub' }, ({ path }) => ({
      contents: `// Browser stub for Node.js built-in: ${path}\nexport default {};\nexport const createRequire = () => { throw new Error('Not in Node.js'); };`,
      loader: 'js',
    }));
  },
};

await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  loader: { '.wasm': 'dataurl' },
  outfile: 'dist/browser.js',
  plugins: [nodeModuleStubPlugin],
  logLevel: 'info',
});

// Also copy manifold.wasm alongside the bundle (webpack uses new URL() pattern)
copyFileSync('node_modules/manifold-3d/manifold.wasm', 'dist/manifold.wasm');
console.log('Copied manifold.wasm → dist/manifold.wasm');
