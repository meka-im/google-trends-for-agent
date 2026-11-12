import { mkdir } from 'node:fs/promises';
import { build } from 'esbuild';

// dsh loads a browser half as a CJS factory registered on its module loader.
// React and the JSX runtime come from the host page; everything else is bundled.
await mkdir('dist', { recursive: true });
await build({
  entryPoints: ['src/client/index.tsx'],
  outfile: 'dist/dsh-client.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  external: ['react', 'react-dom', 'react/jsx-runtime'],
  banner: {
    js: 'window.__ModuleLoader__.load({ id: "google-trends-for-agent", factory: (require) => {\nvar module = { exports: {} }; var exports = module.exports;',
  },
  footer: { js: 'return module.exports; } });' },
  legalComments: 'none',
  logLevel: 'info',
});
