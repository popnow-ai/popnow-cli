import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { shouldRelaunchWithEnvProxy, supportsEnvProxy } from "../src/runtime/env-proxy.js";

const PROXY = "http://127.0.0.1:7890";
const SUPPORTED = "22.22.1";
const ENTRY = fileURLToPath(new URL("../dist/cli/index.js", import.meta.url));

describe("env proxy relaunch decision", () => {
  it("relaunches for an http(s) proxy on a runtime that can use it", () => {
    for (const env of [
      { HTTPS_PROXY: PROXY },
      { https_proxy: "https://proxy.internal:8443" },
      { HTTP_PROXY: PROXY },
      { http_proxy: PROXY, HTTPS_PROXY: "" },
    ]) {
      expect(shouldRelaunchWithEnvProxy({ env, execArgv: [], version: SUPPORTED })).toBe(true);
    }
  });

  it("does not relaunch when it would change nothing or break the start", () => {
    const cases: Array<[string, NodeJS.ProcessEnv, readonly string[], string]> = [
      ["no proxy at all", {}, [], SUPPORTED],
      ["empty proxy values", { HTTPS_PROXY: "", http_proxy: "" }, [], SUPPORTED],
      ["socks proxy", { HTTPS_PROXY: "socks5://127.0.0.1:7890" }, [], SUPPORTED],
      ["bare host:port", { HTTPS_PROXY: "127.0.0.1:7890" }, [], SUPPORTED],
      ["one usable, one not", { HTTPS_PROXY: PROXY, http_proxy: "socks5://h:1" }, [], SUPPORTED],
      ["already on", { HTTPS_PROXY: PROXY, NODE_USE_ENV_PROXY: "1" }, [], SUPPORTED],
      ["opted out", { HTTPS_PROXY: PROXY, NODE_USE_ENV_PROXY: "0" }, [], SUPPORTED],
      ["flag in execArgv", { HTTPS_PROXY: PROXY }, ["--use-env-proxy"], SUPPORTED],
      ["flag in NODE_OPTIONS", { HTTPS_PROXY: PROXY, NODE_OPTIONS: "--use-env-proxy" }, [], SUPPORTED],
      ["runtime too old", { HTTPS_PROXY: PROXY }, [], "22.20.0"],
    ];
    for (const [name, env, execArgv, version] of cases) {
      expect(shouldRelaunchWithEnvProxy({ env, execArgv, version }), name).toBe(false);
    }
  });

  it("knows env proxy support starts at Node.js 22.21 and 24.0", () => {
    expect(supportsEnvProxy("22.20.9")).toBe(false);
    expect(supportsEnvProxy("22.21.0")).toBe(true);
    expect(supportsEnvProxy("23.11.0")).toBe(false);
    expect(supportsEnvProxy("24.0.0")).toBe(true);
  });
});

/* A proxy that records where it was asked to tunnel and refuses, so nothing leaves the machine. */
async function recordingProxy(): Promise<{ server: Server; url: string; tunnels: string[] }> {
  const tunnels: string[] = [];
  const server = createServer((_request, response) => response.writeHead(405).end());
  server.on("connect", (request, socket) => {
    tunnels.push(request.url ?? "");
    socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${port}`, tunnels };
}

async function runBuiltCli(env: NodeJS.ProcessEnv): Promise<{ code: number | null; stderr: string }> {
  const child = spawn(process.execPath, [ENTRY, "--max-retries", "0", "balance"], {
    env: {
      PATH: process.env.PATH ?? "",
      POPNOW_API_KEY: "sk-popnow-envproxytest000000000000000000000000000000",
      // A reserved name: if the request ever went out directly it could not reach anyone.
      POPNOW_BASE_URL: "https://api.popnow.invalid",
      ...env,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
  const code = await new Promise<number | null>((resolve) => child.once("exit", resolve));
  return { code, stderr };
}

// These run the built CLI in a child process, so they need `npm run build` first (CI does that).
describe.skipIf(!supportsEnvProxy() || !existsSync(ENTRY))("built CLI behind a proxy", () => {
  it("sends its request through HTTPS_PROXY", async () => {
    const proxy = await recordingProxy();
    try {
      const { code, stderr } = await runBuiltCli({ HTTPS_PROXY: proxy.url });
      expect(proxy.tunnels).toEqual(["api.popnow.invalid:443"]);
      expect(code).toBe(1);
      expect(stderr).toMatch(/Error: could not reach/);
      expect(stderr).not.toMatch(/EnvHttpProxyAgent|UNDICI-EHPA/);
    } finally {
      proxy.server.close();
    }
  });

  it("stays off the proxy with NODE_USE_ENV_PROXY=0", async () => {
    const proxy = await recordingProxy();
    try {
      const { code } = await runBuiltCli({ HTTPS_PROXY: proxy.url, NODE_USE_ENV_PROXY: "0" });
      expect(proxy.tunnels).toEqual([]);
      expect(code).toBe(1);
    } finally {
      proxy.server.close();
    }
  });
});
