import { describe, expect, it } from "vitest";

import { PopNowClient } from "../src/client/client.js";
import { PopNowApiError } from "../src/client/errors.js";

// Opt-in: POPNOW_LIVE_TESTS=1 npm test. Uses a fake key, so it can never spend credits.
describe.skipIf(process.env.POPNOW_LIVE_TESTS !== "1")("live API", () => {
  it("answers /healthz without a key", async () => {
    expect((await new PopNowClient().getStatus()).operational).toBe(true);
  });

  it("returns the 401 envelope for an unknown key", async () => {
    const client = new PopNowClient({ apiKey: `sk-popnow-${"0".repeat(48 - 1)}x`, maxRetries: 0 });
    const error = await client.getBalance().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PopNowApiError);
    expect(error).toMatchObject({ status: 401, code: 401, fromApi: true });
    expect((error as PopNowApiError).requestId).toMatch(/^req_/);
  });
});
