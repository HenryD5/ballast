import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { parseWebviewMessage, type HostMessage, type WebviewMessage } from './protocol';

/** El panel del webview (uno por ventana). Solo transporta mensajes; la lógica vive en el controlador. */
export class BallastPanel implements vscode.Disposable {
  private static current: BallastPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  static show(extensionUri: vscode.Uri, onMessage: (msg: WebviewMessage) => void): BallastPanel {
    if (BallastPanel.current) {
      BallastPanel.current.panel.reveal(undefined, false);
      return BallastPanel.current;
    }
    const panel = vscode.window.createWebviewPanel(
      'ballast.results',
      'Ballast',
      { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        // Solo el build del webview es accesible desde la página.
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist', 'webview')],
      },
    );
    panel.iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'icon.png');
    BallastPanel.current = new BallastPanel(panel, extensionUri, onMessage);
    return BallastPanel.current;
  }

  static get instance(): BallastPanel | undefined {
    return BallastPanel.current;
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    onMessage: (msg: WebviewMessage) => void,
  ) {
    panel.webview.html = renderHtml(panel.webview, extensionUri);
    this.disposables.push(
      panel.onDidDispose(() => this.dispose()),
      panel.webview.onDidReceiveMessage((data: unknown) => {
        const msg = parseWebviewMessage(data);
        if (msg) onMessage(msg);
      }),
    );
  }

  post(message: HostMessage): void {
    void this.panel.webview.postMessage(message);
  }

  dispose(): void {
    if (BallastPanel.current === this) BallastPanel.current = undefined;
    this.panel.dispose();
    while (this.disposables.length) this.disposables.pop()?.dispose();
  }
}

function renderHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const asset = (file: string) => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview', file));
  const nonce = randomBytes(16).toString('base64');
  // CSP estricta: sin inline, sin eval, sin red.
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource}`,
    `font-src ${webview.cspSource}`,
    `img-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');
  const lang = vscode.workspace.getConfiguration('ballast').get<string>('language', 'es') === 'en' ? 'en' : 'es';
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${asset('main.css')}">
<title>Ballast</title>
</head>
<body>
<div id="app"></div>
<script type="module" nonce="${nonce}" src="${asset('main.js')}"></script>
</body>
</html>`;
}
