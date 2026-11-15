/**
 * Lectura de referencias de un archivo de código, sin parser completo.
 *
 * El criterio es conservador: ante la duda se cuenta como referencia. Un import de más solo hace que
 * algo parezca usado (no se reporta); uno de menos haría borrar algo que sí se usa.
 */

export interface Specifier {
  value: string;
  /** El valor es un glob (`import.meta.glob` o un import dinámico con plantilla). */
  glob: boolean;
}

export interface FileFacts {
  specifiers: Specifier[];
  /** Etiquetas usadas en plantillas (`<CqLimit>`, `<cq-limit>`). */
  tags: Set<string>;
  /** Identificadores que aparecen en el archivo (para auto-imports). */
  identifiers: Set<string>;
  /** `// @vitest-environment jsdom` y similares. */
  environments: string[];
}

const SPECIFIER_PATTERNS: RegExp[] = [
  // import x from 'a' · export { x } from 'a' · export * from 'a' · import type { T } from 'a'
  /\bfrom\s*(['"])([^'"\n]+)\1/g,
  // import 'a'
  /\bimport\s*(['"])([^'"\n]+)\1/g,
  // require('a') · import x = require('a')
  /\brequire\s*\(\s*(['"`])([^'"`\n]+)\1\s*\)/g,
  // vi.mock('a') · jest.requireActual('a') · vi.importActual('a')
  /\b(?:vi|jest)\s*\.\s*(?:mock|doMock|unmock|importActual|importMock|requireActual|requireMock)\s*(?:<[^>]*>)?\s*\(\s*(['"`])([^'"`\n]+)\1/g,
  // new URL('./worker.ts', import.meta.url)
  /\bnew\s+URL\s*\(\s*(['"])([^'"\n]+)\1\s*,\s*import\.meta\.url/g,
  // /// <reference path="./x.d.ts" />
  /\/\/\/\s*<reference\s+path\s*=\s*(['"])([^'"]+)\1/g,
];

/** import('a') con comillas simples, dobles o plantilla (`./views/${name}.vue` se vuelve glob). */
const DYNAMIC_IMPORT = /\bimport\s*\(\s*(?:\/\*[\s\S]*?\*\/\s*)?(['"`])((?:(?!\1)[^\n\\]|\\.)+)\1/g;
const META_GLOB = /\bimport\.meta\.glob(?:Eager)?\s*(?:<[^>]*>)?\s*\(\s*(\[[^\]]*\]|(['"`])[^'"`]+\2)/g;
const STRING_LITERAL = /(['"`])((?:(?!\1)[^\n\\]|\\.)*)\1/g;
const STYLE_IMPORT = /@(?:import|use|forward|plugin|config|reference|source)\s+(?:url\(\s*)?(['"])([^'"]+)\1/g;
const TAG = /<([A-Za-z][\w.-]*)/g;
const IDENTIFIER = /[A-Za-z_$][\w$]*/g;
const ENVIRONMENT = /@(?:vitest|jest)-environment\s+([\w@/.-]+)/g;

/**
 * Quita solo comentarios que empiezan una línea: no puede confundirse con código ni con strings,
 * y cubre los imports comentados, que es lo que importa aquí.
 */
export function stripLineComments(code: string): string {
  return code.replace(/^[ \t]*\/\*[\s\S]*?\*\/[ \t]*$/gm, '').replace(/^[ \t]*\/\/(?!\/\s*<reference).*$/gm, '');
}

export function extractScript(code: string): Pick<FileFacts, 'specifiers' | 'environments'> {
  const environments = [...code.matchAll(ENVIRONMENT)].map((m) => m[1]!);
  const clean = stripLineComments(code);
  const specifiers: Specifier[] = [];
  for (const pattern of SPECIFIER_PATTERNS) {
    for (const m of clean.matchAll(pattern)) specifiers.push({ value: m[2]!, glob: false });
  }
  for (const m of clean.matchAll(DYNAMIC_IMPORT)) {
    const raw = m[2]!;
    if (m[1] === '`' && raw.includes('${')) {
      // Plantilla: cada `${…}` puede ser cualquier cosa, incluso varias carpetas.
      specifiers.push({ value: raw.replace(/\$\{[^}]*\}/g, '**'), glob: true });
    } else {
      specifiers.push({ value: raw, glob: false });
    }
  }
  // Webpack: require.context('./components', true, /\.vue$/)
  for (const m of clean.matchAll(/\brequire\.context\s*\(\s*(['"])([^'"]+)\1\s*(?:,\s*(true|false))?/g)) {
    specifiers.push({ value: `${m[2]!.replace(/\/$/, '')}/${m[3] === 'false' ? '*' : '**'}`, glob: true });
  }
  for (const m of clean.matchAll(META_GLOB)) {
    for (const s of m[1]!.matchAll(STRING_LITERAL)) {
      const value = s[2]!;
      if (value && !value.startsWith('!')) specifiers.push({ value, glob: true });
    }
  }
  return { specifiers, environments };
}

/** Bloques de un SFC de Vue. Lo que no es script ni style es plantilla. */
export function splitVue(code: string): { scripts: string[]; styles: string[]; template: string } {
  const scripts: string[] = [];
  const styles: string[] = [];
  let template = code.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, (_, body: string) => {
    scripts.push(body);
    return '';
  });
  template = template.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_, body: string) => {
    styles.push(body);
    return '';
  });
  // <script src="./x.ts"> y <style src="./x.css">
  for (const m of code.matchAll(/<(?:script|style)\b[^>]*\bsrc\s*=\s*(['"])([^'"]+)\1/gi)) scripts.push(`import '${m[2]}'`);
  return { scripts, styles, template };
}

export function extractStyle(code: string): Specifier[] {
  return [...code.matchAll(STYLE_IMPORT)].map((m) => ({ value: m[2]!.replace(/^~(?=[^/])/, ''), glob: false }));
}

export function extractFacts(path: string, code: string): FileFacts {
  const isVue = path.endsWith('.vue');
  const parts = isVue ? splitVue(code) : { scripts: [code], styles: [] as string[], template: '' };
  const specifiers: Specifier[] = [];
  const environments: string[] = [];
  for (const script of parts.scripts) {
    const facts = extractScript(script);
    specifiers.push(...facts.specifiers);
    environments.push(...facts.environments);
  }
  for (const style of parts.styles) specifiers.push(...extractStyle(style));
  // Las etiquetas salen de la plantilla de Vue y del JSX/TSX (o `h('Comp')`, que también se lee como identificador).
  const tagSource = isVue ? parts.template : /\.[jt]sx$/.test(path) ? code : '';
  const tags = new Set([...tagSource.matchAll(TAG)].map((m) => m[1]!));
  const identifiers = new Set(code.match(IDENTIFIER) ?? []);
  return { specifiers, tags, identifiers, environments };
}

/** `cq-limit` → `CqLimit`, para comparar etiquetas con nombres de componentes. */
export function pascalCase(tag: string): string {
  return tag
    .split(/[-_.]/)
    .filter(Boolean)
    .map((p) => p[0]!.toUpperCase() + p.slice(1))
    .join('');
}
