import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { spawn } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { run } from '../../src/infra/exec';
import { createLogger } from '../../src/infra/log';

function fakeSpawn(code: number, stdout = '', stderr = '') {
  return vi.fn(() => {
    const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: () => void };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = vi.fn();
    setTimeout(() => {
      child.stdout.end(stdout);
      child.stderr.end(stderr);
      child.emit('close', code, null);
    }, 0);
    return child;
  }) as unknown as typeof spawn & ReturnType<typeof vi.fn>;
}

const log = () => {
  const lines: string[] = [];
  return { lines, logger: createLogger({ appendLine: (l) => lines.push(l) }, () => new Date(2026, 0, 1, 10, 0, 0)) };
};

describe('run', () => {
  it('runs allowed commands without a shell and logs them', async () => {
    const spawnImpl = fakeSpawn(0, 'removed 2 packages');
    const { lines, logger } = log();
    const res = await run('npm', ['uninstall', 'dayjs'], { cwd: '/p', log: logger, spawnImpl });
    expect(res).toEqual({ code: 0, stdout: 'removed 2 packages', stderr: '' });
    const [file, args, options] = (spawnImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    if (process.platform !== 'win32') {
      expect(file).toBe('npm');
      expect(args).toEqual(['uninstall', 'dayjs']);
    }
    expect(options).toMatchObject({ cwd: '/p', shell: false });
    expect(lines[0]).toBe('[2026-01-01 10:00:00] $ npm uninstall dayjs   (cwd: /p)');
    expect(lines).toContain('removed 2 packages');
  });

  it('returns failing exit codes instead of throwing', async () => {
    const res = await run('npm', ['run', 'type-check'], { cwd: '/p', log: log().logger, spawnImpl: fakeSpawn(2, '', 'TS2322') });
    expect(res.code).toBe(2);
  });

  it('refuses anything outside the allow-list before spawning', async () => {
    const spawnImpl = fakeSpawn(0);
    await expect(run('npm', ['uninstall', 'a;rm -rf /'], { cwd: '/p', log: log().logger, spawnImpl })).rejects.toThrow('Command not allowed');
    await expect(run('sh', ['-c', 'x'], { cwd: '/p', log: log().logger, spawnImpl })).rejects.toThrow('Command not allowed');
    expect(spawnImpl).not.toHaveBeenCalled();
  });
});
