/**
 * An error answered by the PopNow API in its own `{code,msg,data,request_id}` envelope, or an HTTP
 * failure that came from somewhere in between (then `fromApi` is false and `code` is undefined).
 */
export class PopNowApiError extends Error {
  override readonly name = "PopNowApiError";
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
  }) {
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
  override readonly name = "MissingApiKeyError";
  constructor() {
    super("POPNOW_API_KEY is required for this command");
  }
}

/** The network failed or the per-request timeout elapsed before any response arrived. */
export class PopNowConnectionError extends Error {
  override readonly name = "PopNowConnectionError";
}

/** Waiting for a task ran out of time. The task itself keeps running and is not canceled. */
export class WaitTimeoutError extends Error {
  override readonly name = "WaitTimeoutError";
  constructor(
    readonly taskId: string,
    readonly timeoutMs: number,
    readonly lastState: string | undefined,
  ) {
    super(
      `task ${taskId} did not reach a final state within ${timeoutMs} ms` +
        (lastState ? ` (last state: ${lastState})` : ""),
    );
  }
}

/** The presigned PUT of an upload failed. */
export class UploadError extends Error {
  override readonly name = "UploadError";
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Downloading a skill archive failed after the API answered: the short-lived link was refused or
 * expired, or the archive is larger than the client accepts.
 */
export class SkillDownloadError extends Error {
  override readonly name = "SkillDownloadError";
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}
