import { describe, expect, it } from 'vitest';
import { readConfigAliases } from '../../src/core/project';
import { packageName, Resolver } from '../../src/core/resolve';

const files = ['src/main.ts', 'src/a/index.ts', 'src/b.vue', 'src/c.ts', 'src/d.d.ts', 'tests/mocks/reports/View.ts', 'src/views/x/One.vue', 'src/views/y/Two.vue'];

describe('Resolver', () => {
  const resolver = new Resolver(
    files,
    [{ pattern: '~/*', targets: ['src/*'] }, ...readConfigAliases('vite.config.ts', "alias: { reports: root('./tests/mocks/reports'), zod: 'zod/v3' }")],
  );

  it('resolves relative paths with extensions and index files', () => {
    expect(resolver.resolve('./a', 'src/main.ts')).toEqual({ type: 'files', files: ['src/a/index.ts'] });
    expect(resolver.resolve('./b.vue', 'src/main.ts')).toEqual({ type: 'files', files: ['src/b.vue'] });
    expect(resolver.resolve('./c.js', 'src/main.ts')).toEqual({ type: 'files', files: ['src/c.ts'] });
    expect(resolver.resolve('/src/main.ts', 'index.html')).toEqual({ type: 'files', files: ['src/main.ts'] });
  });

  it('never resolves to declaration files', () => {
    expect(resolver.resolve('./d', 'src/main.ts')).toEqual({ type: 'none' });
  });

  it('resolves tsconfig paths and Vite aliases', () => {
    expect(resolver.resolve('~/c', 'src/b.vue')).toEqual({ type: 'files', files: ['src/c.ts'] });
    expect(resolver.resolve('reports/View', 'src/c.ts')).toEqual({ type: 'files', files: ['tests/mocks/reports/View.ts'] });
  });

  it('falls back to packages, builtins and virtual modules', () => {
    expect(resolver.resolve('zod', 'src/c.ts')).toEqual({ type: 'package', name: 'zod' });
    expect(resolver.resolve('@tanstack/vue-query/devtools', 'src/c.ts')).toEqual({ type: 'package', name: '@tanstack/vue-query' });
    expect(resolver.resolve('node:path', 'vite.config.ts')).toEqual({ type: 'builtin', name: 'path' });
    expect(resolver.resolve('https', 'vite.config.ts')).toEqual({ type: 'builtin', name: 'https' });
    expect(resolver.resolve('virtual:pwa-register', 'src/c.ts')).toEqual({ type: 'none' });
    expect(resolver.resolve('pkg?raw', 'src/c.ts')).toEqual({ type: 'package', name: 'pkg' });
  });

  it('expands globs', () => {
    expect(resolver.resolve('./views/**.vue', 'src/main.ts', true)).toEqual({ type: 'files', files: ['src/views/x/One.vue', 'src/views/y/Two.vue'] });
  });
});

describe('readConfigAliases', () => {
  it('reads the usual alias spellings', () => {
    const text = `
      alias: {
        '~': fileURLToPath(new URL('./src', import.meta.url)),
        '@': path.resolve(__dirname, 'src'),
        '#lib': '/lib',
      },
      alias: [{ find: '$x', replacement: './x' }],
    `;
    const aliases = readConfigAliases('vite.config.ts', text);
    const map = Object.fromEntries(aliases.map((a) => [a.pattern, a.targets[0]]));
    expect(map).toMatchObject({ '~': 'src', '~/*': 'src/*', '@': 'src', '#lib': 'lib', $x: 'x' });
  });

  it('ignores URLs and non-alias options', () => {
    const aliases = readConfigAliases('vite.config.ts', "target: 'https://api.x.com', outDir: './dist', rewrite: (p) => p.replace(/^\\/api/, '')");
    expect(aliases.map((a) => a.pattern)).not.toContain('target');
    expect(aliases.map((a) => a.pattern)).not.toContain('outDir');
  });
});

describe('packageName', () => {
  it('extracts names', () => {
    expect(packageName('vue/dist/vue.esm')).toBe('vue');
    expect(packageName('@a/b/c')).toBe('@a/b');
    expect(packageName('@a')).toBeUndefined();
    expect(packageName('./x')).toBeUndefined();
  });
});
