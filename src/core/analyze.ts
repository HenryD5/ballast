import { join, posix } from 'node:path';
import { classify, isCodeFile, isConfigLike, isDeclarationFile, isInTestRoot, isReportable, isTestFile, moduleOf } from './classify';
import { extractFacts, pascalCase, stripLineComments, type FileFacts } from './extract';
import { globToRegExp, matchesAny } from './glob';
import { findUnusedPackages, type DeclaredPackage } from './packages';
import { fileSize, readConfigAliases, readInstalled, readJson, readText, readTsConfigs, walk, type Alias, type Manifest } from './project';
import { Resolver } from './resolve';
import type { AnalysisResult, AnalysisWarning, AnalyzeOptions, UnusedFile } from './types';

const ROOT_CONFIG = /^(?:[\w.-]+\.config\.[cm]?[jt]s|\.[\w-]+rc(?:\.[\w]+)?|[\w.-]+\.(?:json|jsonc|ya?ml|html)|\.[\w-]+\.(?:json|ya?ml|[cm]?js))$/;
const STYLE_FILE = /\.(?:css|scss|sass|less|pcss|postcss|styl|stylus)$/;
const TEST_CONFIG = /(?:vitest|jest|playwright|cypress|karma|test)/i;
const NOT_CONFIG = new Set(['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'components.d.ts', 'auto-imports.d.ts']);

interface Node {
  path: string;
  facts: FileFacts;
  /** Archivos que importa (resueltos). */
  edges: Set<string>;
  /** Paquetes que importa. */
  packages: Set<string>;
  builtins: Set<string>;
  strings: Set<string>;
  ambient: boolean;
}

/**
 * Referencias a archivos que una configuración arma de otra forma que con un string de ruta:
 * - plantillas: `` `${src}/views/Dashboard.vue` `` → `**\/views/Dashboard.vue`;
 * - solo el nombre: `filename: 'sw.ts'` (PWA, workers) → cualquier `sw.ts` del proyecto.
 */
export function configFileReferences(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/`([^`\n]*\$\{[^`\n]*)`/g)) {
    const glob = m[1]!.replace(/\$\{[^}]*\}/g, '**').replace(/\*\*(?:\/?\*\*)+/g, '**');
    // Solo si queda una parte fija con nombre de archivo: `${x}` a secas marcaría todo el proyecto.
    if (/\/[\w.-]+\.[cm]?[jt]sx?$|\/[\w.-]+\.vue$/.test(glob)) out.push(glob.startsWith('**') ? glob : glob.replace(/^\.?\//, ''));
  }
  for (const m of text.matchAll(/(['"])([\w.-]+\.(?:vue|[cm]?[jt]sx?))\1/g)) out.push(`**/${m[2]}`);
  return out;
}

/** Analiza el proyecto en `root` y devuelve archivos y paquetes que no se usan. Solo lee. */
export async function analyze(root: string, options: AnalyzeOptions = {}): Promise<AnalysisResult> {
  const started = Date.now();
  const manifest = (await readJson<Manifest>(join(root, 'package.json'))) ?? {};
  const files = await walk(root);
  const ignoreGlobs = (options.ignore ?? []).filter((i) => i.includes('/') || i.includes('*')).map(globToRegExp);
  const ignoreNames = new Set((options.ignore ?? []).filter((i) => !i.includes('*')));

  const deps: DeclaredPackage[] = [
    ...Object.entries(manifest.dependencies ?? {}).map(([name, version]) => ({ name, version, section: 'dependencies' as const })),
    ...Object.entries(manifest.devDependencies ?? {}).map(([name, version]) => ({ name, version, section: 'devDependencies' as const })),
  ];
  const declaredNames = new Set(deps.map((d) => d.name));
  const has = (name: string) => declaredNames.has(name);
  const frameworks = ['nuxt', 'next', 'vue', 'react', 'svelte', 'vite', 'vitest', 'jest'].filter((f) => has(f));

  // --- Configuración: alias, textos y tokens --------------------------------------------------
  const ts = await readTsConfigs(root, files);
  const rootFiles = files.filter((f) => !f.includes('/'));
  const configFiles = rootFiles.filter((f) => !NOT_CONFIG.has(f) && (ROOT_CONFIG.test(f) || (isCodeFile(f) && !isDeclarationFile(f))));
  const configTexts = new Map<string, string>();
  for (const f of configFiles) configTexts.set(f, (await readText(join(root, f))) ?? '');
  const aliases: Alias[] = [...ts.aliases];
  for (const [f, text] of configTexts) if (/^(?:vite|vitest|webpack|nuxt|rollup|rsbuild|quasar)\.config/.test(f)) aliases.push(...readConfigAliases(f, text));
  const resolver = new Resolver(files, aliases, ts.baseUrls);

  // --- Hechos de cada archivo de código ------------------------------------------------------
  const codeFiles = files.filter((f) => isCodeFile(f) && !isDeclarationFile(f));
  const nodes = new Map<string, Node>();
  for (const path of codeFiles) {
    const text = (await readText(join(root, path))) ?? '';
    nodes.set(path, {
      path,
      facts: extractFacts(path, text),
      edges: new Set(),
      packages: new Set(),
      builtins: new Set(),
      strings: new Set([...stripLineComments(text).matchAll(/(['"`])([@\w][\w@/.-]*)\1/g)].map((m) => m[2]!)),
      // `declare global` / `declare module`: TypeScript lo carga por el `include` del tsconfig, sin import.
      ambient: /^\s*declare\s+(?:global\b|module\s+['"])/m.test(text),
    });
  }
  /** Se puede reportar: código de la app o de tests que no es configuración ni declaración ambiental. */
  const reportable = (path: string) => isReportable(path) && !isConfigLike(path) && !nodes.get(path)?.ambient;

  // Auto-imports (unplugin-vue-components, unplugin-auto-import, Nuxt): nombre → archivo.
  const autoComponents = new Map<string, string>();
  const autoIdentifiers = new Map<string, string>();
  const dtsFiles = files.filter((f) => /(?:^|\/)(?:components|auto-imports|imports)\.d\.ts$/.test(f));
  for (const extra of ['.nuxt/components.d.ts', '.nuxt/imports.d.ts', '.nuxt/types/imports.d.ts']) dtsFiles.push(extra);
  let foundComponentsDts = false;
  let foundImportsDts = false;
  for (const dts of dtsFiles) {
    const text = await readText(join(root, dts));
    if (!text) continue;
    for (const m of text.matchAll(/(?:const\s+)?['"]?([\w$]+)['"]?\s*:\s*(?:typeof\s+)?import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const resolved = resolver.resolve(m[2]!, dts);
      if (resolved.type !== 'files') continue;
      const target = resolved.files[0]!;
      if (target.endsWith('.vue') || /^[A-Z]/.test(m[1]!) && /components/.test(dts)) {
        autoComponents.set(m[1]!, target);
        foundComponentsDts = true;
      } else {
        autoIdentifiers.set(m[1]!, target);
        foundImportsDts = true;
      }
    }
  }

  // --- Aristas ------------------------------------------------------------------------------
  for (const node of nodes.values()) {
    for (const spec of node.facts.specifiers) {
      const r = resolver.resolve(spec.value, node.path, spec.glob);
      if (r.type === 'files') r.files.forEach((f) => f !== node.path && node.edges.add(f));
      else if (r.type === 'package') node.packages.add(r.name);
      else if (r.type === 'builtin') node.builtins.add(r.name);
    }
    for (const tag of node.facts.tags) {
      for (const name of [tag, pascalCase(tag), pascalCase(tag).replace(/^Lazy/, '')]) {
        const target = autoComponents.get(name);
        if (target && target !== node.path) node.edges.add(target);
      }
    }
    if (autoIdentifiers.size) {
      for (const id of node.facts.identifiers) {
        const target = autoIdentifiers.get(id);
        if (target && target !== node.path) node.edges.add(target);
      }
    }
  }

  // --- Puntos de entrada --------------------------------------------------------------------
  const appEntries = new Set<string>();
  const testEntries = new Set<string>();
  const addResolved = (spec: string, from: string, set: Set<string>) => {
    const r = resolver.resolve(spec, from, spec.includes('*'));
    if (r.type === 'files') r.files.forEach((f) => set.add(f));
    else if (!spec.startsWith('.') && !spec.startsWith('/')) {
      // Rutas relativas a la raíz (`tests/setup.ts`, `src/main.ts`).
      const again = resolver.resolve(`./${spec}`, 'package.json', spec.includes('*'));
      if (again.type === 'files') again.files.forEach((f) => set.add(f));
    }
  };

  for (const path of codeFiles) {
    // Todo lo que está fuera de las carpetas de código (configuraciones, scripts) se considera en uso.
    if (!reportable(path)) (isTestFile(path) || TEST_CONFIG.test(path) ? testEntries : appEntries).add(path);
    if (isTestFile(path)) testEntries.add(path);
  }
  for (const [f, text] of configTexts) {
    const target = TEST_CONFIG.test(f) ? testEntries : appEntries;
    if (f.endsWith('.html')) {
      for (const m of text.matchAll(/<script\b[^>]*\bsrc\s*=\s*(['"])([^'"]+)\1/gi)) addResolved(m[2]!, f, appEntries);
      continue;
    }
    // Strings de la configuración que nombran archivos: setupFiles, exposes de federación, input de Rollup…
    // Los globs se ignoran: suelen ser listas de inclusión o exclusión (de tests o de cobertura), no usos.
    for (const m of text.matchAll(/(['"`])((?:\.{0,2}\/|[@#$~]?[\w-]*\/)[^'"`\s]*)\1/g)) {
      if (/^https?:/.test(m[2]!) || /[*{}]/.test(m[2]!)) continue;
      addResolved(m[2]!, f, target);
    }
    for (const spec of configFileReferences(text)) addResolved(spec, f, target);
  }
  // Las configuraciones fuera de la raíz (config/, scripts/, setup en src) también pueden nombrar archivos.
  for (const node of nodes.values()) {
    if (reportable(node.path) || !node.path.includes('/')) continue;
    for (const s of node.strings) if (s.includes('/')) addResolved(s, node.path, appEntries);
    for (const spec of configFileReferences((await readText(join(root, node.path))) ?? '')) addResolved(spec, node.path, appEntries);
  }
  // Scripts de package.json, hooks de Git y workflows: `tsx src/scripts/seed.ts`, `node ./tools/x.mjs`.
  const commandTexts = [Object.values(manifest.scripts ?? {}).join('\n')];
  for (const f of files) if (/^\.(?:husky|github)\//.test(f)) commandTexts.push((await readText(join(root, f))) ?? '');
  for (const text of commandTexts) {
    for (const m of text.matchAll(/(?:^|[\s'"=])((?:\.{1,2}\/)?[\w@~.-]+(?:\/[\w@~.-]+)*\.[cm]?[jt]sx?)(?=$|[\s'";&|)])/gm)) addResolved(m[1]!, 'package.json', appEntries);
  }
  for (const field of ['main', 'module', 'browser', 'exports', 'bin', 'types', 'source']) {
    for (const s of JSON.stringify(manifest[field] ?? '').match(/"\.?\/?[^"]+\.[cm]?[jt]sx?"/g) ?? []) addResolved(s.slice(1, -1), 'package.json', appEntries);
  }

  const dirEntries = (dirs: string[]) => {
    for (const path of codeFiles) if (dirs.some((d) => path === d || path.startsWith(`${d}/`))) appEntries.add(path);
  };
  const withApp = (dirs: string[]) => dirs.flatMap((d) => [d, `app/${d}`, `src/${d}`]);
  if (has('nuxt')) {
    dirEntries(withApp(['pages', 'layouts', 'middleware', 'plugins', 'server', 'modules', 'app.vue', 'error.vue', 'app.config.ts', 'router.options.ts']));
    if (!foundComponentsDts) dirEntries(withApp(['components']));
    if (!foundImportsDts) dirEntries(withApp(['composables', 'utils', 'stores']));
  }
  if (has('next')) {
    dirEntries(['app', 'pages', 'src/app', 'src/pages']);
    for (const path of codeFiles) if (/^(?:src\/)?(?:middleware|instrumentation)\.[jt]s$/.test(path)) appEntries.add(path);
  }
  if (has('unplugin-vue-components') && !foundComponentsDts) dirEntries(['src/components']);
  if (has('unplugin-auto-import') && !foundImportsDts) dirEntries(['src/composables', 'src/utils', 'src/stores']);
  if (![...appEntries].some((e) => reportable(e))) {
    for (const path of codeFiles) if (/^(?:src\/)?(?:main|index|App)\.[cm]?[jt]sx?$/.test(path)) appEntries.add(path);
  }

  // --- Alcance ------------------------------------------------------------------------------
  const reach = (starts: Iterable<string>) => {
    const seen = new Set<string>();
    const stack = [...starts].filter((s) => nodes.has(s));
    while (stack.length) {
      const path = stack.pop()!;
      if (seen.has(path)) continue;
      seen.add(path);
      for (const next of nodes.get(path)!.edges) if (!seen.has(next) && nodes.has(next)) stack.push(next);
    }
    return seen;
  };
  const appUsed = reach(appEntries);
  const anyUsed = reach([...appEntries, ...testEntries]);

  const importers = new Map<string, string[]>();
  for (const node of nodes.values()) for (const e of node.edges) importers.set(e, [...(importers.get(e) ?? []), node.path]);

  // Candidatos: código de la app que la app no usa, y archivos de tests que ningún test usa.
  const candidates = new Set<string>();
  for (const path of codeFiles) {
    if (!reportable(path) || isTestFile(path) || appEntries.has(path) || testEntries.has(path)) continue;
    if (matchesAny(path, ignoreGlobs)) continue;
    if (isInTestRoot(path) ? !anyUsed.has(path) : !appUsed.has(path)) candidates.add(path);
  }
  // Solo queda lo que se puede borrar sin romper nada: cada archivo que lo importa también se borra.
  const ownTest = (file: string, test: string) => {
    if (!isTestFile(test)) return false;
    const stem = (p: string) => posix.basename(p).replace(/\.(?:test|spec|stories|story)(?=\.)/, '').replace(/\.[^.]+$/, '');
    const fileStem = stem(file) === 'index' ? posix.basename(posix.dirname(file)) : stem(file);
    return stem(test) === fileStem;
  };
  let changed = true;
  while (changed) {
    changed = false;
    for (const path of candidates) {
      const blocked = (importers.get(path) ?? []).some((i) => !candidates.has(i) && !ownTest(path, i));
      if (blocked) {
        candidates.delete(path);
        changed = true;
      }
    }
  }

  const unusedFiles: UnusedFile[] = [];
  for (const path of candidates) {
    const by = importers.get(path) ?? [];
    const tests = by.filter((i) => !candidates.has(i) && ownTest(path, i)).sort();
    const importedBy = by.filter((i) => candidates.has(i)).sort();
    const parts = path.split('/');
    unusedFiles.push({
      path,
      dir: parts.slice(0, -1).join('/'),
      name: parts[parts.length - 1]!,
      module: moduleOf(path),
      kind: classify(path),
      reason: anyUsed.has(path) && !isInTestRoot(path) && tests.length ? 'onlyTests' : importedBy.length ? 'onlyUnused' : 'unreferenced',
      size: (await fileSize(join(root, path))) + (await Promise.all(tests.map((t) => fileSize(join(root, t))))).reduce((a, b) => a + b, 0),
      importedBy,
      tests,
    });
  }
  unusedFiles.sort((a, b) => a.module.localeCompare(b.module) || a.path.localeCompare(b.path));

  // --- Paquetes -----------------------------------------------------------------------------
  const removed = new Set<string>([...candidates, ...unusedFiles.flatMap((f) => f.tests)]);
  const importedByKept = new Set<string>();
  const importedByRemoved = new Map<string, string[]>();
  const builtinFromSource = new Set<string>();
  const builtinFromNode = new Set<string>();
  const codeStrings = new Set<string>();
  const environments: string[] = [];
  for (const node of nodes.values()) {
    if (removed.has(node.path)) {
      for (const p of node.packages) importedByRemoved.set(p, [...(importedByRemoved.get(p) ?? []), node.path]);
      continue;
    }
    node.packages.forEach((p) => importedByKept.add(p));
    node.builtins.forEach((b) => (isReportable(node.path) ? builtinFromSource : builtinFromNode).add(b));
    node.strings.forEach((s) => declaredNames.has(s) && codeStrings.add(s));
    environments.push(...node.facts.environments);
  }

  const tokenize = (text: string) => (text.match(/[@\w][\w@/.:-]*/g) ?? []).map((t) => t.replace(/[:./]+$/, ''));
  const configTokens = new Set<string>(environments);
  const commandTokens = new Set<string>();
  const addCommands = (text: string) => tokenize(text).forEach((t) => commandTokens.add(t));
  const { dependencies: _d, devDependencies: _dd, scripts = {}, name: _n, version: _v, description: _desc, ...restManifest } = manifest;
  const scriptsText = Object.values(scripts).join('\n');
  addCommands(scriptsText);
  tokenize(JSON.stringify(restManifest)).forEach((t) => configTokens.add(t));
  for (const [, text] of configTexts) {
    tokenize(text).forEach((t) => configTokens.add(t));
    addCommands(text);
  }
  for (const f of files) {
    if (/^\.(?:husky|github)\//.test(f) || /^\.storybook\//.test(f) || STYLE_FILE.test(f) || /^tsconfig.*\.json$/.test(f)) {
      const text = (await readText(join(root, f))) ?? '';
      tokenize(text).forEach((t) => configTokens.add(t));
      if (/^\.(?:husky|github)\//.test(f)) addCommands(text);
    }
  }
  // Código de Node fuera de src (config/, scripts/): sus palabras también cuentan.
  for (const node of nodes.values()) if (!reportable(node.path) && node.path.includes('/')) node.strings.forEach((s) => configTokens.add(s));

  const styleLangs = new Set<string>();
  for (const f of files) {
    const ext = f.match(STYLE_FILE)?.[0]?.slice(1);
    if (ext) styleLangs.add(ext);
  }
  for (const node of nodes.values()) {
    if (!node.path.endsWith('.vue')) continue;
    const text = (await readText(join(root, node.path))) ?? '';
    for (const m of text.matchAll(/<style\b[^>]*\blang\s*=\s*['"](\w+)['"]/g)) styleLangs.add(m[1]!);
  }

  const warnings: AnalysisWarning[] = [];
  let installed: Map<string, { bins: string[]; peers: string[] }> | undefined = new Map();
  for (const d of deps) {
    const info = await readInstalled(root, d.name);
    if (info) installed.set(d.name, info);
  }
  if (deps.length && installed.size === 0) {
    installed = undefined;
    warnings.push('noNodeModules');
  }
  if (manifest.workspaces) warnings.push('workspaces');

  const packages = findUnusedPackages(
    {
      declared: deps,
      importedByKept,
      builtinFromSource,
      builtinFromNode,
      importedByRemoved,
      configTokens,
      codeStrings,
      commandTokens,
      installed,
      tsTypes: ts.types,
      globalTypes: ts.globalTypes,
      hasTypeScript: ts.found || codeFiles.some((f) => /\.[cm]?tsx?$/.test(f)),
      styleLangs,
      testConfigText: [...configTexts].filter(([f]) => TEST_CONFIG.test(f) || /^vite\.config/.test(f)).map(([, t]) => t).join('\n'),
      scriptsText,
    },
    ignoreNames,
  );

  return {
    root,
    projectName: manifest.name ?? posix.basename(root.replace(/\\/g, '/')),
    frameworks,
    packageManager: files.includes('pnpm-lock.yaml') ? 'pnpm' : files.includes('yarn.lock') ? 'yarn' : files.some((f) => /^bun\.lockb?$/.test(f)) ? 'bun' : 'npm',
    totals: { files: codeFiles.length, packages: deps.length },
    files: unusedFiles,
    packages,
    warnings,
    durationMs: Date.now() - started,
  };
}
