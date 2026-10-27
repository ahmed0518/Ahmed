/**
 * Runs after `next build` (the `postbuild` script). With `output: 'standalone'` Next writes
 * a self-contained server to .next/standalone but leaves the static assets in .next/static;
 * this copies them next to it so `node .next/standalone/server.js` (npm start, the e2e
 * harness, the Dockerfile) serves them. Does nothing when either folder is missing.
 */
import { cpSync, existsSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const standalone = path.join(root, '.next', 'standalone');
const assets = path.join(root, '.next', 'static');
if (existsSync(standalone) && existsSync(assets)) {
  cpSync(assets, path.join(standalone, '.next', 'static'), { recursive: true });
  process.stdout.write('copied .next/static into .next/standalone/.next/static\n');
}
