import { Command } from "commander";
import { PopNowClient, type PopNowClientOptions } from "../client/client.js";
import { type CliIo } from "./io.js";
/** Exit code for a waited task that reached a final state other than `succeeded`. */
export declare const EXIT_TASK_NOT_SUCCEEDED = 2;
export interface CliDependencies {
    io?: CliIo;
    createClient?: (options: PopNowClientOptions) => PopNowClient;
    /** Used by `docs search`; defaults to the global fetch. */
    fetch?: typeof fetch;
}
interface CliOutcome {
    exitCode: number;
}
export declare function createCli(dependencies?: CliDependencies, outcome?: CliOutcome): Command;
export declare function runCli(argv?: readonly string[], dependencies?: CliDependencies): Promise<number>;
export {};
