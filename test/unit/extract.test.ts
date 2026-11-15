import { describe, expect, it } from 'vitest';
import { extractFacts, pascalCase, splitVue, stripLineComments } from '../../src/core/extract';
import { globToRegExp } from '../../src/core/glob';
import { parseJsonc } from '../../src/core/jsonc';

const values = (path: string, code: string) => extractFacts(path, code).specifiers.map((s) => (s.glob ? `glob:${s.value}` : s.value));

describe('extractFacts', () => {
  it('reads every kind of import and export', () => {
    const code = `
      import a from './a';
      import { b } from "../b";
      import type { T } from '~/types/t';
      import './side-effect.css';
      export * from './barrel';
      export { c } from '@scope/pkg/sub';
      const d = require('d-lib');
      const e = await import('./lazy.vue');
      vi.mock('~/composables/useX');
      const w = new URL('./worker.ts', import.meta.url);
    `;
    expect(values('src/x.ts', code)).toEqual(
      expect.arrayContaining(['./a', '../b', '~/types/t', './side-effect.css', './barrel', '@scope/pkg/sub', 'd-lib', './lazy.vue', '~/composables/useX', './worker.ts']),
    );
  });

  it('ignores imports commented out at the start of a line', () => {
    const code = `//import gone from './gone';\n/* import alsoGone from './also-gone'; */\nimport kept from './kept';`;
    expect(values('src/x.ts', code)).toEqual(['./kept']);
  });

  it('keeps imports inside commented route blocks out', () => {
    const code = `const routes = [\n  /* {\n    component: () => import('./views/old.vue'),\n  }, */\n  { component: () => import('./views/new.vue') },\n];`;
    expect(values('src/routes.ts', code)).toEqual(['./views/new.vue']);
  });

  it('turns template-literal dynamic imports and import.meta.glob into globs', () => {
    const code = "const v = import(`./views/${name}.vue`);\nconst m = import.meta.glob(['./modules/*/index.ts', '!./modules/skip/index.ts']);";
    expect(values('src/x.ts', code)).toEqual(['glob:./views/**.vue', 'glob:./modules/*/index.ts']);
  });

  it('reads Vue scripts, style imports and template tags', () => {
    const code = `<template><CqLimit /><cq-modal v-if="x"><RouterView /></cq-modal></template>
<script setup lang="ts">import { useX } from '~/composables/useX';</script>
<style lang="scss">@import '~bootstrap/scss/grid';</style>`;
    const facts = extractFacts('src/A.vue', code);
    expect(facts.specifiers.map((s) => s.value)).toEqual(['~/composables/useX', 'bootstrap/scss/grid']);
    expect([...facts.tags]).toEqual(expect.arrayContaining(['CqLimit', 'cq-modal', 'RouterView']));
    expect(facts.identifiers.has('useX')).toBe(true);
  });

  it('reads vitest environment comments', () => {
    // Partido en dos para que Vitest no lo lea como configuración de este archivo.
    expect(extractFacts('a.test.ts', '// @vitest' + '-environment happy-dom\n').environments).toEqual(['happy-dom']);
  });
});

describe('helpers', () => {
  it('splits a Vue SFC', () => {
    const parts = splitVue('<template><A/></template><script>x</script><style>y</style>');
    expect(parts.scripts).toEqual(['x']);
    expect(parts.styles).toEqual(['y']);
    expect(parts.template).toBe('<template><A/></template>');
  });

  it('converts kebab-case tags to PascalCase', () => {
    expect(pascalCase('cq-select-dropdown')).toBe('CqSelectDropdown');
    expect(pascalCase('CqLimit')).toBe('CqLimit');
  });

  it('keeps triple-slash references when stripping comments', () => {
    expect(stripLineComments('/// <reference path="./a.d.ts" />\n// note')).toContain('reference');
  });

  it('matches globs', () => {
    expect(globToRegExp('src/**/*.vue').test('src/a/b/C.vue')).toBe(true);
    expect(globToRegExp('src/**/*.vue').test('src/C.vue')).toBe(true);
    expect(globToRegExp('src/*.vue').test('src/a/C.vue')).toBe(false);
    expect(globToRegExp('tests/**/*.{test,spec}.ts').test('tests/unit/a.spec.ts')).toBe(true);
  });

  it('parses JSON with comments and trailing commas', () => {
    expect(parseJsonc('{ // c\n "a": [1, 2,], /* b */ "url": "http://x" }')).toEqual({ a: [1, 2], url: 'http://x' });
    expect(parseJsonc('{ broken')).toBeUndefined();
  });
});
