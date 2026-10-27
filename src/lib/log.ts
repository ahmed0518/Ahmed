import { randomBytes } from 'node:crypto';

type Level = 'info' | 'warn' | 'error';
type Fields = Record<string, unknown>;

// Structured one-line JSON logs. Callers never pass PINs, passcodes, tokens, cookie values
// or Authorization headers (see SPEC §5) — only names, ips, refs, operation names and
// Shopify error text.
function emit(level: Level, msg: string, fields?: Fields): void {
  const line = JSON.stringify({ time: new Date().toISOString(), level, msg, ...(fields ?? {}) });
  if (level === 'info') {
    process.stdout.write(line + '\n');
  } else {
    process.stderr.write(line + '\n');
  }
}

export const log = {
  info: (msg: string, fields?: Fields) => emit('info', msg, fields),
  warn: (msg: string, fields?: Fields) => emit('warn', msg, fields),
  error: (msg: string, fields?: Fields) => emit('error', msg, fields),
};

const REF_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

/** 8 random characters that tie an error response to its server log line. */
export function newRef(): string {
  const bytes = randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i++) {
    out += REF_ALPHABET[(bytes[i] ?? 0) % REF_ALPHABET.length];
  }
  return out;
}
