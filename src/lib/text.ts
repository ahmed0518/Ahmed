/** Strip control characters, collapse whitespace, trim and cap the length. Pure; safe in the browser. */
export function cleanText(value: string, max: number): string {
  const stripped = value
    .split('')
    .filter((ch) => {
      const c = ch.charCodeAt(0);
      return !(c <= 0x08 || c === 0x0b || c === 0x0c || (c >= 0x0e && c <= 0x1f) || c === 0x7f);
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.length > max ? stripped.slice(0, max) : stripped;
}

/** UTF-8 byte length without Node's Buffer. */
export function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** `token:maks-ai` → `maks-ai`, `claude` → `Claude`, `web:Ahmed` → `Ahmed`. */
export function viaLabel(via: string): string {
  if (via === 'claude') return 'Claude';
  const idx = via.indexOf(':');
  return idx >= 0 ? via.slice(idx + 1) : via;
}
