import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { analyze } from '../core/analyze';
import { formatReport } from '../core/report';

declare const __BALLAST_VERSION__: string;
const VERSION = typeof __BALLAST_VERSION__ === 'string' ? __BALLAST_VERSION__ : '0.0.0-dev';

const HELP = `ballast ${VERSION}
Lista los archivos y paquetes npm que el proyecto no usa. Solo lee: no borra ni desinstala nada.

Uso: ballast [carpeta] [--json] [--lang es|en] [--ignore <glob o paquete>]...`;

export async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      json: { type: 'boolean', default: false },
      lang: { type: 'string', default: 'es' },
      ignore: { type: 'string', multiple: true, default: [] },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false },
    },
  });
  if (values.help) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }
  if (values.version) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  const root = resolve(positionals[0] ?? process.cwd());
  const result = await analyze(root, { ignore: values.ignore });
  process.stdout.write(values.json ? `${JSON.stringify(result, null, 2)}\n` : formatReport(result, values.lang === 'en' ? 'en' : 'es'));
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    },
  );
}
