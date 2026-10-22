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
export declare const AGENTS: readonly AgentDefinition[];
export declare const AGENT_IDS: readonly string[];
export declare function findAgent(value: string): AgentDefinition | undefined;
export declare function requireAgent(value: string): AgentDefinition;
export type SkillScope = "user" | "project";
export interface SkillLocations {
    homeDir: string;
    cwd: string;
}
export declare function skillsDirectory(agent: AgentDefinition, scope: SkillScope, where: SkillLocations): string;
/**
 * Agents that look installed. With `project`, agents set up in the current project come first;
 * when the project shows none, the home directory decides.
 */
export declare function detectAgents(where: SkillLocations, project: boolean): AgentDefinition[];
/** A sentence that tells the user how to use an installed skill in this agent. */
export declare function describeInvocation(agent: AgentDefinition | undefined, skillName: string): string;
