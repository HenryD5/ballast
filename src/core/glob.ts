/**
 * Glob mínimo para rutas con `/`: `**` cruza carpetas, `*` no, `?` un carácter, `{a,b}` alternativas.
 * Suficiente para `import.meta.glob`, imports dinámicos con plantilla y la opción `ignore`.
 */
export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') {
          i++;
          re += '(?:.*/)?';
        } else {
          re += '.*';
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if (c === '{') {
      const end = glob.indexOf('}', i);
      if (end < 0) {
        re += '\\{';
        continue;
      }
      re += `(?:${glob.slice(i + 1, end).split(',').map(escape).join('|')})`;
      i = end;
    } else {
      re += escape(c);
    }
  }
  return new RegExp(`^${re}$`);
}

function escape(value: string): string {
  return value.replace(/[.+^$()|[\]\\]/g, '\\$&');
}

export function matchesAny(path: string, globs: readonly RegExp[]): boolean {
  return globs.some((g) => g.test(path));
}
