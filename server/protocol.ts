/**
 * The game API's wire rules, shared by the laptop host (`server/api.ts`, Node) and the cloud host (`worker/`,
 * Cloudflare): what a valid device id, command id, game code and request body look like, and which HTTP status a
 * RuleError answer gets. Nothing here touches a request object, so both hosts read their bodies their own way and
 * hand the text in.
 */
import { createHash } from 'node:crypto';
import type { RuleError } from '../src/engine/types';
import { err } from '../src/engine/util';

export const MAX_BODY = 64 * 1024;
/** Log entries per stream snapshot unless the client asks (`log=`) for 0–100. */
export const STREAM_LOG = 50;
const MAX_STREAM_LOG = 100;
const DEVICE_ID = /^[A-Za-z0-9_-]{1,64}$/;
/** A command id: what a phone sends again, unchanged, when it retries a POST that got no answer. */
const COMMAND_ID = /^[A-Za-z0-9_-]{1,64}$/;
export const GAME_CODE = /^[A-Z0-9]{1,16}$/;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly error: RuleError,
    /** The `Allow` header of a 405. */
    readonly allow: string | null = null,
  ) {
    super(error.message);
  }
}

export const notFound = () => new HttpError(404, err('not_found', 'Unknown API route'));
const noDevice = () => new HttpError(400, err('no_device', 'This device did not send a valid device id; reload the page'));
export const tooLarge = () => new HttpError(413, err('too_large', `The request body is over ${MAX_BODY / 1024} KB`));

/** The public uid of a device secret: the first 24 hex characters of its SHA-256. */
export function publicUid(secret: string): string {
  return createHash('sha256').update(secret).digest('hex').slice(0, 24);
}

/** The public uid behind a device secret from a request; `no_device` if it is missing or malformed. */
export function uidFromSecret(secret: unknown): string {
  if (typeof secret !== 'string' || !DEVICE_ID.test(secret)) throw noDevice();
  return publicUid(secret);
}

/** HTTP status for a RuleError answer. */
export function statusOf(e: RuleError): number {
  if (e.code === 'no_game') return 404;
  if (e.code === 'bad_command' || e.code === 'bad_mode') return 400;
  return 422;
}

/** A request body as a JSON object (an empty body is `{}`); `bad_json` otherwise. */
export function parseJsonObject(text: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = text.trim() === '' ? {} : JSON.parse(text);
  } catch {
    throw new HttpError(400, err('bad_json', 'The request body is not valid JSON'));
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HttpError(400, err('bad_json', 'The request body must be a JSON object'));
  }
  return value as Record<string, unknown>;
}

/** The optional `cmdId` of a POST body; `bad_command` when it is there but malformed. */
export function cmdIdOf(body: Record<string, unknown>): string | undefined {
  const id = body.cmdId;
  if (id === undefined) return undefined;
  if (typeof id !== 'string' || !COMMAND_ID.test(id)) {
    throw new HttpError(400, err('bad_command', '"cmdId" must be 1–64 letters, digits, "-" or "_"'));
  }
  return id;
}

/** The `cmd` object of a commands POST; `bad_command` when there is none. */
export function cmdOf(body: Record<string, unknown>): object {
  if (typeof body.cmd !== 'object' || body.cmd === null) {
    throw new HttpError(400, err('bad_command', 'The request needs a "cmd" object'));
  }
  return body.cmd;
}

/** The optional `seq` of an undo POST: the entry the device means to undo. */
export function seqOf(body: Record<string, unknown>): number | undefined {
  const seq = body.seq;
  if (seq !== undefined && (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0)) {
    throw new HttpError(400, err('bad_undo', '"seq" must be the number of the log entry to undo'));
  }
  return seq;
}

export function logLimit(raw: string | null): number {
  const n = raw === null ? STREAM_LOG : Number(raw);
  return Number.isInteger(n) ? Math.min(MAX_STREAM_LOG, Math.max(0, n)) : STREAM_LOG;
}

/** The game code of an API path segment, upper-cased; null when it can't be a code (no game has it). */
export function codeOf(raw: string): string | null {
  let code: string;
  try {
    code = decodeURIComponent(raw).toUpperCase();
  } catch {
    throw notFound();
  }
  return GAME_CODE.test(code) ? code : null;
}
