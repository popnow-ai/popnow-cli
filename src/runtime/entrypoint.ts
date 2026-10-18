import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function isMainModule(moduleUrl: string, argv: readonly string[] = process.argv): boolean {
  const entrypoint = argv[1];
  if (!entrypoint) return false;
  const modulePath = fileURLToPath(moduleUrl);
  try {
    return realpathSync(modulePath) === realpathSync(entrypoint);
  } catch {
    return path.resolve(modulePath) === path.resolve(entrypoint);
  }
}
