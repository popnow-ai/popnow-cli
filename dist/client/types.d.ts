export type TaskState = "queued" | "running" | "succeeded" | "failed" | "canceled" | "expired";
export interface TaskQuote {
    quoteId: string;
    model: string;
    estimatedCost: string;
    maxCharge: string;
    maxCredits: number;
    expectedCredits: number;
    currency: string;
    quantity: string;
    unit: string;
    expiresAt: string;
    [key: string]: unknown;
}
export interface CreatedTask {
    taskId: string;
    state: TaskState;
    estimatedCost: string;
    estimatedCredits: number;
    deadlineAt: string;
    sourceTaskId?: string;
    [key: string]: unknown;
}
export interface TaskOutputAsset {
    key?: string;
    url?: string;
    expiresAt?: string;
    mime?: string;
    pending?: boolean;
    unavailable?: boolean;
    [key: string]: unknown;
}
export interface TaskRetention {
    outputsExpireAt: string;
    promptsExpireAt: string;
    source: "header" | "account" | "platform";
}
export interface TaskRecord {
    taskId: string;
    model: string;
    state: TaskState | (string & {});
    cost: string;
    credits: number;
    settled: boolean;
    createdAt: string;
    output?: {
        text?: string;
        assets?: TaskOutputAsset[];
        [key: string]: unknown;
    };
    errorCode?: string;
    errorMessage?: string;
    contentState?: "present" | "expired" | "purged";
    contentRemovedBy?: "user" | "system";
    purgedAt?: string;
    retention?: TaskRetention;
    [key: string]: unknown;
}
export interface UploadTicket {
    fileId: string;
    key: string;
    uploadUrl: string;
    method: string;
    headers: Record<string, string>;
    expiresAt: string;
    maxBytes: number;
}
export interface UploadedFile {
    fileId: string;
    status: string;
    bytes: number;
    contentType: string;
    sha256: string;
    uri: string;
    expiresAt: string;
    [key: string]: unknown;
}
export interface ListModelsOptions {
    modality?: string;
    provider?: string;
    task?: string;
    search?: string;
    includeSchema?: boolean;
    includeExamples?: boolean;
}
export interface ListTasksOptions {
    from?: string;
    to?: string;
    state?: string;
    model?: string;
    limit?: number;
    cursor?: string;
}
export interface ListAssetsOptions {
    kind?: string;
    source?: string;
    q?: string;
    favorite?: boolean;
    collectionId?: string;
    entityId?: string;
    sort?: string;
    cursor?: string;
    limit?: number;
}
export interface TaskRequest {
    model: string;
    input: Record<string, unknown>;
    callBackUrl?: string;
}
export interface CreateTaskRequest extends TaskRequest {
    quoteId?: string;
    expectedCredits?: number;
}
export interface ServiceStatus {
    operational: boolean;
    /** HTTP status of `GET /healthz`; 0 when nothing came back at all. */
    status: number;
    body: string;
    error?: string;
    checkedAt: string;
}
export interface AgentSkill {
    slug: string;
    name?: string;
    summary?: string;
    /** For example `video`, `image`, `slides` or `web`. */
    type?: string;
    tasks?: string[];
    /** The PopNow models or features the skill uses. */
    popnow?: string[];
    /** What the skill needs besides the agent, for example `POPNOW_API_KEY` or `python3`. */
    requires?: string[];
    version?: string;
    updated?: string;
    url?: string;
    distribution?: unknown;
    /** Install hints per agent, when the catalog sends them. */
    install?: unknown;
    [key: string]: unknown;
}
export interface ListAgentSkillsOptions {
    q?: string;
    type?: string;
    task?: string;
}
export interface DownloadedSkill {
    bytes: Uint8Array;
    /** Host of the short-lived link the archive came from; never the full signed URL. */
    source: string;
}
