import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { analyze } from './core/analyze';
import { findTypecheckScript, isSafeRelativePath, LOCKFILES, planFileDeletion, planUninstall } from './core/cleanup';
import type { AnalysisResult } from './core/types';
import { run } from './infra/exec';
import type { Logger } from './infra/log';
import { BallastPanel } from './webview/panel';
import type { Busy, Lang, LastAction, StateMessage, Status, TypecheckState, WebviewMessage } from './webview/protocol';

type Backup =
  | { kind: 'files'; entries: Array<{ path: string; content: Uint8Array }> }
  | { kind: 'packages'; manifest: Uint8Array; lockfile?: { name: string; content: Uint8Array } };

const TEXT = {
  es: {
    noFolder: 'Abre una carpeta con un package.json para analizarla.',
    pickProject: 'Elige el proyecto que quieres analizar',
    untrusted: 'Esta carpeta no es de confianza. Confía en ella para poder borrar o desinstalar.',
    confirmFiles: (n: number) => `¿Mover ${n === 1 ? '1 archivo' : `${n} archivos`} a la papelera?`,
    confirmFilesDetail: (list: string, tests: number) =>
      `${list}${tests ? `\n\nIncluye ${tests === 1 ? '1 test propio' : `${tests} tests propios`} de esos archivos.` : ''}\n\nPuedes deshacerlo desde Ballast o recuperarlos de la papelera.`,
    moveToTrash: 'Mover a la papelera',
    confirmPackages: (n: number) => `¿Desinstalar ${n === 1 ? '1 paquete' : `${n} paquetes`}?`,
    confirmPackagesDetail: (command: string, broken: string[]) =>
      `Se ejecutará:\n${command}${broken.length ? `\n\nAtención: ${broken.join(', ')} solo lo importan archivos sin uso. Si no los borras, esos imports fallarán.` : ''}\n\nPuedes deshacerlo desde Ballast.`,
    uninstall: 'Desinstalar',
    more: (n: number) => `… y ${n} más`,
    commandFailed: (command: string) => `${command} falló. Revisa el registro de Ballast.`,
    partial: (n: number) => `No se pudieron mover ${n} archivos. Revisa el registro de Ballast.`,
    noTrash: 'No se pudo usar la papelera en esta carpeta; no se borró nada.',
  },
  en: {
    noFolder: 'Open a folder with a package.json to analyze it.',
    pickProject: 'Choose the project to analyze',
    untrusted: 'This folder is not trusted. Trust it to delete files or uninstall packages.',
    confirmFiles: (n: number) => `Move ${n === 1 ? '1 file' : `${n} files`} to the trash?`,
    confirmFilesDetail: (list: string, tests: number) =>
      `${list}${tests ? `\n\nIncludes ${tests === 1 ? '1 own test' : `${tests} own tests`} of those files.` : ''}\n\nYou can undo it from Ballast or restore them from the trash.`,
    moveToTrash: 'Move to trash',
    confirmPackages: (n: number) => `Uninstall ${n === 1 ? '1 package' : `${n} packages`}?`,
    confirmPackagesDetail: (command: string, broken: string[]) =>
      `This will run:\n${command}${broken.length ? `\n\nWarning: only unused files import ${broken.join(', ')}. If you keep those files, their imports will fail.` : ''}\n\nYou can undo it from Ballast.`,
    uninstall: 'Uninstall',
    more: (n: number) => `… and ${n} more`,
    commandFailed: (command: string) => `${command} failed. Check the Ballast log.`,
    partial: (n: number) => `${n} files could not be moved. Check the Ballast log.`,
    noTrash: 'The trash is not available for this folder; nothing was deleted.',
  },
};

/** Estado de Ballast en la ventana: carpeta, último análisis, operación en curso y copia para deshacer. */
export class BallastController {
  private folder: vscode.Uri | undefined;
  private status: Status = 'idle';
  private result: AnalysisResult | undefined;
  private error: string | undefined;
  private busy: Busy = null;
  private lastAction: LastAction | undefined;
  private backup: Backup | undefined;
  private typecheck: TypecheckState | undefined;
  private typecheckScript: string | undefined;
  private candidateCount = 0;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly channel: vscode.OutputChannel,
    private readonly log: Logger,
  ) {}

  private get lang(): Lang {
    return vscode.workspace.getConfiguration('ballast').get<string>('language', 'es') === 'en' ? 'en' : 'es';
  }

  private get t() {
    return TEXT[this.lang];
  }

  /** Comando "Ballast: Analizar": abre el panel; el análisis lo arranca el dev con el botón. */
  async openCommand(autoAnalyze = false): Promise<void> {
    if (!this.folder) this.folder = await this.pickFolder(false);
    if (!this.folder) {
      void vscode.window.showWarningMessage(this.t.noFolder);
      return;
    }
    this.showPanel();
    if (autoAnalyze) await this.runAnalysis();
  }

  async selectProjectCommand(): Promise<void> {
    const picked = await this.pickFolder(true);
    if (!picked) return;
    this.folder = picked;
    this.resetResults();
    this.showPanel();
  }

  private resetResults(): void {
    this.status = 'idle';
    this.result = undefined;
    this.error = undefined;
    this.lastAction = undefined;
    this.backup = undefined;
    this.typecheck = undefined;
    this.post();
  }

  private showPanel(): void {
    BallastPanel.show(this.context.extensionUri, (msg) => void this.onMessage(msg));
    this.post();
  }

  private async pickFolder(forceAsk: boolean): Promise<vscode.Uri | undefined> {
    const roots = vscode.workspace.workspaceFolders ?? [];
    const manifests = await vscode.workspace.findFiles('**/package.json', '**/{node_modules,dist,build,.git,coverage}/**', 200);
    const folders = [...new Set(manifests.map((m) => path.dirname(m.fsPath)))]
      .filter((dir) => roots.some((r) => dir === r.uri.fsPath || dir.startsWith(r.uri.fsPath + path.sep)))
      .sort((a, b) => a.split(path.sep).length - b.split(path.sep).length || a.localeCompare(b));
    this.candidateCount = folders.length;
    if (!folders.length) return undefined;
    if (folders.length === 1 || (!forceAsk && roots.some((r) => folders[0] === r.uri.fsPath))) return vscode.Uri.file(folders[0]!);
    const pick = await vscode.window.showQuickPick(
      folders.map((f) => ({ label: path.basename(f), description: vscode.workspace.asRelativePath(f), folder: f })),
      { placeHolder: this.t.pickProject },
    );
    return pick ? vscode.Uri.file(pick.folder) : undefined;
  }

  private async onMessage(msg: WebviewMessage): Promise<void> {
    switch (msg.type) {
      case 'ready':
        this.post();
        return;
      case 'analyze':
        await this.runAnalysis();
        return;
      case 'selectProject':
        await this.selectProjectCommand();
        return;
      case 'open':
        await this.openFile(msg.path);
        return;
      case 'reveal':
        if (this.inProject(msg.path)) await vscode.commands.executeCommand('revealInExplorer', this.uri(msg.path));
        return;
      case 'copy':
        await vscode.env.clipboard.writeText(msg.text);
        return;
      case 'showLog':
        this.channel.show();
        return;
      case 'deleteFiles':
        await this.deleteFiles(msg.paths);
        return;
      case 'uninstall':
        await this.uninstall(msg.names);
        return;
      case 'undo':
        await this.undo();
        return;
      case 'typecheck':
        await this.runTypecheck();
        return;
    }
  }

  private uri(rel: string): vscode.Uri {
    return vscode.Uri.joinPath(this.folder!, ...rel.split('/'));
  }

  private inProject(rel: string): boolean {
    return !!this.folder && isSafeRelativePath(rel);
  }

  private async openFile(rel: string): Promise<void> {
    if (!this.inProject(rel)) return;
    try {
      await vscode.window.showTextDocument(this.uri(rel), { preview: true, preserveFocus: false, viewColumn: vscode.ViewColumn.Beside });
    } catch (error) {
      this.log.info(`Could not open ${rel}: ${(error as Error).message}`);
    }
  }

  async runAnalysis(): Promise<void> {
    if (!this.folder || this.status === 'analyzing' || this.busy) return;
    this.status = 'analyzing';
    this.error = undefined;
    this.post();
    try {
      const ignore = vscode.workspace.getConfiguration('ballast').get<string[]>('ignore', []);
      this.log.info(`Analyzing ${this.folder.fsPath}`);
      this.result = await analyze(this.folder.fsPath, { ignore });
      this.log.info(`Found ${this.result.files.length} unused files and ${this.result.packages.length} unused packages in ${this.result.durationMs} ms`);
      const manifest = JSON.parse(await readFile(path.join(this.folder.fsPath, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
      this.typecheckScript = findTypecheckScript(manifest.scripts);
      this.status = 'done';
    } catch (error) {
      this.status = 'error';
      this.error = (error as Error).message;
      this.log.info(`Analysis failed: ${this.error}`);
    }
    this.post();
  }

  private ensureTrusted(): boolean {
    if (vscode.workspace.isTrusted) return true;
    void vscode.window.showWarningMessage(this.t.untrusted);
    return false;
  }

  private listForDialog(items: string[]): string {
    const shown = items.slice(0, 12).join('\n');
    return items.length > 12 ? `${shown}\n${this.t.more(items.length - 12)}` : shown;
  }

  private async deleteFiles(paths: string[]): Promise<void> {
    if (!this.result || this.busy || !this.ensureTrusted()) return;
    const plan = planFileDeletion(this.result, paths);
    if (plan.rejected.length) this.log.info(`Ignored paths not in the analysis: ${plan.rejected.join(', ')}`);
    if (!plan.files.length) return;
    const tests = plan.files.length - paths.filter((p) => plan.files.includes(p)).length;
    const answer = await vscode.window.showWarningMessage(
      this.t.confirmFiles(plan.files.length),
      { modal: true, detail: this.t.confirmFilesDetail(this.listForDialog(plan.files), tests) },
      this.t.moveToTrash,
    );
    if (answer !== this.t.moveToTrash) return;

    this.busy = 'files';
    this.typecheck = undefined;
    this.post();
    const entries: Array<{ path: string; content: Uint8Array }> = [];
    const done: string[] = [];
    let failed = 0;
    let error: string | undefined;
    for (const rel of plan.files) {
      try {
        const content = await vscode.workspace.fs.readFile(this.uri(rel));
        await vscode.workspace.fs.delete(this.uri(rel), { useTrash: true });
        entries.push({ path: rel, content });
        done.push(rel);
        this.log.info(`Moved to trash: ${rel}`);
      } catch (e) {
        failed++;
        this.log.info(`Could not move ${rel} to trash: ${(e as Error).message}`);
        // Sin papelera no se sigue: borrar de forma permanente nunca es la alternativa.
        if (/trash/i.test((e as Error).message)) {
          error = this.t.noTrash;
          break;
        }
      }
    }
    if (failed && !error) error = this.t.partial(failed);
    this.backup = entries.length ? { kind: 'files', entries } : undefined;
    this.lastAction = { kind: 'files', items: done, undoable: entries.length > 0, error };
    this.busy = null;
    await this.runAnalysis();
  }

  private async uninstall(names: string[]): Promise<void> {
    if (!this.result || !this.folder || this.busy || !this.ensureTrusted()) return;
    const plan = planUninstall(this.result, names);
    if (!plan.names.length) return;
    const command = [plan.command, ...plan.args].join(' ');
    const broken = this.result.packages.filter((p) => plan.names.includes(p.name) && p.reason === 'onlyUnusedFiles').map((p) => p.name);
    const answer = await vscode.window.showWarningMessage(
      this.t.confirmPackages(plan.names.length),
      { modal: true, detail: this.t.confirmPackagesDetail(command, broken) },
      this.t.uninstall,
    );
    if (answer !== this.t.uninstall) return;

    this.busy = 'packages';
    this.typecheck = undefined;
    this.post();
    const lockName = LOCKFILES[this.result.packageManager];
    const manifest = await vscode.workspace.fs.readFile(this.uri('package.json'));
    let lockfile: { name: string; content: Uint8Array } | undefined;
    try {
      lockfile = { name: lockName, content: await vscode.workspace.fs.readFile(this.uri(lockName)) };
    } catch {
      lockfile = undefined;
    }
    let error: string | undefined;
    try {
      const res = await run(plan.command, plan.args, { cwd: this.folder.fsPath, log: this.log });
      if (res.code !== 0) error = this.t.commandFailed(command);
    } catch (e) {
      error = (e as Error).message;
    }
    this.backup = { kind: 'packages', manifest, lockfile };
    this.lastAction = { kind: 'packages', items: plan.names, undoable: true, error };
    this.busy = null;
    await this.runAnalysis();
  }

  private async undo(): Promise<void> {
    if (!this.backup || !this.folder || this.busy || !this.ensureTrusted()) return;
    this.busy = 'undo';
    this.post();
    const backup = this.backup;
    let error: string | undefined;
    try {
      if (backup.kind === 'files') {
        for (const entry of backup.entries) {
          await vscode.workspace.fs.writeFile(this.uri(entry.path), entry.content);
          this.log.info(`Restored ${entry.path}`);
        }
      } else {
        await vscode.workspace.fs.writeFile(this.uri('package.json'), backup.manifest);
        if (backup.lockfile) await vscode.workspace.fs.writeFile(this.uri(backup.lockfile.name), backup.lockfile.content);
        const manager = this.result?.packageManager ?? 'npm';
        const res = await run(manager, ['install'], { cwd: this.folder.fsPath, log: this.log });
        if (res.code !== 0) error = this.t.commandFailed(`${manager} install`);
      }
    } catch (e) {
      error = (e as Error).message;
    }
    this.backup = undefined;
    this.lastAction = error ? { kind: backup.kind, items: [], undoable: false, error } : undefined;
    this.busy = null;
    await this.runAnalysis();
  }

  private async runTypecheck(): Promise<void> {
    if (!this.folder || !this.typecheckScript || this.busy || !this.ensureTrusted()) return;
    const script = this.typecheckScript;
    const manager = this.result?.packageManager ?? 'npm';
    this.busy = 'typecheck';
    this.typecheck = { script, status: 'running' };
    this.post();
    try {
      const res = await run(manager, ['run', script], { cwd: this.folder.fsPath, log: this.log });
      this.typecheck = { script, status: res.code === 0 ? 'passed' : 'failed' };
    } catch (e) {
      this.log.info(`Typecheck failed to run: ${(e as Error).message}`);
      this.typecheck = { script, status: 'failed' };
    }
    this.busy = null;
    this.post();
  }

  private post(): void {
    const message: StateMessage = {
      type: 'state',
      lang: this.lang,
      status: this.status,
      projectFolder: this.folder ? path.basename(this.folder.fsPath) : '',
      canSelectProject: this.candidateCount > 1,
      trusted: vscode.workspace.isTrusted,
      result: this.result,
      error: this.error,
      busy: this.busy,
      lastAction: this.lastAction,
      typecheckScript: this.typecheckScript,
      typecheck: this.typecheck,
    };
    BallastPanel.instance?.post(message);
  }

  onConfigChange(): void {
    this.post();
  }
}
