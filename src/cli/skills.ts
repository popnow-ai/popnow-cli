import { lstatSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";

import type { Command } from "commander";

import type { PopNowClient } from "../client/client.js";
import { MissingApiKeyError } from "../client/errors.js";
import type { AgentSkill } from "../client/types.js";
import {
  AGENT_IDS,
  describeInvocation,
  detectAgents,
  requireAgent,
  skillsDirectory,
  type AgentDefinition,
  type SkillLocations,
  type SkillScope,
} from "../skills/agents.js";
import {
  findInstalledSkills,
  folderCandidates,
  installSkillArchive,
  removeSkillFolder,
  skillFolderName,
  skillLocations,
  validateSlug,
  type InstallResult,
} from "../skills/install.js";
import { outputValue, requireConfirmation, type CliIo } from "./io.js";

export interface SkillsCommandContext {
  io: CliIo;
  json: () => boolean;
  client: () => PopNowClient;
  locations: () => SkillLocations;
}

type TargetScope = SkillScope | "dir";

interface InstallTarget {
  agent: AgentDefinition | undefined;
  scope: TargetScope;
  dir: string;
}

const CREDITS_NOTE =
  "PopNow skills quote the price in credits before any paid generation and wait for your OK. " +
  "They read POPNOW_API_KEY from the environment the agent runs in.";

/** The catalog may answer with a bare array or wrap it; both are accepted. */
export function skillList(data: unknown): AgentSkill[] {
  const raw = Array.isArray(data)
    ? data
    : data !== null && typeof data === "object"
      ? ["items", "skills", "data", "results"]
          .map((key) => (data as Record<string, unknown>)[key])
          .find((value) => Array.isArray(value))
      : undefined;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item): item is AgentSkill =>
      item !== null && typeof item === "object" && typeof (item as { slug?: unknown }).slug === "string",
  );
}

/** One skill, whether it comes bare or as `{ skill, install }`. */
export function normalizeSkill(data: unknown): AgentSkill | undefined {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return undefined;
  const record = data as Record<string, unknown>;
  const inner = record.skill;
  if (inner !== null && typeof inner === "object" && !Array.isArray(inner)) {
    const skill = inner as AgentSkill;
    return record.install === undefined ? skill : { ...skill, install: record.install };
  }
  return typeof record.slug === "string" ? (record as AgentSkill) : undefined;
}

function strings(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return typeof value === "string" && value !== "" ? [value] : [];
}

function describeValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const parts = Object.entries(value)
      .filter(([, item]) => typeof item === "string" || typeof item === "number" || typeof item === "boolean")
      .map(([key, item]) => `${key}: ${String(item)}`);
    if (parts.length > 0) return parts.join("; ");
  }
  return JSON.stringify(value);
}

/** Install hints arrive keyed by agent or as a list; either way one line per agent. */
export function describeInstallHints(install: unknown): string[] {
  if (Array.isArray(install)) {
    return install.map((item) => {
      if (item !== null && typeof item === "object") {
        const { agent, id, ...rest } = item as Record<string, unknown>;
        const label = typeof agent === "string" ? agent : typeof id === "string" ? id : "agent";
        return `${label}: ${describeValue(rest)}`;
      }
      return describeValue(item);
    });
  }
  if (install !== null && typeof install === "object") {
    return Object.entries(install).map(([agent, hint]) => `${agent}: ${describeValue(hint)}`);
  }
  return typeof install === "string" && install !== "" ? [install] : [];
}

function pathExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function canonical(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function scopeLabel(scope: TargetScope): string {
  return scope === "dir" ? "custom folder" : scope === "project" ? "this project" : "your user folder";
}

export function registerSkillsCommands(program: Command, context: SkillsCommandContext): void {
  const { io, json, client, locations } = context;

  /** One agent: the one named, the only one detected, or the user's pick at a terminal. */
  const chooseAgent = async (where: SkillLocations, project: boolean): Promise<AgentDefinition> => {
    const found = detectAgents(where, project);
    if (found.length === 1) {
      io.stderr(`Agent: ${found[0]!.name} (detected; pass --agent to choose another)\n`);
      return found[0]!;
    }
    if (found.length === 0) {
      throw new Error(
        `no supported coding agent found in ${where.homeDir}${project ? ` or ${where.cwd}` : ""}. ` +
          `Pass --agent <id> (one of: ${AGENT_IDS.join(", ")}) or --dir <skills folder>`,
      );
    }
    const ids = found.map((agent) => agent.id).join(", ");
    if (!io.stdinIsTTY || !io.ask) {
      throw new Error(`several coding agents found (${ids}); pass --agent <id> to choose one`);
    }
    const menu = found.map((agent, index) => `  ${index + 1}. ${agent.name} (${agent.id})`).join("\n");
    const answer = (await io.ask(`Several coding agents found:\n${menu}\nInstall for which one? [1-${found.length}] `)).trim();
    const byNumber = /^\d+$/.test(answer) ? found[Number(answer) - 1] : undefined;
    const chosen = byNumber ?? found.find((agent) => agent.id === answer.toLowerCase());
    if (!chosen) throw new Error(`no agent chosen; pass --agent <id> (one of: ${ids})`);
    return chosen;
  };

  const resolveTarget = async (options: {
    agent?: string;
    project?: boolean;
    dir?: string;
  }): Promise<InstallTarget> => {
    if (options.dir !== undefined && options.project) {
      throw new TypeError("use either --dir or --project, not both");
    }
    const where = locations();
    const named = options.agent === undefined ? undefined : requireAgent(options.agent);
    if (options.dir !== undefined) {
      return { agent: named, scope: "dir", dir: resolve(where.cwd, options.dir) };
    }
    const scope: SkillScope = options.project ? "project" : "user";
    const agent = named ?? (await chooseAgent(where, scope === "project"));
    return { agent, scope, dir: skillsDirectory(agent, scope, where) };
  };

  const skills = program
    .command("skills")
    .alias("agent-skills")
    .description(
      "find and install PopNow skills for coding agents: Claude Code, Codex, Cursor, Gemini CLI, GitHub Copilot, OpenCode",
    );

  skills
    .command("search")
    .argument("[query...]", "words to look for; omit to list every skill")
    .option("--type <type>", "only skills of this type: video, image, slides or web")
    .option("--task <task>", "only skills for this task, for example image-to-video")
    .description("search the PopNow agent skills catalog")
    .action(async (words: string[], options: { type?: string; task?: string }) => {
      const q = words.join(" ").trim();
      const data = await client().listAgentSkills({
        ...(q ? { q } : {}),
        ...(options.type === undefined ? {} : { type: options.type.trim().toLowerCase() }),
        ...(options.task === undefined ? {} : { task: options.task.trim() }),
      });
      if (json()) {
        outputValue(data, true, io);
        return;
      }
      const list = skillList(data);
      if (list.length === 0) {
        io.stdout(
          `No skills matched${q ? ` "${q}"` : ""}. Try fewer words, or run \`popnow skills search\` to list them all.\n`,
        );
        return;
      }
      const width = Math.max(...list.map((skill) => skill.slug.length));
      for (const skill of list) {
        const tags = [skill.type, skill.version === undefined ? undefined : `v${skill.version}`]
          .filter((item): item is string => typeof item === "string" && item !== "")
          .join(", ");
        io.stdout(`${skill.slug.padEnd(width)}  ${skill.name ?? ""}${tags ? ` (${tags})` : ""}\n`);
        if (skill.summary) io.stdout(`${" ".repeat(width)}  ${skill.summary}\n`);
      }
      io.stdout("\nDetails: popnow skills info <slug>    Install: popnow skills add <slug>\n");
    });

  skills
    .command("info")
    .argument("<slug>", "skill slug from `popnow skills search`")
    .description("show one skill: what it does, what it needs and how to install it")
    .action(async (slug: string) => {
      const id = validateSlug(slug);
      const data = await client().getAgentSkill(id);
      if (json()) {
        outputValue(data, true, io);
        return;
      }
      const skill = normalizeSkill(data);
      if (!skill) {
        outputValue(data, false, io);
        return;
      }
      const lines: string[] = [`${skill.name ?? skill.slug} (${skill.slug})`];
      if (skill.summary) lines.push(skill.summary);
      lines.push("");
      const field = (label: string, value: string | undefined): void => {
        if (value) lines.push(`${label}: ${value}`);
      };
      field("Type", skill.type);
      field("Tasks", strings(skill.tasks).join(", "));
      field("Uses on PopNow", strings(skill.popnow).join(", "));
      field("Requires", strings(skill.requires).join(", "));
      field("Version", skill.version);
      field("Updated", skill.updated);
      field("Page", skill.url);
      if (skill.distribution !== undefined) field("Distribution", describeValue(skill.distribution));
      const hints = describeInstallHints(skill.install);
      if (hints.length > 0) {
        lines.push("", "Install hints:", ...hints.map((hint) => `  ${hint}`));
      }
      lines.push(
        "",
        `Install: popnow skills add ${skill.slug}    (add --agent <id> to choose: ${AGENT_IDS.join(", ")})`,
      );
      io.stdout(`${lines.join("\n")}\n`);
    });

  skills
    .command("add")
    .argument("<slug...>", "one or more skill slugs from `popnow skills search`")
    .option("--agent <id>", `agent to install for: ${AGENT_IDS.join(", ")}; detected when omitted`)
    .option("--project", "install into the current project's skills folder instead of your user folder")
    .option("--dir <path>", "install into this skills folder instead of the agent's own")
    .option("--force", "replace a copy that is already installed")
    .option("--dry-run", "show what would be installed where, without downloading or writing anything")
    .description("download skills with your API key and install them for a coding agent")
    .action(
      async (
        slugs: string[],
        options: { agent?: string; project?: boolean; dir?: string; force?: boolean; dryRun?: boolean },
      ) => {
        const ids = [...new Set(slugs.map(validateSlug))];
        // Fail before any prompt when the download is bound to be refused.
        if (!options.dryRun && !io.env.POPNOW_API_KEY?.trim()) throw new MissingApiKeyError();
        const target = await resolveTarget(options);
        const plans = ids.map((slug) => {
          const path = join(target.dir, skillFolderName(slug));
          return { slug, path, exists: pathExists(path) };
        });
        const agentLabel = target.agent?.name ?? "a custom folder";

        if (options.dryRun) {
          const rows = plans.map((plan) => ({
            slug: plan.slug,
            agent: target.agent?.id ?? null,
            scope: target.scope,
            path: plan.path,
            action: !plan.exists ? "install" : options.force ? "replace" : "skip (already installed; use --force)",
          }));
          if (json()) {
            outputValue({ dryRun: true, skills: rows }, true, io);
            return;
          }
          io.stdout(`Dry run for ${agentLabel} (${scopeLabel(target.scope)}): nothing is downloaded or written.\n`);
          for (const row of rows) io.stdout(`  ${row.action}: ${row.path}\n`);
          return;
        }

        const blocked = plans.filter((plan) => plan.exists && !options.force);
        if (blocked.length > 0) {
          throw new Error(
            `already installed: ${blocked.map((plan) => plan.path).join(", ")}. Pass --force to replace ${blocked.length === 1 ? "it" : "them"}`,
          );
        }

        const api = client();
        const results: Array<InstallResult & { slug: string; agent: string | null; scope: TargetScope; invoke: string }> = [];
        try {
          for (const plan of plans) {
            const download = await api.downloadAgentSkill(plan.slug);
            const result = await installSkillArchive(download.bytes, plan.slug, target.dir, {
              force: Boolean(options.force),
            });
            const invoke = describeInvocation(target.agent, result.name);
            results.push({ slug: plan.slug, agent: target.agent?.id ?? null, scope: target.scope, invoke, ...result });
            if (!json()) {
              const version = result.version === undefined ? "" : ` ${result.version}`;
              io.stdout(
                `${result.replaced ? "Replaced" : "Installed"} ${skillFolderName(plan.slug)}${version} for ${agentLabel}: ${result.path}\n  ${invoke}\n`,
              );
            }
          }
        } finally {
          // Skills already installed stay installed, so a machine reader still learns about them.
          if (json() && results.length > 0) outputValue(results, true, io);
        }
        if (!json()) {
          io.stdout(`\n${CREDITS_NOTE}\nIf the agent was already running, start a new session if the skill does not show up.\n`);
        }
      },
    );

  skills
    .command("list-installed")
    .option("--agent <id>", `only this agent's folders: ${AGENT_IDS.join(", ")}`)
    .option("--project", "only the current project's folders")
    .description("list PopNow skills (popnow-* folders) installed in the known agent skills folders")
    .action((options: { agent?: string; project?: boolean }) => {
      const agent = options.agent === undefined ? undefined : requireAgent(options.agent);
      const found = findInstalledSkills(locations(), {
        ...(agent === undefined ? {} : { agent }),
        ...(options.project ? { scopes: ["project"] as const } : {}),
      });
      if (json()) {
        outputValue(found, true, io);
        return;
      }
      if (found.length === 0) {
        io.stdout("No PopNow skills are installed in the known folders. Find one with `popnow skills search`.\n");
        return;
      }
      for (const skill of found) {
        const version = skill.version === undefined ? "" : ` ${skill.version}`;
        const warning = skill.valid ? "" : " (no SKILL.md: agents will not load it)";
        io.stdout(`${skill.folder}${version}  ${skill.agents.join(", ")}, ${scopeLabel(skill.scope)}${warning}\n  ${skill.path}\n`);
      }
    });

  skills
    .command("remove")
    .argument("<slug>", "skill slug, or its folder name such as popnow-video")
    .option("--agent <id>", `only this agent's folder: ${AGENT_IDS.join(", ")}`)
    .option("--project", "the copy in the current project rather than your user folder")
    .option("--dir <path>", "the copy in this skills folder")
    .option("--yes", "remove without a prompt (for scripts)")
    .description("delete an installed PopNow skill folder")
    .action(async (slug: string, options: { agent?: string; project?: boolean; dir?: string; yes?: boolean }) => {
      const value = validateSlug(slug);
      const where = locations();
      const agent = options.agent === undefined ? undefined : requireAgent(options.agent);
      const dirs =
        options.dir !== undefined
          ? [{ dir: resolve(where.cwd, options.dir), label: "custom folder" }]
          : skillLocations(where, {
              ...(agent === undefined ? {} : { agent }),
              scopes: options.project ? ["project"] : agent ? ["user"] : ["user", "project"],
            }).map((location) => ({
              dir: location.dir,
              label: `${location.agent.id}, ${scopeLabel(location.scope)}`,
            }));
      const matches = new Map<string, { path: string; labels: string[] }>();
      for (const { dir, label } of dirs) {
        for (const folder of folderCandidates(value)) {
          const path = join(dir, folder);
          if (!pathExists(path)) continue;
          const key = canonical(path);
          const known = matches.get(key);
          if (known) known.labels.push(label);
          else matches.set(key, { path, labels: [label] });
          break;
        }
      }
      const found = [...matches.values()];
      if (found.length === 0) {
        throw new Error(`${skillFolderName(value)} is not installed there. \`popnow skills list-installed\` shows where skills are`);
      }
      if (found.length > 1) {
        const where = found.map((item) => `  ${item.path} (${item.labels.join("; ")})`).join("\n");
        throw new Error(
          `${skillFolderName(value)} is installed in several places:\n${where}\n` +
            "Pass --agent <id> (with --project for a project copy) or --dir <path> to pick one",
        );
      }
      const match = found[0]!;
      await requireConfirmation(`Delete ${match.path}?`, Boolean(options.yes), io, "destructive");
      await removeSkillFolder(match.path);
      if (json()) outputValue({ removed: match.path }, true, io);
      else io.stdout(`Removed ${match.path}\n`);
    });
}
