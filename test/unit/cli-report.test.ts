import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { main } from '../../src/cli';
import { formatReport } from '../../src/core/report';
import type { AnalysisResult } from '../../src/core/types';
import { makeProject } from './helpers';

const result: AnalysisResult = {
  root: '/p',
  projectName: 'demo',
  frameworks: ['vue'],
  packageManager: 'npm',
  totals: { files: 10, packages: 3 },
  files: [
    { path: 'src/a/X.vue', dir: 'src/a', name: 'X.vue', module: 'a', kind: 'component', reason: 'onlyTests', size: 10, importedBy: [], tests: ['tests/X.spec.ts'] },
    { path: 'src/b/y.ts', dir: 'src/b', name: 'y.ts', module: 'b', kind: 'util', reason: 'unreferenced', size: 10, importedBy: [], tests: [] },
  ],
  packages: [{ name: 'dayjs', version: '1', section: 'dependencies', reason: 'noImport', files: [] }],
  warnings: ['noNodeModules'],
  durationMs: 1200,
};

describe('formatReport', () => {
  it('prints files by module, own tests, packages and warnings in Spanish', () => {
    const text = formatReport(result, 'es');
    expect(text).toContain('10 archivos de código y 3 paquetes analizados en 1.2 s.');
    expect(text).toContain('Aviso: no hay node_modules');
    expect(text).toContain('  a\n    src/a/X.vue · component · solo lo usan sus tests (+ también: tests/X.spec.ts)');
    expect(text).toContain('dayjs@1 · dependencies · nada lo importa ni lo usa');
  });

  it('prints English and empty lists', () => {
    const text = formatReport({ ...result, files: [], packages: [], warnings: [] }, 'en');
    expect(text).toContain('Unused files: 0\n  None.');
    expect(text).toContain('Unused packages: 0\n  None.');
  });
});

describe('cli', () => {
  afterEach(() => vi.restoreAllMocks());

  it('prints JSON and never changes the project', async () => {
    const root = await makeProject({ 'package.json': { dependencies: { dayjs: '1' } }, 'src/main.ts': 'export {};', 'src/Dead.vue': '<template />' });
    const before = await snapshot(root);
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    expect(await main([root, '--json'])).toBe(0);
    const json = JSON.parse(String(out.mock.calls[0]![0])) as AnalysisResult;
    expect(json.files.map((f) => f.path)).toEqual(['src/Dead.vue']);
    expect(json.packages.map((p) => p.name)).toEqual(['dayjs']);
    expect(await snapshot(root)).toEqual(before);
  });

  it('accepts --ignore, --lang and --help', async () => {
    const root = await makeProject({ 'package.json': { dependencies: { dayjs: '1' } }, 'src/main.ts': 'export {};', 'src/Dead.vue': '<template />' });
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await main([root, '--lang', 'en', '--ignore', 'src/Dead.vue', '--ignore', 'dayjs']);
    expect(String(out.mock.calls[0]![0])).toContain('Unused files: 0');
    await main(['--help']);
    expect(String(out.mock.calls[1]![0])).toContain('Solo lee');
  });
});

async function snapshot(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (dir: string) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else out[full] = await readFile(full, 'utf8');
    }
  };
  await walk(root);
  return out;
}
