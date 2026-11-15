import { describe, expect, it } from 'vitest';
import { findTypecheckScript, isSafeRelativePath, isValidPackageName, planFileDeletion, planUninstall } from '../../src/core/cleanup';
import type { AnalysisResult } from '../../src/core/types';
import { isAllowedCommand } from '../../src/infra/exec';
import { parseWebviewMessage } from '../../src/webview/protocol';

const result: AnalysisResult = {
  root: '/p',
  projectName: 'p',
  frameworks: [],
  packageManager: 'npm',
  totals: { files: 3, packages: 2 },
  files: [
    { path: 'src/A.vue', dir: 'src', name: 'A.vue', module: 'src', kind: 'component', reason: 'onlyTests', size: 1, importedBy: [], tests: ['tests/A.spec.ts'] },
    { path: 'src/b.ts', dir: 'src', name: 'b.ts', module: 'src', kind: 'util', reason: 'unreferenced', size: 1, importedBy: [], tests: [] },
  ],
  packages: [
    { name: 'dayjs', version: '1', section: 'dependencies', reason: 'noImport', files: [] },
    { name: '@types/x', version: '1', section: 'devDependencies', reason: 'typesOrphan', files: [] },
  ],
  warnings: [],
  durationMs: 1,
};

describe('planFileDeletion', () => {
  it('adds own tests and rejects anything the analysis did not report', () => {
    expect(planFileDeletion(result, ['src/A.vue', 'src/main.ts', '../etc/passwd'])).toEqual({
      files: ['src/A.vue', 'tests/A.spec.ts'],
      rejected: ['src/main.ts', '../etc/passwd'],
    });
  });
});

describe('planUninstall', () => {
  it('only uninstalls reported packages, with the project package manager', () => {
    expect(planUninstall(result, ['dayjs', 'vue', 'dayjs'])).toMatchObject({ names: ['dayjs'], rejected: ['vue'], command: 'npm', args: ['uninstall', 'dayjs'] });
    expect(planUninstall({ ...result, packageManager: 'pnpm' }, ['@types/x']).args).toEqual(['remove', '@types/x']);
  });
});

describe('validation', () => {
  it('accepts only safe relative paths', () => {
    expect(isSafeRelativePath('src/a/b.ts')).toBe(true);
    for (const bad of ['', '/etc/x', '../x', 'src/../x', 'C:/x', 'src\\x', 'src//x', './x']) expect(isSafeRelativePath(bad)).toBe(false);
  });

  it('accepts only valid package names', () => {
    expect(isValidPackageName('@scope/pkg.name')).toBe(true);
    for (const bad of ['', 'Pkg', 'a b', 'a;rm', '--force', '@x', '&calc']) expect(isValidPackageName(bad)).toBe(false);
  });

  it('allows only uninstall, install and run with safe arguments', () => {
    expect(isAllowedCommand('npm', ['uninstall', 'dayjs', '@types/x'])).toBe(true);
    expect(isAllowedCommand('pnpm', ['remove', 'dayjs'])).toBe(true);
    expect(isAllowedCommand('npm', ['install'])).toBe(true);
    expect(isAllowedCommand('npm', ['run', 'type-check'])).toBe(true);
    expect(isAllowedCommand('npm', ['uninstall', '--force'])).toBe(false);
    expect(isAllowedCommand('npm', ['install', 'evil'])).toBe(false);
    expect(isAllowedCommand('npm', ['run', 'a && b'])).toBe(false);
    expect(isAllowedCommand('rm', ['-rf', 'x'])).toBe(false);
  });

  it('finds the typecheck script', () => {
    expect(findTypecheckScript({ 'type-check': 'vue-tsc', test: 'vitest' })).toBe('type-check');
    expect(findTypecheckScript({ test: 'vitest' })).toBeUndefined();
  });
});

describe('parseWebviewMessage', () => {
  it('accepts known messages and drops the rest', () => {
    expect(parseWebviewMessage({ type: 'deleteFiles', paths: ['a', 'a', 'b'] })).toEqual({ type: 'deleteFiles', paths: ['a', 'b'] });
    expect(parseWebviewMessage({ type: 'uninstall', names: [] })).toBeUndefined();
    expect(parseWebviewMessage({ type: 'open', path: 42 })).toBeUndefined();
    expect(parseWebviewMessage({ type: 'run', command: 'rm' })).toBeUndefined();
    expect(parseWebviewMessage(null)).toBeUndefined();
  });
});
