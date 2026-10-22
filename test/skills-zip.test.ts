import { describe, expect, it } from "vitest";

import { verifySkillArchive, parseSkillFrontmatter } from "../src/skills/install.js";
import { SkillArchiveError, checkEntryName, readZipEntries, readZipEntryData } from "../src/skills/zip.js";
import { SKILL_MD, buildZip, demoSkillZip } from "./zip.js";

/* Archives made by other tools, so the reader is not only checked against the test builder. */
// Python zipfile, deflate, Unix modes, no extra fields.
const PYTHON_ZIP =
  "UEsDBBQAAAAAAAAAIQAAAAAAAAAAAAAAAAAMAAAAcG9wbm93LXJlYWwvUEsDBBQAAAAIAAAAVl1a0VTXSQAAAEoAAAAUAAAAcG9wbm93LXJlYWwvU0tJTEwubWTT1dXlykvMTbVSKMgvyMsv1y1KTczhKkstKs7Mz7NSMNAz1jPk0gUq4lJWCAJJcfkmpqQqJFUqBFSWZOTnKVRlFqRl5qTqcQEAUEsDBBQAAAAIAAAAVl0oTqPeFAAAABIAAAAaAAAAcG9wbm93LXJlYWwvc2NyaXB0cy9ydW4uc2hTVtRPyszTL87gSk3OyFfIz+YCAFBLAQIUAxQAAAAAAAAAIQAAAAAAAAAAAAAAAAAMAAAAAAAAAAAAEADtQQAAAABwb3Bub3ctcmVhbC9QSwECFAMUAAAACAAAAFZdWtFU10kAAABKAAAAFAAAAAAAAAAAAAAApIEqAAAAcG9wbm93LXJlYWwvU0tJTEwubWRQSwECFAMUAAAACAAAAFZdKE6j3hQAAAASAAAAGgAAAAAAAAAAAAAA7YGlAAAAcG9wbm93LXJlYWwvc2NyaXB0cy9ydW4uc2hQSwUGAAAAAAMAAwDEAAAA8QAAAAAA";
// Info-ZIP `zip -r`: local and central extra fields of different lengths, stored and deflated entries.
const INFOZIP_ZIP =
  "UEsDBAoAAAAAAA9cVl0AAAAAAAAAAAAAAAAPABwAcG9wbm93LWNsaS16aXAvVVQJAAPOg9lqzoPZanV4CwABBPUBAAAEAAAAAFBLAwQKAAAAAAAPXFZdAAAAAAAAAAAAAAAAEwAcAHBvcG5vdy1jbGktemlwL3N1Yi9VVAkAA86D2WrOg9lqdXgLAAEE9QEAAAQAAAAAUEsDBBQAAAAIAA9cVl1RzrIKCAAAAPQBAAAYABwAcG9wbm93LWNsaS16aXAvc3ViL2EudHh0VVQJAAPOg9lqzoPZanV4CwABBPUBAAAEAAAAAKuoGAUjDQAAUEsDBAoAAAAAAA9cVl1mm5MQIAAAACAAAAAXABwAcG9wbm93LWNsaS16aXAvU0tJTEwubWRVVAkAA86D2WrOg9lqdXgLAAEE9QEAAAQAAAAALS0tCm5hbWU6IHBvcG5vdy1jbGktemlwCi0tLQpoaQpQSwECHgMKAAAAAAAPXFZdAAAAAAAAAAAAAAAADwAYAAAAAAAAABAA7UEAAAAAcG9wbm93LWNsaS16aXAvVVQFAAPOg9lqdXgLAAEE9QEAAAQAAAAAUEsBAh4DCgAAAAAAD1xWXQAAAAAAAAAAAAAAABMAGAAAAAAAAAAQAO1BSQAAAHBvcG5vdy1jbGktemlwL3N1Yi9VVAUAA86D2Wp1eAsAAQT1AQAABAAAAABQSwECHgMUAAAACAAPXFZdUc6yCggAAAD0AQAAGAAYAAAAAAABAAAApIGWAAAAcG9wbm93LWNsaS16aXAvc3ViL2EudHh0VVQFAAPOg9lqdXgLAAEE9QEAAAQAAAAAUEsBAh4DCgAAAAAAD1xWXWabkxAgAAAAIAAAABcAGAAAAAAAAQAAAKSB8AAAAHBvcG5vdy1jbGktemlwL1NLSUxMLm1kVVQFAAPOg9lqdXgLAAEE9QEAAAQAAAAAUEsFBgAAAAAEAAQAaQEAAGEBAAAAAA==";

function fromBase64(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, "base64"));
}

function text(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

describe("ZIP reader", () => {
  it("reads stored and deflated entries and keeps the executable bit", () => {
    const zip = demoSkillZip();
    const entries = readZipEntries(zip);
    expect(entries.map((entry) => [entry.path, entry.directory])).toEqual([
      ["popnow-demo", true],
      ["popnow-demo/SKILL.md", false],
      ["popnow-demo/scripts/run.py", false],
      ["popnow-demo/references/notes.md", false],
    ]);
    const byPath = new Map(entries.map((entry) => [entry.path, entry]));
    expect(text(readZipEntryData(zip, byPath.get("popnow-demo/SKILL.md")!))).toBe(SKILL_MD);
    expect(text(readZipEntryData(zip, byPath.get("popnow-demo/references/notes.md")!))).toBe("Stored, not deflated.\n");
    expect(byPath.get("popnow-demo/scripts/run.py")!.executable).toBe(true);
    expect(byPath.get("popnow-demo/SKILL.md")!.executable).toBe(false);
  });

  it("reads an archive written by Python's zipfile", () => {
    const zip = fromBase64(PYTHON_ZIP);
    const archive = verifySkillArchive(zip, "real");
    expect(archive.frontmatter).toMatchObject({ name: "popnow-real", version: "0.3.1" });
    const script = archive.entries.find((entry) => entry.path === "popnow-real/scripts/run.sh")!;
    expect(script.executable).toBe(true);
    expect(text(readZipEntryData(zip, script))).toBe("#!/bin/sh\necho ok\n");
  });

  it("reads an archive written by Info-ZIP, whose local headers carry their own extra fields", () => {
    const zip = fromBase64(INFOZIP_ZIP);
    const archive = verifySkillArchive(zip, "cli-zip");
    expect(archive.frontmatter.name).toBe("popnow-cli-zip");
    const big = archive.entries.find((entry) => entry.path === "popnow-cli-zip/sub/a.txt")!;
    expect(text(readZipEntryData(zip, big))).toBe("x".repeat(500));
  });

  it("refuses data that is not a ZIP", () => {
    expect(() => readZipEntries(new TextEncoder().encode("<html>not a zip</html>"))).toThrow(SkillArchiveError);
    expect(() => readZipEntries(new Uint8Array(4))).toThrow(/too short/);
  });

  it.each([
    ["../evil.txt", /outside its folder/],
    ["popnow-demo/../../evil.txt", /outside its folder/],
    ["/etc/passwd", /absolute path/],
    ["C:/Windows/evil.txt", /absolute path/],
    ["popnow-demo\\..\\evil.txt", /backslash/],
    ["popnow-demo//SKILL.md", /empty or "\." path segment/],
    ["popnow-demo/./SKILL.md", /empty or "\." path segment/],
    ["popnow-demo/NUL.txt", /portable/],
    ["popnow-demo/trailing. ", /portable/],
  ])("refuses the entry name %s", (name, message) => {
    expect(() => checkEntryName(name)).toThrow(message);
    expect(() => readZipEntries(buildZip([{ name, data: "x" }]))).toThrow(SkillArchiveError);
  });

  it("refuses symbolic links and device files", () => {
    const link = buildZip([{ name: "popnow-demo/link", data: "/etc/passwd", mode: 0o120777, method: 0 }]);
    expect(() => readZipEntries(link)).toThrow(/symbolic link/);
    const fifo = buildZip([{ name: "popnow-demo/pipe", data: "", mode: 0o010644 }]);
    expect(() => readZipEntries(fifo)).toThrow(/not a regular file/);
  });

  it("ignores Unix mode bits written by a DOS host", () => {
    const zip = buildZip([{ name: "popnow-demo/file", data: "x", mode: 0o120777, madeBy: 20 }]);
    expect(readZipEntries(zip)[0]!.executable).toBe(false);
  });

  it("refuses duplicate names, including names that differ only in case", () => {
    expect(() => readZipEntries(buildZip([{ name: "a/b.txt" }, { name: "a/b.txt" }]))).toThrow(/more than once/);
    expect(() => readZipEntries(buildZip([{ name: "a/B.txt" }, { name: "a/b.txt" }]))).toThrow(/more than once/);
    expect(() => readZipEntries(buildZip([{ name: "a/b", data: "x" }, { name: "a/b/c", data: "y" }]))).toThrow(
      /both a file and a folder/,
    );
  });

  it("refuses encrypted entries and compression methods other than stored and deflate", () => {
    expect(() => readZipEntries(buildZip([{ name: "a/b", data: "x", flags: 0x0801 }]))).toThrow(/encrypted/);
    expect(() => readZipEntries(buildZip([{ name: "a/b", data: "x", method: 12 }]))).toThrow(/method 12/);
  });

  it("enforces the unpacked size cap from the central directory", () => {
    const zip = buildZip([{ name: "a/b", data: "x".repeat(2048) }]);
    expect(() => readZipEntries(zip, { maxUnpackedBytes: 1024 })).toThrow(/more than 1024 bytes/);
    expect(() => readZipEntries(zip, { maxEntries: 0 })).toThrow(/entries/);
  });

  it("stops an entry that inflates past its declared size, and catches CRC mismatches", () => {
    const bomb = buildZip([{ name: "a/b", data: "x".repeat(100_000), declaredSize: 10 }]);
    const entry = readZipEntries(bomb)[0]!;
    expect(() => readZipEntryData(bomb, entry)).toThrow(SkillArchiveError);
    const corrupt = buildZip([{ name: "a/b", data: "hello", crc: 1234 }]);
    expect(() => readZipEntryData(corrupt, readZipEntries(corrupt)[0]!)).toThrow(/CRC-32/);
  });
});

describe("skill archive layout", () => {
  it("accepts one popnow-<slug>/ folder with a SKILL.md and reads its version", () => {
    const archive = verifySkillArchive(demoSkillZip(), "demo");
    expect(archive.folder).toBe("popnow-demo");
    expect(archive.frontmatter).toEqual({
      name: "popnow-demo",
      description: "Demo skill used by the tests.",
      version: "1.2.0",
    });
  });

  it("refuses several top folders", () => {
    const zip = demoSkillZip([{ name: "other/readme.md", data: "x" }]);
    expect(() => verifySkillArchive(zip, "demo")).toThrow(/exactly one top folder/);
  });

  it("refuses a top folder that does not match the slug", () => {
    expect(() => verifySkillArchive(demoSkillZip(), "video")).toThrow(/expected "popnow-video"/);
  });

  it("refuses an archive without SKILL.md, or with it in the wrong place", () => {
    const missing = buildZip([{ name: "popnow-demo/README.md", data: "x" }]);
    expect(() => verifySkillArchive(missing, "demo")).toThrow(/no popnow-demo\/SKILL\.md/);
    const nested = buildZip([{ name: "popnow-demo/sub/SKILL.md", data: SKILL_MD }]);
    expect(() => verifySkillArchive(nested, "demo")).toThrow(/no popnow-demo\/SKILL\.md/);
  });

  it("refuses a top-level file named like the folder", () => {
    expect(() => verifySkillArchive(buildZip([{ name: "popnow-demo", data: "x" }]), "demo")).toThrow(SkillArchiveError);
  });
});

describe("SKILL.md frontmatter", () => {
  it("reads a top-level version and quoted values, and ignores block scalars", () => {
    expect(
      parseSkillFrontmatter('---\r\nname: "popnow-x"\r\ndescription: >\r\n  long text\r\nversion: 2.0.0\r\n---\r\nbody'),
    ).toEqual({ name: "popnow-x", version: "2.0.0" });
  });

  it("returns nothing for a file without frontmatter", () => {
    expect(parseSkillFrontmatter("# Just a heading\nversion: 1\n")).toEqual({});
  });
});
