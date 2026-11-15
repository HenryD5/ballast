import { isBuiltin } from './resolve';
import type { UnusedPackage } from './types';

export interface DeclaredPackage {
  name: string;
  version: string;
  section: 'dependencies' | 'devDependencies';
}

export interface PackageEvidence {
  declared: DeclaredPackage[];
  /** Paquetes importados por archivos que se quedan en el proyecto. */
  importedByKept: Set<string>;
  /** Nombres de módulos nativos importados desde código del navegador (src, tests). */
  builtinFromSource: Set<string>;
  /** Nombres de módulos nativos importados desde configuración o scripts de Node. */
  builtinFromNode: Set<string>;
  /** Paquete → archivos sin uso (que se borrarían) que lo importan. */
  importedByRemoved: Map<string, string[]>;
  /** Palabras y strings de configuraciones, CSS, HTML, hooks y workflows. */
  configTokens: Set<string>;
  /** Strings literales del código (coincidencia exacta con un nombre de paquete). */
  codeStrings: Set<string>;
  /** Palabras de scripts y hooks que pueden ser comandos (binarios). */
  commandTokens: Set<string>;
  /** Paquete instalado → binarios y peerDependencies obligatorias. `undefined` si no hay node_modules. */
  installed: Map<string, { bins: string[]; peers: string[] }> | undefined;
  tsTypes: string[];
  /** Algún tsconfig carga todos los `@types/*` (no restringe `types`). */
  globalTypes: boolean;
  hasTypeScript: boolean;
  /** Extensiones o `lang` de estilos usados (`scss`, `less`, `styl`…). */
  styleLangs: Set<string>;
  /** Texto de configuración de tests (para el proveedor de cobertura y `--ui`). */
  testConfigText: string;
  scriptsText: string;
}

const PREFIXES = ['eslint-plugin-', 'eslint-config-', 'prettier-plugin-', 'stylelint-config-', 'stylelint-', 'babel-plugin-', 'babel-preset-', 'postcss-', 'remark-', 'rehype-'];

/** `@types/scope__pkg` → `@scope/pkg`; `@types/node` → `node`. */
export function typesBase(name: string): string | undefined {
  if (!name.startsWith('@types/')) return undefined;
  const base = name.slice(7);
  return base.includes('__') ? `@${base.replace('__', '/')}` : base;
}

/** ¿Una palabra de configuración nombra este paquete? Cubre las abreviaturas de ESLint, Prettier, Babel… */
function namedBy(name: string, tokens: Set<string>): boolean {
  if (tokens.has(name)) return true;
  for (const t of tokens) {
    if (t.startsWith(`${name}/`)) return true;
    // `@source "../node_modules/pkg/dist/index.js"` (Tailwind) y rutas parecidas en CSS o configuración.
    if (t.includes(`node_modules/${name}/`) || t.endsWith(`node_modules/${name}`)) return true;
    const short = t.replace(/^plugin:/, '').split('/')[0]!;
    if (!short) continue;
    for (const prefix of PREFIXES) {
      if (name === `${prefix}${short}`) return true;
      // `@vue` en plugins → `@vue/eslint-plugin`; `@scope/x` → `@scope/eslint-plugin-x`
      if (short.startsWith('@')) {
        const [scope, rest] = t.replace(/^plugin:/, '').split('/');
        if (name === `${scope}/${prefix.replace(/-$/, '')}` || (rest && name === `${scope}/${prefix}${rest}`)) return true;
      }
    }
  }
  return false;
}

/** Paquetes que la herramienta usa sin que nadie los importe. */
function implicitlyUsed(name: string, e: PackageEvidence): boolean {
  if (name === 'typescript') return e.hasTypeScript;
  if (/^(?:sass|sass-embedded|node-sass)$/.test(name)) return e.styleLangs.has('scss') || e.styleLangs.has('sass');
  if (name === 'less') return e.styleLangs.has('less');
  if (name === 'stylus') return e.styleLangs.has('styl') || e.styleLangs.has('stylus');
  const coverage = name.match(/^@vitest\/coverage-(.+)$/);
  if (coverage) {
    const provider = e.testConfigText.match(/provider\s*:\s*['"]([\w-]+)['"]/)?.[1];
    const wantsCoverage = /\bcoverage\b/.test(e.testConfigText) || /--coverage\b/.test(e.scriptsText);
    return provider ? provider === coverage[1] : wantsCoverage && coverage[1] === 'v8';
  }
  if (name === '@vitest/ui') return /--ui\b/.test(e.scriptsText) || /\bui\s*:\s*true/.test(e.testConfigText);
  return false;
}

export function findUnusedPackages(e: PackageEvidence, ignore: ReadonlySet<string> = new Set()): UnusedPackage[] {
  const declared = new Map(e.declared.map((d) => [d.name, d]));
  const binOwner = new Map<string, string>();
  for (const [name, info] of e.installed ?? []) for (const bin of info.bins) binOwner.set(bin, name);

  const used = new Set<string>();
  for (const { name } of e.declared) {
    if (isBuiltin(name) && !e.importedByKept.has(name)) {
      // Desde la configuración (Node) `import https from 'https'` es el módulo nativo: las palabras de la
      // configuración no cuentan. Solo cuenta un import desde código del navegador, donde sí puede ser el de npm.
      if (e.builtinFromSource.has(name)) used.add(name);
      continue;
    }
    if (
      e.importedByKept.has(name) ||
      namedBy(name, e.configTokens) ||
      e.codeStrings.has(name) ||
      e.commandTokens.has(name) ||
      e.tsTypes.includes(name) ||
      implicitlyUsed(name, e)
    ) {
      used.add(name);
    }
  }
  for (const token of e.commandTokens) {
    const owner = binOwner.get(token);
    if (owner) used.add(owner);
  }
  // Un paquete usado arrastra sus peerDependencies obligatorias.
  const queue = [...used];
  while (queue.length) {
    const name = queue.pop()!;
    for (const peer of e.installed?.get(name)?.peers ?? []) {
      if (declared.has(peer) && !used.has(peer)) {
        used.add(peer);
        queue.push(peer);
      }
    }
  }
  // Tipos: siguen a su paquete; los de paquetes no declarados se cargan solos si ningún tsconfig restringe `types`.
  for (const { name } of e.declared) {
    const base = typesBase(name);
    if (!base || used.has(name)) continue;
    const listed = e.tsTypes.includes(base) || e.tsTypes.includes(name);
    if (declared.has(base)) {
      if (used.has(base) || listed) used.add(name);
    } else if (listed || (e.globalTypes && e.hasTypeScript) || (base === 'node' && e.hasTypeScript) || e.importedByKept.has(name)) {
      used.add(name);
    }
  }

  const result: UnusedPackage[] = [];
  for (const d of e.declared) {
    if (used.has(d.name) || ignore.has(d.name)) continue;
    // Sin node_modules no se conocen binarios ni peers: los de desarrollo no se pueden juzgar con seguridad.
    if (!e.installed && d.section === 'devDependencies') continue;
    const base = typesBase(d.name);
    const files = e.importedByRemoved.get(d.name) ?? [];
    const reason: UnusedPackage['reason'] =
      base && declared.has(base)
        ? 'typesOrphan'
        : files.length
          ? 'onlyUnusedFiles'
          : isBuiltin(d.name) && e.builtinFromNode.has(d.name)
            ? 'nodeBuiltin'
            : 'noImport';
    result.push({ name: d.name, version: d.version, section: d.section, reason, files: [...files].sort() });
  }
  return result.sort((a, b) => a.section.localeCompare(b.section) || a.name.localeCompare(b.name));
}
