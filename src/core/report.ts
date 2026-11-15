import type { AnalysisResult, FileReason, PackageReason } from './types';

const TEXT = {
  es: {
    title: (name: string) => `Ballast · ${name}`,
    analyzed: (files: number, packages: number, seconds: string) => `${files} archivos de código y ${packages} paquetes analizados en ${seconds} s.`,
    files: (n: number) => `Archivos sin uso: ${n}`,
    packages: (n: number) => `Paquetes sin uso: ${n}`,
    none: '  Ninguno.',
    with: 'también',
    file: { unreferenced: 'nadie lo importa', onlyUnused: 'solo lo usan archivos sin uso', onlyTests: 'solo lo usan sus tests' } satisfies Record<FileReason, string>,
    pkg: { noImport: 'nada lo importa ni lo usa', onlyUnusedFiles: 'solo lo importan archivos sin uso', nodeBuiltin: 'es un módulo nativo de Node', typesOrphan: 'tipos de un paquete que no se usa' } satisfies Record<PackageReason, string>,
    noNodeModules: 'Aviso: no hay node_modules; los paquetes de desarrollo no se analizaron.',
    workspaces: 'Aviso: es un monorepo; solo se analizó la carpeta raíz.',
  },
  en: {
    title: (name: string) => `Ballast · ${name}`,
    analyzed: (files: number, packages: number, seconds: string) => `${files} code files and ${packages} packages analyzed in ${seconds} s.`,
    files: (n: number) => `Unused files: ${n}`,
    packages: (n: number) => `Unused packages: ${n}`,
    none: '  None.',
    with: 'also',
    file: { unreferenced: 'nothing imports it', onlyUnused: 'only unused files use it', onlyTests: 'only its tests use it' } satisfies Record<FileReason, string>,
    pkg: { noImport: 'nothing imports or uses it', onlyUnusedFiles: 'only unused files import it', nodeBuiltin: 'it is a Node built-in module', typesOrphan: 'types for an unused package' } satisfies Record<PackageReason, string>,
    noNodeModules: 'Warning: no node_modules; dev packages were not analyzed.',
    workspaces: 'Warning: monorepo; only the root folder was analyzed.',
  },
};

export function formatReport(result: AnalysisResult, lang: 'es' | 'en' = 'es'): string {
  const t = TEXT[lang];
  const lines = [t.title(result.projectName), t.analyzed(result.totals.files, result.totals.packages, (result.durationMs / 1000).toFixed(1)), ''];
  for (const w of result.warnings) lines.push(t[w], '');
  lines.push(t.files(result.files.length));
  let module = '';
  for (const f of result.files) {
    if (f.module !== module) {
      module = f.module;
      lines.push(`  ${module}`);
    }
    const extra = f.tests.length ? ` (+ ${t.with}: ${f.tests.join(', ')})` : '';
    lines.push(`    ${f.path} · ${f.kind} · ${t.file[f.reason]}${extra}`);
  }
  if (!result.files.length) lines.push(t.none);
  lines.push('', t.packages(result.packages.length));
  for (const p of result.packages) lines.push(`  ${p.name}@${p.version} · ${p.section} · ${t.pkg[p.reason]}`);
  if (!result.packages.length) lines.push(t.none);
  return `${lines.join('\n')}\n`;
}
