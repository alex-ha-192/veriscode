import * as fs from "fs";
import * as path from "path";

/**
 * Lists the .sv/.v files directly inside `dir` as sorted absolute paths.
 * Non-recursive on purpose: "put your files in one folder" is the whole
 * project model, with no subfolder or include mechanism. A missing or
 * unreadable directory yields [] rather than throwing.
 */
export function listSvFiles(dir: string): string[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((f) => /\.(sv|v)$/i.test(f))
    .map((f) => path.join(dir, f))
    .sort();
}
