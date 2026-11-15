import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';
import { parseJsonc } from './jsonc';

/** Carpetas que nunca se recorren: dependencias, builds, cachés. */
const SKIPPED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.nuxt', '.output', '.next', '.svelte-kit', '.vercel',
  '.turbo', '.cache', '.idea', '.vscode-test', 'storybook-static', '.yarn', '.pnpm-store', 'bower_components',
]);
/** Carpetas ocultas que sí se leen (como texto, para paquetes usados por scripts). */
const READ_HIDDEN_DIRS = new Set(['.husky', '.github', '.storybook', '.vitepress', '.config']);

export const MAX_FILES = 60_000;

export async function walk(root: string): Promise<string[]> {
  const out: string[] = [];
  async function visit(rel: string): Promise<void> {
    if (out.length >= MAX_FILES) return;
    let entries;
    try {
      entries = await readdir(join(root, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (SKIPPED_DIRS.has(entry.name)) continue;
        if (entry.name.startsWith('.') && !READ_HIDDEN_DIRS.has(entry.name)) continue;
        await visit(path);
      } else if (entry.isFile()) {
        out.push(path);
      }
    }
  }
  await visit('');
  return out.sort();
}

export interface Manifest {
  name?: string;
  main?: unknown;
  module?: unknown;
  browser?: unknown;
  exports?: unknown;
  bin?: unknown;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  workspaces?: unknown;
  [key: string]: unknown;
}

export async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
}

export async function readJson<T>(path: string): Promise<T | undefined> {
  const text = await readText(path);
  return text === undefined ? undefined : (parseJsonc(text) as T | undefined);
}

export async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

/** Datos de un paquete instalado que importan para saber si se usa. */
export interface InstalledPackage {
  bins: string[];
  /** peerDependencies obligatorias. */
  peers: string[];
}

export async function readInstalled(root: string, name: string): Promise<InstalledPackage | undefined> {
  const manifest = await readJson<Manifest>(join(root, 'node_modules', ...name.split('/'), 'package.json'));
  if (!manifest) return undefined;
  const bins =
    typeof manifest.bin === 'string'
      ? [name.split('/').pop()!]
      : manifest.bin && typeof manifest.bin === 'object'
        ? Object.keys(manifest.bin)
        : [];
  const optional = manifest.peerDependenciesMeta ?? {};
  const peers = Object.keys(manifest.peerDependencies ?? {}).filter((p) => !optional[p]?.optional);
  return { bins, peers };
}

/** Un alias: patrón con a lo sumo un `*` y destinos relativos a la raíz. */
export interface Alias {
  pattern: string;
  targets: string[];
}

interface TsConfig {
  extends?: string | string[];
  compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]>; types?: string[] };
  references?: Array<{ path: string }>;
}

export interface TsInfo {
  aliases: Alias[];
  /** Carpetas `baseUrl`: permiten `import 'components/x'` relativo a ellas. */
  baseUrls: string[];
  /** `compilerOptions.types` de cada tsconfig que lo declara. */
  types: string[];
  /** Algún tsconfig no restringe `types`: todos los `@types/*` se cargan solos. */
  globalTypes: boolean;
  found: boolean;
}

/** Lee `tsconfig*.json` y `jsconfig.json` de la raíz (y los que referencian). */
export async function readTsConfigs(root: string, files: readonly string[]): Promise<TsInfo> {
  const info: TsInfo = { aliases: [], baseUrls: [], types: [], globalTypes: false, found: false };
  const queue = files.filter((f) => /^(?:tsconfig[\w.-]*|jsconfig)\.json$/.test(f));
  const seen = new Set<string>();
  while (queue.length) {
    const rel = queue.shift()!;
    if (seen.has(rel)) continue;
    seen.add(rel);
    const config = await readJson<TsConfig>(join(root, rel));
    if (!config) continue;
    info.found = true;
    const dir = posix.dirname(rel) === '.' ? '' : posix.dirname(rel);
    for (const ref of config.references ?? []) {
      const target = posix.normalize(posix.join(dir, ref.path));
      queue.push(target.endsWith('.json') ? target : `${target}/tsconfig.json`);
    }
    const options = config.compilerOptions ?? {};
    if (options.types) info.types.push(...options.types);
    else info.globalTypes = true;
    const base = posix.normalize(posix.join(dir, options.baseUrl ?? '.')).replace(/^\.$/, '');
    if (options.baseUrl !== undefined) info.baseUrls.push(base);
    for (const [pattern, targets] of Object.entries(options.paths ?? {})) {
      info.aliases.push({ pattern, targets: targets.map((t) => posix.normalize(posix.join(base, t)).replace(/^\.\//, '')) });
    }
  }
  return info;
}

/**
 * Alias de Vite/Vitest/Webpack escritos en la configuración. Se leen del texto, no se ejecuta nada:
 * `'~': fileURLToPath(new URL('./src', import.meta.url))`, `'@': path.resolve(__dirname, 'src')`,
 * `{ find: '@', replacement: '/src' }`, `reports: root('./tests/mocks/reports')`.
 */
/** Opciones de configuración con rutas que no son alias. */
const NOT_ALIAS = /^(?:find|replacement|target|outDir|root|base|envDir|cacheDir|publicDir|reportsDirectory|outputFile|input|entry|setupFiles|globalSetup|include|exclude|dir|assetsDir|filename|configFile|tsconfig|path)$/;

export function readConfigAliases(configPath: string, text: string): Alias[] {
  const dir = posix.dirname(configPath) === '.' ? '' : posix.dirname(configPath);
  const aliases: Alias[] = [];
  const add = (key: string, value: string) => {
    if (!value || value === '.' || value === '/' || NOT_ALIAS.test(key)) return;
    const target = posix.normalize(posix.join(value.startsWith('/') ? '' : dir, value.replace(/^\//, ''))).replace(/^\.\/?/, '');
    if (target.startsWith('..')) return;
    aliases.push({ pattern: key, targets: [target] }, { pattern: `${key}/*`, targets: [`${target}/*`] });
  };
  const KEY = String.raw`(['"]?)([@~$#\w][\w@~$#\-/.]*)\1\s*:\s*`;
  const CALL = new RegExp(`${KEY}(?:[\\w.]+)\\((?:[^()]*?\\()?[^()]*?['"]((?:\\.{1,2}/|/)?[\\w@~$\\-/.]*)['"]`, 'g');
  for (const m of text.matchAll(CALL)) {
    // path.resolve(__dirname, 'src') también nombra la carpeta sin `./`.
    add(m[2]!, m[3]!);
  }
  const PLAIN = new RegExp(`${KEY}(['"])((?:\\.{1,2})?/[^'"]*)\\3`, 'g');
  for (const m of text.matchAll(PLAIN)) add(m[2]!, m[4]!);
  for (const m of text.matchAll(/find\s*:\s*(['"])([^'"]+)\1\s*,\s*replacement\s*:\s*[^,}]*?['"]((?:\.{1,2})?\/?[^'"]*)['"]/g)) {
    add(m[2]!, m[3]!);
  }
  return aliases.filter((a) => !/^https?:/.test(a.targets[0]!));
}

export function projectDir(root: string, rel: string): string {
  return dirname(join(root, rel));
}
