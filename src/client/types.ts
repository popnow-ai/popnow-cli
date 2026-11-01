/*
 * The response shapes this CLI reads, taken from https://popnow.ai/docs/openapi.yaml. Only the
 * fields the CLI itself looks at are typed; everything else the server sends is passed through
 * untouched to `--json` output.
 */

export type TaskState = "queued" | "running" | "succeeded" | "failed" | "canceled" | "expired";

/*
 * Money. The API bills in exact USD from the API balance behind the key. USD amounts are decimal
 * strings with up to nine decimal places; they are kept as strings and never parsed into floats.
 * The integer credit fields (1 credit = $0.001) are deprecated display projections that the server
 * still sends for older clients; the CLI reads them only when a USD field is missing.
 */

export interface TaskQuote {
  quoteId: string;
  model: string;
  /** Exact maximum USD held on acceptance. Send it back as `expectedCostUsd` to lock the price. */
  maxChargeUsd?: string;
  /** Exact typical USD charge, never above `maxChargeUsd`. Informational only. */
  expectedChargeUsd?: string;
  /** Legacy USD alias of `maxChargeUsd`. */
  estimatedCost: string;
  /** Legacy USD alias of `maxChargeUsd`. */
  maxCharge: string;
  /** Legacy USD alias of `expectedChargeUsd`. */
  expectedCharge?: string;
  /** @deprecated Rounded display projection at 1 credit = $0.001. Use `maxChargeUsd`. */
  maxCredits?: number;
  /** @deprecated Rounded display projection at 1 credit = $0.001. Use `expectedChargeUsd`. */
  expectedCredits?: number;
  currency: string;
  quantity: string;
  unit: string;
  expiresAt: string;
  [key: string]: unknown;
}

export interface CreatedTask {
  taskId: string;
  state: TaskState;
  /** Exact USD held on acceptance; unused funds are released at settlement. */
  estimatedCostUsd?: string;
  /** Legacy USD alias of `estimatedCostUsd`. */
  estimatedCost: string;
  /** @deprecated Rounded display projection at 1 credit = $0.001. Use `estimatedCostUsd`. */
  estimatedCredits?: number;
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
  /** Exact USD: the final charge once `settled`, otherwise the hold. */
  costUsd?: string;
  /** Legacy USD alias of `costUsd`. */
  cost: string;
  /** @deprecated Rounded display projection at 1 credit = $0.001. Use `costUsd`. */
  credits?: number;
  /** @deprecated Unrounded credit-scale decimal string (USD x 1000). Use `costUsd`. */
  exactCredits?: string;
  settled: boolean;
  createdAt: string;
  output?: { text?: string; assets?: TaskOutputAsset[]; [key: string]: unknown };
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
  /** Exact USD hold the caller confirmed: the quote's `maxChargeUsd`. */
  expectedCostUsd?: string;
  /** @deprecated Legacy name for `expectedCostUsd`. */
  expectedCost?: string;
  /** @deprecated Integer credits (1 credit = $0.001). Send `expectedCostUsd` or `quoteId` instead. */
  expectedCredits?: number;
}

/** `GET /api/v1/chat/credit`: the API balance in USD. The path name is historical. */
export interface Balance {
  /** Exact USD that new tasks can use. May be negative on an approved credit line. */
  availableUsd?: string;
  /** Exact USD set aside for accepted tasks. */
  heldUsd?: string;
  /** Exact USD, available plus held. */
  totalUsd?: string;
  /** Legacy USD alias of `availableUsd`. */
  available?: string;
  /** Legacy USD alias of `heldUsd`. */
  held?: string;
  /** Legacy USD alias of `totalUsd`. */
  total?: string;
  /** @deprecated Truncated display projection at 1 credit = $0.001. Use `availableUsd`. */
  availableCredits?: number;
  /** @deprecated Rounded display projection at 1 credit = $0.001. Use `heldUsd`. */
  heldCredits?: number;
  /** @deprecated Display projection at 1 credit = $0.001. Use `totalUsd`. */
  totalCredits?: number;
  funding?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ServiceStatus {
  operational: boolean;
  /** HTTP status of `GET /healthz`; 0 when nothing came back at all. */
  status: number;
  body: string;
  error?: string;
  checkedAt: string;
}

/*
 * Agent skills: installable SKILL.md folders for coding agents. The catalog is newer than the rest
 * of the API, so every field except `slug` is optional and unknown fields pass through.
 */
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
