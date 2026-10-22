/**
 * An error answered by the PopNow API in its own `{code,msg,data,request_id}` envelope, or an HTTP
 * failure that came from somewhere in between (then `fromApi` is false and `code` is undefined).
 */
export class PopNowApiError extends Error {
    name = "PopNowApiError";
    /** HTTP status of the response. */
    status;
    /** Business code from the envelope, for example 40201. Undefined when the body was not ours. */
    code;
    requestId;
    /** `data.reason` when the envelope carried one, for example `asset_library_locked`. */
    reason;
    retryAfterSeconds;
    /** False when the response was not a PopNow envelope: a proxy, gateway or CDN answered. */
    fromApi;
    constructor(details) {
        super(details.message);
        this.status = details.status;
        this.code = details.code;
        this.requestId = details.requestId;
        this.reason = details.reason;
        this.retryAfterSeconds = details.retryAfterSeconds;
        this.fromApi = details.fromApi;
    }
}
/** Thrown before any request goes out when an authenticated command runs without a key. */
export class MissingApiKeyError extends Error {
    name = "MissingApiKeyError";
    constructor() {
        super("POPNOW_API_KEY is required for this command");
    }
}
/** The network failed or the per-request timeout elapsed before any response arrived. */
export class PopNowConnectionError extends Error {
    name = "PopNowConnectionError";
}
/** Waiting for a task ran out of time. The task itself keeps running and is not canceled. */
export class WaitTimeoutError extends Error {
    taskId;
    timeoutMs;
    lastState;
    name = "WaitTimeoutError";
    constructor(taskId, timeoutMs, lastState) {
        super(`task ${taskId} did not reach a final state within ${timeoutMs} ms` +
            (lastState ? ` (last state: ${lastState})` : ""));
        this.taskId = taskId;
        this.timeoutMs = timeoutMs;
        this.lastState = lastState;
    }
}
/** The presigned PUT of an upload failed. */
export class UploadError extends Error {
    status;
    name = "UploadError";
    constructor(message, status) {
        super(message);
        this.status = status;
    }
}
/**
 * Downloading a skill archive failed after the API answered: the short-lived link was refused or
 * expired, or the archive is larger than the client accepts.
 */
export class SkillDownloadError extends Error {
    status;
    name = "SkillDownloadError";
    constructor(message, status) {
        super(message);
        this.status = status;
    }
}
