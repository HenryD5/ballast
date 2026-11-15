// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnalysisResult, UnusedFile } from '../../src/core/types';
import type { StateMessage, WebviewMessage } from '../../src/webview/protocol';
import ActionBar from '../../webview-ui/src/components/ActionBar.vue';
import FilesTab from '../../webview-ui/src/components/FilesTab.vue';
import PackagesTab from '../../webview-ui/src/components/PackagesTab.vue';

const file = (path: string, extra: Partial<UnusedFile> = {}): UnusedFile => {
  const parts = path.split('/');
  return { path, dir: parts.slice(0, -1).join('/'), name: parts.at(-1)!, module: parts[2] ?? 'src', kind: 'component', reason: 'unreferenced', size: 2048, importedBy: [], tests: [], ...extra };
};

const files: UnusedFile[] = [
  file('src/modules/billing/components/Invoice.vue'),
  file('src/modules/billing/composables/useBill.ts', { kind: 'composable', reason: 'onlyTests', tests: ['tests/useBill.spec.ts'] }),
  file('src/modules/login/components/Form.vue', { reason: 'onlyUnused', importedBy: ['src/modules/login/views/Old.vue'] }),
];

const filesProps = { files, lang: 'es' as const, search: '', kinds: [], collapsed: [], selected: [], disabled: false };

describe('FilesTab', () => {
  it('groups files by module with folder, type, reason, tests and size', () => {
    const w = mount(FilesTab, { props: filesProps });
    const groups = w.findAll('.file-group');
    expect(groups.map((g) => g.find('.group-head strong').text())).toEqual(['billing', 'login']);
    const text = w.text();
    expect(text).toContain('useBill.ts');
    expect(text).toContain('+ 1 test: useBill.spec.ts');
    expect(text).toContain('Old.vue');
    expect(text).toContain('Composable');
    expect(text).toContain('2 KB');
  });

  it('filters by search and by kind, and offers to clear filters', async () => {
    const searched = mount(FilesTab, { props: { ...filesProps, search: 'invoice' } });
    expect(searched.findAll('.file-row')).toHaveLength(1);
    const byKind = mount(FilesTab, { props: { ...filesProps, kinds: ['composable'] } });
    expect(byKind.findAll('.file-row')).toHaveLength(1);
    const none = mount(FilesTab, { props: { ...filesProps, search: 'zzz' } });
    expect(none.text()).toContain('Ningún archivo coincide');
    await none.find('.empty button').trigger('click');
    expect(none.emitted('clear')).toHaveLength(1);
  });

  it('emits search, kind, collapse, selection, open and reveal', async () => {
    const w = mount(FilesTab, { props: filesProps });
    await w.find('.search input').setValue('form');
    expect(w.emitted('search')![0]).toEqual(['form']);
    await w.findAll('.chip')[1]!.trigger('click');
    expect(w.emitted('kinds')![0]).toEqual([['component']]);
    await w.find('.group-head .icon-button').trigger('click');
    expect(w.emitted('collapse')![0]).toEqual(['billing']);
    await w.find('.group-head input[type=checkbox]').trigger('change');
    expect(w.emitted('selection')![0]).toEqual([['src/modules/billing/components/Invoice.vue', 'src/modules/billing/composables/useBill.ts']]);
    await w.find('.file-row .link-button').trigger('click');
    expect(w.emitted('open')![0]).toEqual(['src/modules/billing/components/Invoice.vue']);
    await w.find('.file-row .icon-button').trigger('click');
    expect(w.emitted('reveal')![0]).toEqual(['src/modules/billing/components/Invoice.vue']);
  });

  it('hides collapsed groups and marks partially selected groups', async () => {
    const w = mount(FilesTab, { props: { ...filesProps, collapsed: ['login'], selected: ['src/modules/billing/components/Invoice.vue'] } });
    expect(w.findAll('.file-row')).toHaveLength(2);
    const groupBox = w.find('.group-head input[type=checkbox]').element as HTMLInputElement;
    expect(groupBox.indeterminate).toBe(true);
    expect(groupBox.checked).toBe(false);
  });

  it('shows the empty state', () => {
    expect(mount(FilesTab, { props: { ...filesProps, files: [] } }).text()).toContain('No hay archivos sin uso.');
  });
});

describe('PackagesTab', () => {
  const packages: AnalysisResult['packages'] = [
    { name: 'dayjs', version: '1.0.0', section: 'dependencies', reason: 'noImport', files: [] },
    { name: 'lodash', version: '4.0.0', section: 'dependencies', reason: 'onlyUnusedFiles', files: ['src/Old.ts'] },
  ];

  it('lists packages with reason and warns about files that still import them', async () => {
    const w = mount(PackagesTab, { props: { packages, lang: 'es', selected: [], disabled: false } });
    expect(w.findAll('.package-row')).toHaveLength(2);
    expect(w.text()).toContain('Solo lo importan archivos sin uso');
    expect(w.text()).toContain('sus imports fallarán');
    await w.find('.package-files button').trigger('click');
    expect(w.emitted('open')![0]).toEqual(['src/Old.ts']);
  });

  it('selects one or all packages', async () => {
    const w = mount(PackagesTab, { props: { packages, lang: 'es', selected: ['dayjs'], disabled: false } });
    await w.findAll('.package-row input')[1]!.trigger('change');
    expect(w.emitted('selection')![0]).toEqual([['dayjs', 'lodash']]);
    await w.find('.package-tools button').trigger('click');
    expect(w.emitted('selection')![1]).toEqual([['dayjs', 'lodash']]);
  });

  it('shows the empty state', () => {
    expect(mount(PackagesTab, { props: { packages: [], lang: 'es', selected: [], disabled: false } }).text()).toContain('No hay paquetes sin uso.');
  });
});

describe('ActionBar', () => {
  it('shows the count and the right action per tab', async () => {
    const files = mount(ActionBar, { props: { tab: 'files', lang: 'es', count: 2, size: '4 KB', disabled: false, trusted: true } });
    expect(files.text()).toContain('2 seleccionados · 4 KB');
    expect(files.text()).toContain('Copiar rutas');
    await files.find('.danger').trigger('click');
    expect(files.emitted('action')).toHaveLength(1);
    const pkgs = mount(ActionBar, { props: { tab: 'packages', lang: 'es', count: 1, command: 'npm uninstall dayjs', disabled: false, trusted: true } });
    expect(pkgs.text()).toContain('npm uninstall dayjs');
    expect(pkgs.text()).not.toContain('Copiar rutas');
  });

  it('disables the destructive action when the folder is not trusted or busy', () => {
    expect(mount(ActionBar, { props: { tab: 'files', lang: 'es', count: 1, disabled: false, trusted: false } }).find('.danger').attributes('disabled')).toBeDefined();
    expect(mount(ActionBar, { props: { tab: 'files', lang: 'es', count: 1, disabled: true, trusted: true } }).find('.danger').attributes('disabled')).toBeDefined();
  });
});

describe('App', () => {
  const sent: WebviewMessage[] = [];
  let saved: unknown;

  beforeEach(() => {
    sent.length = 0;
    saved = undefined;
    vi.resetModules();
    vi.stubGlobal('acquireVsCodeApi', () => ({ postMessage: (m: WebviewMessage) => sent.push(m), getState: () => saved, setState: (s: unknown) => (saved = s) }));
  });

  const result: AnalysisResult = {
    root: '/p', projectName: 'demo', frameworks: ['vue'], packageManager: 'pnpm', totals: { files: 40, packages: 3 }, warnings: ['noNodeModules'], durationMs: 300,
    files,
    packages: [{ name: 'dayjs', version: '1', section: 'dependencies', reason: 'noImport', files: [] }],
  };
  const state = (extra: Partial<StateMessage>): StateMessage => ({ type: 'state', lang: 'es', status: 'done', projectFolder: 'demo', canSelectProject: false, trusted: true, busy: null, result, ...extra });
  const post = async (m: StateMessage) => {
    window.dispatchEvent(new MessageEvent('message', { data: m }));
    await flushPromises();
  };
  const mountApp = async () => mount((await import('../../webview-ui/src/App.vue')).default);

  it('says ready, shows the welcome screen and asks to analyze', async () => {
    const w = await mountApp();
    expect(sent).toEqual([{ type: 'ready' }]);
    await post(state({ status: 'idle', result: undefined }));
    expect(w.text()).toContain('Solo lee el código');
    await w.find('button.primary').trigger('click');
    expect(sent.at(-1)).toEqual({ type: 'analyze' });
    await post(state({ status: 'analyzing', result: undefined }));
    expect(w.text()).toContain('Analizando');
    await post(state({ status: 'error', result: undefined, error: 'boom' }));
    await w.find('button.secondary').trigger('click');
    expect(sent.at(-1)).toEqual({ type: 'showLog' });
  });

  it('deletes the selected files (with own tests counted in size) and uninstalls packages separately', async () => {
    const w = await mountApp();
    await post(state({}));
    expect(w.text()).toContain('Sin node_modules');
    await w.findAll('.file-row input[type=checkbox]')[1]!.trigger('change');
    expect(w.find('.action-bar').text()).toContain('1 seleccionados');
    await w.find('.action-bar .danger').trigger('click');
    expect(sent.at(-1)).toEqual({ type: 'deleteFiles', paths: ['src/modules/billing/composables/useBill.ts'] });

    await w.findAll('[role=tab]')[1]!.trigger('click');
    expect(w.find('.action-bar').exists()).toBe(false);
    await w.find('.package-row input').trigger('change');
    expect(w.find('.action-bar').text()).toContain('pnpm remove dayjs');
    await w.find('.action-bar .danger').trigger('click');
    expect(sent.at(-1)).toEqual({ type: 'uninstall', names: ['dayjs'] });
  });

  it('drops selections that disappear after a new analysis and shows the last action with undo', async () => {
    const w = await mountApp();
    await post(state({}));
    await w.findAll('.file-row input[type=checkbox]')[0]!.trigger('change');
    await post(state({ result: { ...result, files: files.slice(1) }, lastAction: { kind: 'files', items: ['a', 'b'], undoable: true }, typecheckScript: 'type-check' }));
    expect(w.find('.action-bar').exists()).toBe(false);
    expect(w.text()).toContain('2');
    const undo = w.findAll('.action-notice button')[0]!;
    await undo.trigger('click');
    expect(sent.at(-1)).toEqual({ type: 'undo' });
    await w.findAll('.action-notice button')[1]!.trigger('click');
    expect(sent.at(-1)).toEqual({ type: 'typecheck' });
  });

  it('starts with groups collapsed for long lists', async () => {
    const many = Array.from({ length: 61 }, (_, i) => file(`src/modules/m${i % 3}/components/C${i}.vue`));
    const w = await mountApp();
    await post(state({ result: { ...result, files: many } }));
    expect(w.findAll('.file-group')).toHaveLength(3);
    expect(w.findAll('.file-row')).toHaveLength(0);
  });

  it('switches to English', async () => {
    const w = await mountApp();
    await post(state({ lang: 'en' }));
    expect(w.text()).toContain('Unused files');
  });
});
