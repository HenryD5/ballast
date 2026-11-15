import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyze } from '../../src/core/analyze';
import { isCodeFile, isDeclarationFile } from '../../src/core/classify';
import { planFileDeletion } from '../../src/core/cleanup';
import { extractFacts } from '../../src/core/extract';
import { walk } from '../../src/core/project';
import { makeProject } from './helpers';

/**
 * Casos vistos al limpiar st-channel-panel y mfe-panel-summary: se borra TODO lo reportado
 * y se comprueba que el código que queda no importa nada que ya no exista.
 */
async function realisticProject() {
  return makeProject({
    'package.json': { name: 'mfe', dependencies: { vue: '3' } },
    'tsconfig.json': { compilerOptions: { paths: { '~/*': ['./src/*'], '~tests/*': ['./tests/*'] } } },
    'index.html': '<script type="module" src="/src/main.ts"></script>',
    'vite.config.ts': "federation({ exposes: { './ViewDashboard': '~/modules/summary/views/dashboard.vue' } });",
    'src/main.ts': "//import { gtm } from './plugins/gtm';\nimport App from './App.vue';",
    'src/App.vue': '<script setup>import Chart from "~/shared/components/EmptyStateChart.vue";</script>',
    'src/plugins/gtm.ts': 'export const gtm = {};',
    'src/modules/summary/views/dashboard.vue': "<script setup>import { useSales } from '../composables/useSales';</script>",
    'src/modules/summary/composables/useSales.ts': "import { money } from '~/shared/utils/money';\nexport const useSales = () => money(1);",
    'src/shared/utils/money.ts': 'export const money = (n: number) => `${n}`;',
    // Nombre parecido a un componente usado: EmptyStateChart.test.ts no es test propio de EmptyState.vue.
    'src/shared/components/EmptyStateChart.vue': '<template><svg /></template>',
    'src/shared/components/EmptyState.vue': "<script setup>import Vector from './ui/EmptyVector.vue';</script>",
    'src/shared/components/ui/EmptyVector.vue': '<template><path /></template>',
    'tests/unit/plugins/gtm.test.ts': "import { gtm } from '~/plugins/gtm';",
    'tests/unit/shared/EmptyStateChart.test.ts': "import C from '~/shared/components/EmptyStateChart.vue';",
    // El test de EmptyState también importa EmptyVector: bloquea EmptyVector hasta que se borre.
    'tests/unit/shared/EmptyState.test.ts': "import S from '~/shared/components/EmptyState.vue';\nimport V from '~/shared/components/ui/EmptyVector.vue';",
    'tests/unit/shared/EmptyVector.test.ts': "import V from '~/shared/components/ui/EmptyVector.vue';",
  });
}

async function danglingImports(root: string): Promise<string[]> {
  const files = await walk(root);
  const existing = new Set(files);
  const dangling: string[] = [];
  for (const path of files.filter((f) => isCodeFile(f) && !isDeclarationFile(f))) {
    const facts = extractFacts(path, await readFile(join(root, path), 'utf8'));
    for (const { value } of facts.specifiers) {
      const target = value.startsWith('~/') ? `src/${value.slice(2)}` : value.startsWith('.') ? join(path, '..', value) : undefined;
      if (!target) continue;
      const found = ['', '.ts', '.vue', '/index.ts'].some((ext) => existing.has(`${target}${ext}`));
      if (!found) dangling.push(`${path} → ${value}`);
    }
  }
  return dangling;
}

describe('cleaning everything Ballast reports', () => {
  it('never leaves an import pointing to a deleted file, and a second pass finds the cascade', async () => {
    const root = await realisticProject();
    expect(await danglingImports(root)).toEqual([]);

    const first = await analyze(root);
    expect(first.files.map((f) => f.path).sort()).toEqual(['src/plugins/gtm.ts', 'src/shared/components/EmptyState.vue']);
    expect(first.files.find((f) => f.path === 'src/shared/components/EmptyState.vue')?.tests).toEqual(['tests/unit/shared/EmptyState.test.ts']);

    const plan = planFileDeletion(first, first.files.map((f) => f.path));
    for (const f of plan.files) await rm(join(root, f));
    expect(await danglingImports(root)).toEqual([]);

    // Segunda pasada: EmptyVector ya no lo bloquea el test de EmptyState.
    const second = await analyze(root);
    expect(second.files.map((f) => f.path)).toEqual(['src/shared/components/ui/EmptyVector.vue']);
    for (const f of planFileDeletion(second, ['src/shared/components/ui/EmptyVector.vue']).files) await rm(join(root, f));
    expect(await danglingImports(root)).toEqual([]);
    expect((await analyze(root)).files).toEqual([]);
  });

  it('keeps everything the app reaches through federation, aliases and composables', async () => {
    const root = await realisticProject();
    const paths = (await analyze(root)).files.map((f) => f.path);
    for (const kept of ['src/modules/summary/views/dashboard.vue', 'src/modules/summary/composables/useSales.ts', 'src/shared/utils/money.ts', 'src/shared/components/EmptyStateChart.vue']) {
      expect(paths).not.toContain(kept);
    }
  });
});
