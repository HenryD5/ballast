export type FileKind =
  | 'view'
  | 'layout'
  | 'component'
  | 'composable'
  | 'store'
  | 'service'
  | 'util'
  | 'type'
  | 'constant'
  | 'test'
  | 'other';

/**
 * Por qué un archivo no se usa:
 * - `unreferenced`: ningún archivo lo importa.
 * - `onlyUnused`: solo lo importan archivos que tampoco se usan.
 * - `onlyTests`: la aplicación no lo usa; solo lo importan sus propios tests, que se borran con él.
 */
export type FileReason = 'unreferenced' | 'onlyUnused' | 'onlyTests';

export interface UnusedFile {
  /** Ruta relativa a la raíz del proyecto, con `/`. */
  path: string;
  /** Carpeta que lo contiene, relativa y con `/` (vacía en la raíz). */
  dir: string;
  name: string;
  /** Módulo o carpeta principal: `subscriptions`, `shared`, `tests`… */
  module: string;
  kind: FileKind;
  reason: FileReason;
  size: number;
  /** Archivos que lo importan (todos sin uso). */
  importedBy: string[];
  /** Tests propios que lo importan; se borran junto con él. */
  tests: string[];
}

/**
 * Por qué un paquete no se usa:
 * - `noImport`: nada lo importa, ni lo nombra una configuración, un script o un paquete que sí se usa.
 * - `onlyUnusedFiles`: solo lo importan archivos sin uso.
 * - `nodeBuiltin`: se llama igual que un módulo nativo de Node y los imports usan el nativo.
 * - `typesOrphan`: son los tipos de un paquete que no se usa.
 */
export type PackageReason = 'noImport' | 'onlyUnusedFiles' | 'nodeBuiltin' | 'typesOrphan';

export interface UnusedPackage {
  name: string;
  version: string;
  section: 'dependencies' | 'devDependencies';
  reason: PackageReason;
  /** Archivos sin uso que lo importan (para `onlyUnusedFiles`). */
  files: string[];
}

export type AnalysisWarning = 'noNodeModules' | 'workspaces';

export interface AnalysisResult {
  root: string;
  projectName: string;
  frameworks: string[];
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun';
  /** Archivos de código analizados y dependencias declaradas. */
  totals: { files: number; packages: number };
  files: UnusedFile[];
  packages: UnusedPackage[];
  warnings: AnalysisWarning[];
  durationMs: number;
}

export interface AnalyzeOptions {
  /** Globs relativos a la raíz, o nombres de paquete, que no se reportan. */
  ignore?: string[];
}
