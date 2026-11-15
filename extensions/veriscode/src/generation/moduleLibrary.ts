import * as fs from "fs";
import { parseModule } from "../simulation/portParser";
import { listSvFiles } from "../simulation/svFiles";
import { ParsedModule } from "../simulation/types";

export interface LibraryModule {
  module: ParsedModule;
  /** Absolute path to the .sv/.v file this module was parsed from. */
  filePath: string;
}

/**
 * Parses every .sv/.v file directly inside `folder` (see listSvFiles) into
 * the composer's palette of available modules. Files that can't be read
 * or contain no module declaration are skipped: this is a convenience
 * listing, not a build step.
 */
export function listModulesInFolder(folder: string): LibraryModule[] {
  const modules: LibraryModule[] = [];
  for (const filePath of listSvFiles(folder)) {
    let text: string;
    try {
      text = fs.readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    const module = parseModule(text);
    if (module) {
      modules.push({ module, filePath });
    }
  }
  return modules;
}
