import type { WebviewMessage } from '../../src/webview/protocol';

export interface ViewState {
  activeTab: 'files' | 'packages';
  search: string;
  kinds: string[];
  collapsed: string[];
  fileSelection: string[];
  packageSelection: string[];
}

const defaults: ViewState = { activeTab: 'files', search: '', kinds: [], collapsed: [], fileSelection: [], packageSelection: [] };
const api = acquireVsCodeApi<ViewState>();
const restored = api.getState();

export function toPlain<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
export function send(message: WebviewMessage): void { api.postMessage(toPlain(message)); }
export function loadState(): ViewState { return { ...defaults, ...restored }; }
export function hasSavedState(): boolean { return restored !== undefined; }
export function saveState(state: ViewState): void { api.setState(toPlain(state)); }
