import type { AnalysisResult } from './types';

/** Nombre de paquete npm válido: nada que un shell pueda interpretar. */
const PACKAGE_NAME = /^(?:@[a-z0-9~][a-z0-9._~-]*\/)?[a-z0-9~][a-z0-9._~-]*$/;
const SCRIPT_NAME = /^[\w:.-]{1,100}$/;

export function isValidPackageName(name: string): boolean {
  return name.length <= 214 && PACKAGE_NAME.test(name);
}

export function isValidScriptName(name: string): boolean {
  return SCRIPT_NAME.test(name);
}

/** Ruta relativa dentro del proyecto: sin `..`, sin absolutas, sin barras invertidas. */
export function isSafeRelativePath(path: string): boolean {
  if (!path || path.includes('\\') || path.includes('\0') || path.startsWith('/') || /^[a-zA-Z]:/.test(path)) return false;
  return path.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

export interface FileDeletionPlan {
  /** Archivos elegidos más sus tests propios, sin repetir y ordenados. */
  files: string[];
  /** Rutas pedidas que no están en el análisis (se ignoran). */
  rejected: string[];
}

/** Solo se borra lo que el último análisis marcó como sin uso, con sus tests. */
export function planFileDeletion(result: AnalysisResult, paths: readonly string[]): FileDeletionPlan {
  const byPath = new Map(result.files.map((f) => [f.path, f]));
  const files = new Set<string>();
  const rejected: string[] = [];
  for (const path of paths) {
    const file = byPath.get(path);
    if (!file || !isSafeRelativePath(path)) {
      rejected.push(path);
      continue;
    }
    files.add(path);
    for (const test of file.tests) if (isSafeRelativePath(test)) files.add(test);
  }
  return { files: [...files].sort(), rejected };
}

export interface UninstallPlan {
  names: string[];
  rejected: string[];
  command: string;
  args: string[];
}

const REMOVE_VERB: Record<AnalysisResult['packageManager'], string> = { npm: 'uninstall', pnpm: 'remove', yarn: 'remove', bun: 'remove' };

/** Solo se desinstala lo que el último análisis marcó como sin uso. */
export function planUninstall(result: AnalysisResult, names: readonly string[]): UninstallPlan {
  const unused = new Set(result.packages.map((p) => p.name));
  const ok = [...new Set(names)].filter((n) => unused.has(n) && isValidPackageName(n)).sort();
  const rejected = names.filter((n) => !ok.includes(n));
  return { names: ok, rejected, command: result.packageManager, args: [REMOVE_VERB[result.packageManager], ...ok] };
}

export const LOCKFILES: Record<AnalysisResult['packageManager'], string> = {
  npm: 'package-lock.json',
  pnpm: 'pnpm-lock.yaml',
  yarn: 'yarn.lock',
  bun: 'bun.lockb',
};

/** Script que comprueba tipos, si el proyecto tiene uno. */
export function findTypecheckScript(scripts: Record<string, string> | undefined): string | undefined {
  const names = ['type-check', 'typecheck', 'check-types', 'types:check', 'tsc', 'check'];
  return names.find((n) => typeof scripts?.[n] === 'string' && isValidScriptName(n));
}
