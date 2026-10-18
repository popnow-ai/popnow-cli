import { readFile } from "node:fs/promises";
import { CLI_VERSION } from "../version.js";
import { MissingApiKeyError, PopNowApiError, PopNowConnectionError, UploadError, WaitTimeoutError, } from "./errors.js";
export const DEFAULT_BASE_URL = "https://api.popnow.ai";
export const API_PREFIX = "/api/v1";
/*
 * The API sits behind a CDN that refuses some generic client User-Agents outright (HTTP 403 with
 * an HTML page). Every request therefore names this client explicitly.
 */
export const USER_AGENT = `popnow-cli/${CLI_VERSION} (+https://github.com/popnow-ai/popnow-cli; node ${process.version})`;
/** Business codes the PopNow error docs list as worth retrying. */
const RETRYABLE_CODES = new Set([429, 500, 503, 50301]);
/** HTTP statuses worth retrying when the body is not a PopNow envelope (edge and proxy errors). */
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524]);
const MAX_RETRY_AFTER_MS = 60_000;
export const TERMINAL_STATES = new Set([
    "succeeded",
    "failed",
    "canceled",
    "expired",
]);
/**
 * A deliberately small client for the PopNow native API (`/api/v1/*`). It covers exactly what the
 * CLI needs, unwraps the `{code,msg,data,request_id}` envelope and turns everything else into a
 * `PopNowApiError` that says whether PopNow or something in between answered.
 */
export class PopNowClient {
    baseUrl;
    apiKey;
    timeoutMs;
    maxRetries;
    uploadTimeoutMs;
    fetchImpl;
    sleep;
    now;
    constructor(options = {}) {
        this.apiKey = options.apiKey?.trim() || undefined;
        this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
        this.timeoutMs = options.timeoutMs ?? 60_000;
        this.maxRetries = Math.min(5, Math.max(0, options.maxRetries ?? 2));
        this.uploadTimeoutMs = options.uploadTimeoutMs ?? 600_000;
        this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
        this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
        this.now = options.now ?? (() => Date.now());
    }
    /** `GET /healthz`. Needs no key and costs nothing. */
    async getStatus() {
        const checkedAt = new Date(this.now()).toISOString();
        try {
            const response = await this.fetchOnce(`${this.baseUrl}/healthz`, { method: "GET", headers: { Accept: "application/json", "User-Agent": USER_AGENT } }, this.timeoutMs);
            const body = (await response.text()).trim().slice(0, 512);
            return { operational: response.ok, status: response.status, body, checkedAt };
        }
        catch (error) {
            return {
                operational: false,
                status: 0,
                body: "",
                error: error instanceof Error ? error.message : "unknown error",
                checkedAt,
            };
        }
    }
    listModels(options = {}) {
        return this.request("GET", "/models", {
            query: {
                modality: options.modality,
                provider: options.provider,
                task: options.task,
                search: options.search,
                includeSchema: options.includeSchema ? "1" : undefined,
                includeExamples: options.includeExamples ? "1" : undefined,
            },
            retryable: true,
        });
    }
    getModel(model) {
        // Model IDs contain slashes (`<maker>/<model>/<task>`); the path accepts them as they are.
        const path = requireId(model, "model").split("/").map(encodeURIComponent).join("/");
        return this.request("GET", `/models/${path}`, { retryable: true });
    }
    getBalance() {
        return this.request("GET", "/chat/credit", { retryable: true });
    }
    getUsage(options = {}) {
        return this.request("GET", "/usage", {
            query: { from: options.from, to: options.to },
            retryable: true,
        });
    }
    listTasks(options = {}) {
        return this.request("GET", "/jobs", { query: { ...options }, retryable: true });
    }
    getTask(taskId) {
        return this.request("GET", "/jobs/recordInfo", {
            query: { taskId: requireId(taskId, "taskId") },
            retryable: true,
        });
    }
    /** A quote holds nothing and creates nothing, so it is safe to retry. */
    quoteTask(payload) {
        return this.request("POST", "/jobs/quote", { body: payload, retryable: true });
    }
    /**
     * Creates a billable task. The Idempotency-Key is required here (the CLI always has one), which
     * is what makes a retry after a timeout safe: the server returns the original task.
     */
    createTask(payload, options) {
        return this.request("POST", "/jobs/createTask", {
            body: payload,
            headers: {
                "Idempotency-Key": requireId(options.idempotencyKey, "idempotencyKey"),
                ...(options.retentionSeconds === undefined
                    ? {}
                    : { "X-PopNow-Retention": String(options.retentionSeconds) }),
            },
            retryable: true,
        });
    }
    retryTask(taskId, options) {
        return this.request("POST", "/jobs/retry", {
            body: { taskId: requireId(taskId, "taskId") },
            headers: { "Idempotency-Key": requireId(options.idempotencyKey, "idempotencyKey") },
            retryable: true,
        });
    }
    /** Idempotent by taskId on the server, so it is safe to retry. */
    purgeTask(taskId) {
        return this.request("POST", "/jobs/purge", {
            body: { taskId: requireId(taskId, "taskId") },
            retryable: true,
        });
    }
    async waitForTask(taskId, options = {}) {
        const id = requireId(taskId, "taskId");
        const timeoutMs = options.timeoutMs ?? 1_800_000;
        const startedAt = this.now();
        let last;
        for (let attempt = 0;; attempt++) {
            last = await this.getTask(id);
            options.onUpdate?.(last);
            // A succeeded task can still have an output that is being copied into storage.
            const pending = last.state === "succeeded" &&
                (last.output?.assets ?? []).some((asset) => asset.pending === true && !asset.unavailable);
            if (TERMINAL_STATES.has(last.state) && !pending)
                return last;
            const remaining = timeoutMs - (this.now() - startedAt);
            if (remaining <= 0)
                throw new WaitTimeoutError(id, timeoutMs, last.state);
            const delay = options.intervalMs ?? Math.min(10_000, Math.round(3_000 * 1.4 ** attempt));
            await this.sleep(Math.min(delay, remaining));
        }
    }
    createUploadUrl(contentType, bytes) {
        return this.request("POST", "/common/upload-url", {
            body: { contentType, bytes },
        });
    }
    commitUpload(fileId) {
        const id = encodeURIComponent(requireId(fileId, "fileId"));
        return this.request("POST", `/files/${id}/commit`, { retryable: true });
    }
    /** Ticket, presigned PUT of the exact bytes, then commit. Returns the `popnow://f/...` URI. */
    async uploadFile(filePath, contentType) {
        const data = await readFile(filePath);
        if (data.byteLength === 0)
            throw new TypeError(`${filePath} is empty`);
        const ticket = await this.createUploadUrl(contentType, data.byteLength);
        if (data.byteLength > ticket.maxBytes) {
            throw new UploadError(`${filePath} is ${data.byteLength} bytes; the upload ticket allows ${ticket.maxBytes}`, 413);
        }
        let response;
        try {
            // The presigned URL carries its own authorization: the API key must not be sent along.
            response = await this.fetchOnce(ticket.uploadUrl, { method: ticket.method || "PUT", headers: { ...ticket.headers }, body: data }, this.uploadTimeoutMs);
        }
        catch (error) {
            throw new PopNowConnectionError(`upload failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (!response.ok) {
            throw new UploadError(`presigned upload failed with HTTP ${response.status}`, response.status);
        }
        return this.commitUpload(ticket.fileId);
    }
    createDownloadUrl(taskId, key) {
        return this.request("POST", "/common/download-url", {
            body: { taskId: requireId(taskId, "taskId"), ...(key === undefined ? {} : { key }) },
            retryable: true,
        });
    }
    listAssets(options = {}) {
        return this.request("GET", "/assets", { query: { ...options }, retryable: true });
    }
    getAsset(assetId) {
        const id = encodeURIComponent(requireId(assetId, "assetId"));
        return this.request("GET", `/assets/${id}`, { retryable: true });
    }
    getAssetUsage() {
        return this.request("GET", "/assets/usage", { retryable: true });
    }
    async request(method, path, config = {}) {
        if (config.auth !== false && !this.apiKey)
            throw new MissingApiKeyError();
        const url = `${this.baseUrl}${API_PREFIX}${path}${buildQuery(config.query)}`;
        const headers = {
            Accept: "application/json",
            "User-Agent": USER_AGENT,
            ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
            ...(config.body === undefined ? {} : { "Content-Type": "application/json" }),
            ...config.headers,
        };
        const init = {
            method,
            headers,
            ...(config.body === undefined ? {} : { body: JSON.stringify(config.body) }),
        };
        const retries = config.retryable ? this.maxRetries : 0;
        for (let attempt = 0;; attempt++) {
            let response;
            try {
                response = await this.fetchOnce(url, init, this.timeoutMs);
            }
            catch (error) {
                if (attempt < retries) {
                    await this.backoff(attempt, undefined);
                    continue;
                }
                throw new PopNowConnectionError(`could not reach ${this.baseUrl}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
            }
            const result = await parseEnvelope(response);
            if (!(result instanceof PopNowApiError))
                return result.data;
            const retryable = result.fromApi
                ? result.code !== undefined && RETRYABLE_CODES.has(result.code)
                : RETRYABLE_STATUSES.has(result.status);
            if (!retryable || attempt >= retries)
                throw result;
            await this.backoff(attempt, result.retryAfterSeconds);
        }
    }
    async fetchOnce(url, init, timeoutMs) {
        const signal = AbortSignal.timeout(timeoutMs);
        try {
            return await this.fetchImpl(url, { ...init, signal });
        }
        catch (error) {
            if (signal.aborted)
                throw new PopNowConnectionError(`request timed out after ${timeoutMs} ms`);
            throw error;
        }
    }
    backoff(attempt, retryAfterSeconds) {
        const ms = retryAfterSeconds !== undefined
            ? Math.min(retryAfterSeconds * 1000, MAX_RETRY_AFTER_MS)
            : Math.min(500 * 2 ** attempt, 8_000) + Math.round(Math.random() * 250);
        return this.sleep(ms);
    }
}
function requireId(value, label) {
    if (typeof value !== "string" || value.trim() === "") {
        throw new TypeError(`${label} must be a non-empty string`);
    }
    return value.trim();
}
function buildQuery(query) {
    if (!query)
        return "";
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
        if (value === undefined)
            continue;
        params.set(key, String(value));
    }
    const text = params.toString();
    return text ? `?${text}` : "";
}
function parseRetryAfter(value) {
    if (value === null || !/^\d+$/.test(value.trim()))
        return undefined;
    return Number(value.trim());
}
async function parseEnvelope(response) {
    const text = await response.text().catch(() => "");
    const headerRequestId = response.headers.get("x-request-id") ?? undefined;
    const retryAfterSeconds = parseRetryAfter(response.headers.get("retry-after"));
    let parsed;
    try {
        parsed = text ? JSON.parse(text) : undefined;
    }
    catch {
        parsed = undefined;
    }
    const envelope = parsed !== null &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        typeof parsed.code === "number" &&
        typeof parsed.msg === "string"
        ? parsed
        : undefined;
    if (envelope) {
        const requestId = typeof envelope.request_id === "string" && envelope.request_id
            ? envelope.request_id
            : headerRequestId;
        if (envelope.code === 200 && response.ok)
            return { data: envelope.data };
        const reason = envelope.data?.reason;
        return new PopNowApiError({
            message: envelope.msg || response.statusText || `HTTP ${response.status}`,
            status: response.status,
            code: envelope.code === 200 ? response.status : envelope.code,
            requestId,
            reason: typeof reason === "string" ? reason : undefined,
            retryAfterSeconds,
            fromApi: true,
        });
    }
    // Not our envelope: an HTML or plain-text page from a proxy, gateway or CDN in between.
    const snippet = text.replace(/\s+/g, " ").trim().slice(0, 160);
    return new PopNowApiError({
        message: `HTTP ${response.status} from something other than the PopNow API` +
            (snippet ? `: ${snippet}` : ""),
        status: response.status,
        requestId: headerRequestId,
        retryAfterSeconds,
        fromApi: false,
    });
}
