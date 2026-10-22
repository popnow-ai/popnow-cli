import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { createInterface } from "node:readline/promises";

import { MissingApiKeyError, PopNowApiError, SkillDownloadError, UploadError } from "../client/errors.js";
import { SkillArchiveError } from "../skills/zip.js";
import type { ServiceStatus, TaskRecord } from "../client/types.js";

export const MAX_CLI_INPUT_BYTES = 1_048_576;
export const KEY_PREFIX = "sk-popnow-";
export const CONSOLE_KEYS_URL = "https://popnow.ai/api/console/keys";

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  stdinIsTTY: boolean;
  readStdin: () => Promise<string>;
  confirm: (message: string) => Promise<boolean>;
  /** Asks a free-form question at the terminal. Optional; without it the CLI never prompts for a choice. */
  ask?: (question: string) => Promise<string>;
  /** Opens a URL in the default browser. Resolves false when nothing could be opened. */
  openUrl: (url: string) => Promise<boolean>;
  env: NodeJS.ProcessEnv;
}

function openInBrowser(url: string): Promise<boolean> {
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  return new Promise((resolve) => {
    try {
      const child = spawn(command as string, args as string[], {
        stdio: "ignore",
        detached: true,
      });
      child.once("error", () => resolve(false));
      child.once("spawn", () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}

export function defaultCliIo(): CliIo {
  return {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    stdinIsTTY: Boolean(process.stdin.isTTY),
    readStdin: async () => {
      const chunks: string[] = [];
      const stream: AsyncIterable<unknown> = process.stdin;
      for await (const chunk of stream) {
        if (typeof chunk === "string") chunks.push(chunk);
        else if (chunk instanceof Uint8Array) chunks.push(new TextDecoder().decode(chunk));
        else throw new TypeError("stdin yielded an unsupported value");
      }
      return chunks.join("");
    },
    confirm: async (message) => {
      const prompt = createInterface({ input: process.stdin, output: process.stderr });
      try {
        const answer = await prompt.question(`${message} Continue? [y/N] `);
        return /^(?:y|yes)$/i.test(answer.trim());
      } finally {
        prompt.close();
      }
    },
    ask: async (question) => {
      const prompt = createInterface({ input: process.stdin, output: process.stderr });
      try {
        return (await prompt.question(question)).trim();
      } finally {
        prompt.close();
      }
    },
    openUrl: openInBrowser,
    env: process.env,
  };
}

export function outputValue(value: unknown, json: boolean, io: CliIo): void {
  if (json) {
    io.stdout(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }
  if (typeof value === "string") {
    io.stdout(`${value}\n`);
    return;
  }
  if (Array.isArray(value)) {
    io.stdout(`${value.map(formatRecord).join("\n\n")}\n`);
    return;
  }
  io.stdout(`${formatRecord(value)}\n`);
}

function formatRecord(value: unknown): string {
  if (value === null || typeof value !== "object") return String(value);
  return Object.entries(value)
    .map(([key, item]) => {
      const formatted =
        item !== null && typeof item === "object"
          ? JSON.stringify(item)
          : item === undefined
            ? ""
            : String(item);
      return `${key}: ${formatted}`;
    })
    .join("\n");
}

function host(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

/**
 * `status` is the one command that needs no key and costs nothing, so it should say in a sentence
 * whether the API is reachable, who answered and how fast. `--json` keeps the raw structure.
 */
export function describeServiceStatus(
  status: ServiceStatus,
  baseUrl: string,
  elapsedMs: number,
): string {
  const where = host(baseUrl);
  if (status.operational) return `PopNow API is reachable: ${where} answered in ${elapsedMs} ms.`;
  if (status.status === 0) {
    const detail = status.error ? ` (${status.error})` : "";
    return (
      `PopNow API could not be reached: no answer from ${where}${detail}. ` +
      "Check your network or proxy, then POPNOW_BASE_URL if you overrode it."
    );
  }
  if (status.status === 403 || status.status === 451) {
    return (
      `${where} refused this request with HTTP ${status.status}. ` +
      "That is a rejection of where the request came from, not a service fault: " +
      "check any proxy, VPN or gateway between this machine and the API."
    );
  }
  return (
    `PopNow API is not healthy: ${where} answered HTTP ${status.status} on /healthz. ` +
    "Try again in a minute; if it persists, contact https://popnow.ai/contact."
  );
}

function describeApiKeyState(env: NodeJS.ProcessEnv): string {
  const key = env.POPNOW_API_KEY?.trim();
  if (!key) return "POPNOW_API_KEY is not set in this shell.";
  // Only as many characters as the prefix itself: enough to spot a wrong value without printing
  // the secret into a terminal or a CI log.
  if (!key.startsWith(KEY_PREFIX)) {
    return `POPNOW_API_KEY starts with "${key.slice(0, KEY_PREFIX.length)}", not "${KEY_PREFIX}", so this shell holds the wrong value.`;
  }
  return "POPNOW_API_KEY has the right prefix, so the key itself is revoked, expired or mistyped.";
}

/** A 403 has several unrelated causes, and the business code is what tells them apart. */
function describeForbidden(error: PopNowApiError): string {
  if (error.reason === "asset_permission_denied") {
    return "Next: your team role cannot change this asset. Ask a team owner or admin.";
  }
  if (error.reason === "asset_workspace_forbidden") {
    return "Next: this key cannot reach that asset library. Use a key from the workspace that owns it.";
  }
  switch (error.code) {
    case 40301:
      return `Next: this key may not call this model. Check the key's model restrictions at ${CONSOLE_KEYS_URL}.`;
    case 40302:
      return `Next: this network address is not on the key's IP allowlist. Add it, or use a key without one, at ${CONSOLE_KEYS_URL}.`;
    case 40303:
      return "Next: the service is not offered in the region this request came from. Changing keys or settings does not change that.";
    case 40310:
      return "Next: verify your account email first. Open the link from your sign-up email, or send a new one from https://popnow.ai/api/console; the key works as soon as the address is verified.";
    default:
      return "Next: the account cannot use the API right now. Contact https://popnow.ai/contact with the request id.";
  }
}

const ASSET_HINTS: Readonly<Record<string, string>> = {
  asset_library_locked:
    "Next: the asset library opens after your first credit purchase. See https://popnow.ai/pricing.",
  asset_library_full:
    "Next: the asset library is full. Delete assets you no longer need, or unlock a larger plan with a top-up.",
  asset_file_too_large: "Next: the file is above your plan's per-file limit for the asset library.",
  asset_daily_limit:
    "Next: the daily number of new assets is reached. It resets at 00:00 UTC (see Retry-After).",
  asset_storage_full: "Next: asset storage is temporarily full on our side. Try again later.",
};

/**
 * The server's message says what happened; the terminal still owes a sentence about what to do
 * next. Nothing here is added under `--json`, which is read by programs.
 */
export function describeNextStep(error: unknown, env: NodeJS.ProcessEnv): string | undefined {
  if (error instanceof MissingApiKeyError) {
    return (
      `Next: set your key with export POPNOW_API_KEY="${KEY_PREFIX}..." ` +
      `(PowerShell: $env:POPNOW_API_KEY = "${KEY_PREFIX}..."), then run the command again. ` +
      `Create a key at ${CONSOLE_KEYS_URL}. \`popnow status\` and \`popnow docs\` work without one.`
    );
  }
  if (error instanceof UploadError) {
    return "Next: the file bytes did not reach storage. Run `popnow files upload` again; an unused ticket simply expires.";
  }
  if (error instanceof SkillArchiveError) {
    return "Next: the downloaded archive was refused and nothing was installed. Run the command again; if it repeats, send the skill slug to https://popnow.ai/contact.";
  }
  if (error instanceof SkillDownloadError) {
    return error.status === undefined
      ? "Next: nothing was installed. Send the skill slug to https://popnow.ai/contact if this repeats."
      : "Next: the short-lived download link was refused or has expired, and nothing was installed. Run the command again for a fresh link.";
  }
  if (!(error instanceof PopNowApiError)) return undefined;
  if (!error.fromApi) {
    if (error.status === 403) {
      return "Next: this refusal did not come from the PopNow API, so something in between answered. Check any proxy, VPN or corporate gateway between this machine and api.popnow.ai.";
    }
    if (error.status >= 500) {
      return "Next: a gateway between you and the API failed. Retry in a moment; `popnow status` shows whether the API answers.";
    }
    return undefined;
  }
  if (error.reason && ASSET_HINTS[error.reason]) return ASSET_HINTS[error.reason];
  if (error.reason === "unknown_skill") {
    return "Next: `popnow skills search` lists the skill slugs you can install.";
  }
  if (error.reason === "unknown_model" || error.reason === "unknown_task") {
    return "Next: `popnow models list` shows the model IDs this key can call today.";
  }
  switch (error.code) {
    case 400:
      return "Next: read the input schema with `popnow models get <model>` and build --input-json from it. One unknown field is a 400.";
    case 40003:
      return "Next: the uploaded bytes did not match the ticket. Upload the file again with `popnow files upload`.";
    case 40004:
      return "Next: the model cannot serve this combination of settings right now. Change the setting named in the message.";
    case 401:
      return `Next: ${describeApiKeyState(env)} Create or rotate a key at ${CONSOLE_KEYS_URL}.`;
    case 40201:
      return "Next: not enough credits for this task's hold. Buy credits at https://popnow.ai/pricing, then run it again.";
    case 40202:
      return `Next: this key's spend cap was reached. Raise it at ${CONSOLE_KEYS_URL}, or wait for it to reset.`;
    case 403:
    case 40301:
    case 40302:
    case 40303:
    case 40310:
      return describeForbidden(error);
    case 404:
      return "Next: check the id. Model IDs read <maker>/<model>/<task>, and tasks are visible only to the key that created them.";
    case 409:
      return "Next: this conflicts with the current state. If the same --idempotency-key was used for a different request, use a new key; if a task is still running, wait for it to finish.";
    case 40901:
      return "Next: the quote expired or the price changed. Run the command again to get a fresh quote.";
    case 413:
      return "Next: the request is too large. Upload the media with `popnow files upload` and pass the popnow://f/ URI instead.";
    case 429: {
      const wait =
        error.retryAfterSeconds === undefined
          ? "after the Retry-After delay"
          : `in ${error.retryAfterSeconds}s (Retry-After)`;
      return `Next: back off and retry ${wait}. The limit counts per account, so more keys do not raise it.`;
    }
    case 50301:
      return "Next: this model cannot take tasks right now. Try again later or pick another model from `popnow models list`.";
    case 50302:
      return "Next: the generation failed upstream and nothing was charged. Run it again with a NEW --idempotency-key; the old one replays the failure.";
    default:
      if (error.status >= 500) {
        return "Next: this one is on our side. Retry with backoff; if it persists, send the request id to https://popnow.ai/contact.";
      }
      return undefined;
  }
}

function parseJsonObject(raw: string, label: string): Record<string, unknown> {
  if (Buffer.byteLength(raw, "utf8") > MAX_CLI_INPUT_BYTES) {
    throw new TypeError(`${label} exceeds ${MAX_CLI_INPUT_BYTES} bytes`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new TypeError(`${label} is not valid JSON`, { cause: error });
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError(`${label} must contain a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

/**
 * Windows PowerShell 5.1 writes a UTF-8 BOM with `Out-File -Encoding utf8`, which JSON.parse
 * rejects. Only the leading one is removed.
 */
function stripUtf8Bom(raw: string): string {
  return raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
}

export async function readInputObject(
  inputJson: string | undefined,
  inputFile: string | undefined,
  io: CliIo,
): Promise<Record<string, unknown>> {
  if (inputJson !== undefined && inputFile !== undefined) {
    throw new TypeError("use either --input-json or --input-file, not both");
  }
  if (inputJson !== undefined) return parseJsonObject(stripUtf8Bom(inputJson), "--input-json");
  // Every model has required fields, so an empty object is never right: refuse before any quote
  // or charge instead of learning it from a 400.
  if (inputFile === undefined) {
    throw new TypeError(
      "model input is required: pass --input-json '<json object>' or --input-file <path> " +
        "(use --input-file - to read the object from stdin). " +
        "Read the model's input schema with `popnow models get <model>` first",
    );
  }
  const raw = inputFile === "-" ? await io.readStdin() : await readFile(inputFile, "utf8");
  return parseJsonObject(stripUtf8Bom(raw), inputFile === "-" ? "stdin" : "--input-file");
}

/**
 * Spending credits and destroying content pass through the same gate: an answer at an interactive
 * terminal, or an explicit `--yes`.
 */
export async function requireConfirmation(
  message: string,
  yes: boolean,
  io: CliIo,
  kind: "billable" | "destructive" = "billable",
): Promise<void> {
  if (yes) return;
  if (!io.stdinIsTTY) {
    throw new Error(`${kind} command requires an interactive confirmation or --yes`);
  }
  if (!(await io.confirm(message))) throw new Error("operation canceled");
}

const RETENTION_UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3_600, d: 86_400 };

/**
 * `--retention` accepts `30m`, `1h`, `7d` or plain seconds. No ceiling is enforced locally: the
 * server clamps to `min(header, account setting, platform maximum)` and reports the effective
 * value in the task's `retention`.
 */
export function parseRetentionSeconds(value: string): number {
  const match = /^(\d+)(s|m|h|d)?$/.exec(value.trim().toLowerCase());
  if (!match) {
    throw new TypeError(
      "--retention must be a whole number of seconds or a duration such as 30m, 1h, or 7d",
    );
  }
  const seconds = Number(match[1]) * RETENTION_UNIT_SECONDS[match[2] ?? "s"]!;
  if (!Number.isSafeInteger(seconds)) throw new TypeError("--retention is too large");
  return seconds;
}

/** "It expired" and "you deleted it" must read differently. */
export function describeTaskRetention(task: TaskRecord): string[] {
  const lines: string[] = [];
  const retention = task.retention;
  const removedOn = task.purgedAt ?? retention?.outputsExpireAt;
  if (task.contentState === "purged") {
    lines.push(
      `Content: destroyed, you removed the outputs${removedOn ? ` on ${removedOn}` : ""}. Billing records are unaffected.`,
    );
  } else if (task.contentState === "expired") {
    lines.push(
      `Content: expired, outputs were removed${removedOn ? ` on ${removedOn}` : ""} under your retention settings.`,
    );
  }
  if (retention?.outputsExpireAt) lines.push(`Outputs expire: ${retention.outputsExpireAt}`);
  if (retention?.promptsExpireAt) lines.push(`Prompts erased: ${retention.promptsExpireAt}`);
  if (retention?.source) lines.push(`Retention set by: ${retention.source}`);
  return lines;
}

/* Must match the `UploadURLRequest.contentType` enum of the OpenAPI contract value for value. */
const UPLOAD_CONTENT_TYPES_BY_EXTENSION: Readonly<Record<string, string>> = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".key": "application/vnd.apple.keynote",
  ".pages": "application/vnd.apple.pages",
  ".numbers": "application/vnd.apple.numbers",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  // LoRA weights; the returned URI goes in `loras[].path`.
  ".safetensors": "application/octet-stream",
};

export const SUPPORTED_UPLOAD_CONTENT_TYPES: readonly string[] = [
  ...new Set(Object.values(UPLOAD_CONTENT_TYPES_BY_EXTENSION)),
];

export function inferUploadContentType(filePath: string): string {
  const contentType = UPLOAD_CONTENT_TYPES_BY_EXTENSION[extname(filePath).toLowerCase()];
  if (!contentType) {
    const known = Object.keys(UPLOAD_CONTENT_TYPES_BY_EXTENSION)
      .map((extension) => extension.slice(1))
      .join(", ");
    throw new TypeError(`--content-type is required unless the file extension is one of: ${known}`);
  }
  return contentType;
}

export function parseUploadContentType(value: string): string {
  if (!SUPPORTED_UPLOAD_CONTENT_TYPES.includes(value)) {
    throw new TypeError(`content type must be one of: ${SUPPORTED_UPLOAD_CONTENT_TYPES.join(", ")}`);
  }
  return value;
}
