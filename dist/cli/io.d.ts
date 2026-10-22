import type { ServiceStatus, TaskRecord } from "../client/types.js";
export declare const MAX_CLI_INPUT_BYTES = 1048576;
export declare const KEY_PREFIX = "sk-popnow-";
export declare const CONSOLE_KEYS_URL = "https://popnow.ai/api/console/keys";
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
export declare function defaultCliIo(): CliIo;
export declare function outputValue(value: unknown, json: boolean, io: CliIo): void;
/**
 * `status` is the one command that needs no key and costs nothing, so it should say in a sentence
 * whether the API is reachable, who answered and how fast. `--json` keeps the raw structure.
 */
export declare function describeServiceStatus(status: ServiceStatus, baseUrl: string, elapsedMs: number): string;
/**
 * The server's message says what happened; the terminal still owes a sentence about what to do
 * next. Nothing here is added under `--json`, which is read by programs.
 */
export declare function describeNextStep(error: unknown, env: NodeJS.ProcessEnv): string | undefined;
export declare function readInputObject(inputJson: string | undefined, inputFile: string | undefined, io: CliIo): Promise<Record<string, unknown>>;
/**
 * Spending credits and destroying content pass through the same gate: an answer at an interactive
 * terminal, or an explicit `--yes`.
 */
export declare function requireConfirmation(message: string, yes: boolean, io: CliIo, kind?: "billable" | "destructive"): Promise<void>;
/**
 * `--retention` accepts `30m`, `1h`, `7d` or plain seconds. No ceiling is enforced locally: the
 * server clamps to `min(header, account setting, platform maximum)` and reports the effective
 * value in the task's `retention`.
 */
export declare function parseRetentionSeconds(value: string): number;
/** "It expired" and "you deleted it" must read differently. */
export declare function describeTaskRetention(task: TaskRecord): string[];
export declare const SUPPORTED_UPLOAD_CONTENT_TYPES: readonly string[];
export declare function inferUploadContentType(filePath: string): string;
export declare function parseUploadContentType(value: string): string;
