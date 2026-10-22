import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runCli } from "../src/cli/program.js";
import { describeInstallHints, normalizeSkill, skillList } from "../src/cli/skills.js";
import { AGENTS, detectAgents, findAgent, skillsDirectory } from "../src/skills/agents.js";
import { BASE, apiError, argv, captureIo, deps, envelope, mockFetch, type Handler } from "./helpers.js";
import { buildZip, demoSkillZip } from "./zip.js";

const SIGNED = "https://storage.example.com/skills/popnow-demo.zip?signature=abc";
const SKILL = {
  slug: "demo",
  name: "PopNow demo",
  summary: "Makes a demo clip.",
  type: "video",
  tasks: ["text-to-video"],
  popnow: ["minimax/h3/text-to-video"],
  requires: ["POPNOW_API_KEY"],
  version: "1.2.0",
  updated: "2026-10-22",
  url: "https://popnow.ai/skills/demo",
  distribution: "zip",
};

let home: string;
let project: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "popnow-home-"));
  project = await mkdtemp(join(tmpdir(), "popnow-project-"));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
  await rm(project, { recursive: true, force: true });
});

function skillDeps(io: Parameters<typeof deps>[0], fetchImpl: typeof fetch) {
  return { ...deps(io, fetchImpl), homeDir: home, cwd: project };
}

/** The API redirects to a signed link, and the link serves the archive. */
function downloadHandlers(zip: Uint8Array<ArrayBuffer> = demoSkillZip()): Handler[] {
  return [
    () => new Response(null, { status: 302, headers: { Location: SIGNED } }),
    () => new Response(zip, { headers: { "Content-Type": "application/zip" } }),
  ];
}

describe("agents", () => {
  it("knows the six agents and their folders", () => {
    expect(AGENTS.map((agent) => agent.id)).toEqual([
      "claude-code",
      "codex",
      "cursor",
      "gemini-cli",
      "github-copilot",
      "opencode",
    ]);
    const where = { homeDir: "/h", cwd: "/p" };
    const dir = (id: string, scope: "user" | "project") =>
      skillsDirectory(findAgent(id)!, scope, where).split("\\").join("/");
    expect(dir("claude-code", "user")).toBe("/h/.claude/skills");
    expect(dir("codex", "user")).toBe("/h/.agents/skills");
    expect(dir("codex", "project")).toBe("/p/.agents/skills");
    expect(dir("cursor", "project")).toBe("/p/.cursor/skills");
    expect(dir("gemini-cli", "user")).toBe("/h/.gemini/skills");
    expect(dir("github-copilot", "user")).toBe("/h/.copilot/skills");
    expect(dir("github-copilot", "project")).toBe("/p/.github/skills");
    expect(dir("opencode", "user")).toBe("/h/.config/opencode/skills");
    expect(dir("opencode", "project")).toBe("/p/.opencode/skills");
    expect(findAgent("claude")?.id).toBe("claude-code");
    expect(findAgent("Copilot")?.id).toBe("github-copilot");
    expect(findAgent("nope")).toBeUndefined();
  });

  it("detects agents from their home folders", async () => {
    const where = { homeDir: home, cwd: project };
    expect(detectAgents(where, false)).toEqual([]);
    await mkdir(join(home, ".claude"));
    expect(detectAgents(where, false).map((agent) => agent.id)).toEqual(["claude-code"]);
    await mkdir(join(home, ".codex"));
    await mkdir(join(home, ".config", "opencode"), { recursive: true });
    expect(detectAgents(where, false).map((agent) => agent.id)).toEqual(["claude-code", "codex", "opencode"]);
  });

  it("prefers project folders with --project, but ignores a bare .github folder", async () => {
    const where = { homeDir: home, cwd: project };
    await mkdir(join(home, ".claude"));
    await mkdir(join(project, ".github", "workflows"), { recursive: true });
    expect(detectAgents(where, true).map((agent) => agent.id)).toEqual(["claude-code"]);
    await writeFile(join(project, ".github", "copilot-instructions.md"), "x");
    expect(detectAgents(where, true).map((agent) => agent.id)).toEqual(["github-copilot"]);
  });
});

describe("skills search and info", () => {
  it("passes the query and filters, and does not require a key", async () => {
    const c = captureIo({ env: {} });
    const m = mockFetch([() => envelope({ items: [SKILL] })]);
    expect(await runCli(argv("skills", "search", "product", "video", "--type", "video", "--task", "text-to-video"), skillDeps(c.io, m.fetch))).toBe(0);
    const url = new URL(m.requests[0]!.url);
    expect(`${url.origin}${url.pathname}`).toBe(`${BASE}/api/v1/agent-skills`);
    expect(Object.fromEntries(url.searchParams)).toEqual({ q: "product video", type: "video", task: "text-to-video" });
    expect(m.requests[0]!.headers.authorization).toBeUndefined();
    expect(c.out()).toContain("demo  PopNow demo (video, v1.2.0)");
    expect(c.out()).toContain("Makes a demo clip.");
    expect(c.out()).toContain("popnow skills add <slug>");
  });

  it("sends the key when there is one and prints the raw data under --json", async () => {
    const c = captureIo();
    const m = mockFetch([() => envelope([SKILL])]);
    expect(await runCli(argv("--json", "skills", "search"), skillDeps(c.io, m.fetch))).toBe(0);
    expect(m.requests[0]!.url).toBe(`${BASE}/api/v1/agent-skills`);
    expect(m.requests[0]!.headers.authorization).toBe("Bearer sk-popnow-test");
    expect(JSON.parse(c.out())).toEqual([SKILL]);
  });

  it("says so when nothing matched", async () => {
    const c = captureIo();
    const m = mockFetch([() => envelope({ skills: [] })]);
    expect(await runCli(argv("skills", "search", "zzz"), skillDeps(c.io, m.fetch))).toBe(0);
    expect(c.out()).toContain('No skills matched "zzz"');
  });

  it("shows one skill with its install hints", async () => {
    const c = captureIo();
    const m = mockFetch([
      () =>
        envelope({
          skill: SKILL,
          install: { "claude-code": { path: "~/.claude/skills/popnow-demo", invoke: "/popnow-demo" } },
        }),
    ]);
    expect(await runCli(argv("skills", "info", "demo"), skillDeps(c.io, m.fetch))).toBe(0);
    expect(m.requests[0]!.url).toBe(`${BASE}/api/v1/agent-skills/demo`);
    const out = c.out();
    expect(out).toContain("PopNow demo (demo)");
    expect(out).toContain("Uses on PopNow: minimax/h3/text-to-video");
    expect(out).toContain("Requires: POPNOW_API_KEY");
    expect(out).toContain("Version: 1.2.0");
    expect(out).toContain("claude-code: path: ~/.claude/skills/popnow-demo; invoke: /popnow-demo");
    expect(out).toContain("Install: popnow skills add demo");
  });

  it("points an unknown slug at `skills search`", async () => {
    const c = captureIo();
    const m = mockFetch([() => apiError(404, 404, "skill not found")]);
    expect(await runCli(argv("skills", "info", "nope"), skillDeps(c.io, m.fetch))).toBe(1);
    expect(c.err()).toContain("Error: skill not found");
    expect(c.err()).toContain("popnow skills search");
    expect(c.err()).not.toContain("Model IDs");
  });

  it("refuses a slug that could name a path before any request", async () => {
    const c = captureIo();
    const m = mockFetch([]);
    expect(await runCli(argv("skills", "info", "../etc"), skillDeps(c.io, m.fetch))).toBe(1);
    expect(m.requests).toHaveLength(0);
    expect(c.err()).toContain("is not a skill slug");
  });

  it("normalizes the shapes the catalog may answer with", () => {
    expect(skillList([SKILL, { name: "no slug" }])).toEqual([SKILL]);
    expect(skillList({ results: [SKILL] })).toEqual([SKILL]);
    expect(skillList("nonsense")).toEqual([]);
    expect(normalizeSkill({ skill: SKILL, install: ["x"] })).toEqual({ ...SKILL, install: ["x"] });
    expect(normalizeSkill([SKILL])).toBeUndefined();
    expect(describeInstallHints([{ agent: "codex", command: "popnow skills add demo --agent codex" }])).toEqual([
      "codex: command: popnow skills add demo --agent codex",
    ]);
    expect(describeInstallHints(undefined)).toEqual([]);
  });
});

describe("skills download", () => {
  it("follows the redirect by hand and never sends the key to the signed link", async () => {
    const c = captureIo();
    const m = mockFetch(downloadHandlers());
    expect(await runCli(argv("skills", "add", "demo", "--agent", "claude-code"), skillDeps(c.io, m.fetch))).toBe(0);
    expect(m.requests).toHaveLength(2);
    expect(m.requests[0]!.url).toBe(`${BASE}/api/v1/agent-skills/demo/download`);
    expect(m.requests[0]!.headers.authorization).toBe("Bearer sk-popnow-test");
    expect(m.requests[0]!.redirect).toBe("manual");
    expect(m.requests[1]!.url).toBe(SIGNED);
    expect(m.requests[1]!.headers.authorization).toBeUndefined();
  });

  it("also accepts the archive in the response itself, or a link in a JSON envelope", async () => {
    const direct = captureIo();
    const zip = demoSkillZip();
    const m1 = mockFetch([() => new Response(zip, { headers: { "Content-Type": "application/zip" } })]);
    expect(await runCli(argv("skills", "add", "demo", "--agent", "codex"), skillDeps(direct.io, m1.fetch))).toBe(0);
    expect(existsSync(join(home, ".agents", "skills", "popnow-demo", "SKILL.md"))).toBe(true);

    const linked = captureIo();
    const m2 = mockFetch([() => envelope({ url: SIGNED, expiresAt: "2026-10-22T00:05:00Z" }), ...downloadHandlers().slice(1)]);
    expect(await runCli(argv("skills", "add", "demo", "--agent", "cursor"), skillDeps(linked.io, m2.fetch))).toBe(0);
    expect(m2.requests[1]!.url).toBe(SIGNED);
    expect(m2.requests[1]!.headers.authorization).toBeUndefined();
  });

  it("requires a key before detecting agents or downloading", async () => {
    const c = captureIo({ env: {} });
    const m = mockFetch([]);
    expect(await runCli(argv("skills", "add", "demo"), skillDeps(c.io, m.fetch))).toBe(1);
    expect(m.requests).toHaveLength(0);
    expect(c.err()).toContain("POPNOW_API_KEY is required");
  });

  it("explains a 401 from the download", async () => {
    const c = captureIo({ env: { POPNOW_API_KEY: "sk-popnow-revoked" } });
    const m = mockFetch([() => apiError(401, 401, "Credentials are invalid or expired")]);
    expect(await runCli(argv("skills", "add", "demo", "--agent", "codex"), skillDeps(c.io, m.fetch))).toBe(1);
    expect(c.err()).toContain("Credentials are invalid or expired");
    expect(c.err()).toContain("revoked, expired or mistyped");
    expect(existsSync(join(home, ".agents", "skills", "popnow-demo"))).toBe(false);
  });

  it("explains a 404 from the download as an unknown skill", async () => {
    const c = captureIo();
    const m = mockFetch([() => apiError(404, 404, "skill not found")]);
    expect(await runCli(argv("--json", "skills", "add", "nope", "--agent", "codex"), skillDeps(c.io, m.fetch))).toBe(1);
    expect(JSON.parse(c.err())).toMatchObject({ status: 404, reason: "unknown_skill" });
  });

  it("retries a 429 after Retry-After, then explains it when it persists", async () => {
    const c = captureIo();
    const limited = () => apiError(429, 429, "Too many requests", {}, { "Retry-After": "7" });
    const m = mockFetch([limited, limited]);
    const code = await runCli(argv("skills", "add", "demo", "--agent", "codex"), {
      ...deps(c.io, m.fetch, 1),
      homeDir: home,
      cwd: project,
    });
    expect(code).toBe(1);
    expect(m.requests).toHaveLength(2);
    expect(c.err()).toContain("Too many requests");
    expect(c.err()).toContain("retry in 7s (Retry-After)");
  });

  it("reports an expired signed link without installing anything", async () => {
    const c = captureIo();
    const m = mockFetch([
      () => new Response(null, { status: 302, headers: { Location: SIGNED } }),
      () => new Response("<Error>AccessDenied</Error>", { status: 403 }),
    ]);
    expect(await runCli(argv("skills", "add", "demo", "--agent", "codex"), skillDeps(c.io, m.fetch))).toBe(1);
    expect(c.err()).toContain("download link answered HTTP 403");
    expect(c.err()).toContain("fresh link");
    expect(existsSync(join(home, ".agents", "skills"))).toBe(false);
  });

  it("refuses an archive that declares more than the size cap", async () => {
    const c = captureIo();
    const m = mockFetch([
      () => new Response(null, { status: 302, headers: { Location: SIGNED } }),
      () => new Response("x", { headers: { "Content-Length": String(200 * 1024 * 1024) } }),
    ]);
    expect(await runCli(argv("skills", "add", "demo", "--agent", "codex"), skillDeps(c.io, m.fetch))).toBe(1);
    expect(c.err()).toContain("the limit is 104857600");
  });

  it("refuses an unsafe archive and leaves no files behind", async () => {
    const c = captureIo();
    const evil = buildZip([
      { name: "popnow-demo/SKILL.md", data: "---\nname: popnow-demo\n---\n" },
      { name: "popnow-demo/../../escape.txt", data: "x" },
    ]);
    const m = mockFetch(downloadHandlers(evil));
    expect(await runCli(argv("skills", "add", "demo", "--agent", "codex"), skillDeps(c.io, m.fetch))).toBe(1);
    expect(c.err()).toContain("points outside its folder");
    expect(c.err()).toContain("nothing was installed");
    expect(existsSync(join(home, "escape.txt"))).toBe(false);
    expect(existsSync(join(home, ".agents", "skills", "popnow-demo"))).toBe(false);
  });
});

describe("skills add", () => {
  it("installs into the agent's user folder and says how to invoke the skill", async () => {
    const c = captureIo();
    const m = mockFetch(downloadHandlers());
    expect(await runCli(argv("skills", "add", "demo", "--agent", "claude-code"), skillDeps(c.io, m.fetch))).toBe(0);
    const folder = join(home, ".claude", "skills", "popnow-demo");
    expect(await readFile(join(folder, "SKILL.md"), "utf8")).toContain("name: popnow-demo");
    expect(await readFile(join(folder, "references", "notes.md"), "utf8")).toBe("Stored, not deflated.\n");
    if (process.platform !== "win32") {
      expect((await stat(join(folder, "scripts", "run.py"))).mode & 0o111).not.toBe(0);
    }
    const out = c.out();
    expect(out).toContain(`Installed popnow-demo 1.2.0 for Claude Code: ${folder}`);
    expect(out).toContain("type /popnow-demo");
    expect(out).toContain("quote the price in credits before any paid generation");
  });

  it("uses the $name syntax for Codex and the project folder with --project", async () => {
    const c = captureIo();
    const m = mockFetch(downloadHandlers());
    expect(await runCli(argv("skills", "add", "demo", "--agent", "codex", "--project"), skillDeps(c.io, m.fetch))).toBe(0);
    expect(existsSync(join(project, ".agents", "skills", "popnow-demo", "SKILL.md"))).toBe(true);
    expect(c.out()).toContain("type $popnow-demo");
  });

  it("installs into --dir", async () => {
    const c = captureIo();
    const m = mockFetch(downloadHandlers());
    expect(await runCli(argv("skills", "add", "demo", "--dir", "custom/skills"), skillDeps(c.io, m.fetch))).toBe(0);
    expect(existsSync(join(project, "custom", "skills", "popnow-demo", "SKILL.md"))).toBe(true);
    expect(c.out()).toContain("ask for it by name");
  });

  it("detects the only installed agent", async () => {
    await mkdir(join(home, ".gemini"));
    const c = captureIo();
    const m = mockFetch(downloadHandlers());
    expect(await runCli(argv("skills", "add", "demo"), skillDeps(c.io, m.fetch))).toBe(0);
    expect(existsSync(join(home, ".gemini", "skills", "popnow-demo", "SKILL.md"))).toBe(true);
    expect(c.err()).toContain("Agent: Gemini CLI (detected");
  });

  it("asks which agent at a terminal when several are installed", async () => {
    await mkdir(join(home, ".claude"));
    await mkdir(join(home, ".cursor"));
    const questions: string[] = [];
    const c = captureIo({
      stdinIsTTY: true,
      ask: (question) => {
        questions.push(question);
        return Promise.resolve("2");
      },
    });
    const m = mockFetch(downloadHandlers());
    expect(await runCli(argv("skills", "add", "demo"), skillDeps(c.io, m.fetch))).toBe(0);
    expect(questions[0]).toContain("1. Claude Code (claude-code)");
    expect(questions[0]).toContain("2. Cursor (cursor)");
    expect(existsSync(join(home, ".cursor", "skills", "popnow-demo", "SKILL.md"))).toBe(true);
  });

  it("requires --agent without a terminal when several agents are installed", async () => {
    await mkdir(join(home, ".claude"));
    await mkdir(join(home, ".codex"));
    const c = captureIo();
    const m = mockFetch([]);
    expect(await runCli(argv("skills", "add", "demo"), skillDeps(c.io, m.fetch))).toBe(1);
    expect(m.requests).toHaveLength(0);
    expect(c.err()).toContain("several coding agents found (claude-code, codex); pass --agent <id>");
  });

  it("requires --agent when no agent is installed", async () => {
    const c = captureIo();
    expect(await runCli(argv("skills", "add", "demo"), skillDeps(c.io, mockFetch([]).fetch))).toBe(1);
    expect(c.err()).toContain("no supported coding agent found");
  });

  it("refuses to overwrite without --force, before downloading", async () => {
    const existing = join(home, ".claude", "skills", "popnow-demo");
    await mkdir(existing, { recursive: true });
    await writeFile(join(existing, "SKILL.md"), "---\nname: popnow-demo\nversion: 0.9.0\n---\n");
    const c = captureIo();
    const m = mockFetch([]);
    expect(await runCli(argv("skills", "add", "demo", "--agent", "claude"), skillDeps(c.io, m.fetch))).toBe(1);
    expect(m.requests).toHaveLength(0);
    expect(c.err()).toContain("Pass --force to replace it");
    expect(await readFile(join(existing, "SKILL.md"), "utf8")).toContain("0.9.0");
  });

  it("replaces an installed copy with --force and drops files the new version no longer has", async () => {
    const existing = join(home, ".claude", "skills", "popnow-demo");
    await mkdir(existing, { recursive: true });
    await writeFile(join(existing, "SKILL.md"), "---\nname: popnow-demo\nversion: 0.9.0\n---\n");
    await writeFile(join(existing, "stale.txt"), "old");
    const c = captureIo();
    const m = mockFetch(downloadHandlers());
    expect(await runCli(argv("skills", "add", "demo", "--agent", "claude", "--force"), skillDeps(c.io, m.fetch))).toBe(0);
    expect(await readFile(join(existing, "SKILL.md"), "utf8")).toContain('version: "1.2.0"');
    expect(existsSync(join(existing, "stale.txt"))).toBe(false);
    expect(c.out()).toContain("Replaced popnow-demo 1.2.0");
  });

  it("changes nothing with --dry-run", async () => {
    const c = captureIo({ env: {} });
    const m = mockFetch([]);
    expect(
      await runCli(argv("--json", "skills", "add", "demo", "video", "--agent", "opencode", "--dry-run"), skillDeps(c.io, m.fetch)),
    ).toBe(0);
    expect(m.requests).toHaveLength(0);
    expect(existsSync(join(home, ".config"))).toBe(false);
    const plan = JSON.parse(c.out());
    expect(plan.dryRun).toBe(true);
    expect(plan.skills.map((row: { slug: string; action: string }) => [row.slug, row.action])).toEqual([
      ["demo", "install"],
      ["video", "install"],
    ]);
    expect(plan.skills[0].path).toBe(join(home, ".config", "opencode", "skills", "popnow-demo"));
  });

  it("prints machine-readable results under --json", async () => {
    const c = captureIo();
    const m = mockFetch(downloadHandlers());
    expect(await runCli(argv("--json", "skills", "add", "demo", "--agent", "codex"), skillDeps(c.io, m.fetch))).toBe(0);
    const [result] = JSON.parse(c.out());
    expect(result).toMatchObject({
      slug: "demo",
      agent: "codex",
      scope: "user",
      name: "popnow-demo",
      version: "1.2.0",
      replaced: false,
      files: 3,
      path: join(home, ".agents", "skills", "popnow-demo"),
    });
  });
});

describe("skills list-installed and remove", () => {
  async function installFake(dir: string, folder: string, version?: string): Promise<string> {
    const path = join(dir, folder);
    await mkdir(path, { recursive: true });
    await writeFile(join(path, "SKILL.md"), `---\nname: ${folder}\n${version ? `version: ${version}\n` : ""}---\n`);
    return path;
  }

  it("lists popnow-* skills with versions across agents and scopes", async () => {
    await installFake(join(home, ".claude", "skills"), "popnow-video", "1.0.0");
    await installFake(join(home, ".claude", "skills"), "someone-else");
    await installFake(join(project, ".cursor", "skills"), "popnow-image");
    await mkdir(join(home, ".agents", "skills", "popnow-broken"), { recursive: true });
    const c = captureIo();
    expect(await runCli(argv("--json", "skills", "list-installed"), skillDeps(c.io, mockFetch([]).fetch))).toBe(0);
    const found = JSON.parse(c.out()) as Array<Record<string, unknown>>;
    expect(found.map((skill) => [skill.folder, skill.version ?? null, skill.agents, skill.scope, skill.valid])).toEqual([
      ["popnow-video", "1.0.0", ["claude-code"], "user", true],
      ["popnow-broken", null, ["codex"], "user", false],
      ["popnow-image", null, ["cursor"], "project", true],
    ]);

    const human = captureIo();
    expect(await runCli(argv("skills", "list-installed", "--agent", "claude-code"), skillDeps(human.io, mockFetch([]).fetch))).toBe(0);
    expect(human.out()).toContain("popnow-video 1.0.0  claude-code, your user folder");
    expect(human.out()).not.toContain("popnow-image");
  });

  it("says so when nothing is installed", async () => {
    const c = captureIo();
    expect(await runCli(argv("skills", "list-installed"), skillDeps(c.io, mockFetch([]).fetch))).toBe(0);
    expect(c.out()).toContain("No PopNow skills are installed");
  });

  it("asks before removing, and refuses without a terminal unless --yes", async () => {
    const path = await installFake(join(home, ".claude", "skills"), "popnow-video");
    const refused = captureIo();
    expect(await runCli(argv("skills", "remove", "video"), skillDeps(refused.io, mockFetch([]).fetch))).toBe(1);
    expect(refused.err()).toContain("destructive command requires an interactive confirmation or --yes");
    expect(existsSync(path)).toBe(true);

    const declined = captureIo({ stdinIsTTY: true });
    expect(await runCli(argv("skills", "remove", "video"), skillDeps(declined.io, mockFetch([]).fetch))).toBe(1);
    expect(declined.confirmations[0]).toContain(path);
    expect(existsSync(path)).toBe(true);

    const c = captureIo();
    expect(await runCli(argv("skills", "remove", "popnow-video", "--yes"), skillDeps(c.io, mockFetch([]).fetch))).toBe(0);
    expect(c.out()).toContain(`Removed ${path}`);
    expect(existsSync(path)).toBe(false);
  });

  it("asks which copy when the skill is installed for several agents", async () => {
    await installFake(join(home, ".claude", "skills"), "popnow-video");
    const codexCopy = await installFake(join(home, ".agents", "skills"), "popnow-video");
    const c = captureIo();
    expect(await runCli(argv("skills", "remove", "video", "--yes"), skillDeps(c.io, mockFetch([]).fetch))).toBe(1);
    expect(c.err()).toContain("installed in several places");
    expect(c.err()).toContain("Pass --agent <id>");

    const picked = captureIo();
    expect(await runCli(argv("skills", "remove", "video", "--agent", "codex", "--yes"), skillDeps(picked.io, mockFetch([]).fetch))).toBe(0);
    expect(existsSync(codexCopy)).toBe(false);
    expect(existsSync(join(home, ".claude", "skills", "popnow-video"))).toBe(true);
  });

  it("removes a symlinked skill as a link and leaves its target alone", async () => {
    if (process.platform === "win32") return;
    const target = await installFake(join(project, "src"), "popnow-video");
    await mkdir(join(home, ".claude", "skills"), { recursive: true });
    await symlink(target, join(home, ".claude", "skills", "popnow-video"));
    const c = captureIo();
    expect(await runCli(argv("skills", "remove", "video", "--agent", "claude-code", "--yes"), skillDeps(c.io, mockFetch([]).fetch))).toBe(0);
    expect(existsSync(join(home, ".claude", "skills", "popnow-video"))).toBe(false);
    expect(existsSync(join(target, "SKILL.md"))).toBe(true);
  });

  it("reports a skill that is not installed", async () => {
    const c = captureIo();
    expect(await runCli(argv("skills", "remove", "video", "--yes"), skillDeps(c.io, mockFetch([]).fetch))).toBe(1);
    expect(c.err()).toContain("popnow-video is not installed");
  });
});
