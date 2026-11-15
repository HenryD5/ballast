import { describe, expect, it } from 'vitest';
import { findUnusedPackages, typesBase, type DeclaredPackage, type PackageEvidence } from '../../src/core/packages';

function evidence(declared: Array<[string, 'dependencies' | 'devDependencies']>, extra: Partial<PackageEvidence> = {}): PackageEvidence {
  return {
    declared: declared.map(([name, section]): DeclaredPackage => ({ name, version: '1.0.0', section })),
    importedByKept: new Set(),
    builtinFromSource: new Set(),
    builtinFromNode: new Set(),
    importedByRemoved: new Map(),
    configTokens: new Set(),
    codeStrings: new Set(),
    commandTokens: new Set(),
    installed: new Map(),
    tsTypes: [],
    globalTypes: false,
    hasTypeScript: false,
    styleLangs: new Set(),
    testConfigText: '',
    scriptsText: '',
    ...extra,
  };
}

const unused = (e: PackageEvidence, ignore?: Set<string>) => findUnusedPackages(e, ignore).map((p) => `${p.name}:${p.reason}`);

describe('findUnusedPackages', () => {
  it('reports what nothing uses and keeps what code imports', () => {
    expect(unused(evidence([['vue', 'dependencies'], ['dayjs', 'dependencies']], { importedByKept: new Set(['vue']) }))).toEqual(['dayjs:noImport']);
  });

  it('understands ESLint, Prettier and Babel shorthands in configs', () => {
    const e = evidence(
      [
        ['eslint-plugin-vue', 'devDependencies'],
        ['eslint-config-prettier', 'devDependencies'],
        ['@typescript-eslint/eslint-plugin', 'devDependencies'],
        ['prettier-plugin-tailwindcss', 'devDependencies'],
        ['eslint-plugin-unused', 'devDependencies'],
      ],
      { configTokens: new Set(['plugin:vue/recommended', 'prettier', '@typescript-eslint', 'tailwindcss']) },
    );
    expect(unused(e)).toEqual(['eslint-plugin-unused:noImport']);
  });

  it('matches node_modules paths used by CSS and configs', () => {
    const e = evidence([['@acme/ui', 'dependencies']], { configTokens: new Set(['../../node_modules/@acme/ui/dist/index.js']) });
    expect(unused(e)).toEqual([]);
  });

  it('counts binaries used by scripts and hooks', () => {
    const e = evidence([['npm-run-all', 'devDependencies'], ['@commitlint/cli', 'devDependencies']], {
      commandTokens: new Set(['run-p', 'commitlint']),
      installed: new Map([
        ['npm-run-all', { bins: ['run-p', 'run-s'], peers: [] }],
        ['@commitlint/cli', { bins: ['commitlint'], peers: [] }],
      ]),
    });
    expect(unused(e)).toEqual([]);
  });

  it('keeps required peers of used packages, but not optional ones', () => {
    const e = evidence([['autoprefixer', 'devDependencies'], ['postcss', 'devDependencies'], ['terser', 'devDependencies']], {
      configTokens: new Set(['autoprefixer']),
      installed: new Map([
        ['autoprefixer', { bins: [], peers: ['postcss'] }],
        ['postcss', { bins: [], peers: [] }],
        ['terser', { bins: [], peers: [] }],
      ]),
    });
    expect(unused(e)).toEqual(['terser:noImport']);
  });

  it('decides about @types packages', () => {
    const declared: Array<[string, 'dependencies' | 'devDependencies']> = [
      ['lodash', 'dependencies'],
      ['@types/lodash', 'devDependencies'],
      ['@types/node', 'devDependencies'],
      ['@types/jest', 'devDependencies'],
    ];
    // Sin tsconfig que restrinja `types`, los @types de paquetes no declarados se cargan solos.
    expect(unused(evidence(declared, { hasTypeScript: true, globalTypes: true }))).toEqual(['lodash:noImport', '@types/lodash:typesOrphan']);
    // Con `types` restringido, @types/jest no se carga si no está en la lista.
    expect(unused(evidence(declared, { hasTypeScript: true, tsTypes: ['node'] }))).toEqual(['lodash:noImport', '@types/jest:noImport', '@types/lodash:typesOrphan']);
  });

  it('reports npm packages named like Node built-ins only when the browser code does not import them', () => {
    const e = evidence([['https', 'dependencies'], ['buffer', 'dependencies']], {
      builtinFromNode: new Set(['https']),
      builtinFromSource: new Set(['buffer']),
      configTokens: new Set(['https']),
    });
    expect(unused(e)).toEqual(['https:nodeBuiltin']);
  });

  it('marks packages imported only by removable files', () => {
    const e = evidence([['@internationalized/date', 'dependencies']], { importedByRemoved: new Map([['@internationalized/date', ['src/b.ts', 'src/a.ts']]]) });
    expect(findUnusedPackages(e)).toEqual([{ name: '@internationalized/date', version: '1.0.0', section: 'dependencies', reason: 'onlyUnusedFiles', files: ['src/a.ts', 'src/b.ts'] }]);
  });

  it('knows tooling used without imports', () => {
    const declared: Array<[string, 'dependencies' | 'devDependencies']> = [
      ['typescript', 'devDependencies'],
      ['sass', 'devDependencies'],
      ['less', 'devDependencies'],
      ['@vitest/coverage-v8', 'devDependencies'],
      ['@vitest/coverage-istanbul', 'devDependencies'],
      ['@vitest/ui', 'devDependencies'],
    ];
    const e = evidence(declared, { hasTypeScript: true, styleLangs: new Set(['scss']), testConfigText: "coverage: { provider: 'v8' }", scriptsText: 'vitest --ui' });
    expect(unused(e)).toEqual(['@vitest/coverage-istanbul:noImport', 'less:noImport']);
  });

  it('skips devDependencies without node_modules and honours ignore', () => {
    const e = evidence([['dayjs', 'dependencies'], ['left-pad', 'dependencies'], ['some-cli', 'devDependencies']], { installed: undefined });
    expect(unused(e, new Set(['left-pad']))).toEqual(['dayjs:noImport']);
  });
});

describe('typesBase', () => {
  it('maps @types names to their package', () => {
    expect(typesBase('@types/node')).toBe('node');
    expect(typesBase('@types/babel__core')).toBe('@babel/core');
    expect(typesBase('lodash')).toBeUndefined();
  });
});
