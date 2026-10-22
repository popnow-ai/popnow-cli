import type { Command } from "commander";
import type { PopNowClient } from "../client/client.js";
import type { AgentSkill } from "../client/types.js";
import { type SkillLocations } from "../skills/agents.js";
import { type CliIo } from "./io.js";
export interface SkillsCommandContext {
    io: CliIo;
    json: () => boolean;
    client: () => PopNowClient;
    locations: () => SkillLocations;
}
/** The catalog may answer with a bare array or wrap it; both are accepted. */
export declare function skillList(data: unknown): AgentSkill[];
/** One skill, whether it comes bare or as `{ skill, install }`. */
export declare function normalizeSkill(data: unknown): AgentSkill | undefined;
/** Install hints arrive keyed by agent or as a list; either way one line per agent. */
export declare function describeInstallHints(install: unknown): string[];
export declare function registerSkillsCommands(program: Command, context: SkillsCommandContext): void;
