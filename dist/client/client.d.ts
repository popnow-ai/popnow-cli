import type { CreateTaskRequest, CreatedTask, ListAssetsOptions, ListModelsOptions, ListTasksOptions, ServiceStatus, TaskQuote, TaskRecord, TaskRequest, UploadTicket, UploadedFile } from "./types.js";
export declare const DEFAULT_BASE_URL = "https://api.popnow.ai";
export declare const API_PREFIX = "/api/v1";
export declare const USER_AGENT: string;
export declare const TERMINAL_STATES: ReadonlySet<string>;
export interface PopNowClientOptions {
    apiKey?: string | undefined;
    /** API origin without a path, for example `https://api.popnow.ai`. */
    baseUrl?: string | undefined;
    /** Per-request timeout for API calls. Default 60 s. */
    timeoutMs?: number | undefined;
    /** Retries for safe requests (reads, quotes, idempotent writes). Default 2, at most 5. */
    maxRetries?: number | undefined;
    /** Timeout for moving file bytes during an upload. Default 10 min. */
    uploadTimeoutMs?: number | undefined;
    fetch?: typeof fetch | undefined;
    sleep?: ((ms: number) => Promise<void>) | undefined;
    now?: (() => number) | undefined;
}
export interface WaitOptions {
    /** Fixed poll interval. When omitted the interval starts at 3 s and backs off to 10 s. */
    intervalMs?: number | undefined;
    /** Overall wait budget. Default 30 min. Running out never cancels the task. */
    timeoutMs?: number | undefined;
    onUpdate?: ((task: TaskRecord) => void) | undefined;
}
/**
 * A deliberately small client for the PopNow native API (`/api/v1/*`). It covers exactly what the
 * CLI needs, unwraps the `{code,msg,data,request_id}` envelope and turns everything else into a
 * `PopNowApiError` that says whether PopNow or something in between answered.
 */
export declare class PopNowClient {
    readonly baseUrl: string;
    private readonly apiKey;
    private readonly timeoutMs;
    private readonly maxRetries;
    private readonly uploadTimeoutMs;
    private readonly fetchImpl;
    private readonly sleep;
    private readonly now;
    constructor(options?: PopNowClientOptions);
    /** `GET /healthz`. Needs no key and costs nothing. */
    getStatus(): Promise<ServiceStatus>;
    listModels(options?: ListModelsOptions): Promise<unknown>;
    getModel(model: string): Promise<unknown>;
    getBalance(): Promise<unknown>;
    getUsage(options?: {
        from?: string;
        to?: string;
    }): Promise<unknown>;
    listTasks(options?: ListTasksOptions): Promise<unknown>;
    getTask(taskId: string): Promise<TaskRecord>;
    /** A quote holds nothing and creates nothing, so it is safe to retry. */
    quoteTask(payload: TaskRequest): Promise<TaskQuote>;
    /**
     * Creates a billable task. The Idempotency-Key is required here (the CLI always has one), which
     * is what makes a retry after a timeout safe: the server returns the original task.
     */
    createTask(payload: CreateTaskRequest, options: {
        idempotencyKey: string;
        retentionSeconds?: number | undefined;
    }): Promise<CreatedTask>;
    retryTask(taskId: string, options: {
        idempotencyKey: string;
    }): Promise<CreatedTask>;
    /** Idempotent by taskId on the server, so it is safe to retry. */
    purgeTask(taskId: string): Promise<unknown>;
    waitForTask(taskId: string, options?: WaitOptions): Promise<TaskRecord>;
    createUploadUrl(contentType: string, bytes: number): Promise<UploadTicket>;
    commitUpload(fileId: string): Promise<UploadedFile>;
    /** Ticket, presigned PUT of the exact bytes, then commit. Returns the `popnow://f/...` URI. */
    uploadFile(filePath: string, contentType: string): Promise<UploadedFile>;
    createDownloadUrl(taskId: string, key?: string): Promise<unknown>;
    listAssets(options?: ListAssetsOptions): Promise<unknown>;
    getAsset(assetId: string): Promise<unknown>;
    getAssetUsage(): Promise<unknown>;
    private request;
    private fetchOnce;
    private backoff;
}
