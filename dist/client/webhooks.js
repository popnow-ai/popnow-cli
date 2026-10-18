import { createHash, createHmac, timingSafeEqual } from "node:crypto";
function safeEqual(expected, received) {
    const a = Buffer.from(expected);
    const b = Buffer.from(received);
    return a.length === b.length && timingSafeEqual(a, b);
}
function checkTimestamp(timestamp, toleranceSeconds, nowSeconds) {
    if (!/^\d+$/.test(timestamp))
        return { reason: "timestamp is not a Unix time in seconds" };
    const age = nowSeconds - Number(timestamp);
    if (Math.abs(age) > toleranceSeconds) {
        return { age, reason: `timestamp is ${age}s from now, outside the ${toleranceSeconds}s tolerance` };
    }
    return { age };
}
function parseJson(raw) {
    try {
        return JSON.parse(Buffer.from(raw).toString("utf8"));
    }
    catch {
        return undefined;
    }
}
export function verifyTaskCallback(input) {
    const tolerance = input.toleranceSeconds ?? 300;
    const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
    const result = { valid: false, kind: "task-callback" };
    const time = checkTimestamp(input.timestamp.trim(), tolerance, now);
    if (time.age !== undefined)
        result.ageSeconds = time.age;
    const body = parseJson(input.rawBody);
    if (!body || typeof body !== "object")
        return { ...result, reason: "body is not valid JSON" };
    const taskId = input.payloadVersion === 1 ? body.task_id : body.data?.taskId;
    if (typeof taskId !== "string" || taskId === "") {
        return { ...result, reason: "body has no task id" };
    }
    result.taskId = taskId;
    if (typeof body.data?.state === "string")
        result.state = body.data.state;
    if (typeof body.request_id === "string")
        result.deliveryId = body.request_id;
    const digest = createHash("sha256").update(input.rawBody).digest("hex");
    const expected = createHmac("sha256", input.secret)
        .update(`${taskId}.${input.timestamp.trim()}.${digest}`)
        .digest("base64");
    if (!safeEqual(expected, input.signature.trim())) {
        return { ...result, reason: "signature does not match" };
    }
    if (time.reason)
        return { ...result, reason: time.reason };
    return { ...result, valid: true };
}
export function verifyAccountEndpoint(input) {
    const tolerance = input.toleranceSeconds ?? 300;
    const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
    const result = {
        valid: false,
        kind: "account-endpoint",
        deliveryId: input.webhookId,
    };
    const time = checkTimestamp(input.timestamp.trim(), tolerance, now);
    if (time.age !== undefined)
        result.ageSeconds = time.age;
    const encoded = input.secret.startsWith("whsec_") ? input.secret.slice(6) : input.secret;
    const key = Buffer.from(encoded, "base64");
    if (key.length === 0)
        return { ...result, reason: "endpoint secret is not valid Base64" };
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
    if (!matched)
        return { ...result, reason: "signature does not match" };
    if (time.reason)
        return { ...result, reason: time.reason };
    const body = parseJson(input.rawBody);
    if (typeof body?.type === "string")
        result.eventType = body.type;
    if (typeof body?.data?.object?.taskId === "string")
        result.taskId = body.data.object.taskId;
    if (typeof body?.data?.object?.state === "string")
        result.state = body.data.object.state;
    return { ...result, valid: true };
}
