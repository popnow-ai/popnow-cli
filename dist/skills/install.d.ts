import { type AgentDefinition, type SkillLocations, type SkillScope } from "./agents.js";
import { type ZipEntry, type ZipLimits } from "./zip.js";
export declare const SKILL_FOLDER_PREFIX = "popnow-";
export declare function validateSlug(slug: string): string;
export declare function skillFolderName(slug: string): string;
export interface SkillFrontmatter {
    name?: string;
    description?: string;
    version?: string;
}
/**
 * Reads `name`, `description` and `version` from a SKILL.md frontmatter block. `version` may sit
 * at the top level or under `metadata:`. Only the simple `key: value` form is understood, which
 * is all a skill needs; anything else is ignored rather than guessed at.
 */
export declare function parseSkillFrontmatter(text: string): SkillFrontmatter;
export interface VerifiedSkillArchive {
    folder: string;
    entries: ZipEntry[];
    frontmatter: SkillFrontmatter;
}
/**
 * A skill archive must hold exactly one top folder, `popnow-<slug>/`, with a SKILL.md directly
 * inside it. Anything else is refused before a single byte is written.
 */
export declare function verifySkillArchive(buffer: Uint8Array, slug: string, limits?: ZipLimits): VerifiedSkillArchive;
export interface InstallResult {
    path: string;
    replaced: boolean;
    name: string;
    version?: string;
    files: number;
}
/**
 * Unpacks a verified archive into `<skillsDir>/popnow-<slug>`. The files are written to a hidden
 * staging folder next to the target first and moved into place in one rename, so an agent never
 * sees half a skill and a failure leaves the previous version as it was.
 */
export declare function installSkillArchive(buffer: Uint8Array, slug: string, skillsDir: string, options?: {
    force?: boolean;
    limits?: ZipLimits;
}): Promise<InstallResult>;
export interface InstalledSkill {
    slug: string;
    folder: string;
    name: string;
    version?: string;
    scope: SkillScope;
    agents: string[];
    path: string;
    /** False when the folder has no SKILL.md, so no agent would load it. */
    valid: boolean;
}
interface Location {
    agent: AgentDefinition;
    scope: SkillScope;
    dir: string;
}
/** Every skills folder of the given agents, merged when two agents share one. */
export declare function skillLocations(where: SkillLocations, options?: {
    agent?: AgentDefinition;
    scopes?: readonly SkillScope[];
}): Location[];
/** PopNow skills (`popnow-*` folders) found in the known skills folders. */
export declare function findInstalledSkills(where: SkillLocations, options?: {
    agent?: AgentDefinition;
    scopes?: readonly SkillScope[];
}): InstalledSkill[];
/** Accepts `video` as well as the folder name `popnow-video`. */
export declare function folderCandidates(slugOrFolder: string): string[];
/**
 * Deletes one installed skill folder. A symbolic link is removed as a link; whatever it points to
 * is left alone.
 */
export declare function removeSkillFolder(path: string): Promise<void>;
export {};
