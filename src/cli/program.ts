import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";

import { Command, CommanderError, InvalidArgumentError, Option } from "commander";

import { DEFAULT_BASE_URL, PopNowClient, type PopNowClientOptions } from "../client/client.js";
import { DOC_TOPICS, OPENAPI_URL, findTopic, searchDocs } from "../client/docs.js";
import { PopNowApiError, WaitTimeoutError } from "../client/errors.js";
import type { CreatedTask, ListAssetsOptions, ListTasksOptions, TaskRecord } from "../client/types.js";
import { verifyAccountEndpoint, verifyTaskCallback } from "../client/webhooks.js";
import { CLI_VERSION } from "../version.js";
import {
  defaultCliIo,
  describeNextStep,
  describeServiceStatus,
  describeTaskRetention,
  inferUploadContentType,
  outputValue,
  parseRetentionSeconds,
  parseUploadContentType,
  readInputObject,
  requireConfirmation,
  type CliIo,
} from "./io.js";
import { registerSkillsCommands } from "./skills.js";

interface GlobalOptions {
  json?: boolean;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

interface WaitCommandOptions {
  pollIntervalMs?: number;
  waitTimeoutMs?: number;
}

interface CreateCommandOptions extends WaitCommandOptions {
  model: string;
  inputJson?: string;
  inputFile?: string;
  callbackUrl?: string;
  idempotencyKey?: string;
  retention?: number;
  yes?: boolean;
  wait?: boolean;
}

interface RetryCommandOptions extends WaitCommandOptions {
  idempotencyKey?: string;
  yes?: boolean;
  wait?: boolean;
}

interface CliErrorDetails {
  error: string;
  type: string;
  status?: number;
  code?: number;
  reason?: string;
  requestId?: string;
  retryAfterSeconds?: number;
  /** The task was accepted; only the waiting step did not finish. */
  taskId?: string;
  /** Replaying this key returns the same task instead of creating (and paying for) another. */
  idempotencyKey?: string;
  /** A command that can be pasted back into the terminal to pick the task up again. */
  recover?: string;
}

/**
 * "The task was accepted, but waiting for it failed." Its own type, so the task id reaches the
 * final error output in both human and `--json` mode. Without it a dropped connection during
 * `--wait` would print nothing useful, and re-running the command with a fresh idempotency key
 * would create and pay for a second task.
 */
class AcceptedButWaitFailedError extends Error {
  constructor(
    readonly taskId: string,
    readonly idempotencyKey: string,
    override readonly cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : "waiting for the task failed");
    this.name = "AcceptedButWaitFailedError";
  }
}

/* `jobs purge` and `--retention` remove the same content; both descriptions must agree. */
const DESTROYED_CONTENT = "generated files, result payload and stored prompt";
const RETAINED_BILLING_RECORDS =
  "the charge, the model, the state, the timestamps and the request id";

/** Exit code for a waited task that reached a final state other than `succeeded`. */
export const EXIT_TASK_NOT_SUCCEEDED = 2;

export interface CliDependencies {
  io?: CliIo;
  createClient?: (options: PopNowClientOptions) => PopNowClient;
  /** Used by `docs search`; defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Home directory for agent skills folders; defaults to os.homedir(). */
  homeDir?: string;
  /** Project root for `skills --project`; defaults to the current working directory. */
  cwd?: string;
}

interface CliOutcome {
  exitCode: number;
}

function integer(value: string): number {
  const parsed = Number(value);
  if (!/^\d+$/.test(value.trim()) || !Number.isSafeInteger(parsed)) {
    throw new InvalidArgumentError("must be a non-negative integer");
  }
  return parsed;
}

function retentionDuration(value: string): number {
  try {
    return parseRetentionSeconds(value);
  } catch (error) {
    throw new InvalidArgumentError(error instanceof Error ? error.message : "invalid duration");
  }
}

function contentType(value: string): string {
  try {
    return parseUploadContentType(value);
  } catch (error) {
    throw new InvalidArgumentError(error instanceof Error ? error.message : "invalid content type");
  }
}

function booleanFlag(value: string): boolean {
  if (/^(true|1|yes)$/i.test(value)) return true;
  if (/^(false|0|no)$/i.test(value)) return false;
  throw new InvalidArgumentError("must be true or false");
}

function waitOptions(options: WaitCommandOptions): { intervalMs?: number; timeoutMs?: number } {
  return {
    ...(options.pollIntervalMs === undefined ? {} : { intervalMs: options.pollIntervalMs }),
    ...(options.waitTimeoutMs === undefined ? {} : { timeoutMs: options.waitTimeoutMs }),
  };
}

function describeError(error: unknown): CliErrorDetails {
  if (error instanceof AcceptedButWaitFailedError) {
    return {
      ...describeError(error.cause),
      taskId: error.taskId,
      idempotencyKey: error.idempotencyKey,
      recover: `popnow jobs wait ${error.taskId}`,
    };
  }
  if (error instanceof PopNowApiError) {
    return {
      error: error.message,
      type: error.name,
      status: error.status,
      ...(error.code === undefined ? {} : { code: error.code }),
      ...(error.reason === undefined ? {} : { reason: error.reason }),
      ...(error.requestId === undefined ? {} : { requestId: error.requestId }),
      ...(error.retryAfterSeconds === undefined
        ? {}
        : { retryAfterSeconds: error.retryAfterSeconds }),
    };
  }
  if (error instanceof Error) return { error: error.message, type: error.name };
  return { error: "unknown error", type: "Error" };
}

/** Plain-text lines for a task's files, so a terminal user does not have to dig through JSON. */
function describeOutputs(task: TaskRecord): string[] {
  const lines: string[] = [];
  for (const asset of task.output?.assets ?? []) {
    if (asset.url) lines.push(`Output: ${asset.url}${asset.expiresAt ? ` (link expires ${asset.expiresAt})` : ""}`);
  }
  if (task.state === "failed" && task.errorCode) {
    lines.push(`Failed: ${task.errorCode}${task.errorMessage ? `: ${task.errorMessage}` : ""}`);
  }
  return lines;
}

export function createCli(dependencies: CliDependencies = {}, outcome: CliOutcome = { exitCode: 0 }): Command {
  const io = dependencies.io ?? defaultCliIo();
  const createClient = dependencies.createClient ?? ((options) => new PopNowClient(options));
  const program = new Command();
  // Must be set before any subcommand exists: commander copies the exit callback into each
  // subcommand when it is created, and without it `--help` on a subcommand calls process.exit.
  program.exitOverride();
  program
    .name("popnow")
    .description(
      "Official CLI for the PopNow API. Reads the API key from POPNOW_API_KEY; it is never accepted as an argument.",
    )
    .version(CLI_VERSION)
    .option("--json", "emit machine-readable JSON")
    .option("--base-url <url>", `API origin (default POPNOW_BASE_URL or ${DEFAULT_BASE_URL})`)
    .option("--timeout-ms <milliseconds>", "per-request timeout", integer)
    .option("--max-retries <count>", "retries for safe requests (0-5)", integer)
    .showSuggestionAfterError()
    .configureOutput({
      writeOut: (text) => io.stdout(text),
      writeErr: (text) => io.stderr(text),
    });

  const json = (): boolean => Boolean(program.opts<GlobalOptions>().json);
  const baseUrl = (): string =>
    program.opts<GlobalOptions>().baseUrl ?? io.env.POPNOW_BASE_URL ?? DEFAULT_BASE_URL;
  const client = (): PopNowClient => {
    const options = program.opts<GlobalOptions>();
    return createClient({
      apiKey: io.env.POPNOW_API_KEY,
      baseUrl: baseUrl(),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      ...(options.maxRetries === undefined ? {} : { maxRetries: options.maxRetries }),
    });
  };
  const printTask = (task: TaskRecord): void => {
    outputValue(task, json(), io);
    if (!json()) {
      for (const line of [...describeOutputs(task), ...describeTaskRetention(task)]) {
        io.stdout(`${line}\n`);
      }
    }
  };
  const noteFinalState = (task: TaskRecord): void => {
    if (task.state !== "succeeded") outcome.exitCode = EXIT_TASK_NOT_SUCCEEDED;
  };

  /**
   * Waits only after a successful acceptance. The task id goes to stderr the moment the task is
   * accepted, because a timeout, a dropped connection or Ctrl-C may never reach a catch block.
   */
  const waitAfterAccepted = async (
    api: PopNowClient,
    accepted: CreatedTask,
    idempotencyKey: string,
    options: WaitCommandOptions,
  ): Promise<TaskRecord> => {
    io.stderr(
      `Accepted: ${accepted.taskId}\nIf waiting is interrupted: popnow jobs wait ${accepted.taskId}\n`,
    );
    try {
      return await api.waitForTask(accepted.taskId, waitOptions(options));
    } catch (error) {
      throw new AcceptedButWaitFailedError(accepted.taskId, idempotencyKey, error);
    }
  };

  program
    .command("status")
    .description("check whether the PopNow API is reachable; no API key needed")
    .action(async () => {
      const api = client();
      const startedAt = Date.now();
      const status = await api.getStatus();
      if (json()) {
        outputValue(status, true, io);
      } else {
        io.stdout(`${describeServiceStatus(status, api.baseUrl, Date.now() - startedAt)}\n`);
      }
      if (!status.operational) outcome.exitCode = 1;
    });

  // Models
  const models = program.command("models").description("browse the live model catalog and prices");
  models
    .command("list")
    .description("list the image, video and audio models this key can call, with credit prices")
    .addOption(new Option("--modality <type>", "filter by output").choices(["image", "video", "audio"]))
    .option("--provider <name>", "exact model maker, for example kling")
    .option("--task <task>", "exact task, for example text-to-video")
    .option("--search <text>", "free-text search")
    .option("--include-schema", "include each model's input JSON Schema")
    .option("--include-examples", "include validated example inputs")
    .action(async (options: Record<string, string | boolean | undefined>) => {
      const result = await client().listModels({
        ...(typeof options.modality === "string" ? { modality: options.modality } : {}),
        ...(typeof options.provider === "string" ? { provider: options.provider } : {}),
        ...(typeof options.task === "string" ? { task: options.task } : {}),
        ...(typeof options.search === "string" ? { search: options.search } : {}),
        ...(options.includeSchema ? { includeSchema: true } : {}),
        ...(options.includeExamples ? { includeExamples: true } : {}),
      });
      outputValue(result, json(), io);
    });
  models
    .command("get")
    .argument("<model>", "exact model ID, for example alibaba/wan-3.0/image-to-video")
    .description("get one model with its price and input schema")
    .action(async (model: string) => {
      outputValue(await client().getModel(model), json(), io);
    });

  // Account
  program
    .command("balance")
    .description("show available, held and total credits (1 credit = $0.001)")
    .action(async () => {
      outputValue(await client().getBalance(), json(), io);
    });
  program
    .command("usage")
    .description("show settled usage for the current API key")
    .option("--from <date>", "inclusive UTC date (YYYY-MM-DD)")
    .option("--to <date>", "exclusive UTC date (YYYY-MM-DD), at most 92 days after --from")
    .action(async (options: { from?: string; to?: string }) => {
      outputValue(await client().getUsage(options), json(), io);
    });

  // Jobs
  const jobs = program
    .command("jobs")
    .description("quote, create, follow, retry and purge generation tasks");
  jobs
    .command("list")
    .description("list tasks created with the current API key (metadata only)")
    .option("--from <date>", "inclusive UTC date (YYYY-MM-DD)")
    .option("--to <date>", "exclusive UTC date; default is the last seven days, at most 92 days")
    .addOption(
      new Option("--state <state>", "filter by state").choices([
        "queued",
        "running",
        "succeeded",
        "failed",
        "canceled",
        "expired",
      ]),
    )
    .option("--model <model>", "exact model ID")
    .option("--limit <count>", "page size (1-100, default 20)", integer)
    .option("--cursor <cursor>", "nextCursor from the previous page; keep the other filters")
    .action(async (options: ListTasksOptions) => {
      outputValue(await client().listTasks(options), json(), io);
    });
  jobs
    .command("get")
    .argument("<task-id>")
    .description("get a task with its state, outputs, cost and retention")
    .action(async (taskId: string) => {
      printTask(await client().getTask(taskId));
    });
  jobs
    .command("wait")
    .argument("<task-id>")
    .option("--poll-interval-ms <milliseconds>", "fixed poll interval (default backs off 3-10 s)", integer)
    .option("--wait-timeout-ms <milliseconds>", "overall wait budget (default 30 min)", integer)
    .description(
      `poll until the task reaches a final state; exits ${EXIT_TASK_NOT_SUCCEEDED} if it did not succeed. Waiting never cancels a task`,
    )
    .action(async (taskId: string, options: WaitCommandOptions) => {
      const task = await client().waitForTask(taskId, waitOptions(options));
      printTask(task);
      noteFinalState(task);
    });
  jobs
    .command("quote")
    .requiredOption("--model <model>", "exact model ID from `popnow models list`")
    .option("--input-json <json>", "model input as a JSON object")
    .option("--input-file <path>", "model input JSON file; use - for stdin")
    .option("--callback-url <url>", "public HTTPS URL for the finished task")
    .description("price a request in credits without creating a task or holding credits")
    .action(async (options: CreateCommandOptions) => {
      const input = await readInputObject(options.inputJson, options.inputFile, io);
      outputValue(
        await client().quoteTask({
          model: options.model,
          input,
          ...(options.callbackUrl === undefined ? {} : { callBackUrl: options.callbackUrl }),
        }),
        json(),
        io,
      );
    });
  jobs
    .command("create")
    .requiredOption("--model <model>", "exact model ID from `popnow models list`")
    .option("--input-json <json>", "model input as a JSON object")
    .option("--input-file <path>", "model input JSON file; use - for stdin")
    .option("--callback-url <url>", "public HTTPS URL for the finished task")
    .option("--idempotency-key <key>", "stable key for this logical request; generated when omitted")
    .option(
      "--retention <duration>",
      `keep this task's ${DESTROYED_CONTENT} for at most this long: 30m, 1h, 7d or seconds. Only shortens; 0 removes them once the task finishes`,
      retentionDuration,
    )
    .option("--yes", "confirm the charge without a prompt (for scripts and CI)")
    .option("--wait", "wait for the task to finish and print the result")
    .option("--poll-interval-ms <milliseconds>", "fixed poll interval used with --wait", integer)
    .option("--wait-timeout-ms <milliseconds>", "overall wait budget used with --wait", integer)
    .description("quote, confirm and create a billable generation task")
    .action(async (options: CreateCommandOptions) => {
      const input = await readInputObject(options.inputJson, options.inputFile, io);
      const idempotencyKey = options.idempotencyKey ?? randomUUID();
      // Fail closed before any network call when nobody can answer the prompt.
      if (!options.yes && !io.stdinIsTTY) {
        await requireConfirmation("Create a billable task.", false, io);
      }
      const api = client();
      const payload = {
        model: options.model,
        input,
        ...(options.callbackUrl === undefined ? {} : { callBackUrl: options.callbackUrl }),
      };
      const quote = await api.quoteTask(payload);
      const retentionNote =
        options.retention === undefined
          ? ""
          : options.retention === 0
            ? ` Retention: the ${DESTROYED_CONTENT} are removed once the task finishes; billing records are kept.`
            : ` Retention: the ${DESTROYED_CONTENT} are kept for at most ${options.retention} s; billing records are kept.`;
      const price =
        `Price: ${quote.expectedCredits} credits (USD ${quote.estimatedCost}); ` +
        `at most ${quote.maxCredits} credits (USD ${quote.maxCharge}) is held and unused credits are released. ` +
        `Quote expires: ${quote.expiresAt}.${retentionNote}`;
      io.stderr(`${price}\nIdempotency-Key: ${idempotencyKey}\n`);
      await requireConfirmation(
        `Create a task with ${options.model}? ${price}`,
        Boolean(options.yes),
        io,
      );
      const created = await api.createTask(
        { ...payload, quoteId: quote.quoteId, expectedCredits: quote.maxCredits },
        {
          idempotencyKey,
          ...(options.retention === undefined ? {} : { retentionSeconds: options.retention }),
        },
      );
      if (!options.wait) {
        outputValue({ idempotencyKey, ...created }, json(), io);
        return;
      }
      const task = await waitAfterAccepted(api, created, idempotencyKey, options);
      if (json()) outputValue({ idempotencyKey, accepted: created, task }, true, io);
      else printTask(task);
      noteFinalState(task);
    });
  jobs
    .command("retry")
    .argument("<task-id>", "a failed or expired task")
    .option("--idempotency-key <key>", "stable key for this retry; generated when omitted")
    .option("--yes", "confirm the charge without a prompt (for scripts and CI)")
    .option("--wait", "wait for the new task to finish")
    .option("--poll-interval-ms <milliseconds>", "fixed poll interval used with --wait", integer)
    .option("--wait-timeout-ms <milliseconds>", "overall wait budget used with --wait", integer)
    .description("create a new billable task from a failed or expired one, at today's price")
    .action(async (taskId: string, options: RetryCommandOptions) => {
      const idempotencyKey = options.idempotencyKey ?? randomUUID();
      await requireConfirmation(
        `Retry task ${taskId} as a new task? Today's price, balance and model settings apply again. Idempotency-Key: ${idempotencyKey}.`,
        Boolean(options.yes),
        io,
      );
      io.stderr(`Idempotency-Key: ${idempotencyKey}\n`);
      const api = client();
      const created = await api.retryTask(taskId, { idempotencyKey });
      if (!options.wait) {
        outputValue({ idempotencyKey, ...created }, json(), io);
        return;
      }
      const task = await waitAfterAccepted(api, created, idempotencyKey, options);
      if (json()) outputValue({ idempotencyKey, accepted: created, task }, true, io);
      else printTask(task);
      noteFinalState(task);
    });
  jobs
    .command("purge")
    .argument("<task-id>", "a finished task; a running task cannot be stopped, wait for it first")
    .option("--yes", "confirm the destructive action without a prompt")
    .description(`permanently delete one finished task's ${DESTROYED_CONTENT}; billing records are kept`)
    .action(async (taskId: string, options: { yes?: boolean }) => {
      await requireConfirmation(
        `Permanently delete the ${DESTROYED_CONTENT} of task ${taskId}? This cannot be undone. Billing records are kept: ${RETAINED_BILLING_RECORDS} stay visible.`,
        Boolean(options.yes),
        io,
        "destructive",
      );
      outputValue(await client().purgeTask(taskId), json(), io);
      if (!json()) {
        io.stdout(
          "Content deletion requested. Stored files are removed within about a minute; billing records were not touched.\n",
        );
      }
    });

  // Files
  const files = program.command("files").description("upload inputs and get links to outputs");
  files
    .command("upload")
    .argument(
      "<path>",
      "image (JPEG/PNG/WebP/GIF), video (MP4/WebM), audio (MP3/WAV), document (PDF, Office, iWork, TXT, Markdown) or LoRA weights (.safetensors)",
    )
    .option("--content-type <type>", "override the MIME type inferred from the extension", contentType)
    .description("upload a local file and print its popnow://f/ URI for use in model input")
    .action(async (filePath: string, options: { contentType?: string }) => {
      const type = options.contentType ?? inferUploadContentType(filePath);
      outputValue(await client().uploadFile(filePath, type), json(), io);
    });
  files
    .command("download-url")
    .argument("<task-id>")
    .option("--key <key>", "output key; the first output when omitted")
    .description("create a fresh short-lived link to a task output")
    .action(async (taskId: string, options: { key?: string }) => {
      outputValue(await client().createDownloadUrl(taskId, options.key), json(), io);
    });

  // Assets
  const assets = program
    .command("assets")
    .description("read your private asset library (popnow://a/ URIs)");
  assets
    .command("list")
    .description("list saved assets, one page at a time")
    .addOption(new Option("--kind <kind>", "filter by kind").choices(["image", "video", "audio"]))
    .option("--source <sources>", "comma-separated: task_output, upload, url")
    .option("--search <text>", "case-insensitive substring of the asset name")
    .option("--favorite <bool>", "only favorites (true) or only non-favorites (false)", booleanFlag)
    .option("--collection-id <id>", "only assets in this collection")
    .option("--entity-id <id>", "only the images of this character")
    .addOption(
      new Option("--sort <order>", "sort order").choices(["recent", "oldest", "name", "size"]),
    )
    .option("--limit <count>", "page size (1-100, default 100)", integer)
    .option("--cursor <cursor>", "nextCursor from the previous page")
    .action(async (options: Omit<ListAssetsOptions, "q"> & { search?: string }) => {
      const { search, ...rest } = options;
      outputValue(
        await client().listAssets({ ...rest, ...(search === undefined ? {} : { q: search }) }),
        json(),
        io,
      );
    });
  assets
    .command("get")
    .argument("<asset-id>", "asset id, for example ast_...")
    .description("get one asset with a fresh private preview link")
    .action(async (assetId: string) => {
      outputValue(await client().getAsset(assetId), json(), io);
    });
  assets
    .command("usage")
    .description("show your asset library plan, storage used and limits")
    .action(async () => {
      outputValue(await client().getAssetUsage(), json(), io);
    });

  // Webhooks
  const webhooks = program.command("webhooks").description("check PopNow webhook signatures");
  webhooks
    .command("verify")
    .requiredOption("--body-file <path>", "the raw, unmodified request body")
    .requiredOption("--timestamp <seconds>", "X-Webhook-Timestamp (or webhook-timestamp)")
    .requiredOption("--signature <value>", "X-Webhook-Signature (or webhook-signature)")
    .option(
      "--webhook-id <id>",
      "webhook-id header; switches to account endpoint (Standard Webhooks) verification",
    )
    .option("--payload-version <version>", "X-Webhook-Payload-Version of a task callback (1 or 2)", integer, 2)
    .option(
      "--secret-env <name>",
      "environment variable holding the secret (default POPNOW_WEBHOOK_SECRET, or POPNOW_ENDPOINT_SECRET with --webhook-id)",
    )
    .option("--tolerance-seconds <seconds>", "accepted clock skew", integer, 300)
    .description("verify a delivery's signature from its exact bytes; secrets are read only from the environment")
    .action(
      async (options: {
        bodyFile: string;
        timestamp: string;
        signature: string;
        webhookId?: string;
        payloadVersion: number;
        secretEnv?: string;
        toleranceSeconds: number;
      }) => {
        const secretEnv =
          options.secretEnv ??
          (options.webhookId === undefined ? "POPNOW_WEBHOOK_SECRET" : "POPNOW_ENDPOINT_SECRET");
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(secretEnv)) {
          throw new TypeError("--secret-env must be an environment variable name");
        }
        const secret = io.env[secretEnv];
        if (!secret) throw new Error(`${secretEnv} is not set in this shell`);
        if (options.payloadVersion !== 1 && options.payloadVersion !== 2) {
          throw new TypeError("--payload-version must be 1 or 2");
        }
        const rawBody = await readFile(options.bodyFile);
        const result =
          options.webhookId === undefined
            ? verifyTaskCallback({
                rawBody,
                timestamp: options.timestamp,
                signature: options.signature,
                secret,
                payloadVersion: options.payloadVersion,
                toleranceSeconds: options.toleranceSeconds,
              })
            : verifyAccountEndpoint({
                rawBody,
                webhookId: options.webhookId,
                timestamp: options.timestamp,
                signature: options.signature,
                secret,
                toleranceSeconds: options.toleranceSeconds,
              });
        outputValue(result, json(), io);
        if (!result.valid) outcome.exitCode = 1;
      },
    );

  // Agent skills
  registerSkillsCommands(program, {
    io,
    json,
    client,
    locations: () => ({ homeDir: dependencies.homeDir ?? homedir(), cwd: dependencies.cwd ?? process.cwd() }),
  });

  // Docs
  const docs = program.command("docs").description("find PopNow documentation; no API key needed");
  docs
    .command("list", { isDefault: true })
    .description("print links to the main documentation pages")
    .action(() => {
      if (json()) {
        outputValue({ topics: DOC_TOPICS, openapi: OPENAPI_URL, llms: "https://popnow.ai/llms.txt" }, true, io);
        return;
      }
      const width = Math.max(...DOC_TOPICS.map((item) => item.slug.length));
      for (const item of DOC_TOPICS) {
        io.stdout(`${item.slug.padEnd(width)}  ${item.url}\n${" ".repeat(width)}  ${item.summary}\n`);
      }
      io.stdout(`\nOpenAPI contract: ${OPENAPI_URL}\nFor LLMs: https://popnow.ai/llms.txt\n`);
      io.stdout("Open one with `popnow docs open <topic>`, or search with `popnow docs search <words>`.\n");
    });
  docs
    .command("open")
    .argument("<topic>", `one of: ${DOC_TOPICS.map((item) => item.slug).join(", ")}, openapi`)
    .option("--print", "only print the link, do not open a browser")
    .description("open a documentation page in the browser (prints the link when there is no terminal)")
    .action(async (name: string, options: { print?: boolean }) => {
      const url = name.trim().toLowerCase() === "openapi" ? OPENAPI_URL : findTopic(name)?.url;
      if (!url) {
        throw new TypeError(
          `unknown topic "${name}". Run \`popnow docs\` to list topics, or \`popnow docs search ${name}\``,
        );
      }
      const opened = !options.print && !json() && io.stdinIsTTY ? await io.openUrl(url) : false;
      outputValue(json() ? { url, opened } : url, json(), io);
    });
  docs
    .command("search")
    .argument("<words...>", "what to look for")
    .option("--limit <count>", "maximum results (1-25)", integer, 8)
    .description("search the live PopNow documentation")
    .action(async (words: string[], options: { limit: number }) => {
      const query = words.join(" ");
      const results = await searchDocs(query, {
        limit: Math.min(25, Math.max(1, options.limit)),
        ...(dependencies.fetch === undefined ? {} : { fetch: dependencies.fetch }),
      });
      if (json()) {
        outputValue(results, true, io);
        return;
      }
      if (results.length === 0) {
        io.stdout(`No documentation matched "${query}". Try fewer words, or run \`popnow docs\` to browse.\n`);
        return;
      }
      for (const result of results) io.stdout(`${result.text}\n  ${result.url}\n`);
    });

  return program;
}

export async function runCli(
  argv: readonly string[] = process.argv,
  dependencies: CliDependencies = {},
): Promise<number> {
  const io = dependencies.io ?? defaultCliIo();
  const outcome: CliOutcome = { exitCode: 0 };
  const program = createCli({ ...dependencies, io }, outcome);
  const json = (): boolean => Boolean(program.opts<GlobalOptions>().json);
  try {
    await program.parseAsync([...argv]);
    return outcome.exitCode;
  } catch (error) {
    if (error instanceof CommanderError) {
      // commander already printed the usage error; exit code 0 means --help or --version.
      if (error.exitCode === 0) return 0;
      if (json()) io.stderr(`${JSON.stringify(describeError(error))}\n`);
      return error.exitCode;
    }
    const details = describeError(error);
    if (json()) {
      io.stderr(`${JSON.stringify(details)}\n`);
      return 1;
    }
    io.stderr(`Error: ${details.error}${details.requestId ? ` (request ${details.requestId})` : ""}\n`);
    /* The two lines printed at acceptance may have scrolled away; the last lines are what people
       read, and that is exactly where "run it again and pay twice" happens. */
    if (details.taskId !== undefined) {
      io.stderr(
        `Task ${details.taskId} was accepted and may still be running; only the wait stopped.\n` +
          `Recover: ${details.recover ?? `popnow jobs wait ${details.taskId}`}\n` +
          `To replay the same request without creating a second task, reuse --idempotency-key ${details.idempotencyKey ?? "<original key>"}.\n`,
      );
    }
    const cause = error instanceof AcceptedButWaitFailedError ? error.cause : error;
    if (cause instanceof WaitTimeoutError && details.taskId === undefined) {
      io.stderr(`The task keeps running. Pick it up again with: popnow jobs wait ${cause.taskId}\n`);
    }
    const next = describeNextStep(cause, io.env);
    if (next) io.stderr(`${next}\n`);
    return 1;
  }
}

