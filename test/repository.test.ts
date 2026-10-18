import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "coverage"]);

/** Tracked files when this is a git checkout, otherwise every file outside build output. */
function repositoryFiles(): string[] {
  try {
    const out = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" });
    const tracked = out.split("\0").filter(Boolean);
    if (tracked.length > 0) return tracked;
  } catch {
    // Not a git checkout (for example an unpacked tarball): walk the tree instead.
  }
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (SKIP_DIRS.has(name)) continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else files.push(relative(ROOT, path));
    }
  };
  walk(ROOT);
  return files;
}

function textFiles(): Array<{ file: string; text: string }> {
  return repositoryFiles()
    .filter((file) => !/\.(png|jpe?g|webp|gif|ico)$/i.test(file) && file !== "package-lock.json")
    .map((file) => ({ file, text: readFileSync(join(ROOT, file), "utf8") }));
}

describe("repository hygiene", () => {
  const files = textFiles();

  it("reads enough files for the scans below to mean anything", () => {
    // A counter-check: a scan that silently read nothing would always pass.
    expect(files.length).toBeGreaterThanOrEqual(20);
    expect(files.some(({ file }) => file === "src/cli/program.ts")).toBe(true);
  });

  it("contains no CJK characters, so every file reads the same to every contributor", () => {
    const cjk = new RegExp("[\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]");
    expect(files.filter(({ text }) => cjk.test(text)).map(({ file }) => file)).toEqual([]);
  });

  it("names no third-party model hosts or other services", () => {
    // Assembled from parts so this file does not match its own scan.
    const names = [["wave", "speed"], ["atlas", "cloud"], ["kie", "\\.ai"], ["sp", "icy"], ["replic", "ate\\.com"], ["fal", "\\.ai"]];
    const pattern = new RegExp(names.map((parts) => parts.join("")).join("|"), "i");
    expect(files.filter(({ text }) => pattern.test(text)).map(({ file }) => file)).toEqual([]);
  });

  it("never ships a real-looking API key", () => {
    const key = /sk-popnow-[0-9a-f]{48}/;
    expect(files.filter(({ text }) => key.test(text)).map(({ file }) => file)).toEqual([]);
  });
});
