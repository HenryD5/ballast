import type { FileKind, UnusedFile } from '../../src/core/types';

export interface FileFilter {
  search: string;
  kinds: ReadonlySet<FileKind> | readonly FileKind[];
}

export interface FileGroup {
  module: string;
  dirHint: string;
  files: UnusedFile[];
  size: number;
}

const fold = (value: string): string =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();

export function filterFiles(files: readonly UnusedFile[], filter: FileFilter): UnusedFile[] {
  const query = fold(filter.search.trim());
  const kinds = filter.kinds instanceof Set ? filter.kinds : new Set(filter.kinds);
  return files.filter((file) =>
    (kinds.size === 0 || kinds.has(file.kind)) &&
    (!query || fold(file.name).includes(query) || fold(file.path).includes(query)),
  );
}

function commonDirectory(files: readonly UnusedFile[]): string {
  if (!files.length) return '';
  const parts = files.map((file) => file.dir.split('/').filter(Boolean));
  const first = parts[0] ?? [];
  let length = 0;
  while (length < first.length && parts.every((item) => item[length] === first[length])) length += 1;
  return first.slice(0, length).join('/');
}

export function groupByModule(files: readonly UnusedFile[]): FileGroup[] {
  const map = new Map<string, UnusedFile[]>();
  for (const file of files) {
    const group = map.get(file.module) ?? [];
    group.push(file);
    map.set(file.module, group);
  }
  return [...map].map(([module, grouped]) => ({
    module,
    dirHint: commonDirectory(grouped),
    files: grouped,
    size: grouped.reduce((total, file) => total + file.size, 0),
  })).sort((a, b) => b.files.length - a.files.length || a.module.localeCompare(b.module));
}

export function kindCounts(files: readonly UnusedFile[]): Partial<Record<FileKind, number>> {
  const counts: Partial<Record<FileKind, number>> = {};
  for (const file of files) counts[file.kind] = (counts[file.kind] ?? 0) + 1;
  return counts;
}

export function formatSize(bytes: number, lang: 'es' | 'en'): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${new Intl.NumberFormat(lang, { maximumFractionDigits: value < 10 ? 1 : 0 }).format(value)} ${units[unit]}`;
}

export function pruneSelection(selected: readonly string[], existingKeys: readonly string[]): string[] {
  const existing = new Set(existingKeys);
  return [...new Set(selected)].filter((key) => existing.has(key));
}

export function groupSelectionState(groupKeys: readonly string[], selected: ReadonlySet<string> | readonly string[]): 'none' | 'some' | 'all' {
  const set = selected instanceof Set ? selected : new Set(selected);
  const count = groupKeys.filter((key) => set.has(key)).length;
  return count === 0 ? 'none' : count === groupKeys.length ? 'all' : 'some';
}

export function uninstallCommand(packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun', names: readonly string[]): string {
  const verb = packageManager === 'npm' ? 'uninstall' : 'remove';
  return `${packageManager} ${verb} ${names.join(' ')}`.trim();
}

export function filesToDelete(selectedPaths: readonly string[], files: readonly UnusedFile[]): string[] {
  const selected = new Set(selectedPaths);
  for (const file of files) if (selected.has(file.path)) for (const test of file.tests) selected.add(test);
  return [...selected].sort();
}
