import assert from "node:assert/strict";
import { mkdir, writeFile, readFile, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  generateCad,
  buildFirmware,
  firmwareSource,
  runProcess,
} from "../packages/core/src/worker";
import { sandboxCommand } from "../packages/core/src/sandbox";
import { Settings } from "../packages/core/src/settings";
import { defaultEnclosure } from "../packages/core/src/contracts";
const root = resolve("."),
  dir = resolve("workspace/validation");
await mkdir(dir, { recursive: true });
const config = await new Settings(root).snapshot();
config.MAKE_WORKER_TIMEOUT = "600";
const parameters = {
  ...defaultEnclosure,
  holes: [{ x: 32, y: 20, diameter: 3 }],
  ports: [{ face: "front" as const, x: 0, y: 12, width: 12, height: 7 }],
  mounts: [{ x: -20, y: -20, height: 4, outerDiameter: 6, holeDiameter: 2.5 }],
  components: [
    {
      partId: "fixture-board",
      x: 0,
      y: 0,
      z: 7,
      width: 21,
      depth: 40,
      height: 5,
    },
  ],
};
const report = await generateCad(
  root,
  join(dir, "assembly"),
  parameters,
  config,
);
assert(
  report.ok &&
    report.checks.watertight &&
    report.checks.component_envelopes_fit,
);
assert(report.checks.height_matches_parameter);
assert(report.checks.print_parts_on_bed);
assert(report.checks.enclosure_no_interference);
assert.equal(report.component_count, 1);
assert((await readFile(join(dir, "assembly/assembly.step"))).length > 1000);
await assert.rejects(
  () =>
    generateCad(
      root,
      join(dir, "collision"),
      { ...parameters, components: [{ ...parameters.components[0], x: 50 }] },
      config,
    ),
  /does not fit/,
);
const canary = join(dir, "private-canary.txt");
await writeFile(canary, "not accessible");
const job = join(dir, "isolation");
await mkdir(job, { recursive: true });
const sandbox = await sandboxCommand(root, job, resolve(".venv/bin/python"), [
  "-c",
  `from pathlib import Path\ntry: Path(${JSON.stringify(canary)}).read_text(); print('LEAK')\nexcept PermissionError: print('READ_DENIED')\nPath('allowed.txt').write_text('ok')\ntry: Path(${JSON.stringify(join(dir, "outside.txt"))}).write_text('bad'); print('WRITE_LEAK')\nexcept PermissionError: print('WRITE_DENIED')`,
]);
const check = await runProcess(sandbox.command, sandbox.args, {
  cwd: job,
  timeout: 10000,
});
assert.match(check.stdout, /READ_DENIED/);
assert.match(check.stdout, /WRITE_DENIED/);
assert(!check.stdout.includes("LEAK"));
const firmware = await buildFirmware(
  root,
  join(dir, "firmware"),
  firmwareSource,
  config,
);
assert(firmware.ok && !firmware.physicalTested);
await writeFile(
  join(dir, "validation-summary.json"),
  JSON.stringify({ cad: report, isolation: check.stdout, firmware }, null, 2),
);
console.log(
  "Engineering PASS: 参数化开孔/支柱/装配、STEP 回读、STL 闭合、碰撞拒绝、私有文件隔离、Pico 实际编译",
);
