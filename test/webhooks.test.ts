import { createHash, createHmac } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runCli } from "../src/cli/program.js";
import { verifyAccountEndpoint, verifyTaskCallback } from "../src/client/webhooks.js";
import { argv, captureIo } from "./helpers.js";

const SECRET = "test-webhook-secret";
const NOW = Math.floor(Date.now() / 1000);
const BODY = Buffer.from(
  JSON.stringify({
    code: 200,
    msg: "success",
    data: { taskId: "job_1", state: "succeeded", credits: 34, cost: "0.034", settled: true },
    request_id: "whd_1",
  }),
);

/** The scheme from https://popnow.ai/docs/webhooks, computed independently of the code under test. */
function sign(body: Buffer, taskId: string, timestamp: number, secret = SECRET): string {
  const digest = createHash("sha256").update(body).digest("hex");
  return createHmac("sha256", secret).update(`${taskId}.${timestamp}.${digest}`).digest("base64");
}

let dir: string;
let bodyFile: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "popnow-cli-hooks-"));
  bodyFile = join(dir, "body.json");
  await writeFile(bodyFile, BODY);
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("task callback verification", () => {
  it("accepts a correct v2 signature and reports the delivery id", () => {
    const result = verifyTaskCallback({ rawBody: BODY, timestamp: String(NOW), signature: sign(BODY, "job_1", NOW), secret: SECRET, nowSeconds: NOW });
    expect(result).toMatchObject({ valid: true, taskId: "job_1", state: "succeeded", deliveryId: "whd_1" });
  });

  it("rejects a changed body, a wrong secret and a stale timestamp", () => {
    const signature = sign(BODY, "job_1", NOW);
    const changed = Buffer.from(BODY.toString().replace("0.034", "0.000"));
    expect(verifyTaskCallback({ rawBody: changed, timestamp: String(NOW), signature, secret: SECRET, nowSeconds: NOW }).valid).toBe(false);
    expect(verifyTaskCallback({ rawBody: BODY, timestamp: String(NOW), signature, secret: "other", nowSeconds: NOW }).valid).toBe(false);
    const old = NOW - 3600;
    const stale = verifyTaskCallback({ rawBody: BODY, timestamp: String(old), signature: sign(BODY, "job_1", old), secret: SECRET, nowSeconds: NOW });
    expect(stale.valid).toBe(false);
    expect(stale.reason).toMatch(/tolerance/);
  });

  it("reads the task id from task_id for payload version 1", () => {
    const v1 = Buffer.from(JSON.stringify({ task_id: "job_9", status: "succeeded" }));
    const result = verifyTaskCallback({ rawBody: v1, timestamp: String(NOW), signature: sign(v1, "job_9", NOW), secret: SECRET, payloadVersion: 1, nowSeconds: NOW });
    expect(result).toMatchObject({ valid: true, taskId: "job_9" });
  });
});

describe("account endpoint verification (Standard Webhooks)", () => {
  const key = Buffer.from("0123456789abcdef0123456789abcdef");
  const secret = `whsec_${key.toString("base64")}`;
  const body = Buffer.from(JSON.stringify({ type: "task.succeeded", data: { object: { taskId: "job_3", state: "succeeded" } } }));
  const id = "msg_1";
  const good = createHmac("sha256", key).update(`${id}.${NOW}.`).update(body).digest("base64");

  it("accepts any matching v1 signature in a rotated header", () => {
    const result = verifyAccountEndpoint({ rawBody: body, webhookId: id, timestamp: String(NOW), signature: `v1,bm9wZQ== v1,${good}`, secret, nowSeconds: NOW });
    expect(result).toMatchObject({ valid: true, eventType: "task.succeeded", taskId: "job_3", deliveryId: id });
  });

  it("rejects a signature for another webhook id", () => {
    expect(verifyAccountEndpoint({ rawBody: body, webhookId: "msg_2", timestamp: String(NOW), signature: `v1,${good}`, secret, nowSeconds: NOW }).valid).toBe(false);
  });
});

describe("webhooks verify command", () => {
  it("reads the secret from the environment only and exits 0 when valid", async () => {
    const c = captureIo({ env: { POPNOW_WEBHOOK_SECRET: SECRET } });
    const code = await runCli(
      argv("--json", "webhooks", "verify", "--body-file", bodyFile, "--timestamp", String(NOW), "--signature", sign(BODY, "job_1", NOW)),
      { io: c.io },
    );
    expect(code).toBe(0);
    expect(JSON.parse(c.out())).toMatchObject({ valid: true, kind: "task-callback" });
  });

  it("exits 1 for a bad signature", async () => {
    const c = captureIo({ env: { POPNOW_WEBHOOK_SECRET: SECRET } });
    const code = await runCli(
      argv("webhooks", "verify", "--body-file", bodyFile, "--timestamp", String(NOW), "--signature", "AAAA"),
      { io: c.io },
    );
    expect(code).toBe(1);
    expect(c.out()).toContain("valid: false");
  });

  it("fails clearly when the secret variable is unset", async () => {
    const c = captureIo({ env: {} });
    const code = await runCli(
      argv("webhooks", "verify", "--body-file", bodyFile, "--timestamp", String(NOW), "--signature", "AAAA"),
      { io: c.io },
    );
    expect(code).toBe(1);
    expect(c.err()).toContain("POPNOW_WEBHOOK_SECRET is not set");
  });
});
