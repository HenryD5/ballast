import { describe, expect, it } from 'vitest';
import { analyze, configFileReferences } from '../../src/core/analyze';
import { isConfigLike } from '../../src/core/classify';
import { extractFacts } from '../../src/core/extract';
import { makeProject } from './helpers';

/** Archivos que se usan solo por configuración, por convención o porque se exponen: nunca se reportan. */
describe('files used by configuration, conventions or exposure', () => {
  async function unusedPaths(files: Record<string, string | object>): Promise<string[]> {
    const root = await makeProject({
      'package.json': { name: 'demo', scripts: { seed: 'tsx src/scripts/seed.ts --env dev', 'gen:icons': 'node ./src/tools/icons.mjs' } },
      'index.html': '<script type="module" src="/src/main.ts"></script>',
      'src/main.ts': "import './app';",
      'src/app.ts': 'export {};',
      'src/Dead.vue': '<template><i /></template>',
      ...files,
    });
    return (await analyze(root)).files.map((f) => f.path);
  }

  it('never reports config or setup files, even inside src', async () => {
    const paths = await unusedPaths({
      'src/vitest.setup.ts': "import '@testing-library/jest-dom';",
      'src/setupTests.ts': 'export {};',
      'src/i18n.config.ts': 'export default {};',
      'src/shared/config/remotes.ts': 'export const remotes = {};',
      'src/settings/theme.ts': 'export const theme = {};',
    });
    expect(paths).toEqual(['src/Dead.vue']);
  });

  it('never reports ambient declarations that TypeScript loads without imports', async () => {
    const paths = await unusedPaths({
      'src/types/vue-augment.ts': "export {};\ndeclare module 'vue' { interface ComponentCustomProperties { $t: (k: string) => string } }",
      'src/types/globals.ts': 'export {};\ndeclare global { interface Window { dataLayer: unknown[] } }',
    });
    expect(paths).toEqual(['src/Dead.vue']);
  });

  it('keeps files run by package.json scripts and Git hooks', async () => {
    const paths = await unusedPaths({
      'src/scripts/seed.ts': "import { helper } from './helper';",
      'src/scripts/helper.ts': 'export const helper = 1;',
      'src/tools/icons.mjs': 'export {};',
      '.husky/pre-commit': 'node src/tools/check-names.js',
      'src/tools/check-names.js': 'export {};',
    });
    expect(paths).toEqual(['src/Dead.vue']);
  });

  it('keeps files exposed by Module Federation, also through aliases and template paths', async () => {
    const paths = await unusedPaths({
      'tsconfig.json': { compilerOptions: { paths: { '~/*': ['./src/*'], '@modules/*': ['./src/modules/*'] } } },
      'vite.config.ts': `
        const src = './src';
        federation({
          name: 'summary',
          exposes: {
            './Dashboard': '~/modules/summary/views/dashboard.vue',
            './Detail': '@modules/summary/views/Detail.vue',
            './Chart': \`\${src}/modules/summary/views/Chart.vue\`,
            './Remote': { import: './src/modules/summary/Remote.vue' },
          },
        });
        VitePWA({ strategies: 'injectManifest', srcDir: 'src', filename: 'sw.ts' });`,
      'src/modules/summary/views/dashboard.vue': '<script setup>import Card from "../components/Card.vue";</script>',
      'src/modules/summary/components/Card.vue': '<template><b /></template>',
      'src/modules/summary/views/Detail.vue': '<template><b /></template>',
      'src/modules/summary/views/Chart.vue': '<template><b /></template>',
      'src/modules/summary/Remote.vue': '<template><b /></template>',
      'src/sw.ts': 'self.addEventListener("fetch", () => {});',
    });
    expect(paths).toEqual(['src/Dead.vue']);
  });

  it('keeps files loaded by webpack require.context', async () => {
    const paths = await unusedPaths({
      'src/app.ts': "const ctx = require.context('./components', true, /\\.vue$/);",
      'src/components/deep/A.vue': '<template><b /></template>',
    });
    expect(paths).toEqual(['src/Dead.vue']);
  });

  it('keeps exports re-exported by a barrel that is used', async () => {
    const paths = await unusedPaths({
      'src/app.ts': "import { a } from './lib';",
      'src/lib/index.ts': "export * from './a';\nexport { b } from './b';",
      'src/lib/a.ts': 'export const a = 1;',
      'src/lib/b.ts': 'export const b = 1;',
    });
    expect(paths).toEqual(['src/Dead.vue']);
  });
});

describe('helpers', () => {
  it('recognizes config-like files', () => {
    for (const p of ['src/vitest.setup.ts', 'src/a/i18n.config.ts', 'src/setupTests.ts', 'src/shared/config/x.ts', 'src/polyfills.ts']) expect(isConfigLike(p)).toBe(true);
    for (const p of ['src/components/Config.vue', 'src/utils/setupForm.ts', 'src/views/settings.vue']) expect(isConfigLike(p)).toBe(false);
  });

  it('reads template and bare-name file references from configs', () => {
    expect(configFileReferences("`${root}/views/A.vue` `${x}` filename: 'sw.ts'")).toEqual(['**/views/A.vue', '**/sw.ts']);
  });

  it('reads require.context', () => {
    expect(extractFacts('a.js', "require.context('./icons', false, /\\.svg$/)").specifiers).toEqual([{ value: './icons/*', glob: true }]);
  });
});
