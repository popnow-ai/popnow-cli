#!/usr/bin/env node

import { isMainModule } from "../runtime/entrypoint.js";
import { relaunchWithEnvProxy, shouldRelaunchWithEnvProxy } from "../runtime/env-proxy.js";
import { runCli } from "./program.js";

export { createCli, runCli, EXIT_TASK_NOT_SUCCEEDED } from "./program.js";
export type { CliDependencies } from "./program.js";
export { PopNowClient, DEFAULT_BASE_URL } from "../client/client.js";
export { PopNowApiError, MissingApiKeyError } from "../client/errors.js";
export { verifyTaskCallback, verifyAccountEndpoint } from "../client/webhooks.js";

if (isMainModule(import.meta.url)) {
  // Honor HTTPS_PROXY the way curl in the same shell does; Node.js fetch alone would not.
  if (shouldRelaunchWithEnvProxy()) await relaunchWithEnvProxy();
  process.exitCode = await runCli();
}
