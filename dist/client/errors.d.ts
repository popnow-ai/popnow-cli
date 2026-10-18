/**
 * An error answered by the PopNow API in its own `{code,msg,data,request_id}` envelope, or an HTTP
 * failure that came from somewhere in between (then `fromApi` is false and `code` is undefined).
 */
export declare class PopNowApiError extends Error {
    readonly name = "PopNowApiError";
    /** HTTP status of the response. */
    readonly status: number;
    /** Business code from the envelope, for example 40201. Undefined when the body was not ours. */
    readonly code: number | undefined;
    readonly requestId: string | undefined;
    /** `data.reason` when the envelope carried one, for example `asset_library_locked`. */
    readonly reason: string | undefined;
    readonly retryAfterSeconds: number | undefined;
    /** False when the response was not a PopNow envelope: a proxy, gateway or CDN answered. */
    readonly fromApi: boolean;
    constructor(details: {
        message: string;
        status: number;
        code?: number | undefined;
        requestId?: string | undefined;
        reason?: string | undefined;
        retryAfterSeconds?: number | undefined;
        fromApi: boolean;
    });
}
/** Thrown before any request goes out when an authenticated command runs without a key. */
export declare class MissingApiKeyError extends Error {
    readonly name = "MissingApiKeyError";
    constructor();
}
/** The network failed or the per-request timeout elapsed before any response arrived. */
export declare class PopNowConnectionError extends Error {
    readonly name = "PopNowConnectionError";
}
/** Waiting for a task ran out of time. The task itself keeps running and is not canceled. */
export declare class WaitTimeoutError extends Error {
    readonly taskId: string;
    readonly timeoutMs: number;
    readonly lastState: string | undefined;
    readonly name = "WaitTimeoutError";
    constructor(taskId: string, timeoutMs: number, lastState: string | undefined);
}
/** The presigned PUT of an upload failed. */
export declare class UploadError extends Error {
    readonly status: number;
    readonly name = "UploadError";
    constructor(message: string, status: number);
}
