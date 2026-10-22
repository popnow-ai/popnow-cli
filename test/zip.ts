import { crc32, deflateRawSync } from "node:zlib";

/** One entry of a test archive. Every field that a hostile archive could lie about is overridable. */
export interface ZipFileSpec {
  name: string;
  data?: string | Uint8Array;
  /** 0 = stored, 8 = deflate (default). Other values build an unsupported entry. */
  method?: number;
  /** Unix mode including the file type bits, for example 0o120777 for a symlink. */
  mode?: number;
  /** "Version made by"; the high byte is the host system (3 = Unix, 0 = DOS). */
  madeBy?: number;
  flags?: number;
  /** Uncompressed size written into the central directory, when it should lie. */
  declaredSize?: number;
  crc?: number;
}

/** Builds a ZIP archive in memory, the way common tools lay it out. */
export function buildZip(files: ZipFileSpec[]): Uint8Array<ArrayBuffer> {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const content = typeof file.data === "string" ? Buffer.from(file.data, "utf8") : Buffer.from(file.data ?? new Uint8Array(0));
    const method = file.method ?? 8;
    const body = method === 8 ? deflateRawSync(content) : content;
    const crc = file.crc ?? crc32(content);
    const size = file.declaredSize ?? content.byteLength;
    const flags = file.flags ?? 0x0800;
    const directory = file.name.endsWith("/");
    const mode = file.mode ?? (directory ? 0o040755 : 0o100644);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc >>> 0, 14);
    local.writeUInt32LE(body.byteLength, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.byteLength, 26);
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(file.madeBy ?? (3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc >>> 0, 16);
    central.writeUInt32LE(body.byteLength, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.byteLength, 28);
    central.writeUInt32LE((mode << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.byteLength + name.byteLength + body.byteLength;
  }
  const centralDirectory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.byteLength, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, centralDirectory, end]));
}

export const SKILL_MD = [
  "---",
  "name: popnow-demo",
  "description: Demo skill used by the tests.",
  "metadata:",
  '  version: "1.2.0"',
  "---",
  "",
  "# Demo",
  "",
].join("\n");

/** A valid archive for the slug `demo`. */
export function demoSkillZip(extra: ZipFileSpec[] = []): Uint8Array<ArrayBuffer> {
  return buildZip([
    { name: "popnow-demo/" },
    { name: "popnow-demo/SKILL.md", data: SKILL_MD },
    { name: "popnow-demo/scripts/run.py", data: "print('hello')\n", mode: 0o100755 },
    { name: "popnow-demo/references/notes.md", data: "Stored, not deflated.\n", method: 0 },
    ...extra,
  ]);
}
