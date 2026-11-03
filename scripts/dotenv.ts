/** Loads .env.local then .env into process.env (existing values win) for the CLI scripts. */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export function loadDotEnv(file: string): void {
  if (!existsSync(file)) return;
  for (const rawLine of readFileSync(file, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export function loadProjectEnv(): void {
  loadDotEnv(path.join(process.cwd(), '.env.local'));
  loadDotEnv(path.join(process.cwd(), '.env'));
}
