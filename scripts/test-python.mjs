import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const candidates = [
  ".runtime/python/Scripts/python.exe",
  ".runtime/python/bin/python",
  ".venv-engine/Scripts/python.exe",
  ".venv-engine/bin/python",
];
const local = candidates.map((path) => resolve(root, path)).find(existsSync);
const python = process.env.MAKE_ENGINE_PYTHON || local || "python";
const temp = resolve(root, ".runtime/tmp/python-tests");
mkdirSync(temp, { recursive: true });

const requiredSuites = ["element/tests", "engine/tests", "process/tests"];
// Optional local examples are not part of every source checkout.
const exampleSuites = [
  "examples/project_2/software/Feather_RP2040_1/tests",
  "examples/project_4/software/Pico_1/tests",
].filter((suite) => existsSync(resolve(root, suite)));
for (const suite of [...requiredSuites, ...exampleSuites]) {
  console.log(`\nPython suite: ${suite}`);
  const result = spawnSync(
    python,
    ["-B", "-m", "unittest", "discover", "-s", suite, "-v"],
    {
      cwd: root,
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
        TEMP: temp,
        TMP: temp,
        TMPDIR: temp,
      },
      stdio: "inherit",
      windowsHide: true,
    },
  );
  if (result.error) {
    console.error(
      `Cannot run Python tests with ${python}: ${result.error.message}`,
    );
    console.error(
      "Install Python 3.11+, run pip install -r requirements.txt, and set MAKE_ENGINE_PYTHON if needed.",
    );
  }
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
