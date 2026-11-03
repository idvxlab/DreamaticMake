import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const candidates = [
  ".venv-engine/Scripts/python.exe",
  ".venv-engine/bin/python",
];
const local = candidates.map((path) => resolve(root, path)).find(existsSync);
const python = process.env.MAKE_ENGINE_PYTHON || local || "python";

for (const suite of ["element/tests", "engine/tests"]) {
  console.log(`\nPython suite: ${suite}`);
  const result = spawnSync(
    python,
    ["-B", "-m", "unittest", "discover", "-s", suite, "-v"],
    {
      cwd: root,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
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
