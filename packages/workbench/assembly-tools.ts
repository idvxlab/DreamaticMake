import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { assemblyDesignSchema } from "./assembly-contracts";
/** Trusted caller resolves paths from stores and supplies the complete retained IDs.
 * This executor does not approve designs or authenticate model-supplied asset paths.
 */
export async function executeAssemblyDesign(
  input: unknown,
  assets: {
    shellFile: string;
    outerFile: string;
    instances: Record<string, string>;
  },
  expectedInstanceIds: string[],
  directory: string,
) {
  const design = assemblyDesignSchema.parse(input);
  const actual = design.instances.map((i) => i.id).sort();
  if (
    new Set(expectedInstanceIds).size !== expectedInstanceIds.length ||
    JSON.stringify(actual) !== JSON.stringify([...expectedInstanceIds].sort())
  )
    throw new Error("Assembly must retain the exact trusted instance baseline");
  for (const id of actual)
    if (!assets.instances[id]) throw new Error(`Missing resolved STEP: ${id}`);
  await mkdir(directory, { recursive: true });
  const file = resolve(directory, "input.json");
  await writeFile(file, JSON.stringify({ design, assets }), { mode: 0o600 });
  const python =
    process.env.WORKBENCH_GEOMETRY_PYTHON ||
    resolve("../CAD生成相关/DreamaticMake/.venv/bin/python");
  await promisify(execFile)(
    python,
    [resolve("workers/workbench/build_assembly.py"), file, resolve(directory)],
    { timeout: 180000, maxBuffer: 2000000 },
  );
  return JSON.parse(await readFile(resolve(directory, "report.json"), "utf8"));
}
