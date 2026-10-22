import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

/*
 * Coding agents that read Agent Skills (a folder with a SKILL.md) and where each one looks for
 * them. Paths follow each agent's own documentation as of 2026-10-22. Several agents also read
 * the shared `~/.agents/skills` folder, which is Codex's user folder here.
 */

export interface AgentDefinition {
  id: string;
  name: string;
  /** Other spellings accepted by `--agent`. */
  aliases: readonly string[];
  /** User-level skills folder, relative to the home directory. */
  userSkills: readonly string[];
  /** Project-level skills folder, relative to the project root. */
  projectSkills: readonly string[];
  /** Folders in the home directory that show the agent is installed. */
  homeMarkers: ReadonlyArray<readonly string[]>;
  /** Paths in a project that show it is set up for the agent. */
  projectMarkers: ReadonlyArray<readonly string[]>;
  /** How to call a skill by name, when the agent has an explicit syntax. */
  invoke?: (name: string) => string;
}

export const AGENTS: readonly AgentDefinition[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    aliases: ["claude"],
    userSkills: [".claude", "skills"],
    projectSkills: [".claude", "skills"],
    homeMarkers: [[".claude"]],
    projectMarkers: [[".claude"]],
    invoke: (name) => `/${name}`,
  },
  {
    id: "codex",
    name: "Codex",
    aliases: ["openai-codex"],
    userSkills: [".agents", "skills"],
    projectSkills: [".agents", "skills"],
    homeMarkers: [[".codex"], [".agents"]],
    projectMarkers: [[".codex"], [".agents"]],
    invoke: (name) => `$${name}`,
  },
  {
    id: "cursor",
    name: "Cursor",
    aliases: [],
    userSkills: [".cursor", "skills"],
    projectSkills: [".cursor", "skills"],
    homeMarkers: [[".cursor"]],
    projectMarkers: [[".cursor"]],
  },
  {
    id: "gemini-cli",
    name: "Gemini CLI",
    aliases: ["gemini"],
    userSkills: [".gemini", "skills"],
    projectSkills: [".gemini", "skills"],
    homeMarkers: [[".gemini"]],
    projectMarkers: [[".gemini"]],
  },
  {
    id: "github-copilot",
    name: "GitHub Copilot",
    aliases: ["copilot"],
    userSkills: [".copilot", "skills"],
    projectSkills: [".github", "skills"],
    homeMarkers: [[".copilot"]],
    // Nearly every repository has a .github folder, so only Copilot's own files count.
    projectMarkers: [[".github", "skills"], [".github", "copilot-instructions.md"]],
  },
  {
    id: "opencode",
    name: "OpenCode",
    aliases: [],
    userSkills: [".config", "opencode", "skills"],
    projectSkills: [".opencode", "skills"],
    homeMarkers: [[".config", "opencode"]],
    projectMarkers: [[".opencode"]],
  },
];

export const AGENT_IDS: readonly string[] = AGENTS.map((agent) => agent.id);

export function findAgent(value: string): AgentDefinition | undefined {
  const wanted = value.trim().toLowerCase();
  return AGENTS.find((agent) => agent.id === wanted || agent.aliases.includes(wanted));
}

export function requireAgent(value: string): AgentDefinition {
  const agent = findAgent(value);
  if (!agent) throw new TypeError(`unknown agent "${value}"; use one of: ${AGENT_IDS.join(", ")}`);
  return agent;
}

export type SkillScope = "user" | "project";

export interface SkillLocations {
  homeDir: string;
  cwd: string;
}

export function skillsDirectory(agent: AgentDefinition, scope: SkillScope, where: SkillLocations): string {
  return scope === "user" ? join(where.homeDir, ...agent.userSkills) : join(where.cwd, ...agent.projectSkills);
}

function exists(path: string): boolean {
  try {
    return existsSync(path) && (statSync(path).isDirectory() || statSync(path).isFile());
  } catch {
    return false;
  }
}

/**
 * Agents that look installed. With `project`, agents set up in the current project come first;
 * when the project shows none, the home directory decides.
 */
export function detectAgents(where: SkillLocations, project: boolean): AgentDefinition[] {
  if (project) {
    const inProject = AGENTS.filter((agent) =>
      agent.projectMarkers.some((marker) => exists(join(where.cwd, ...marker))),
    );
    if (inProject.length > 0) return inProject;
  }
  return AGENTS.filter((agent) => agent.homeMarkers.some((marker) => exists(join(where.homeDir, ...marker))));
}

/** A sentence that tells the user how to use an installed skill in this agent. */
export function describeInvocation(agent: AgentDefinition | undefined, skillName: string): string {
  if (agent?.invoke) {
    return `In ${agent.name}, type ${agent.invoke(skillName)} or just ask for what you want; it loads the skill when a request matches.`;
  }
  const who = agent ? agent.name : "Your agent";
  return `${who} loads the skill when a request matches its description; you can also ask for it by name ("use the ${skillName} skill").`;
}
