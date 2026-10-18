import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/*
 * Signature checks for the two kinds of PopNow webhooks, as described at
 * https://popnow.ai/docs/webhooks:
 *
 * - Task callbacks (`callBackUrl`):
 *   X-Webhook-Signature = base64(HMAC-SHA256(secret, "<taskId>.<timestamp>.<sha256_hex(raw_body)>"))
 *   with `taskId` read from `data.taskId` (payload version 2) or the top-level `task_id`
 *   (payload version 1).
 * - Account endpoints (Standard Webhooks):
 *   webhook-signature = "v1," + base64(HMAC-SHA256(key, "<webhook-id>.<webhook-timestamp>.<raw_body>"))
 *   where `key` is the Base64-decoded part of the `whsec_...` secret. The header may hold several
 *   space-separated signatures during a rotation; any match is accepted.
 */

export interface WebhookVerification {
  valid: boolean;
  /** Why verification failed; absent when it succeeded. */
  reason?: string;
  kind: "task-callback" | "account-endpoint";
  taskId?: string;
  state?: string;
  /** The delivery ID to de-duplicate on: `request_id` (callbacks) or `webhook-id` (endpoints). */
  deliveryId?: string;
  eventType?: string;
  /** Seconds between the signed timestamp and now, positive when the timestamp is in the past. */
  ageSeconds?: number;
}

export interface VerifyTaskCallbackInput {
  rawBody: Uint8Array;
  timestamp: string;
  signature: string;
  secret: string;
  payloadVersion?: number;
  toleranceSeconds?: number;
  nowSeconds?: number;
}

export interface VerifyEndpointInput {
  rawBody: Uint8Array;
  webhookId: string;
  timestamp: string;
  signature: string;
  secret: string;
  toleranceSeconds?: number;
  nowSeconds?: number;
}

function safeEqual(expected: string, received: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

function checkTimestamp(
  timestamp: string,
  toleranceSeconds: number,
  nowSeconds: number,
): { age?: number; reason?: string } {
  if (!/^\d+$/.test(timestamp)) return { reason: "timestamp is not a Unix time in seconds" };
  const age = nowSeconds - Number(timestamp);
  if (Math.abs(age) > toleranceSeconds) {
    return { age, reason: `timestamp is ${age}s from now, outside the ${toleranceSeconds}s tolerance` };
  }
  return { age };
}

function parseJson(raw: Uint8Array): unknown {
  try {
    return JSON.parse(Buffer.from(raw).toString("utf8"));
  } catch {
    return undefined;
  }
}

export function verifyTaskCallback(input: VerifyTaskCallbackInput): WebhookVerification {
  const tolerance = input.toleranceSeconds ?? 300;
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const result: WebhookVerification = { valid: false, kind: "task-callback" };
  const time = checkTimestamp(input.timestamp.trim(), tolerance, now);
  if (time.age !== undefined) result.ageSeconds = time.age;

  const body = parseJson(input.rawBody) as
    | { request_id?: unknown; task_id?: unknown; data?: { taskId?: unknown; state?: unknown } }
    | undefined;
  if (!body || typeof body !== "object") return { ...result, reason: "body is not valid JSON" };
  const taskId = input.payloadVersion === 1 ? body.task_id : body.data?.taskId;
  if (typeof taskId !== "string" || taskId === "") {
    return { ...result, reason: "body has no task id" };
  }
  result.taskId = taskId;
  if (typeof body.data?.state === "string") result.state = body.data.state;
  if (typeof body.request_id === "string") result.deliveryId = body.request_id;

  const digest = createHash("sha256").update(input.rawBody).digest("hex");
  const expected = createHmac("sha256", input.secret)
    .update(`${taskId}.${input.timestamp.trim()}.${digest}`)
    .digest("base64");
  if (!safeEqual(expected, input.signature.trim())) {
    return { ...result, reason: "signature does not match" };
  }
  if (time.reason) return { ...result, reason: time.reason };
  return { ...result, valid: true };
}

export function verifyAccountEndpoint(input: VerifyEndpointInput): WebhookVerification {
  const tolerance = input.toleranceSeconds ?? 300;
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const result: WebhookVerification = {
    valid: false,
    kind: "account-endpoint",
    deliveryId: input.webhookId,
  };
  const time = checkTimestamp(input.timestamp.trim(), tolerance, now);
  if (time.age !== undefined) result.ageSeconds = time.age;

  const encoded = input.secret.startsWith("whsec_") ? input.secret.slice(6) : input.secret;
  const key = Buffer.from(encoded, "base64");
  if (key.length === 0) return { ...result, reason: "endpoint secret is not valid Base64" };
  const expected = createHmac("sha256", key)
    .update(`${input.webhookId}.${input.timestamp.trim()}.`)
    .update(input.rawBody)
    .digest("base64");
  const matched = input.signature
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean)
    .some((part) => {
      const comma = part.indexOf(",");
      return comma > 0 && part.slice(0, comma) === "v1" && safeEqual(expected, part.slice(comma + 1));
    });
  if (!matched) return { ...result, reason: "signature does not match" };
  if (time.reason) return { ...result, reason: time.reason };

  const body = parseJson(input.rawBody) as
    | { type?: unknown; data?: { object?: { taskId?: unknown; state?: unknown } } }
    | undefined;
  if (typeof body?.type === "string") result.eventType = body.type;
  if (typeof body?.data?.object?.taskId === "string") result.taskId = body.data.object.taskId;
  if (typeof body?.data?.object?.state === "string") result.state = body.data.object.state;
  return { ...result, valid: true };
}
