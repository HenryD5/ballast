import { afterEach, describe, expect, it, vi } from 'vitest';
import { BallastPanel } from '../../src/webview/panel';
import type { WebviewMessage } from '../../src/webview/protocol';
import { createFakeWebviewPanel, Uri, vscodeMock, window } from './mocks/vscode';

function open(onMessage: (m: WebviewMessage) => void = () => {}) {
  const fake = createFakeWebviewPanel();
  window.createWebviewPanel.mockReturnValueOnce(fake.panel);
  const panel = BallastPanel.show(Uri.file('/ext') as never, onMessage);
  return { fake, panel };
}

afterEach(() => {
  BallastPanel.instance?.dispose();
  vscodeMock.reset();
  window.createWebviewPanel.mockReset();
});

describe('BallastPanel', () => {
  it('renders a page with a strict CSP that only loads the extension build', () => {
    const { fake } = open();
    const [, , , options] = window.createWebviewPanel.mock.calls[0]!;
    expect(options).toMatchObject({ enableScripts: true, localResourceRoots: [expect.objectContaining({ fsPath: '/ext/dist/webview' })] });
    expect(fake.html).toContain("default-src 'none'");
    expect(fake.html).toMatch(/script-src 'nonce-[A-Za-z0-9+/=]+'/);
    expect(fake.html).not.toContain('unsafe-inline');
    expect(fake.html).not.toContain('unsafe-eval');
    expect(fake.html).toContain('src="webview:///ext/dist/webview/main.js"');
    expect(fake.html).toContain('<html lang="es">');
  });

  it('uses a different nonce each time and the configured language', () => {
    const first = open().fake.html.match(/nonce-([^']+)/)![1];
    BallastPanel.instance!.dispose();
    vscodeMock.config.language = 'en';
    const second = open().fake;
    expect(second.html.match(/nonce-([^']+)/)![1]).not.toBe(first);
    expect(second.html).toContain('<html lang="en">');
  });

  it('passes only valid messages to the controller', () => {
    const received: WebviewMessage[] = [];
    const { fake } = open((m) => received.push(m));
    fake.receive({ type: 'analyze' });
    fake.receive({ type: 'deleteFiles', paths: 'src/x.ts' });
    fake.receive({ type: 'exec', command: 'rm -rf /' });
    fake.receive('analyze');
    expect(received).toEqual([{ type: 'analyze' }]);
  });

  it('reuses the open panel, posts messages and forgets it when closed', () => {
    const { fake, panel } = open();
    expect(BallastPanel.show(Uri.file('/ext') as never, () => {})).toBe(panel);
    expect(window.createWebviewPanel).toHaveBeenCalledTimes(1);
    expect(fake.revealed).toBe(1);
    panel.post({ type: 'state', lang: 'es', status: 'idle', projectFolder: 'p', canSelectProject: false, trusted: true, busy: null });
    expect(fake.posted).toHaveLength(1);
    fake.close();
    expect(BallastPanel.instance).toBeUndefined();
    expect(fake.disposed).toBe(true);
  });
});

describe('protocol limits', () => {
  it('drops oversized or malformed payloads', async () => {
    const { parseWebviewMessage, MAX_ITEMS } = await import('../../src/webview/protocol');
    expect(parseWebviewMessage({ type: 'deleteFiles', paths: Array.from({ length: MAX_ITEMS + 1 }, (_, i) => `f${i}`) })).toBeUndefined();
    expect(parseWebviewMessage({ type: 'open', path: 'x'.repeat(1001) })).toBeUndefined();
    expect(parseWebviewMessage({ type: 'copy', text: 'a\nb' })).toEqual({ type: 'copy', text: 'a\nb' });
    expect(parseWebviewMessage({ type: 'copy', text: 42 })).toBeUndefined();
    expect(parseWebviewMessage({ type: 'uninstall', names: ['ok', ''] })).toBeUndefined();
    void vi;
  });
});
