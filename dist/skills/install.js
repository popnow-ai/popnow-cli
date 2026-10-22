import { randomBytes } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { lstat, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { AGENTS, skillsDirectory } from "./agents.js";
import { SkillArchiveError, readZipEntries, readZipEntryData } from "./zip.js";
export const SKILL_FOLDER_PREFIX = "popnow-";
const SKILL_FILE = "SKILL.md";
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
export function validateSlug(slug) {
    const value = slug.trim();
    if (!SLUG_PATTERN.test(value)) {
        throw new TypeError(`"${slug}" is not a skill slug: use lowercase letters, digits and dashes, as listed by \`popnow skills search\``);
    }
    return value;
}
export function skillFolderName(slug) {
    return `${SKILL_FOLDER_PREFIX}${slug}`;
}
function unquote(value) {
    const trimmed = value.trim();
    if (trimmed.length >= 2 && /^(["']).*\1$/s.test(trimmed))
        return trimmed.slice(1, -1);
    return trimmed;
}
/**
 * Reads `name`, `description` and `version` from a SKILL.md frontmatter block. `version` may sit
 * at the top level or under `metadata:`. Only the simple `key: value` form is understood, which
 * is all a skill needs; anything else is ignored rather than guessed at.
 */
export function parseSkillFrontmatter(text) {
    const lines = text.replace(/^﻿/, "").split(/\r?\n/);
    if (lines[0]?.trim() !== "---")
        return {};
    const result = {};
    let section = "";
    for (let index = 1; index < lines.length; index++) {
        const line = lines[index];
        if (line.trim() === "---")
            break;
        const match = /^(\s*)([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
        if (!match)
            continue;
        const [, indent = "", key = "", raw = ""] = match;
        if (indent === "")
            section = raw.trim() === "" ? key : "";
        const value = unquote(raw);
        if (value === "" || value === "|" || value === ">")
            continue;
        if (indent === "" && (key === "name" || key === "description" || key === "version")) {
            result[key] = value;
        }
        else if (indent !== "" && section === "metadata" && key === "version" && result.version === undefined) {
            result.version = value;
        }
    }
    return result;
}
/**
 * A skill archive must hold exactly one top folder, `popnow-<slug>/`, with a SKILL.md directly
 * inside it. Anything else is refused before a single byte is written.
 */
export function verifySkillArchive(buffer, slug, limits = {}) {
    const folder = skillFolderName(slug);
    const entries = readZipEntries(buffer, limits);
    if (entries.length === 0)
        throw new SkillArchiveError("the skill archive is empty");
    const tops = [...new Set(entries.map((entry) => entry.segments[0]))];
    if (tops.length !== 1) {
        throw new SkillArchiveError(`the skill archive must contain exactly one top folder "${folder}/", found: ${tops.slice(0, 5).join(", ")}`);
    }
    if (tops[0] !== folder) {
        throw new SkillArchiveError(`the skill archive's top folder is "${tops[0]}", expected "${folder}"`);
    }
    if (entries.some((entry) => entry.segments.length === 1 && !entry.directory)) {
        throw new SkillArchiveError(`"${folder}" must be a folder in the skill archive, not a file`);
    }
    const skillFile = entries.find((entry) => entry.path === `${folder}/${SKILL_FILE}` && !entry.directory);
    if (!skillFile)
        throw new SkillArchiveError(`the skill archive has no ${folder}/${SKILL_FILE}`);
    const frontmatter = parseSkillFrontmatter(new TextDecoder().decode(readZipEntryData(buffer, skillFile)));
    return { folder, entries, frontmatter };
}
function pathExists(path) {
    return lstat(path).then(() => true, (error) => {
        if (error.code === "ENOENT")
            return false;
        throw error;
    });
}
function scratchName(slug, purpose) {
    return `.${skillFolderName(slug)}.${purpose}-${randomBytes(4).toString("hex")}`;
}
/**
 * Unpacks a verified archive into `<skillsDir>/popnow-<slug>`. The files are written to a hidden
 * staging folder next to the target first and moved into place in one rename, so an agent never
 * sees half a skill and a failure leaves the previous version as it was.
 */
export async function installSkillArchive(buffer, slug, skillsDir, options = {}) {
    const archive = verifySkillArchive(buffer, slug, options.limits);
    const destination = join(skillsDir, archive.folder);
    const replaced = await pathExists(destination);
    if (replaced && !options.force) {
        throw new Error(`${destination} already exists; pass --force to replace it`);
    }
    await mkdir(skillsDir, { recursive: true });
    const staging = join(skillsDir, scratchName(slug, "new"));
    await mkdir(staging);
    let files = 0;
    try {
        for (const entry of archive.entries) {
            const inner = entry.segments.slice(1);
            if (inner.length === 0)
                continue;
            const target = join(staging, ...inner);
            // Defense in depth: the names were checked already, but the final path is what matters.
            const rel = relative(staging, target);
            if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
                throw new SkillArchiveError(`archive entry "${entry.path}" resolves outside the skill folder`);
            }
            if (entry.directory) {
                await mkdir(target, { recursive: true });
                continue;
            }
            await mkdir(join(staging, ...inner.slice(0, -1)), { recursive: true });
            await writeFile(target, readZipEntryData(buffer, entry), {
                flag: "wx",
                mode: entry.executable ? 0o755 : 0o644,
            });
            files++;
        }
        if (replaced) {
            const backup = join(skillsDir, scratchName(slug, "old"));
            await rename(destination, backup);
            try {
                await rename(staging, destination);
            }
            catch (error) {
                await rename(backup, destination).catch(() => undefined);
                throw error;
            }
            await rm(backup, { recursive: true, force: true });
        }
        else {
            await rename(staging, destination);
        }
    }
    finally {
        await rm(staging, { recursive: true, force: true });
    }
    return {
        path: destination,
        replaced,
        name: archive.frontmatter.name ?? archive.folder,
        ...(archive.frontmatter.version === undefined ? {} : { version: archive.frontmatter.version }),
        files,
    };
}
function canonical(path) {
    try {
        return realpathSync(path);
    }
    catch {
        return path;
    }
}
/** Every skills folder of the given agents, merged when two agents share one. */
export function skillLocations(where, options = {}) {
    const agents = options.agent ? [options.agent] : AGENTS;
    const scopes = options.scopes ?? ["user", "project"];
    const locations = [];
    for (const scope of scopes) {
        for (const agent of agents)
            locations.push({ agent, scope, dir: skillsDirectory(agent, scope, where) });
    }
    return locations;
}
function readFrontmatter(folder) {
    try {
        return parseSkillFrontmatter(readFileSync(join(folder, SKILL_FILE), "utf8"));
    }
    catch {
        return undefined;
    }
}
function isDirectory(path) {
    try {
        return statSync(path).isDirectory();
    }
    catch {
        return false;
    }
}
/** PopNow skills (`popnow-*` folders) found in the known skills folders. */
export function findInstalledSkills(where, options = {}) {
    const byPath = new Map();
    for (const location of skillLocations(where, options)) {
        if (!isDirectory(location.dir))
            continue;
        let names;
        try {
            names = readdirSync(location.dir);
        }
        catch {
            continue;
        }
        for (const folder of names.sort()) {
            if (!folder.startsWith(SKILL_FOLDER_PREFIX))
                continue;
            const path = join(location.dir, folder);
            if (!isDirectory(path))
                continue;
            const key = canonical(path);
            const known = byPath.get(key);
            if (known) {
                if (!known.agents.includes(location.agent.id))
                    known.agents.push(location.agent.id);
                continue;
            }
            const frontmatter = readFrontmatter(path);
            byPath.set(key, {
                slug: folder.slice(SKILL_FOLDER_PREFIX.length),
                folder,
                name: frontmatter?.name ?? folder,
                ...(frontmatter?.version === undefined ? {} : { version: frontmatter.version }),
                scope: location.scope,
                agents: [location.agent.id],
                path,
                valid: frontmatter !== undefined,
            });
        }
    }
    return [...byPath.values()];
}
/** Accepts `video` as well as the folder name `popnow-video`. */
export function folderCandidates(slugOrFolder) {
    const value = slugOrFolder.trim();
    const candidates = [skillFolderName(value)];
    if (value.startsWith(SKILL_FOLDER_PREFIX) && value.length > SKILL_FOLDER_PREFIX.length)
        candidates.push(value);
    return candidates;
}
/**
 * Deletes one installed skill folder. A symbolic link is removed as a link; whatever it points to
 * is left alone.
 */
export async function removeSkillFolder(path) {
    const info = lstatSync(path);
    if (info.isSymbolicLink()) {
        await rm(path, { force: true });
        return;
    }
    if (!info.isDirectory())
        throw new Error(`${path} is not a folder`);
    await rm(path, { recursive: true, force: true });
}
