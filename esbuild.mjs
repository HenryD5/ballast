import * as esbuild from 'esbuild';
import { chmod, readFile } from 'node:fs/promises';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
const packageJson = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));

const shared = {
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  mainFields: ['module', 'main'],
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

// La extensión no incluye TypeScript: el análisis corre en dist/cli.js como proceso aparte.
const extension = await esbuild.context({
  ...shared,
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  external: ['vscode'],
});

const cli = await esbuild.context({
  ...shared,
  entryPoints: ['src/cli/index.ts'],
  outfile: 'dist/cli.js',
  banner: { js: '#!/usr/bin/env node' },
  define: { __BALLAST_VERSION__: JSON.stringify(packageJson.version) },
});

if (watch) {
  await Promise.all([extension.watch(), cli.watch()]);
} else {
  await Promise.all([extension.rebuild(), cli.rebuild()]);
  await Promise.all([extension.dispose(), cli.dispose()]);
  await chmod('dist/cli.js', 0o755);
}
