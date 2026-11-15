import { builtinModules } from 'node:module';
import { posix } from 'node:path';
import { CODE_EXTENSIONS, isCodeFile, isDeclarationFile } from './classify';
import { globToRegExp } from './glob';
import type { Alias } from './project';

const BUILTINS = new Set(builtinModules.filter((m) => !m.startsWith('_')));

export function isBuiltin(name: string): boolean {
  return BUILTINS.has(name) || BUILTINS.has(name.split('/')[0]!);
}

export type Resolution =
  | { type: 'files'; files: string[] }
  | { type: 'package'; name: string }
  | { type: 'builtin'; name: string }
  | { type: 'none' };

/** `@scope/pkg/sub` → `@scope/pkg`; `pkg/sub` → `pkg`. */
export function packageName(specifier: string): string | undefined {
  if (!/^[@a-z0-9]/i.test(specifier)) return undefined;
  const parts = specifier.split('/');
  if (specifier.startsWith('@')) return parts.length >= 2 && parts[1] ? `${parts[0]}/${parts[1]}` : undefined;
  return parts[0];
}

/** Módulos virtuales de plugins: no son paquetes ni archivos. */
const VIRTUAL = /^(?:virtual:|~icons\/|\0|astro:|\$app\/|\$lib\/|#)/;

export class Resolver {
  private readonly fileSet: Set<string>;
  private readonly codeFiles: string[];
  private readonly aliases: Alias[];

  constructor(
    files: readonly string[],
    aliases: readonly Alias[],
    private readonly baseUrls: readonly string[] = [],
  ) {
    this.fileSet = new Set(files);
    this.codeFiles = files.filter(isCodeFile);
    // Los patrones más específicos primero (como TypeScript).
    this.aliases = [...aliases].sort((a, b) => b.pattern.replace('*', '').length - a.pattern.replace('*', '').length);
  }

  resolve(specifier: string, fromFile: string, glob = false): Resolution {
    const spec = specifier.replace(/[?#].*$/, '');
    if (!spec || VIRTUAL.test(specifier)) return { type: 'none' };
    if (spec.startsWith('node:')) return { type: 'builtin', name: spec.slice(5).split('/')[0]! };
    const fromDir = posix.dirname(fromFile) === '.' ? '' : posix.dirname(fromFile);

    if (spec.startsWith('./') || spec.startsWith('../') || spec === '.' || spec === '..') {
      return this.paths([posix.join(fromDir, spec)], glob);
    }
    if (spec.startsWith('/')) return this.paths([spec.slice(1)], glob);

    for (const alias of this.aliases) {
      const star = this.match(alias.pattern, spec);
      if (star === undefined) continue;
      const found = this.paths(alias.targets.map((t) => t.replace('*', star)), glob);
      if (found.type === 'files') return found;
    }
    for (const base of this.baseUrls) {
      const found = this.paths([posix.join(base, spec)], glob);
      if (found.type === 'files') return found;
    }
    const name = packageName(spec);
    if (!name) return { type: 'none' };
    if (isBuiltin(name)) return { type: 'builtin', name };
    return { type: 'package', name };
  }

  private match(pattern: string, spec: string): string | undefined {
    const i = pattern.indexOf('*');
    if (i < 0) return pattern === spec ? '' : undefined;
    const prefix = pattern.slice(0, i);
    const suffix = pattern.slice(i + 1);
    if (spec.length < prefix.length + suffix.length || !spec.startsWith(prefix) || !spec.endsWith(suffix)) return undefined;
    return spec.slice(prefix.length, spec.length - suffix.length);
  }

  private paths(candidates: string[], glob: boolean): Resolution {
    const files = new Set<string>();
    for (const raw of candidates) {
      const path = posix.normalize(raw).replace(/^\.\//, '').replace(/\/$/, '');
      if (path.startsWith('..')) continue;
      if (glob) {
        const re = globToRegExp(path);
        // Un glob sin extensión (`./views/**`) puede apuntar a archivos con cualquier extensión.
        const loose = /\.[a-z]+$/i.test(path) ? undefined : globToRegExp(`${path}.*`);
        for (const f of this.codeFiles) if (re.test(f) || loose?.test(f)) files.add(f);
      } else {
        const hit = this.file(path);
        if (hit) files.add(hit);
      }
    }
    return files.size ? { type: 'files', files: [...files] } : { type: 'none' };
  }

  /** Un archivo de código para la ruta, probando extensiones e `index` como Vite y TypeScript. */
  private file(path: string): string | undefined {
    const tries: string[] = [];
    if (isCodeFile(path)) tries.push(path);
    // ESM con TypeScript: `./x.js` apunta a `x.ts`.
    const swapped = path.replace(/\.js$/, '.ts').replace(/\.jsx$/, '.tsx').replace(/\.mjs$/, '.mts').replace(/\.cjs$/, '.cts');
    if (swapped !== path) tries.push(swapped, path.replace(/\.js$/, '.tsx'));
    for (const ext of CODE_EXTENSIONS) tries.push(`${path}${ext}`);
    for (const ext of CODE_EXTENSIONS) tries.push(`${path}/index${ext}`);
    for (const t of tries) if (this.fileSet.has(t) && !isDeclarationFile(t)) return t;
    return undefined;
  }

  /** La ruta existe como archivo (de cualquier tipo). */
  exists(path: string): boolean {
    return this.fileSet.has(path);
  }
}
