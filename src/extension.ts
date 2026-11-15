import * as vscode from 'vscode';
import { BallastController } from './controller';
import { createLogger } from './infra/log';

export function activate(context: vscode.ExtensionContext): void {
  const channel = vscode.window.createOutputChannel('Ballast');
  const log = createLogger(channel);
  const ballast = new BallastController(context, channel, log);

  context.subscriptions.push(
    channel,
    // La vista queda vacía a propósito: su contenido es el texto de bienvenida de package.json.
    vscode.window.registerTreeDataProvider<vscode.TreeItem>('ballast.home', { getTreeItem: (item) => item, getChildren: () => [] }),
    vscode.commands.registerCommand('ballast.analyze', () => ballast.openCommand(true)),
    vscode.commands.registerCommand('ballast.selectProject', () => ballast.selectProjectCommand()),
    vscode.commands.registerCommand('ballast.showLog', () => channel.show()),
    vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration('ballast') && ballast.onConfigChange()),
    vscode.workspace.onDidGrantWorkspaceTrust(() => ballast.onConfigChange()),
  );
}

export function deactivate(): void {}
