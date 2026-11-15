// Protocolo entre la extensión y el webview. Lo importan los dos lados:
// solo tipos y validación, sin `vscode` ni Vue.
import type { AnalysisResult } from '../core/types';

export type Lang = 'es' | 'en';

export type Status = 'idle' | 'analyzing' | 'done' | 'error';

/** Operación en curso; mientras dura, el webview bloquea los botones de acción. */
export type Busy = 'files' | 'packages' | 'undo' | 'typecheck' | null;

export interface LastAction {
  kind: 'files' | 'packages';
  /** Archivos borrados (incluidos sus tests) o paquetes desinstalados. */
  items: string[];
  /** Hay copia para deshacer. */
  undoable: boolean;
  /** Error de la operación, si falló a medias. */
  error?: string;
}

export interface TypecheckState {
  /** Script del proyecto que comprueba tipos (`type-check`, `typecheck`…). */
  script: string;
  status: 'running' | 'passed' | 'failed';
}

export interface StateMessage {
  type: 'state';
  lang: Lang;
  status: Status;
  projectFolder: string;
  canSelectProject: boolean;
  /** La carpeta es de confianza: sin ella no se puede borrar ni desinstalar. */
  trusted: boolean;
  result?: AnalysisResult;
  error?: string;
  busy: Busy;
  lastAction?: LastAction;
  /** Script de tipos disponible en el proyecto (o `undefined`). */
  typecheckScript?: string;
  typecheck?: TypecheckState;
}

export type HostMessage = StateMessage;

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'analyze' }
  | { type: 'selectProject' }
  | { type: 'open'; path: string }
  | { type: 'reveal'; path: string }
  | { type: 'deleteFiles'; paths: string[] }
  | { type: 'uninstall'; names: string[] }
  | { type: 'undo' }
  | { type: 'typecheck' }
  | { type: 'copy'; text: string }
  | { type: 'showLog' };

export const MAX_ITEMS = 5_000;

const isString = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 1_000;
const isStringList = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 && v.length <= MAX_ITEMS && v.every(isString);

/** Valida lo que llega del webview: lo que no encaja se descarta. */
export function parseWebviewMessage(data: unknown): WebviewMessage | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const msg = data as Record<string, unknown>;
  switch (msg.type) {
    case 'ready':
    case 'analyze':
    case 'selectProject':
    case 'undo':
    case 'typecheck':
    case 'showLog':
      return { type: msg.type };
    case 'open':
    case 'reveal':
      return isString(msg.path) ? { type: msg.type, path: msg.path } : undefined;
    case 'deleteFiles':
      return isStringList(msg.paths) ? { type: 'deleteFiles', paths: [...new Set(msg.paths)] } : undefined;
    case 'uninstall':
      return isStringList(msg.names) ? { type: 'uninstall', names: [...new Set(msg.names)] } : undefined;
    case 'copy':
      return typeof msg.text === 'string' && msg.text.length <= 1_000_000 ? { type: 'copy', text: msg.text } : undefined;
    default:
      return undefined;
  }
}
