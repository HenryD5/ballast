import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtensionContext, OutputChannel } from 'vscode';
import type { StateMessage, WebviewMessage } from '../../src/webview/protocol';
import { Uri, vscodeMock } from './mocks/vscode';
import { makeProject } from './helpers';

// El panel real necesita un webview: aquí guarda los mensajes que el controlador le envía.
const panel = vi.hoisted(() => ({ onMessage: undefined as ((m: WebviewMessage) => void) | undefined, posted: [] as unknown[] }));
vi.mock('../../src/webview/panel', () => ({
  BallastPanel: {
    show: (_uri: unknown, onMessage: (m: WebviewMessage) => void) => {
      panel.onMessage = onMessage;
    },
    get instance() {
      return panel.onMessage ? { post: (m: unknown) => panel.posted.push(m) } : undefined;
    },
  },
}));
// Los comandos de npm no se ejecutan de verdad: se registran y se simula el cambio en package.json.
const exec = vi.hoisted(() => ({ calls: [] as Array<[string, string[]]>, code: 0 }));
vi.mock('../../src/infra/exec', () => ({
  run: vi.fn(async (command: string, args: string[]) => {
    exec.calls.push([command, args]);
    return { code: exec.code, stdout: '', stderr: exec.code ? 'failed' : '' };
  }),
}));

const { BallastController } = await import('../../src/controller');

const logLines: string[] = [];
const log = { info: (m: string) => logLines.push(m), command: () => {}, output: () => {} };
const channel = { show: vi.fn() } as unknown as OutputChannel;

async function setup(files: Record<string, string | object> = {}) {
  const root = await makeProject({
    'package.json': { name: 'demo', scripts: { 'type-check': 'vue-tsc' }, dependencies: { vue: '3', dayjs: '1', lodash: '4' } },
    'package-lock.json': '{"lockfileVersion":3}',
    'node_modules/vue/package.json': { name: 'vue' },
    'index.html': '<script type="module" src="/src/main.ts"></script>',
    'src/main.ts': "import 'vue';",
    'src/Dead.vue': '<template><i /></template>',
    'src/Orphan.ts': "import { x } from 'lodash';",
    'src/Tested.vue': '<template><b /></template>',
    'tests/Tested.spec.ts': "import T from '../src/Tested.vue';",
    ...files,
  });
  vscodeMock.workspaceFolders = [{ uri: Uri.file(root) }];
  vscodeMock.manifests = [join(root, 'package.json')];
  const controller = new BallastController({ extensionUri: Uri.file('/ext') } as unknown as ExtensionContext, channel, log);
  await controller.openCommand(true);
  const send = async (m: WebviewMessage) => {
    panel.onMessage!(m);
    // Los mensajes se procesan de forma asíncrona: se espera a que el controlador publique el estado final.
    await vi.waitFor(() => expect(last().busy).toBeNull());
    await new Promise((r) => setTimeout(r, 30));
  };
  return { root, controller, send };
}

const last = () => panel.posted[panel.posted.length - 1] as StateMessage;
const exists = async (path: string) => readFile(path).then(() => true, () => false);

beforeEach(() => {
  vscodeMock.reset();
  panel.onMessage = undefined;
  panel.posted.length = 0;
  exec.calls.length = 0;
  exec.code = 0;
  logLines.length = 0;
});

describe('analysis', () => {
  it('opens the panel, analyzes and posts the result', async () => {
    await setup();
    const state = last();
    expect(state).toMatchObject({ type: 'state', status: 'done', lang: 'es', trusted: true, busy: null, typecheckScript: 'type-check', projectFolder: expect.any(String) });
    expect(state.result!.files.map((f) => f.path)).toEqual(['src/Dead.vue', 'src/Orphan.ts', 'src/Tested.vue']);
    expect(state.result!.packages.map((p) => p.name)).toEqual(['dayjs', 'lodash']);
    expect(panel.posted.some((m) => (m as StateMessage).status === 'analyzing')).toBe(true);
  });

  it('reports errors in the panel', async () => {
    await setup({ 'package.json': '{ not json' });
    expect(last()).toMatchObject({ status: 'error', error: expect.stringContaining('JSON') });
    vscodeMock.workspaceFolders = [];
    vscodeMock.manifests = [];
    const lonely = new BallastController({ extensionUri: Uri.file('/ext') } as unknown as ExtensionContext, channel, log);
    await lonely.openCommand(true);
    expect(vscodeMock.warnings).toContain('Abre una carpeta con un package.json para analizarla.');
  });
});

describe('moving files to the trash', () => {
  it('deletes the chosen files with their own tests after confirmation, and can undo', async () => {
    const { root, send } = await setup();
    vscodeMock.answer = 'Mover a la papelera';
    await send({ type: 'deleteFiles', paths: ['src/Dead.vue', 'src/Tested.vue'] });

    expect(vscodeMock.dialogs[0]!.message).toBe('¿Mover 3 archivos a la papelera?');
    expect(vscodeMock.dialogs[0]!.detail).toContain('Incluye 1 test propio');
    expect(await exists(join(root, 'src/Dead.vue'))).toBe(false);
    expect(await exists(join(root, 'tests/Tested.spec.ts'))).toBe(false);
    expect(await exists(join(root, 'src/Orphan.ts'))).toBe(true);
    expect(vscodeMock.trash).toHaveLength(3);
    expect(last().lastAction).toEqual({ kind: 'files', items: ['src/Dead.vue', 'src/Tested.vue', 'tests/Tested.spec.ts'], undoable: true, error: undefined });
    // Se vuelve a analizar: lo borrado ya no aparece.
    expect(last().result!.files.map((f) => f.path)).toEqual(['src/Orphan.ts']);

    await send({ type: 'undo' });
    expect(await readFile(join(root, 'src/Dead.vue'), 'utf8')).toBe('<template><i /></template>');
    expect(await exists(join(root, 'tests/Tested.spec.ts'))).toBe(true);
    expect(last().lastAction).toBeUndefined();
    expect(last().result!.files).toHaveLength(3);
  });

  it('does nothing when the user cancels', async () => {
    const { root, send } = await setup();
    vscodeMock.answer = undefined;
    panel.onMessage!({ type: 'deleteFiles', paths: ['src/Dead.vue'] });
    await vi.waitFor(() => expect(vscodeMock.dialogs).toHaveLength(1));
    await send({ type: 'ready' });
    expect(await exists(join(root, 'src/Dead.vue'))).toBe(true);
    expect(last().lastAction).toBeUndefined();
  });

  it('only deletes files from the last analysis', async () => {
    const { root, send } = await setup();
    vscodeMock.answer = 'Mover a la papelera';
    await send({ type: 'deleteFiles', paths: ['src/main.ts', 'package.json', '../outside.txt'] });
    expect(vscodeMock.dialogs).toHaveLength(0);
    expect(await exists(join(root, 'src/main.ts'))).toBe(true);
    expect(logLines.some((l) => l.startsWith('Ignored paths not in the analysis'))).toBe(true);
  });

  it('refuses in an untrusted workspace', async () => {
    const { root, send } = await setup();
    vscodeMock.trusted = false;
    vscodeMock.answer = 'Mover a la papelera';
    await send({ type: 'deleteFiles', paths: ['src/Dead.vue'] });
    expect(vscodeMock.dialogs).toHaveLength(0);
    expect(vscodeMock.warnings[0]).toContain('no es de confianza');
    expect(await exists(join(root, 'src/Dead.vue'))).toBe(true);
  });

  it('stops without deleting permanently when the trash is not available', async () => {
    const { root, send } = await setup();
    vscodeMock.answer = 'Mover a la papelera';
    vscodeMock.failDelete = { path: 'src/Dead.vue', message: 'Unable to move to trash' };
    await send({ type: 'deleteFiles', paths: ['src/Dead.vue', 'src/Orphan.ts'] });
    expect(await exists(join(root, 'src/Dead.vue'))).toBe(true);
    expect(await exists(join(root, 'src/Orphan.ts'))).toBe(true);
    expect(last().lastAction).toMatchObject({ undoable: false, error: 'No se pudo usar la papelera en esta carpeta; no se borró nada.' });
  });
});

describe('uninstalling packages', () => {
  it('runs the package manager after confirmation and restores manifest and lockfile on undo', async () => {
    const { root, send } = await setup({ 'src/main.ts': "import 'vue';\nimport './Orphan';" });
    vscodeMock.answer = 'Desinstalar';
    await send({ type: 'uninstall', names: ['dayjs', 'vue'] });
    expect(vscodeMock.dialogs[0]!.message).toBe('¿Desinstalar 1 paquete?');
    expect(vscodeMock.dialogs[0]!.detail).toContain('npm uninstall dayjs');
    expect(exec.calls).toEqual([['npm', ['uninstall', 'dayjs']]]);
    expect(last().lastAction).toMatchObject({ kind: 'packages', items: ['dayjs'], undoable: true });

    // Simula lo que haría npm y comprueba que deshacer devuelve los archivos originales.
    const manifest = await readFile(join(root, 'package.json'), 'utf8');
    await import('node:fs/promises').then((fs) => fs.writeFile(join(root, 'package.json'), '{"name":"changed"}'));
    await send({ type: 'undo' });
    expect(await readFile(join(root, 'package.json'), 'utf8')).toBe(manifest);
    expect(await readFile(join(root, 'package-lock.json'), 'utf8')).toBe('{"lockfileVersion":3}');
    expect(exec.calls[1]).toEqual(['npm', ['install']]);
  });

  it('warns when a package is still imported by files that are not deleted', async () => {
    const { send } = await setup();
    vscodeMock.answer = undefined;
    panel.onMessage!({ type: 'uninstall', names: ['lodash'] });
    await vi.waitFor(() => expect(vscodeMock.dialogs).toHaveLength(1));
    expect(vscodeMock.dialogs[0]!.detail).toContain('lodash solo lo importan archivos sin uso');
    expect(exec.calls).toHaveLength(0);
    await send({ type: 'ready' });
  });

  it('reports a failing uninstall', async () => {
    const { send } = await setup();
    vscodeMock.answer = 'Desinstalar';
    exec.code = 1;
    await send({ type: 'uninstall', names: ['dayjs'] });
    expect(last().lastAction).toMatchObject({ error: 'npm uninstall dayjs falló. Revisa el registro de Ballast.' });
  });
});

describe('other panel messages', () => {
  it('runs the type-check script and reports the result', async () => {
    const { send } = await setup();
    await send({ type: 'typecheck' });
    expect(exec.calls).toEqual([['npm', ['run', 'type-check']]]);
    expect(last().typecheck).toEqual({ script: 'type-check', status: 'passed' });
    exec.code = 2;
    await send({ type: 'typecheck' });
    expect(last().typecheck).toEqual({ script: 'type-check', status: 'failed' });
  });

  it('opens and reveals only safe paths inside the project, and copies text', async () => {
    const { root, send } = await setup();
    await send({ type: 'open', path: 'src/Dead.vue' });
    await send({ type: 'open', path: '../etc/passwd' });
    await send({ type: 'reveal', path: 'src/Dead.vue' });
    await send({ type: 'copy', text: 'src/Dead.vue' });
    await send({ type: 'showLog' });
    expect(vscodeMock.opened).toEqual([join(root, 'src/Dead.vue')]);
    expect(vscodeMock.commands).toEqual([['revealInExplorer', expect.objectContaining({ fsPath: join(root, 'src/Dead.vue') })]]);
    expect(vscodeMock.clipboard).toBe('src/Dead.vue');
    expect(channel.show).toHaveBeenCalled();
  });

  it('uses English when configured', async () => {
    vscodeMock.config.language = 'en';
    const { send } = await setup();
    expect(last().lang).toBe('en');
    vscodeMock.answer = 'Move to trash';
    await send({ type: 'deleteFiles', paths: ['src/Dead.vue'] });
    expect(vscodeMock.dialogs[0]!.message).toBe('Move 1 file to the trash?');
  });
});
