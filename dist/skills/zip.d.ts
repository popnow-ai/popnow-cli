/** About 100 MB unpacked: far above any skill, far below what fills a disk. */
export declare const DEFAULT_MAX_UNPACKED_BYTES: number;
export declare const DEFAULT_MAX_ENTRIES = 10000;
/** The archive is not a ZIP this client accepts. Nothing has been written when it is thrown. */
export declare class SkillArchiveError extends Error {
    readonly name = "SkillArchiveError";
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
/**
 * Rejects every name that could land outside the destination folder or mean something different
 * on another operating system. Returns the path segments.
 */
export declare function checkEntryName(rawName: string): {
    segments: string[];
    directory: boolean;
};
/** Lists the entries of a ZIP held in memory, after checking every name and size. */
export declare function readZipEntries(buffer: Uint8Array, limits?: ZipLimits): ZipEntry[];
/** Inflates one file entry and checks its size and CRC-32 against the central directory. */
export declare function readZipEntryData(buffer: Uint8Array, entry: ZipEntry): Uint8Array;
