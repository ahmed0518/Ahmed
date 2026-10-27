/**
 * Runs after `next build` (the `postbuild` script). With `output: 'standalone'` Next writes
 * a self-contained server to .next/standalone but leaves the static assets in .next/static;
 * this copies them next to it so `node .next/standalone/server.js` (npm start, the e2e
 * harness, the Dockerfile) serves them. Does nothing when either folder is missing, and
 * fails loudly when the server was written somewhere else inside .next/standalone (a
 * nested layout — next.config.ts pins `outputFileTracingRoot` to prevent exactly that).
 */
import { cpSync, existsSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const standalone = path.join(root, '.next', 'standalone');
const assets = path.join(root, '.next', 'static');
if (existsSync(standalone) && existsSync(assets)) {
  if (!existsSync(path.join(standalone, 'server.js'))) {
    process.stderr.write(
      'standalone-static: .next/standalone/server.js is missing — the standalone server was built under a nested path. ' +
        'next.config.ts pins outputFileTracingRoot to this checkout; check for a package-lock.json in a parent directory and rebuild.\n',
    );
    process.exit(1);
  }
  cpSync(assets, path.join(standalone, '.next', 'static'), { recursive: true });
  process.stdout.write('copied .next/static into .next/standalone/.next/static\n');
}
