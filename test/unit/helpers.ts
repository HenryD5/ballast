import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach } from 'vitest';

const created: string[] = [];

afterEach(async () => {
  while (created.length) await rm(created.pop()!, { recursive: true, force: true });
});

/** Crea un proyecto temporal. Los valores objeto se escriben como JSON. Se borra al terminar cada test. */
export async function makeProject(files: Record<string, string | object>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ballast-'));
  created.push(root);
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, ...path.split('/'));
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  }
  return root;
}

/** package.json instalado en node_modules, con binarios y peers. */
export function installed(name: string, extra: { bin?: string | Record<string, string>; peerDependencies?: Record<string, string>; peerDependenciesMeta?: Record<string, { optional: boolean }> } = {}): Record<string, object> {
  return { [`node_modules/${name}/package.json`]: { name, version: '1.0.0', ...extra } };
}
