import type { FileKind } from './types';

export const CODE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.vue'] as const;

export function isCodeFile(path: string): boolean {
  return CODE_EXTENSIONS.some((ext) => path.endsWith(ext));
}

export function isDeclarationFile(path: string): boolean {
  return /\.d\.[cm]?ts$/.test(path);
}

export function isTestFile(path: string): boolean {
  return /\.(?:test|spec|stories|story)\.[cm]?[jt]sx?$/.test(path) || /(?:^|\/)__tests__\//.test(path);
}

/** Carpetas donde vive el código de la aplicación y sus tests: solo ahí se reporta algo. */
const SOURCE_ROOTS = new Set([
  'src', 'app', 'lib', 'components', 'composables', 'pages', 'layouts', 'stores', 'store', 'utils', 'services',
  'views', 'plugins', 'middleware', 'server', 'modules', 'shared', 'features', 'hooks',
  'tests', 'test', '__tests__', 'e2e', 'spec',
]);

const TEST_ROOTS = new Set(['tests', 'test', '__tests__', 'e2e', 'spec']);

export function isReportable(path: string): boolean {
  const parts = path.split('/');
  if (parts.length < 2) return false;
  if (!SOURCE_ROOTS.has(parts[0]!)) return false;
  // Mocks automáticos de Vitest/Jest: se usan sin import explícito.
  if (parts.includes('__mocks__')) return false;
  return !isDeclarationFile(path);
}

/**
 * Archivos de configuración o de arranque, estén donde estén: las herramientas los cargan por nombre
 * (`*.config.ts`, `setupTests.ts`, `vitest.setup.ts`) o viven en carpetas de configuración. Nunca se reportan.
 */
export function isConfigLike(path: string): boolean {
  const parts = path.split('/');
  const name = parts[parts.length - 1]!;
  if (/\.(?:config|conf|setup|rc)\.[cm]?[jt]sx?$/.test(name)) return true;
  if (/^(?:setup-?tests?|test-?setup|global-?setup|global-?teardown|setup|bootstrap|polyfills?|shims?)\.[cm]?[jt]sx?$/i.test(name)) return true;
  return parts.slice(0, -1).some((dir) => /^(?:config|configs|configuration|settings|setup)$/i.test(dir));
}

export function isInTestRoot(path: string): boolean {
  return TEST_ROOTS.has(path.split('/')[0]!);
}

const DIR_KINDS: Array<[RegExp, FileKind]> = [
  [/^(?:views?|pages?|screens?|routes?)$/, 'view'],
  [/^layouts?$/, 'layout'],
  [/^composables?$|^hooks?$/, 'composable'],
  [/^stores?$/, 'store'],
  [/^(?:services?|api|http-client|http|repositories)$/, 'service'],
  [/^(?:utils?|helpers?|libs?|adapters?|lib)$/, 'util'],
  [/^(?:types?|interfaces?|models?)$/, 'type'],
  [/^(?:constants?|config|configs|data|enums?)$/, 'constant'],
  [/^components?$/, 'component'],
];

export function classify(path: string): FileKind {
  if (isTestFile(path) || isInTestRoot(path)) return 'test';
  const parts = path.split('/');
  const name = parts[parts.length - 1]!;
  const base = name.replace(/\.[^.]+$/, '');
  if (/^use[A-Z0-9]/.test(base)) return 'composable';
  if (/Store$/.test(base)) return 'store';
  // La carpeta más cercana manda: `components/forms/utils/x.ts` es una utilidad.
  for (let i = parts.length - 2; i >= 0; i--) {
    const dir = parts[i]!.toLowerCase();
    for (const [re, kind] of DIR_KINDS) if (re.test(dir)) return kind === 'component' && !/\.(?:vue|[jt]sx)$/.test(name) ? 'other' : kind;
  }
  if (/\.(?:vue|[jt]sx)$/.test(name)) return 'component';
  if (/\.(?:types?|interfaces?)$/.test(base)) return 'type';
  if (/(?:service|http|api)$/i.test(base)) return 'service';
  return 'other';
}

/** Módulo para agrupar: `src/modules/<x>/…` → `x`; `src/<x>/…` → `x`; `tests/…` → `tests`. */
export function moduleOf(path: string): string {
  const parts = path.split('/');
  const modulesAt = parts.findIndex((p, i) => (p === 'modules' || p === 'features') && i < parts.length - 2);
  if (modulesAt >= 0) return parts[modulesAt + 1]!;
  if (TEST_ROOTS.has(parts[0]!)) return parts[0]!;
  if ((parts[0] === 'src' || parts[0] === 'app') && parts.length > 2) return parts[1]!;
  return parts.length > 1 ? parts[0]! : '.';
}
