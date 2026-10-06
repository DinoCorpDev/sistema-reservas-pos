import { defineConfig } from 'tsup';

/**
 * Un solo archivo para instalar en el mini-PC o tablet de la sede. Los paquetes @pos/* (TypeScript
 * fuente) se empaquetan; el resto de dependencias se resuelven desde node_modules del hub.
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
