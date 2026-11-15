import { spawn } from 'node:child_process';
import { isValidPackageName, isValidScriptName } from '../core/cleanup';
import type { Logger } from './log';

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

const MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);

/**
 * Únicas invocaciones permitidas: desinstalar paquetes con nombre válido, reinstalar (para deshacer)
 * y correr un script del proyecto. Nunca un string de shell ni `--force`.
 */
export function isAllowedCommand(command: string, args: readonly string[]): boolean {
  if (!MANAGERS.has(command) || args.length === 0) return false;
  const [verb, ...rest] = args;
  if (verb === 'install') return rest.length === 0;
  if (verb === 'uninstall' || verb === 'remove') return rest.length > 0 && rest.every(isValidPackageName);
  if (verb === 'run') return rest.length === 1 && isValidScriptName(rest[0]!);
  return false;
}

export interface ExecOptions {
  cwd: string;
  log: Logger;
  timeoutMs?: number;
  spawnImpl?: typeof spawn;
}

export function run(command: string, args: readonly string[], options: ExecOptions): Promise<ExecResult> {
  if (!isAllowedCommand(command, args)) return Promise.reject(new Error(`Command not allowed: ${[command, ...args].join(' ')}`));
  const { cwd, log, timeoutMs = 10 * 60_000, spawnImpl = spawn } = options;
  const display = [command, ...args].join(' ');
  log.command(`${display}   (cwd: ${cwd})`);
  // En Windows los gestores son .cmd y Node no los lanza sin shell (CVE-2024-27980).
  // cmd.exe es seguro aquí: los argumentos ya pasaron por la lista de arriba.
  const [file, argv] = process.platform === 'win32' ? ['cmd.exe', ['/d', '/s', '/c', command, ...args]] : [command, [...args]];
  return new Promise((resolve, reject) => {
    const child = spawnImpl(file, argv, {
      cwd,
      shell: false,
      windowsHide: true,
      env: { ...process.env, npm_config_fund: 'false', npm_config_audit: 'false', npm_config_update_notifier: 'false' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr?.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      log.info(`${display} failed to start: ${err.message}`);
      reject(err);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      log.output(stdout);
      log.output(stderr);
      if (signal) {
        reject(new Error(`${display} was stopped (${signal}).`));
        return;
      }
      log.info(`${display} exited with code ${code}`);
      resolve({ code: code ?? 0, stdout, stderr });
    });
  });
}
