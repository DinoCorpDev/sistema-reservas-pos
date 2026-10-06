import { defineConfig } from 'tsup';

/**
 * A single file to install on the location's mini-PC or tablet. The @pos/* packages (TypeScript
 * source) are bundled; the other dependencies are resolved from the hub's node_modules.
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: [/^@pos\//],
});
