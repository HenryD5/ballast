import { describe, expect, it } from 'vitest';
import type { UnusedFile } from '../../src/core/types';
import { filesToDelete, filterFiles, formatSize, groupByModule, groupSelectionState, kindCounts, pruneSelection, uninstallCommand } from '../../webview-ui/src/model';

const file = (path: string, module = 'shared', size = 10, kind: UnusedFile['kind'] = 'component', tests: string[] = []): UnusedFile => ({
  path, dir: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '', name: path.split('/').at(-1)!, module, kind,
  reason: tests.length ? 'onlyTests' : 'unreferenced', size, importedBy: [], tests,
});

describe('model', () => {
  const files = [file('src/café/Card.vue'), file('src/shop/Cart.vue', 'shop', 20, 'view'), file('lib/other.ts', 'shared', 5, 'util')];

  it('filters names and paths without case or accents and filters kinds', () => {
    expect(filterFiles(files, { search: 'CAFE', kinds: [] }).map((x) => x.path)).toEqual(['src/café/Card.vue']);
    expect(filterFiles(files, { search: 'src/SHOP', kinds: new Set(['view']) }).map((x) => x.name)).toEqual(['Cart.vue']);
    expect(filterFiles(files, { search: '', kinds: ['util'] })).toEqual([files[2]]);
  });

  it('groups by module with common directory, size, and stable ordering', () => {
    const groups = groupByModule(files);
    expect(groups.map((g) => g.module)).toEqual(['shared', 'shop']);
    expect(groups[0]).toMatchObject({ dirHint: '', size: 15 });
    expect(groupByModule([file('src/a/x.ts'), file('src/a/deep/y.ts')])[0]?.dirHint).toBe('src/a');
  });

  it('counts kinds', () => expect(kindCounts(files)).toEqual({ component: 1, view: 1, util: 1 }));

  it('formats localized sizes', () => {
    expect(formatSize(900, 'es')).toBe('900 B');
    expect(formatSize(1536, 'en')).toBe('1.5 KB');
    expect(formatSize(1536, 'es')).toBe('1,5 KB');
    expect(formatSize(2 * 1024 * 1024, 'en')).toBe('2 MB');
  });

  it('prunes, deduplicates, and reports selection state', () => {
    expect(pruneSelection(['a', 'gone', 'a'], ['a', 'b'])).toEqual(['a']);
    expect(groupSelectionState(['a', 'b'], [])).toBe('none');
    expect(groupSelectionState(['a', 'b'], ['a'])).toBe('some');
    expect(groupSelectionState(['a', 'b'], new Set(['a', 'b']))).toBe('all');
  });

  it.each([['npm', 'npm uninstall a b'], ['pnpm', 'pnpm remove a b'], ['yarn', 'yarn remove a b'], ['bun', 'bun remove a b']] as const)(
    'builds the %s command', (manager, command) => expect(uninstallCommand(manager, ['a', 'b'])).toBe(command),
  );

  it('adds tests to deletion paths, deduplicated and sorted', () => {
    const subject = file('src/a.ts', 'src', 4, 'component', ['src/a.spec.ts', 'src/shared.spec.ts']);
    expect(filesToDelete(['src/shared.spec.ts', 'src/a.ts'], [subject])).toEqual(['src/a.spec.ts', 'src/a.ts', 'src/shared.spec.ts']);
  });
});
