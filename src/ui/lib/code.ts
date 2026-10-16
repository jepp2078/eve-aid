/** Room codes as people type, paste, read and see them: `abc-234`, a pasted join link → `ABC234`, shown `ABC·234`. */
import { CODE_ALPHABET, CODE_LENGTH } from '../../sync/commit';

export { CODE_LENGTH };

/** Upper-cases and keeps only code characters (so separators, spaces and the never-used I, O, 0, 1 drop out). */
export function normalizeCode(raw: string): string {
  let out = '';
  for (const ch of raw.toUpperCase()) {
    if (CODE_ALPHABET.includes(ch)) out += ch;
    if (out.length === CODE_LENGTH) break;
  }
  return out;
}

/** The code in pasted text: the part after `/join/` of a join link, or the text itself. */
export function extractCode(text: string): string {
  const link = /\/join\/([^/?#\s]+)/.exec(text);
  return normalizeCode(link ? safeDecode(link[1]!) : text);
}

/** `ABC234` → `ABC·234` (any code longer than three characters gets the middle dot after the third). */
export function formatCode(code: string): string {
  return code.length > 3 ? `${code.slice(0, 3)}·${code.slice(3)}` : code;
}

export function isCompleteCode(code: string): boolean {
  return code.length === CODE_LENGTH && [...code].every((ch) => CODE_ALPHABET.includes(ch));
}

export function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
