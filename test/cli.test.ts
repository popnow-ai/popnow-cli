import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runCli } from "../src/cli/program.js";
import { SUPPORTED_UPLOAD_CONTENT_TYPES } from "../src/cli/io.js";
import { CLI_VERSION } from "../src/version.js";
import { BASE, apiError, argv, captureIo, deps, envelope, mockFetch } from "./helpers.js";

/* The current response shape: exact USD strings first, deprecated credit projections alongside. */
const QUOTE = {
  quoteId: "q_signed",
  model: "alibaba/wan-3.0/image-to-video",
  maxChargeUsd: "0.0405",
  expectedChargeUsd: "0.0342",
  estimatedCost: "0.0405",
  maxCharge: "0.0405",
  expectedCharge: "0.0342",
  maxCredits: 41,
  expectedCredits: 35,
  currency: "USD",
  quantity: "5",
  unit: "second",
  expiresAt: "2026-10-19T10:05:00Z",
};
/* What an older server sent: no USD fields beside the legacy aliases and credits. */
const LEGACY_QUOTE = {
  quoteId: "q_legacy",
  model: "alibaba/wan-3.0/image-to-video",
  estimatedCost: "0.040",
  maxCharge: "0.040",
  maxCredits: 40,
  expectedCredits: 34,
  currency: "USD",
  quantity: "5",
  unit: "second",
  expiresAt: "2026-10-19T10:05:00Z",
};
const CREATED = {
  taskId: "job_1",
  state: "queued",
  estimatedCostUsd: "0.0405",
  estimatedCost: "0.0405",
  estimatedCredits: 41,
  deadlineAt: "2026-10-19T11:00:00Z",
};
const INPUT = '{"image_url":"https://example.com/a.png","prompt":"waves"}';

function task(state: string, extra: Record<string, unknown> = {}) {
  return {
    taskId: "job_1",
    model: QUOTE.model,
    state,
    costUsd: "0.0342",
    cost: "0.0342",
    credits: 35,
    exactCredits: "34.2",
    settled: state !== "queued" && state !== "running",
    createdAt: "2026-10-19T10:00:00Z",
    ...extra,
  };
}

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "popnow-cli-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("program surface", () => {
  it("never offers an API-key flag and points at POPNOW_API_KEY", async () => {
    const c = captureIo();
    expect(await runCli(argv("--help"), { io: c.io })).toBe(0);
    expect(c.out()).not.toContain("--api-key");
    expect(c.out()).toContain("POPNOW_API_KEY");
    for (const command of ["status", "models", "balance", "usage", "jobs", "files", "assets", "webhooks", "skills", "docs"]) {
      expect(c.out()).toContain(command);
    }
  });

  it("keeps the version constant in step with package.json", async () => {
    const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    expect(CLI_VERSION).toBe(manifest.version);
    expect(manifest.name).toBe("@popnow/cli");
    expect(manifest.bin.popnow).toBe("dist/cli/index.js");
    const c = captureIo();
    expect(await runCli(argv("--version"), { io: c.io })).toBe(0);
    expect(c.out().trim()).toBe(CLI_VERSION);
  });

  it("returns a usage error for an unknown command without a stack trace", async () => {
    const c = captureIo();
    const code = await runCli(argv("jbos"), { io: c.io });
    expect(code).not.toBe(0);
    expect(c.err()).toMatch(/unknown command/);
  });
});

describe("authentication", () => {
  it("refuses before any request when POPNOW_API_KEY is missing", async () => {
    const c = captureIo({ env: {} });
    const m = mockFetch([]);
    expect(await runCli(argv("balance"), deps(c.io, m.fetch))).toBe(1);
    expect(m.requests).toHaveLength(0);
    expect(c.err()).toContain("POPNOW_API_KEY is required");
    expect(c.err()).toContain('export POPNOW_API_KEY="sk-popnow-..."');
  });

  it("reports a missing key as a typed error under --json", async () => {
    const c = captureIo({ env: {} });
    expect(await runCli(argv("--json", "balance"), deps(c.io, mockFetch([]).fetch))).toBe(1);
    expect(JSON.parse(c.err())).toMatchObject({ type: "MissingApiKeyError" });
    expect(c.out()).toBe("");
  });

  it("sends the key as a Bearer token with an explicit User-Agent", async () => {
    const c = captureIo();
    const m = mockFetch([() => envelope({ availableUsd: "12.000000001", availableCredits: 12000 })]);
    expect(await runCli(argv("--json", "balance"), deps(c.io, m.fetch))).toBe(0);
    expect(m.requests[0]!.url).toBe(`${BASE}/api/v1/chat/credit`);
    expect(m.requests[0]!.headers.authorization).toBe("Bearer sk-popnow-test");
    expect(m.requests[0]!.headers["user-agent"]).toMatch(/^popnow-cli\/\d+\.\d+\.\d+ \(/);
    // --json passes the server's data through untouched, legacy fields included.
    expect(JSON.parse(c.out())).toEqual({ availableUsd: "12.000000001", availableCredits: 12000 });
  });

  it("explains a 401 and checks the key prefix without printing the key", async () => {
    const c = captureIo({ env: { POPNOW_API_KEY: "sk-other-0123456789abcdef" } });
    const m = mockFetch([() => apiError(401, 401, "Credentials are invalid or expired")]);
    expect(await runCli(argv("balance"), deps(c.io, m.fetch))).toBe(1);
    expect(c.err()).toContain("Error: Credentials are invalid or expired (request req_err)");
    expect(c.err()).toContain('not "sk-popnow-"');
    expect(c.err()).not.toContain("0123456789abcdef");
    expect(c.err()).toContain("https://popnow.ai/api/console/keys");
  });
});

describe("status", () => {
  it("probes /healthz without a key and says so in one sentence", async () => {
    const c = captureIo({ env: {} });
    const m = mockFetch([() => Response.json({ status: "ok" })]);
    expect(await runCli(argv("status"), deps(c.io, m.fetch))).toBe(0);
    expect(m.requests[0]!.url).toBe(`${BASE}/healthz`);
    expect(m.requests[0]!.headers.authorization).toBeUndefined();
    expect(c.out()).toMatch(/^PopNow API is reachable: 127\.0\.0\.1:4020 answered in \d+ ms\.\n$/);
  });

  it("exits 1 and blames the path, not the service, on a 403 from in between", async () => {
    const c = captureIo();
    const m = mockFetch([() => new Response("<html>blocked</html>", { status: 403 })]);
    expect(await runCli(argv("status"), deps(c.io, m.fetch))).toBe(1);
    expect(c.out()).toContain("not a service fault");
  });
});

describe("models, usage and lists", () => {
  it("passes model filters as query parameters", async () => {
    const c = captureIo();
    const m = mockFetch([() => envelope({ object: "list", data: [] })]);
    const code = await runCli(
      argv("--json", "models", "list", "--modality", "video", "--provider", "kling", "--include-schema"),
      deps(c.io, m.fetch),
    );
    expect(code).toBe(0);
    expect(m.requests[0]!.url).toBe(`${BASE}/api/v1/models?modality=video&provider=kling&includeSchema=1`);
  });

  it("rejects a modality the API does not serve", async () => {
    const c = captureIo();
    expect(await runCli(argv("models", "list", "--modality", "text"), deps(c.io, mockFetch([]).fetch))).not.toBe(0);
  });

  it("keeps the slashes of a model id in the path", async () => {
    const c = captureIo();
    const m = mockFetch([() => envelope({ model: QUOTE.model })]);
    await runCli(argv("models", "get", QUOTE.model), deps(c.io, m.fetch));
    expect(m.requests[0]!.url).toBe(`${BASE}/api/v1/models/alibaba/wan-3.0/image-to-video`);
  });

  it("sends only the date range for usage and keeps decimal strings intact", async () => {
    const c = captureIo();
    const m = mockFetch([() => envelope({ totalSpend: "0.000000001", totalCalls: 1 })]);
    await runCli(argv("--json", "usage", "--from", "2026-10-01", "--to", "2026-10-02"), deps(c.io, m.fetch));
    expect(m.requests[0]!.url).toBe(`${BASE}/api/v1/usage?from=2026-10-01&to=2026-10-02`);
    expect(JSON.parse(c.out()).totalSpend).toBe("0.000000001");
  });

  it("lists jobs with filters", async () => {
    const c = captureIo();
    const m = mockFetch([() => envelope({ items: [], hasMore: false })]);
    await runCli(argv("jobs", "list", "--state", "failed", "--limit", "50"), deps(c.io, m.fetch));
    expect(m.requests[0]!.url).toBe(`${BASE}/api/v1/jobs?state=failed&limit=50`);
  });

  it("lists assets, mapping --search to q", async () => {
    const c = captureIo();
    const m = mockFetch([() => envelope({ items: [] })]);
    await runCli(
      argv("assets", "list", "--kind", "image", "--search", "cat", "--favorite", "true", "--sort", "name"),
      deps(c.io, m.fetch),
    );
    expect(m.requests[0]!.url).toBe(`${BASE}/api/v1/assets?kind=image&favorite=true&sort=name&q=cat`);
  });

  it("reads one asset and the asset plan", async () => {
    const c = captureIo();
    const m = mockFetch([() => envelope({ id: "ast_1", uri: "popnow://a/ast_1" }), () => envelope({ plan: {} })]);
    await runCli(argv("assets", "get", "ast_1"), deps(c.io, m.fetch));
    await runCli(argv("assets", "usage"), deps(c.io, m.fetch));
    expect(m.requests.map((r) => r.url)).toEqual([`${BASE}/api/v1/assets/ast_1`, `${BASE}/api/v1/assets/usage`]);
  });
});

describe("jobs create", () => {
  it("fails closed without --yes when nobody can answer the prompt", async () => {
    const c = captureIo();
    const m = mockFetch([]);
    const code = await runCli(argv("jobs", "create", "--model", QUOTE.model, "--input-json", INPUT), deps(c.io, m.fetch));
    expect(code).toBe(1);
    expect(m.requests).toHaveLength(0);
    expect(c.err()).toContain("requires an interactive confirmation or --yes");
  });

  it("requires model input instead of sending an empty object", async () => {
    const c = captureIo();
    const m = mockFetch([]);
    expect(await runCli(argv("jobs", "create", "--model", QUOTE.model, "--yes"), deps(c.io, m.fetch))).toBe(1);
    expect(m.requests).toHaveLength(0);
    expect(c.err()).toContain("model input is required");
  });

  it("quotes, then creates with the quote, an automatic idempotency key and the retention header", async () => {
    const c = captureIo();
    const m = mockFetch([() => envelope(QUOTE), () => envelope(CREATED, { status: 202 })]);
    const code = await runCli(
      argv("--json", "jobs", "create", "--model", QUOTE.model, "--input-json", INPUT, "--retention", "1h", "--yes"),
      deps(c.io, m.fetch),
    );
    expect(code).toBe(0);
    const [quote, create] = m.requests;
    expect(quote!.url).toBe(`${BASE}/api/v1/jobs/quote`);
    expect(JSON.parse(quote!.body!)).toEqual({ model: QUOTE.model, input: JSON.parse(INPUT) });
    expect(create!.url).toBe(`${BASE}/api/v1/jobs/createTask`);
    // The hold is confirmed with the quote's exact USD maximum, never the rounded credits.
    expect(JSON.parse(create!.body!)).toEqual({
      model: QUOTE.model,
      input: JSON.parse(INPUT),
      quoteId: "q_signed",
      expectedCostUsd: "0.0405",
    });
    const key = create!.headers["idempotency-key"];
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    expect(create!.headers["x-popnow-retention"]).toBe("3600");
    expect(JSON.parse(c.out())).toEqual({ idempotencyKey: key, ...CREATED });
    expect(c.err()).toContain("Price: $0.0342 expected; at most $0.0405 is held from your API balance");
    expect(c.err()).not.toContain("credits");
    expect(c.err()).toContain(`Idempotency-Key: ${key}`);
  });

  it("still confirms a quote from a server that sends only the legacy fields", async () => {
    const c = captureIo();
    const m = mockFetch([() => envelope(LEGACY_QUOTE), () => envelope(CREATED, { status: 202 })]);
    expect(
      await runCli(argv("jobs", "create", "--model", QUOTE.model, "--input-json", INPUT, "--yes"), deps(c.io, m.fetch)),
    ).toBe(0);
    expect(JSON.parse(m.requests[1]!.body!)).toMatchObject({ quoteId: "q_legacy", expectedCostUsd: "0.040" });
    expect(c.err()).toContain("Price: $0.034 expected; at most $0.040 is held");
  });

  it("falls back to expectedCredits only when a quote carries no USD amount at all", async () => {
    const c = captureIo();
    const { estimatedCost: _e, maxCharge: _m, ...creditsOnly } = LEGACY_QUOTE;
    const m = mockFetch([() => envelope(creditsOnly), () => envelope(CREATED, { status: 202 })]);
    expect(
      await runCli(argv("jobs", "create", "--model", QUOTE.model, "--input-json", INPUT, "--yes"), deps(c.io, m.fetch)),
    ).toBe(0);
    const body = JSON.parse(m.requests[1]!.body!);
    expect(body).toMatchObject({ quoteId: "q_legacy", expectedCredits: 40 });
    expect(body.expectedCostUsd).toBeUndefined();
    expect(c.err()).toContain("at most $0.04 is held");
  });

  it("prints a quote in USD and hides the deprecated credit fields outside --json", async () => {
    const c = captureIo();
    const m = mockFetch([() => envelope(QUOTE)]);
    expect(await runCli(argv("jobs", "quote", "--model", QUOTE.model, "--input-json", INPUT), deps(c.io, m.fetch))).toBe(0);
    expect(c.out()).toContain("maxChargeUsd: 0.0405");
    expect(c.out()).toContain("Price: $0.0342 expected; at most $0.0405 is held");
    expect(c.out()).not.toContain("maxCredits");
    expect(c.out()).not.toContain("expectedCredits");
  });

  it("shows the quote and stops when the interactive answer is no", async () => {
    const c = captureIo({ stdinIsTTY: true });
    const m = mockFetch([() => envelope(QUOTE)]);
    const code = await runCli(
      argv("jobs", "create", "--model", QUOTE.model, "--input-json", INPUT, "--idempotency-key", "order-8814"),
      deps(c.io, m.fetch),
    );
    expect(code).toBe(1);
    expect(m.requests).toHaveLength(1);
    expect(c.confirmations[0]).toContain("at most $0.0405");
    expect(c.err()).toContain("operation canceled");
  });

  it("reads input from a file with a UTF-8 BOM", async () => {
    const file = join(dir, "input.json");
    await writeFile(file, `﻿${INPUT}`);
    const c = captureIo();
    const m = mockFetch([() => envelope(QUOTE)]);
    expect(await runCli(argv("jobs", "quote", "--model", QUOTE.model, "--input-file", file), deps(c.io, m.fetch))).toBe(0);
    expect(JSON.parse(m.requests[0]!.body!).input).toEqual(JSON.parse(INPUT));
  });

  it("waits for the result and prints the output link", async () => {
    const c = captureIo();
    const done = task("succeeded", {
      output: { assets: [{ url: "https://media.example/out.mp4", expiresAt: "2026-10-19T10:30:00Z" }] },
    });
    const m = mockFetch([
      () => envelope(QUOTE),
      () => envelope(CREATED, { status: 202 }),
      () => envelope(task("running")),
      () => envelope(done),
    ]);
    const code = await runCli(
      argv("jobs", "create", "--model", QUOTE.model, "--input-json", INPUT, "--yes", "--wait", "--poll-interval-ms", "1"),
      deps(c.io, m.fetch),
    );
    expect(code).toBe(0);
    expect(m.requests[2]!.url).toBe(`${BASE}/api/v1/jobs/recordInfo?taskId=job_1`);
    expect(c.err()).toContain("Accepted: job_1");
    expect(c.out()).toContain("Output: https://media.example/out.mp4");
  });

  it("exits 2 when the waited task fails", async () => {
    const c = captureIo();
    const m = mockFetch([
      () => envelope(QUOTE),
      () => envelope(CREATED, { status: 202 }),
      () => envelope(task("failed", { errorCode: "content_rejected", errorMessage: "declined" })),
    ]);
    const code = await runCli(
      argv("jobs", "create", "--model", QUOTE.model, "--input-json", INPUT, "--yes", "--wait"),
      deps(c.io, m.fetch),
    );
    expect(code).toBe(2);
    expect(c.out()).toContain("Failed: content_rejected: declined");
  });

  it("keeps the task id and the idempotency key when waiting breaks after acceptance", async () => {
    const c = captureIo();
    const m = mockFetch([
      () => envelope(QUOTE),
      () => envelope(CREATED, { status: 202 }),
      () => Promise.reject(new TypeError("socket hang up")),
    ]);
    const code = await runCli(
      argv("--json", "jobs", "create", "--model", QUOTE.model, "--input-json", INPUT, "--yes", "--wait", "--idempotency-key", "k-1"),
      deps(c.io, m.fetch),
    );
    expect(code).toBe(1);
    const lines = c.err().trim().split("\n");
    const details = JSON.parse(lines[lines.length - 1]!);
    expect(details).toMatchObject({ taskId: "job_1", idempotencyKey: "k-1", recover: "popnow jobs wait job_1" });
  });

  it("maps 40201 to the API billing page", async () => {
    const c = captureIo();
    const m = mockFetch([() => apiError(402, 40201, "Insufficient balance")]);
    expect(await runCli(argv("jobs", "quote", "--model", QUOTE.model, "--input-json", INPUT), deps(c.io, m.fetch))).toBe(1);
    expect(c.err()).toContain("Add funds at https://popnow.ai/api/console/billing");
    expect(c.err()).not.toContain("popnow.ai/pricing");
  });
});

describe("balance and costs in USD", () => {
  it("shows the API balance in exact USD with where to add funds", async () => {
    const c = captureIo();
    const m = mockFetch([
      () =>
        envelope({
          availableUsd: "12.345678901",
          heldUsd: "0.0405",
          totalUsd: "12.386178901",
          available: "12.345678901",
          held: "0.0405",
          total: "12.386178901",
          availableCredits: 12345,
          heldCredits: 41,
          totalCredits: 12386,
        }),
    ]);
    expect(await runCli(argv("balance"), deps(c.io, m.fetch))).toBe(0);
    expect(c.out()).toContain("Available: $12.345678901\nHeld: $0.0405\nTotal: $12.386178901\n");
    expect(c.out()).toContain("Add funds: https://popnow.ai/api/console/billing");
    expect(c.out()).not.toContain("Credits");
  });

  it("reads the legacy credit balance when no USD field is present", async () => {
    const c = captureIo();
    const m = mockFetch([() => envelope({ availableCredits: 0, heldCredits: 1205, totalCredits: 1205 })]);
    expect(await runCli(argv("balance"), deps(c.io, m.fetch))).toBe(0);
    expect(c.out()).toContain("Available: $0\nHeld: $1.205\nTotal: $1.205\n");
    expect(c.out()).toContain("Nothing is available for new tasks.");
  });

  it("shows a negative balance with the sign before the currency", async () => {
    const c = captureIo();
    const m = mockFetch([() => envelope({ availableUsd: "-1.5", heldUsd: "0", totalUsd: "-1.5" })]);
    expect(await runCli(argv("balance"), deps(c.io, m.fetch))).toBe(0);
    expect(c.out()).toContain("Available: -$1.5");
  });

  it("prints a settled task's charge, and a running task's hold, in USD", async () => {
    const settled = captureIo();
    await runCli(argv("jobs", "get", "job_1"), deps(settled.io, mockFetch([() => envelope(task("succeeded"))]).fetch));
    expect(settled.out()).toContain("Charged: $0.0342");
    expect(settled.out()).not.toContain("exactCredits");

    const running = captureIo();
    await runCli(argv("jobs", "get", "job_1"), deps(running.io, mockFetch([() => envelope(task("running"))]).fetch));
    expect(running.out()).toContain("Held: $0.0342 (the final charge is at most this");
  });

  it("still prints the cost of a legacy task record that has only credits", async () => {
    const c = captureIo();
    const legacy = { taskId: "job_1", model: QUOTE.model, state: "succeeded", credits: 34, settled: true, createdAt: "2026-10-19T10:00:00Z" };
    await runCli(argv("jobs", "get", "job_1"), deps(c.io, mockFetch([() => envelope(legacy)]).fetch));
    expect(c.out()).toContain("credits: 34");
    expect(c.out()).toContain("Charged: $0.034");
  });

  it("hides the deprecated credit totals of usage outside --json", async () => {
    const usage = {
      from: "2026-10-01",
      to: "2026-10-08",
      currency: "USD",
      totalCalls: 2,
      totalSpend: "0.0684",
      totalCredits: 69,
      days: [{ day: "2026-10-01", calls: 2, succeeded: 2, failed: 0, spend: "0.0684", credits: 69 }],
      models: [{ model: QUOTE.model, calls: 2, succeeded: 2, failed: 0, spend: "0.0684", credits: 69 }],
    };
    const c = captureIo();
    expect(await runCli(argv("usage"), deps(c.io, mockFetch([() => envelope(usage)]).fetch))).toBe(0);
    expect(c.out()).toContain("totalSpend: 0.0684");
    expect(c.out()).not.toContain("credits");
    expect(c.out()).not.toContain("totalCredits");

    const j = captureIo();
    expect(await runCli(argv("--json", "usage"), deps(j.io, mockFetch([() => envelope(usage)]).fetch))).toBe(0);
    expect(JSON.parse(j.out())).toEqual(usage);
  });
});

describe("retry, purge, wait", () => {
  it("retries with confirmation and an idempotency key", async () => {
    const c = captureIo();
    const m = mockFetch([() => envelope({ ...CREATED, taskId: "job_2", sourceTaskId: "job_1" })]);
    expect(await runCli(argv("--json", "jobs", "retry", "job_1", "--yes"), deps(c.io, m.fetch))).toBe(0);
    expect(m.requests[0]!.url).toBe(`${BASE}/api/v1/jobs/retry`);
    expect(JSON.parse(m.requests[0]!.body!)).toEqual({ taskId: "job_1" });
    expect(m.requests[0]!.headers["idempotency-key"]).toBeTruthy();
  });

  it("refuses to purge without confirmation", async () => {
    const c = captureIo();
    const m = mockFetch([]);
    expect(await runCli(argv("jobs", "purge", "job_1"), deps(c.io, m.fetch))).toBe(1);
    expect(c.err()).toContain("destructive command requires");
    expect(m.requests).toHaveLength(0);
  });

  it("purges with --yes", async () => {
    const c = captureIo();
    const m = mockFetch([() => envelope({ taskId: "job_1", contentState: "purged", billingRetained: true, mediaDeletionPending: true })]);
    expect(await runCli(argv("jobs", "purge", "job_1", "--yes"), deps(c.io, m.fetch))).toBe(0);
    expect(JSON.parse(m.requests[0]!.body!)).toEqual({ taskId: "job_1" });
    expect(c.out()).toContain("billing records were not touched");
  });

  it("explains a purged task in words", async () => {
    const c = captureIo();
    const m = mockFetch([() => envelope(task("succeeded", { contentState: "purged", purgedAt: "2026-10-19T12:00:00Z" }))]);
    await runCli(argv("jobs", "get", "job_1"), deps(c.io, m.fetch));
    expect(c.out()).toContain("Content: destroyed, you removed the outputs on 2026-10-19T12:00:00Z");
  });

  it("stops waiting at the timeout without canceling and says how to resume", async () => {
    const c = captureIo();
    const m = mockFetch(() => envelope(task("running")));
    const code = await runCli(argv("jobs", "wait", "job_1", "--wait-timeout-ms", "0"), deps(c.io, m.fetch));
    expect(code).toBe(1);
    expect(c.err()).toContain("popnow jobs wait job_1");
  });
});

describe("retries", () => {
  it("retries a safe request after 429, honoring Retry-After", async () => {
    const c = captureIo();
    const m = mockFetch([
      () => apiError(429, 429, "Too many requests", {}, { "Retry-After": "1" }),
      () => envelope({ availableUsd: "0.005" }),
    ]);
    expect(await runCli(argv("--json", "balance"), deps(c.io, m.fetch, 2))).toBe(0);
    expect(m.requests).toHaveLength(2);
  });

  it("does not retry a 400", async () => {
    const c = captureIo();
    const m = mockFetch([() => apiError(400, 400, "input.prompt is required")]);
    expect(await runCli(argv("jobs", "quote", "--model", QUOTE.model, "--input-json", "{}"), deps(c.io, m.fetch, 2))).toBe(1);
    expect(m.requests).toHaveLength(1);
    expect(c.err()).toContain("popnow models get <model>");
  });

  it("says when a refusal did not come from the API", async () => {
    const c = captureIo();
    const m = mockFetch([() => new Response("<html>Access denied</html>", { status: 403 })]);
    expect(await runCli(argv("balance"), deps(c.io, m.fetch))).toBe(1);
    expect(c.err()).toContain("something other than the PopNow API");
    expect(c.err()).toContain("proxy, VPN or corporate gateway");
  });
});

describe("files", () => {
  it("uploads with a ticket, a PUT without the API key, and a commit", async () => {
    const file = join(dir, "photo.png");
    await writeFile(file, Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]));
    const c = captureIo();
    const m = mockFetch([
      () =>
        envelope({
          fileId: "fil_1",
          key: "popnow://f/fil_1",
          uploadUrl: "https://storage.example/put?sig=1",
          method: "PUT",
          headers: { "Content-Type": "image/png" },
          expiresAt: "2026-10-19T10:15:00Z",
          maxBytes: 10485760,
        }),
      () => new Response(null, { status: 200 }),
      () => envelope({ fileId: "fil_1", status: "ready", uri: "popnow://f/fil_1", bytes: 8 }),
    ]);
    expect(await runCli(argv("--json", "files", "upload", file), deps(c.io, m.fetch))).toBe(0);
    const [ticket, put, commit] = m.requests;
    expect(JSON.parse(ticket!.body!)).toEqual({ contentType: "image/png", bytes: 8 });
    expect(put!.method).toBe("PUT");
    expect(put!.url).toBe("https://storage.example/put?sig=1");
    expect(put!.headers.authorization).toBeUndefined();
    expect(put!.headers["content-type"]).toBe("image/png");
    expect(commit!.url).toBe(`${BASE}/api/v1/files/fil_1/commit`);
    expect(JSON.parse(c.out()).uri).toBe("popnow://f/fil_1");
  });

  it("asks for --content-type when the extension is unknown", async () => {
    const c = captureIo();
    expect(await runCli(argv("files", "upload", join(dir, "notes.xyz")), deps(c.io, mockFetch([]).fetch))).toBe(1);
    expect(c.err()).toContain("--content-type is required");
  });

  it("accepts exactly the upload content types of the OpenAPI contract", () => {
    expect([...SUPPORTED_UPLOAD_CONTENT_TYPES].sort()).toEqual(
      [
        "image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/webm", "audio/mpeg", "audio/wav",
        "application/pdf", "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "application/vnd.apple.keynote", "application/vnd.apple.pages", "application/vnd.apple.numbers",
        "text/plain", "text/markdown", "application/octet-stream",
      ].sort(),
    );
  });

  it("creates a download link for a task output", async () => {
    const c = captureIo();
    const m = mockFetch([() => envelope({ key: "out/0.mp4", url: "https://media.example/0.mp4", expiresAt: "x" })]);
    await runCli(argv("files", "download-url", "job_1", "--key", "out/0.mp4"), deps(c.io, m.fetch));
    expect(m.requests[0]!.url).toBe(`${BASE}/api/v1/common/download-url`);
    expect(JSON.parse(m.requests[0]!.body!)).toEqual({ taskId: "job_1", key: "out/0.mp4" });
  });
});

describe("docs", () => {
  it("lists documentation links without an API key or a request", async () => {
    const c = captureIo({ env: {} });
    const m = mockFetch([]);
    expect(await runCli(argv("docs"), deps(c.io, m.fetch))).toBe(0);
    expect(m.requests).toHaveLength(0);
    expect(c.out()).toContain("https://popnow.ai/docs/webhooks");
    expect(c.out()).toContain("https://popnow.ai/docs/openapi.yaml");
    expect(c.out()).toContain("Developer MCP: https://api.popnow.ai/api/v1/mcp (setup: https://popnow.ai/api/mcp)");
    expect(c.out()).toContain("Agent skills: https://popnow.ai/api/skills");
    expect(c.out()).not.toMatch(/popnow\.ai\/mcp\b/);
  });

  it("prints the link instead of opening a browser when there is no terminal", async () => {
    const c = captureIo();
    expect(await runCli(argv("docs", "open", "errors"), { io: c.io })).toBe(0);
    expect(c.out().trim()).toBe("https://popnow.ai/docs/errors");
    expect(c.opened).toHaveLength(0);
  });

  it("opens the browser at a terminal", async () => {
    const c = captureIo({ stdinIsTTY: true });
    expect(await runCli(argv("docs", "open", "webhooks"), { io: c.io })).toBe(0);
    expect(c.opened).toEqual(["https://popnow.ai/docs/webhooks"]);
  });

  it("rejects an unknown topic with a pointer to search", async () => {
    const c = captureIo();
    expect(await runCli(argv("docs", "open", "nope"), { io: c.io })).toBe(1);
    expect(c.err()).toContain("popnow docs search nope");
  });

  it("searches the live docs index and returns absolute links", async () => {
    const c = captureIo({ env: {} });
    const m = mockFetch([
      () =>
        Response.json([
          { id: "/idempotency", type: "page", content: "<mark>Idempotency</mark>", url: "/idempotency" },
          { id: "/idempotency-6", type: "text", content: "An **<mark>idempotency</mark> key**", url: "/idempotency" },
          { id: "/tasks-1", type: "heading", content: "Retry", url: "/tasks#retry" },
        ]),
    ]);
    expect(await runCli(argv("--json", "docs", "search", "idempotency", "key"), deps(c.io, m.fetch))).toBe(0);
    expect(m.requests[0]!.url).toBe("https://popnow.ai/docs/api/search?query=idempotency+key&locale=en");
    expect(JSON.parse(c.out())).toEqual([
      { type: "page", text: "Idempotency", url: "https://popnow.ai/docs/idempotency" },
      { type: "heading", text: "Retry", url: "https://popnow.ai/docs/tasks#retry" },
    ]);
  });
});
