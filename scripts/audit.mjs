#!/usr/bin/env node
/**
 * `npm run audit:prod` — `npm audit --omit=dev` with an explicit allow-list of accepted
 * advisories (README §8). Fails on anything that is not on the list, so a new advisory is
 * never hidden behind the accepted ones.
 *
 * Accepted (postcss <= 8.5.22 pulled in by next 15.x; the fixed range starts at next 16.3):
 * build-time CSS stringify / source-map issues. The app only processes its own stylesheets
 * at build time, never user CSS. Upgrade trigger: drop them when the 15.x pin goes.
 */
import { execFileSync } from 'node:child_process';

const ACCEPTED = new Map([
  ['GHSA-qx2v-qp2m-jg93', 'postcss: XSS via unescaped </style> in stringified output (build-time only here)'],
  ['GHSA-6g55-p6wh-862q', 'postcss: sourceMappingURL file read (build-time only here)'],
  ['GHSA-fxqj-rqcc-2cmp', 'postcss: incomplete fix of GHSA-6g55-p6wh-862q (build-time only here)'],
  ['GHSA-r28c-9q8g-f849', 'postcss: path traversal in source-map auto-loading (build-time only here)'],
]);

let raw;
try {
  raw = execFileSync('npm', ['audit', '--omit=dev', '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
} catch (e) {
  raw = e.stdout; // npm exits 1 when it finds anything; the JSON report is still on stdout
  if (!raw) {
    console.error(`npm audit could not run: ${e.stderr || e.message}`);
    process.exit(2);
  }
}

const report = JSON.parse(raw);
const unexpected = [];
const seen = new Set();
for (const [name, vuln] of Object.entries(report.vulnerabilities ?? {})) {
  for (const via of vuln.via ?? []) {
    if (typeof via === 'string') continue; // "via another package" — reported under that package
    const id = String(via.url ?? '').split('/').pop() ?? '';
    seen.add(id);
    if (!ACCEPTED.has(id)) unexpected.push(`${name} ${via.range ?? ''}: ${via.title} (${via.severity}) ${via.url}`);
  }
}

for (const [id, why] of ACCEPTED) {
  if (seen.has(id)) console.log(`accepted  ${id} — ${why}`);
}
if (unexpected.length > 0) {
  console.error('\nnpm audit --omit=dev found advisories that are NOT on the accepted list:\n - ' + unexpected.join('\n - '));
  process.exit(1);
}
console.log(`ok        no production-dependency advisory outside the accepted list (${seen.size} accepted)`);
