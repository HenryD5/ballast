import type { FileKind, FileReason, PackageReason, AnalysisWarning } from '../../src/core/types';
import type { Lang } from '../../src/webview/protocol';

const copy = {
  es: {
    explain: 'Busca los archivos y paquetes que tu proyecto ya no usa. Solo lee el código.', analyze: 'Analizar proyecto', analyzing: 'Analizando el proyecto…', change: 'Cambiar carpeta', retry: 'Reintentar', log: 'Ver registro',
    again: 'Analizar de nuevo', files: 'Archivos sin uso', packages: 'Paquetes sin uso', analyzed: 'archivos analizados', search: 'Buscar por nombre o ruta', all: 'Todos', selectAll: 'Seleccionar todo', clear: 'Limpiar filtros',
    noFiles: 'No hay archivos sin uso.', noMatch: 'Ningún archivo coincide con la búsqueda.', noPackages: 'No hay paquetes sin uso.', reveal: 'Mostrar en el explorador', selected: 'seleccionados', deselect: 'Deseleccionar', copyPaths: 'Copiar rutas', trash: 'Mover {n} a la papelera', uninstall: 'Desinstalar {n}',
    untrusted: 'Esta carpeta no es de confianza: puedes ver el análisis, pero no borrar ni desinstalar.', undo: 'Deshacer', typecheck: 'Comprobar tipos', moved: 'Se movieron {n} archivos a la papelera.', uninstalled: 'Se desinstalaron {n} paquetes.',
    busyFiles: 'Moviendo a la papelera…', busyPackages: 'Desinstalando paquetes…', busyUndo: 'Deshaciendo…', busyTypecheck: 'Comprobando tipos…', passed: 'La comprobación de tipos pasó.', failed: 'La comprobación de tipos falló.', running: 'Comprobando tipos…',
    packageWarning: 'Si lo desinstalas sin borrar estos archivos, sus imports fallarán.', version: 'versión',
  },
  en: {
    explain: 'Finds files and packages your project no longer uses. It only reads the code.', analyze: 'Analyze project', analyzing: 'Analyzing the project…', change: 'Change folder', retry: 'Retry', log: 'View log',
    again: 'Analyze again', files: 'Unused files', packages: 'Unused packages', analyzed: 'files analyzed', search: 'Search by name or path', all: 'All', selectAll: 'Select all', clear: 'Clear filters',
    noFiles: 'There are no unused files.', noMatch: 'No files match the search.', noPackages: 'There are no unused packages.', reveal: 'Show in Explorer', selected: 'selected', deselect: 'Deselect', copyPaths: 'Copy paths', trash: 'Move {n} to trash', uninstall: 'Uninstall {n}',
    untrusted: 'This folder is not trusted: you can view the analysis, but cannot delete or uninstall.', undo: 'Undo', typecheck: 'Check types', moved: 'Moved {n} files to trash.', uninstalled: 'Uninstalled {n} packages.',
    busyFiles: 'Moving to trash…', busyPackages: 'Uninstalling packages…', busyUndo: 'Undoing…', busyTypecheck: 'Checking types…', passed: 'Type checking passed.', failed: 'Type checking failed.', running: 'Checking types…',
    packageWarning: 'If you uninstall it without deleting these files, their imports will fail.', version: 'version',
  },
} as const;

export type TextKey = keyof typeof copy.es;
export const t = (lang: Lang, key: TextKey, vars?: Record<string, string | number>): string => {
  let value: string = copy[lang][key];
  for (const [name, replacement] of Object.entries(vars ?? {})) value = value.replace(`{${name}}`, String(replacement));
  return value;
};

const kinds: Record<Lang, Record<FileKind, string>> = {
  es: { view: 'Vista', layout: 'Layout', component: 'Componente', composable: 'Composable', store: 'Store', service: 'Servicio', util: 'Utilidad', type: 'Tipos', constant: 'Constantes', test: 'Test', other: 'Otro' },
  en: { view: 'View', layout: 'Layout', component: 'Component', composable: 'Composable', store: 'Store', service: 'Service', util: 'Utility', type: 'Types', constant: 'Constants', test: 'Test', other: 'Other' },
};
export const kindText = (lang: Lang, kind: FileKind): string => kinds[lang][kind];

const fileReasons: Record<Lang, Record<FileReason, string>> = { es: { unreferenced: 'Nadie lo importa', onlyUnused: 'Solo lo usan archivos sin uso', onlyTests: 'Solo lo usan sus tests' }, en: { unreferenced: 'Nothing imports it', onlyUnused: 'Only unused files use it', onlyTests: 'Only its tests use it' } };
export const fileReasonText = (lang: Lang, reason: FileReason): string => fileReasons[lang][reason];
const packageReasons: Record<Lang, Record<PackageReason, string>> = { es: { noImport: 'Nada lo importa ni lo usa', onlyUnusedFiles: 'Solo lo importan archivos sin uso', nodeBuiltin: 'Es un módulo nativo de Node; el paquete npm sobra', typesOrphan: 'Tipos de un paquete que no se usa' }, en: { noImport: 'Nothing imports or uses it', onlyUnusedFiles: 'Only unused files import it', nodeBuiltin: 'It is a built-in Node module; the npm package is unnecessary', typesOrphan: 'Types for a package that is not used' } };
export const packageReasonText = (lang: Lang, reason: PackageReason): string => packageReasons[lang][reason];
const warnings: Record<Lang, Record<AnalysisWarning, string>> = { es: { noNodeModules: 'Sin node_modules: instala las dependencias para analizar los paquetes de desarrollo con precisión.', workspaces: 'Es un monorepo: solo se analizó la carpeta raíz.' }, en: { noNodeModules: 'No node_modules: install dependencies to analyze development packages accurately.', workspaces: 'This is a monorepo: only the root folder was analyzed.' } };
export const warningText = (lang: Lang, warning: AnalysisWarning): string => warnings[lang][warning];
