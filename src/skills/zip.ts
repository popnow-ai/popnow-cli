import { crc32, inflateRawSync } from "node:zlib";

/*
 * A small, strict ZIP reader for skill archives. It reads the central directory, never trusts the
 * local headers for sizes, supports only "stored" and "deflate" entries, and refuses anything an
 * extractor could be tricked by: absolute paths, `..`, backslashes, symlinks and device files,
 * duplicate names, encrypted or ZIP64 entries, and archives that inflate past a size cap.
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_MIN_LENGTH = 22;
const MAX_COMMENT_LENGTH = 0xffff;

const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

const FLAG_ENCRYPTED = 0x0001;
const FLAG_UTF8 = 0x0800;

const UNIX_HOST = 3;
const S_IFMT = 0o170000;
const S_IFREG = 0o100000;
const S_IFDIR = 0o040000;
const S_IFLNK = 0o120000;

/** About 100 MB unpacked: far above any skill, far below what fills a disk. */
export const DEFAULT_MAX_UNPACKED_BYTES = 100 * 1024 * 1024;
export const DEFAULT_MAX_ENTRIES = 10_000;

/** The archive is not a ZIP this client accepts. Nothing has been written when it is thrown. */
export class SkillArchiveError extends Error {
  override readonly name = "SkillArchiveError";
}

export interface ZipEntry {
  /** Path inside the archive, with `/` separators and no trailing slash. */
  path: string;
  /** Path segments of `path`. */
  segments: string[];
  directory: boolean;
  /** Whether a Unix "executable" bit was recorded, so bundled scripts stay runnable. */
  executable: boolean;
  method: number;
  compressedSize: number;
  size: number;
  crc32: number;
  /** Offset of the entry's local header. */
  localHeaderOffset: number;
}

export interface ZipLimits {
  maxUnpackedBytes?: number;
  maxEntries?: number;
}

function view(buffer: Uint8Array): DataView {
  return new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

function findEndOfCentralDirectory(buffer: Uint8Array): number {
  const data = view(buffer);
  const lowest = Math.max(0, buffer.byteLength - EOCD_MIN_LENGTH - MAX_COMMENT_LENGTH);
  for (let offset = buffer.byteLength - EOCD_MIN_LENGTH; offset >= lowest; offset--) {
    if (data.getUint32(offset, true) !== EOCD_SIGNATURE) continue;
    const commentLength = data.getUint16(offset + 20, true);
    if (offset + EOCD_MIN_LENGTH + commentLength === buffer.byteLength) return offset;
  }
  throw new SkillArchiveError("not a ZIP archive (no end of central directory record)");
}

/**
 * Rejects every name that could land outside the destination folder or mean something different
 * on another operating system. Returns the path segments.
 */
export function checkEntryName(rawName: string): { segments: string[]; directory: boolean } {
  if (rawName === "") throw new SkillArchiveError("archive contains an entry with an empty name");
  if (rawName.includes("\0")) throw new SkillArchiveError("archive entry name contains a NUL byte");
  if (rawName.includes("\\")) {
    throw new SkillArchiveError(`archive entry "${rawName}" uses a backslash in its path`);
  }
  if (rawName.startsWith("/") || /^[A-Za-z]:/.test(rawName)) {
    throw new SkillArchiveError(`archive entry "${rawName}" has an absolute path`);
  }
  const directory = rawName.endsWith("/");
  const segments = (directory ? rawName.slice(0, -1) : rawName).split("/");
  for (const segment of segments) {
    if (segment === "..") {
      throw new SkillArchiveError(`archive entry "${rawName}" points outside its folder ("..")`);
    }
    if (segment === "" || segment === ".") {
      throw new SkillArchiveError(`archive entry "${rawName}" has an empty or "." path segment`);
    }
    // A trailing dot or space is silently dropped by Windows, so two names could become one.
    // Device names such as CON or NUL.txt cannot be created as files on Windows.
    if (
      /[. ]$/.test(segment) ||
      /[<>:"|?*\u0000-\u001f]/.test(segment) ||
      /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\..*)?$/i.test(segment)
    ) {
      throw new SkillArchiveError(`archive entry "${rawName}" is not a portable file name`);
    }
  }
  return { segments, directory };
}

/** Lists the entries of a ZIP held in memory, after checking every name and size. */
export function readZipEntries(buffer: Uint8Array, limits: ZipLimits = {}): ZipEntry[] {
  const maxUnpacked = limits.maxUnpackedBytes ?? DEFAULT_MAX_UNPACKED_BYTES;
  const maxEntries = limits.maxEntries ?? DEFAULT_MAX_ENTRIES;
  if (buffer.byteLength < EOCD_MIN_LENGTH) {
    throw new SkillArchiveError("not a ZIP archive (too short)");
  }
  const data = view(buffer);
  const eocd = findEndOfCentralDirectory(buffer);
  const disk = data.getUint16(eocd + 4, true);
  const centralDisk = data.getUint16(eocd + 6, true);
  const entriesOnDisk = data.getUint16(eocd + 8, true);
  const totalEntries = data.getUint16(eocd + 10, true);
  const centralSize = data.getUint32(eocd + 12, true);
  const centralOffset = data.getUint32(eocd + 16, true);
  if (totalEntries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new SkillArchiveError("ZIP64 archives are not supported");
  }
  if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== totalEntries) {
    throw new SkillArchiveError("multi-part ZIP archives are not supported");
  }
  if (totalEntries > maxEntries) {
    throw new SkillArchiveError(`archive has ${totalEntries} entries; at most ${maxEntries} are allowed`);
  }
  if (centralOffset + centralSize > eocd) {
    throw new SkillArchiveError("ZIP central directory lies outside the archive");
  }

  const entries: ZipEntry[] = [];
  const seen = new Set<string>();
  let unpacked = 0;
  let offset = centralOffset;
  for (let index = 0; index < totalEntries; index++) {
    if (offset + 46 > eocd || data.getUint32(offset, true) !== CENTRAL_SIGNATURE) {
      throw new SkillArchiveError("ZIP central directory is damaged");
    }
    const madeBy = data.getUint16(offset + 4, true);
    const flags = data.getUint16(offset + 8, true);
    const method = data.getUint16(offset + 10, true);
    const crc = data.getUint32(offset + 16, true);
    const compressedSize = data.getUint32(offset + 20, true);
    const size = data.getUint32(offset + 24, true);
    const nameLength = data.getUint16(offset + 28, true);
    const extraLength = data.getUint16(offset + 30, true);
    const commentLength = data.getUint16(offset + 32, true);
    const externalAttributes = data.getUint32(offset + 38, true);
    const localHeaderOffset = data.getUint32(offset + 42, true);
    const nameStart = offset + 46;
    if (nameStart + nameLength + extraLength + commentLength > eocd) {
      throw new SkillArchiveError("ZIP central directory is damaged");
    }
    const nameBytes = buffer.subarray(nameStart, nameStart + nameLength);
    const rawName = new TextDecoder(flags & FLAG_UTF8 ? "utf-8" : "latin1").decode(nameBytes);
    offset = nameStart + nameLength + extraLength + commentLength;

    if (flags & FLAG_ENCRYPTED) throw new SkillArchiveError(`archive entry "${rawName}" is encrypted`);
    if (compressedSize === 0xffffffff || size === 0xffffffff || localHeaderOffset === 0xffffffff) {
      throw new SkillArchiveError("ZIP64 archives are not supported");
    }
    const { segments, directory: slashDirectory } = checkEntryName(rawName);

    let directory = slashDirectory;
    let executable = false;
    if (madeBy >>> 8 === UNIX_HOST) {
      const mode = externalAttributes >>> 16;
      const type = mode & S_IFMT;
      if (type === S_IFLNK) throw new SkillArchiveError(`archive entry "${rawName}" is a symbolic link`);
      if (type !== 0 && type !== S_IFREG && type !== S_IFDIR) {
        throw new SkillArchiveError(`archive entry "${rawName}" is not a regular file or folder`);
      }
      if (type === S_IFDIR) directory = true;
      executable = (mode & 0o111) !== 0;
    }
    if (directory && size !== 0) {
      throw new SkillArchiveError(`archive entry "${rawName}" is a folder with content`);
    }
    if (!directory && method !== METHOD_STORED && method !== METHOD_DEFLATE) {
      throw new SkillArchiveError(
        `archive entry "${rawName}" uses compression method ${method}; only stored and deflate are supported`,
      );
    }
    if (!directory && method === METHOD_STORED && compressedSize !== size) {
      throw new SkillArchiveError(`archive entry "${rawName}" has inconsistent sizes`);
    }

    const path = segments.join("/");
    // Case-insensitive, because macOS and Windows would write both names into one file.
    const key = path.toLowerCase();
    if (seen.has(key)) throw new SkillArchiveError(`archive contains "${path}" more than once`);
    seen.add(key);

    unpacked += size;
    if (unpacked > maxUnpacked) {
      throw new SkillArchiveError(`archive unpacks to more than ${maxUnpacked} bytes`);
    }
    entries.push({
      path,
      segments,
      directory,
      executable,
      method,
      compressedSize,
      size,
      crc32: crc,
      localHeaderOffset,
    });
  }

  // A file and a folder with the same path (`a` and `a/b`) cannot both exist on disk.
  const files = new Set(entries.filter((entry) => !entry.directory).map((entry) => entry.path.toLowerCase()));
  for (const entry of entries) {
    for (let depth = 1; depth < entry.segments.length; depth++) {
      const parent = entry.segments.slice(0, depth).join("/").toLowerCase();
      if (files.has(parent)) {
        throw new SkillArchiveError(`archive uses "${entry.segments.slice(0, depth).join("/")}" as both a file and a folder`);
      }
    }
  }
  return entries;
}

/** Inflates one file entry and checks its size and CRC-32 against the central directory. */
export function readZipEntryData(buffer: Uint8Array, entry: ZipEntry): Uint8Array {
  if (entry.directory) return new Uint8Array(0);
  const data = view(buffer);
  const header = entry.localHeaderOffset;
  if (header + 30 > buffer.byteLength || data.getUint32(header, true) !== LOCAL_SIGNATURE) {
    throw new SkillArchiveError(`archive entry "${entry.path}" has a damaged local header`);
  }
  const nameLength = data.getUint16(header + 26, true);
  const extraLength = data.getUint16(header + 28, true);
  const start = header + 30 + nameLength + extraLength;
  const end = start + entry.compressedSize;
  if (end > buffer.byteLength) {
    throw new SkillArchiveError(`archive entry "${entry.path}" lies outside the archive`);
  }
  const compressed = buffer.subarray(start, end);
  let content: Uint8Array;
  if (entry.method === METHOD_STORED) {
    content = compressed;
  } else {
    try {
      // maxOutputLength stops a "zip bomb" at the declared size instead of after filling memory.
      content = inflateRawSync(compressed, { maxOutputLength: Math.max(1, entry.size) });
    } catch (error) {
      throw new SkillArchiveError(
        `archive entry "${entry.path}" could not be inflated: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (content.byteLength !== entry.size) {
    throw new SkillArchiveError(`archive entry "${entry.path}" is not the size it declares`);
  }
  if (crc32(content) >>> 0 !== entry.crc32 >>> 0) {
    throw new SkillArchiveError(`archive entry "${entry.path}" fails its CRC-32 check`);
  }
  return content;
}
