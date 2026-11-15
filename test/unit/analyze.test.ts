import { describe, expect, it } from 'vitest';
import { analyze } from '../../src/core/analyze';
import { installed, makeProject } from './helpers';

/** Proyecto Vue + Vite parecido a los reales: alias, rutas perezosas, auto-componentes, federación y tests. */
async function vueProject(extra: Record<string, string | object> = {}) {
  return makeProject({
    'package.json': {
      name: 'demo',
      scripts: { build: 'run-p type-check build-only', 'type-check': 'vue-tsc --build', lint: 'eslint .', test: 'vitest run --coverage' },
      dependencies: { vue: '^3.5.0', dayjs: '^1.0.0', lodash: '^4.0.0', https: '^1.0.0', '@acme/ui': '^1.0.0', 'vue-router': '^4.0.0' },
      devDependencies: {
        vite: '^6.0.0', vitest: '^4.0.0', '@vitest/coverage-v8': '^4.0.0', '@vitest/coverage-istanbul': '^4.0.0', 'vue-tsc': '^3.0.0',
        'npm-run-all': '^4.0.0', eslint: '^9.0.0', 'eslint-plugin-vue': '^9.0.0', '@types/lodash': '^4.0.0', '@types/node': '^20.0.0',
        sass: '^1.0.0', typescript: '^5.0.0', jsdom: '^25.0.0', '@vitejs/plugin-vue': '^5.0.0', 'left-pad': '^1.0.0', 'flush-promises': '^1.0.0',
      },
    },
    ...installed('vue'),
    ...installed('vite', { bin: { vite: 'bin/vite.js' } }),
    ...installed('vitest', { bin: { vitest: 'vitest.mjs' } }),
    ...installed('vue-tsc', { bin: { 'vue-tsc': 'bin.js' }, peerDependencies: { typescript: '*' } }),
    ...installed('npm-run-all', { bin: { 'run-p': 'bin/run-p', 'npm-run-all': 'bin/npm-run-all' } }),
    ...installed('eslint', { bin: { eslint: 'bin/eslint.js' } }),
    ...installed('@vitejs/plugin-vue', { peerDependencies: { vite: '*', vue: '*' } }),
    ...installed('vue-router', { peerDependencies: { vue: '*', '@vue/devtools-api': '*' }, peerDependenciesMeta: { '@vue/devtools-api': { optional: true } } }),
    'tsconfig.json': { compilerOptions: { baseUrl: '.', paths: { '~/*': ['./src/*'] } } },
    'index.html': '<script type="module" src="/src/main.ts"></script>',
    'vite.config.ts': `
      import https from 'https';
      import vue from '@vitejs/plugin-vue';
      export default {
        plugins: [vue(), federation({ exposes: { './Remote': '~/modules/remote/RemoteView.vue' } })],
        resolve: { alias: { '~': fileURLToPath(new URL('./src', import.meta.url)) } },
      };`,
    'vitest.config.ts': "export default { test: { environment: 'jsdom', setupFiles: ['tests/setup.ts'], coverage: { provider: 'v8', exclude: ['src/legacy/**'] } } };",
    'eslint.config.js': "export default [{ plugins: ['vue'] }];",
    'components.d.ts': "declare module 'vue' { export interface GlobalComponents { CqBadge: typeof import('./src/components/CqBadge.vue')['default'] } }",
    'src/main.ts': "import { createApp } from 'vue';\nimport App from './App.vue';\nimport router from '~/router';\nimport '@acme/ui/styles.css';\ncreateApp(App).use(router);",
    'src/App.vue': '<template><cq-badge /><RouterView /></template>\n<style lang="scss">a { b: c }</style>',
    'src/router/index.ts': "import { createRouter } from 'vue-router';\nexport default [\n  { component: () => import('~/views/Home.vue') },\n  /* { component: () => import('~/views/Old.vue') }, */\n];",
    'src/views/Home.vue': "<script setup>import { format } from '~/utils/date';</script>",
    'src/views/Old.vue': '<template><div /></template>',
    'src/utils/date.ts': "import dayjs from 'dayjs';\nexport const format = (d: Date) => dayjs(d).format();",
    'src/utils/index.ts': "export * from './date';",
    'src/components/CqBadge.vue': '<template><span /></template>',
    'src/components/Orphan.vue': "<script setup>import Child from './OrphanChild.vue';\nimport { debounce } from 'lodash';</script>",
    'src/components/OrphanChild.vue': '<template><i /></template>',
    'src/components/Tested.vue': '<template><b /></template>',
    'src/components/SharedTested.vue': '<template><u /></template>',
    'src/modules/remote/RemoteView.vue': '<template><p /></template>',
    'src/modules/billing/composables/useInvoices.ts': 'export const useInvoices = () => 1;',
    'src/legacy/old.ts': 'export const old = 1;',
    'src/types/env.d.ts': "import x from '../components/Orphan.vue';",
    'tests/setup.ts': "import { config } from './helpers/config';",
    'tests/helpers/config.ts': 'export const config = {};',
    'tests/helpers/unused-helper.ts': 'export const nope = 1;',
    'tests/__mocks__/thing.ts': 'export default 1;',
    'tests/unit/Tested.spec.ts': "import Tested from '~/components/Tested.vue';",
    'tests/unit/Other.spec.ts': "import SharedTested from '~/components/SharedTested.vue';\nimport { format } from '~/utils/date';",
    ...extra,
  });
}

describe('analyze: files', () => {
  it('reports only files nothing reachable uses, grouped by module and kind', async () => {
    const result = await analyze(await vueProject());
    const byPath = Object.fromEntries(result.files.map((f) => [f.path, f]));
    expect(Object.keys(byPath).sort()).toEqual([
      'src/components/Orphan.vue',
      'src/components/OrphanChild.vue',
      'src/components/Tested.vue',
      'src/legacy/old.ts',
      'src/modules/billing/composables/useInvoices.ts',
      'src/utils/index.ts',
      'src/views/Old.vue',
      'tests/helpers/unused-helper.ts',
    ]);
    expect(byPath['src/components/Orphan.vue']).toMatchObject({ reason: 'unreferenced', kind: 'component', module: 'components', dir: 'src/components' });
    expect(byPath['src/components/OrphanChild.vue']).toMatchObject({ reason: 'onlyUnused', importedBy: ['src/components/Orphan.vue'] });
    expect(byPath['src/modules/billing/composables/useInvoices.ts']).toMatchObject({ module: 'billing', kind: 'composable' });
    expect(byPath['src/views/Old.vue']).toMatchObject({ kind: 'view', reason: 'unreferenced' });
    expect(byPath['tests/helpers/unused-helper.ts']).toMatchObject({ kind: 'test', module: 'tests' });
  });

  it('deletes a file only with its own tests, never with tests of other files', async () => {
    const result = await analyze(await vueProject());
    expect(result.files.find((f) => f.path === 'src/components/Tested.vue')).toMatchObject({ reason: 'onlyTests', tests: ['tests/unit/Tested.spec.ts'] });
    // Other.spec.ts también prueba utils/date: borrar SharedTested.vue lo rompería.
    expect(result.files.some((f) => f.path === 'src/components/SharedTested.vue')).toBe(false);
  });

  it('keeps entries: index.html, federation exposes, setup files, lazy routes, auto-registered components, mocks', async () => {
    const paths = (await analyze(await vueProject())).files.map((f) => f.path);
    for (const used of ['src/main.ts', 'src/modules/remote/RemoteView.vue', 'tests/setup.ts', 'tests/helpers/config.ts', 'src/views/Home.vue', 'src/components/CqBadge.vue', 'tests/__mocks__/thing.ts', 'src/types/env.d.ts']) {
      expect(paths).not.toContain(used);
    }
  });

  it('ignores coverage exclude globs as usage and honours the ignore option', async () => {
    const result = await analyze(await vueProject(), { ignore: ['src/legacy/**', 'left-pad'] });
    expect(result.files.map((f) => f.path)).not.toContain('src/legacy/old.ts');
    expect(result.packages.map((p) => p.name)).not.toContain('left-pad');
  });

  it('follows import.meta.glob and template-literal imports', async () => {
    const root = await vueProject({ 'src/main.ts': "import App from './App.vue';\nconst pages = import.meta.glob('./views/*.vue');\nimport('./modules/billing/composables/' + 'x');" });
    const paths = (await analyze(root)).files.map((f) => f.path);
    expect(paths).not.toContain('src/views/Old.vue');
  });

  it('treats unplugin auto-imported composables as used by name', async () => {
    const root = await vueProject({
      'auto-imports.d.ts': "declare global { const useInvoices: typeof import('./src/modules/billing/composables/useInvoices')['useInvoices'] }",
      'src/views/Home.vue': '<script setup>const n = useInvoices();</script>',
    });
    expect((await analyze(root)).files.map((f) => f.path)).not.toContain('src/modules/billing/composables/useInvoices.ts');
  });
});

describe('analyze: packages', () => {
  it('finds unused packages with the right reason', async () => {
    const result = await analyze(await vueProject());
    const reasons = Object.fromEntries(result.packages.map((p) => [p.name, p.reason]));
    expect(reasons).toEqual({
      https: 'nodeBuiltin',
      lodash: 'onlyUnusedFiles',
      '@types/lodash': 'typesOrphan',
      '@vitest/coverage-istanbul': 'noImport',
      'left-pad': 'noImport',
      'flush-promises': 'noImport',
    });
    expect(result.packages.find((p) => p.name === 'lodash')?.files).toEqual(['src/components/Orphan.vue']);
  });

  it('counts packages used by scripts, configs, CSS paths, peers and tooling', async () => {
    const root = await vueProject({
      'src/assets/main.css': '@source "../../node_modules/left-pad/dist/index.js";',
      'tests/unit/a.spec.ts': "// import flushPromises from 'flush-promises'\nimport fp from 'flush-promises';",
    });
    const names = (await analyze(root)).packages.map((p) => p.name);
    for (const used of ['vue', 'vite', 'vitest', 'vue-tsc', 'typescript', 'npm-run-all', 'eslint', 'eslint-plugin-vue', '@vitest/coverage-v8', 'sass', 'jsdom', '@types/node', '@acme/ui', 'left-pad', 'flush-promises']) {
      expect(names).not.toContain(used);
    }
  });

  it('does not judge devDependencies without node_modules', async () => {
    const root = await makeProject({
      'package.json': { dependencies: { dayjs: '1' }, devDependencies: { 'some-cli': '1' } },
      'src/main.ts': 'export {};',
    });
    const result = await analyze(root);
    expect(result.warnings).toContain('noNodeModules');
    expect(result.packages.map((p) => p.name)).toEqual(['dayjs']);
  });

  it('detects the package manager and frameworks', async () => {
    const root = await makeProject({ 'package.json': { dependencies: { vue: '3' } }, 'pnpm-lock.yaml': '', 'src/main.ts': "import 'vue';" });
    const result = await analyze(root);
    expect(result.packageManager).toBe('pnpm');
    expect(result.frameworks).toEqual(['vue']);
  });
});
