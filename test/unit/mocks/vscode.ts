// API de VS Code simulada para los tests del controlador. El sistema de archivos es el disco real
// (proyectos temporales); los diálogos y la configuración se controlan desde cada test con `vscodeMock`.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { vi } from 'vitest';

export class Uri {
  private constructor(readonly fsPath: string) {}
  static file(path: string): Uri {
    return new Uri(path);
  }
  static joinPath(base: Uri, ...parts: string[]): Uri {
    return new Uri(join(base.fsPath, ...parts));
  }
  toString(): string {
    return this.fsPath;
  }
}

export const ViewColumn = { Active: -1, Beside: -2 };

export const vscodeMock = {
  config: { language: 'es', ignore: [] as string[] } as Record<string, unknown>,
  trusted: true,
  workspaceFolders: [] as Array<{ uri: Uri }>,
  manifests: [] as string[],
  /** Respuesta a los diálogos modales: el texto del botón o `undefined` (cancelar). */
  answer: undefined as string | undefined,
  /** Si se define, `fs.delete` falla con este mensaje en el archivo indicado. */
  failDelete: undefined as { path: string; message: string } | undefined,
  trash: [] as string[],
  dialogs: [] as Array<{ message: string; detail?: string }>,
  warnings: [] as string[],
  opened: [] as string[],
  commands: [] as Array<[string, unknown]>,
  clipboard: '',
  reset(): void {
    this.config = { language: 'es', ignore: [] };
    this.trusted = true;
    this.workspaceFolders = [];
    this.manifests = [];
    this.answer = undefined;
    this.failDelete = undefined;
    this.trash = [];
    this.dialogs = [];
    this.warnings = [];
    this.opened = [];
    this.commands = [];
    this.clipboard = '';
  },
};

export const workspace = {
  getConfiguration: () => ({ get: <T>(key: string, fallback: T): T => (vscodeMock.config[key] as T) ?? fallback }),
  get isTrusted() {
    return vscodeMock.trusted;
  },
  get workspaceFolders() {
    return vscodeMock.workspaceFolders;
  },
  findFiles: vi.fn(async () => vscodeMock.manifests.map((m) => Uri.file(m))),
  asRelativePath: (p: string) => p,
  fs: {
    readFile: async (uri: Uri) => new Uint8Array(await readFile(uri.fsPath)),
    writeFile: async (uri: Uri, content: Uint8Array) => {
      await mkdir(dirname(uri.fsPath), { recursive: true });
      await writeFile(uri.fsPath, content);
    },
    delete: async (uri: Uri, options?: { useTrash?: boolean }) => {
      if (vscodeMock.failDelete && uri.fsPath.endsWith(vscodeMock.failDelete.path)) throw new Error(vscodeMock.failDelete.message);
      if (!options?.useTrash) throw new Error('El test exige papelera: nunca borrado permanente.');
      vscodeMock.trash.push(uri.fsPath);
      await rm(uri.fsPath);
    },
  },
};

/** Webview simulado: guarda el HTML, los mensajes enviados y permite simular los que llegan. */
export function createFakeWebviewPanel() {
  const listeners: { message?: (data: unknown) => void; dispose?: () => void } = {};
  const fake = {
    html: '',
    posted: [] as unknown[],
    revealed: 0,
    disposed: false,
    iconPath: undefined as unknown,
    receive: (data: unknown) => listeners.message?.(data),
    close: () => listeners.dispose?.(),
    panel: {} as Record<string, unknown>,
  };
  fake.panel = {
    webview: {
      cspSource: 'vscode-resource:',
      asWebviewUri: (uri: Uri) => `webview://${uri.fsPath}`,
      postMessage: async (m: unknown) => fake.posted.push(m),
      onDidReceiveMessage: (cb: (data: unknown) => void) => ((listeners.message = cb), { dispose: () => {} }),
      set html(value: string) {
        fake.html = value;
      },
    },
    onDidDispose: (cb: () => void) => ((listeners.dispose = cb), { dispose: () => {} }),
    reveal: () => fake.revealed++,
    dispose: () => {
      fake.disposed = true;
    },
    set iconPath(value: unknown) {
      fake.iconPath = value;
    },
  };
  return fake;
}

export const window = {
  createWebviewPanel: vi.fn(),
  showWarningMessage: vi.fn(async (message: string, ...rest: unknown[]) => {
    const options = rest[0] as { modal?: boolean; detail?: string } | undefined;
    if (options && typeof options === 'object' && options.modal) {
      vscodeMock.dialogs.push({ message, detail: options.detail });
      return vscodeMock.answer;
    }
    vscodeMock.warnings.push(message);
    return undefined;
  }),
  showQuickPick: vi.fn(async (items: Array<{ folder: string }>) => items[0]),
  showTextDocument: vi.fn(async (uri: Uri) => {
    vscodeMock.opened.push(uri.fsPath);
  }),
};

export const commands = {
  executeCommand: vi.fn(async (command: string, arg: unknown) => {
    vscodeMock.commands.push([command, arg]);
  }),
};

export const env = {
  clipboard: {
    writeText: vi.fn(async (text: string) => {
      vscodeMock.clipboard = text;
    }),
  },
};

export const l10n = { t: (s: string) => s };
