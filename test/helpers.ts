import { PopNowClient } from "../src/client/client.js";
import type { CliDependencies } from "../src/cli/program.js";
import type { CliIo } from "../src/cli/io.js";

export interface CapturedIo {
  io: CliIo;
  stdout: string[];
  stderr: string[];
  out: () => string;
  err: () => string;
  confirmations: string[];
  opened: string[];
}

export function captureIo(overrides: Partial<CliIo> = {}): CapturedIo {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const confirmations: string[] = [];
  const opened: string[] = [];
  return {
    stdout,
    stderr,
    confirmations,
    opened,
    out: () => stdout.join(""),
    err: () => stderr.join(""),
    io: {
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
      stdinIsTTY: false,
      readStdin: () => Promise.resolve(""),
      confirm: (message) => {
        confirmations.push(message);
        return Promise.resolve(false);
      },
      openUrl: (url) => {
        opened.push(url);
        return Promise.resolve(true);
      },
      env: { POPNOW_API_KEY: "sk-popnow-test" },
      ...overrides,
    },
  };
}

export interface RecordedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | undefined;
  rawBody: unknown;
  redirect: RequestRedirect | undefined;
}

export type Handler = (request: RecordedRequest) => Response | Promise<Response>;

/** A fetch that records every request and answers from a list of handlers, in order. */
export function mockFetch(handlers: Handler[] | Handler): {
  fetch: typeof fetch;
  requests: RecordedRequest[];
} {
  const requests: RecordedRequest[] = [];
  let index = 0;
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    const request: RecordedRequest = {
      method: init?.method ?? "GET",
      url,
      headers,
      body: typeof init?.body === "string" ? init.body : undefined,
      rawBody: init?.body,
      redirect: init?.redirect,
    };
    requests.push(request);
    const handler = Array.isArray(handlers) ? handlers[index++] : handlers;
    if (!handler) throw new Error(`unexpected request ${request.method} ${url}`);
    return handler(request);
  }) as typeof fetch;
  return { fetch: fetchImpl, requests };
}

export function envelope(data: unknown, init: ResponseInit = {}): Response {
  return Response.json({ code: 200, msg: "success", data, request_id: "req_test" }, init);
}

export function apiError(
  status: number,
  code: number,
  msg: string,
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Response {
  return Response.json({ code, msg, request_id: "req_err", ...extra }, { status, headers });
}

export const BASE = "http://127.0.0.1:4020";

export function deps(io: CliIo, fetchImpl: typeof fetch, retries = 0): CliDependencies {
  return {
    io,
    fetch: fetchImpl,
    createClient: (options) =>
      new PopNowClient({
        ...options,
        baseUrl: BASE,
        fetch: fetchImpl,
        maxRetries: options.maxRetries ?? retries,
        sleep: () => Promise.resolve(),
      }),
  };
}

export function argv(...args: string[]): string[] {
  return ["node", "popnow", ...args];
}
