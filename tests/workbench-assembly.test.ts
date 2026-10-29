import test from "node:test";
import assert from "node:assert/strict";
import {
  assemblyDesignSchema,
  ASSEMBLY_VERSION,
} from "../packages/workbench/assembly-contracts";
import { executeAssemblyDesign } from "../packages/workbench/assembly-tools";
const design = () => ({
  version: ASSEMBLY_VERSION,
  units: "mm",
  geometryFrame: "xyz-mm-center-z-up/1",
  appearanceRef: {
    modelId: "123e4567-e89b-42d3-a456-426614174000",
    revision: "a".repeat(64),
  },
  shellSha256: "b".repeat(64),
  outerSha256: "c".repeat(64),
  instances: [
    {
      id: "board",
      geometryRef: {
        source: "curated",
        recordId: "fixture",
        assetId: "source.step",
        revision: "d".repeat(64),
        sha256: "e".repeat(64),
      },
      translationMm: [0, 0, 0],
      rotationDeg: [0, 0, 0],
    },
  ],
  split: { axis: "z", atMm: 10, gapMm: 0.4 },
  mounts: [
    {
      id: "mount",
      kind: "mount",
      centerMm: [0, 0],
      baseZMm: 0,
      topZMm: 5,
      radiusMm: 3,
      holeRadiusMm: 1,
      instanceId: "board",
    },
  ],
  keepouts: [
    {
      id: "wire",
      kind: "wire",
      centerMm: [0, 0, 0],
      sizeMm: [10, 3, 3],
      assumption: "Explicit straight clearance corridor",
    },
  ],
  print: {
    bedMm: [100, 100, 100],
    material: "PLA assumption",
    clearanceAssumption: "Nominal geometry only",
  },
  assemblyOrder: [
    "Install board",
    "Route harness",
    "Locate lid; fastening unverified",
  ],
});
test("versioned assembly retains pinned assets and explicit print/assembly assumptions", () => {
  const parsed = assemblyDesignSchema.parse(design());
  assert.equal(parsed.instances[0].id, "board");
  assert.equal(parsed.split.gapMm, 0.4);
  assert(
    !assemblyDesignSchema.safeParse({
      ...design(),
      version: "dreamatic.appearance/1",
    }).success,
  );
});
test("invalid mount targets, split crossing, inverted dimensions and duplicate instances reject", () => {
  for (const mutate of [
    (d: ReturnType<typeof design>) => {
      d.mounts[0].instanceId = "missing";
    },
    (d: ReturnType<typeof design>) => {
      d.mounts[0].topZMm = 12;
    },
    (d: ReturnType<typeof design>) => {
      d.mounts[0].holeRadiusMm = 4;
    },
    (d: ReturnType<typeof design>) => {
      d.instances.push(d.instances[0]);
    },
  ]) {
    const d = design();
    mutate(d);
    assert(!assemblyDesignSchema.safeParse(d).success);
  }
});
test("executor rejects incomplete baseline and missing source paths before launching worker", async () => {
  await assert.rejects(
    executeAssemblyDesign(
      design(),
      { shellFile: "unused", outerFile: "unused", instances: {} },
      ["board", "retained"],
      "/tmp/unused-assembly",
    ),
    /baseline/,
  );
  await assert.rejects(
    executeAssemblyDesign(
      design(),
      { shellFile: "unused", outerFile: "unused", instances: {} },
      ["board"],
      "/tmp/unused-assembly",
    ),
    /Missing resolved STEP/,
  );
});

test("closure schema retains optional compatibility and requires valid separated locating/fastening features", () => {
  const locator = (id: string, x: number, y: number) => ({
    id,
    centerMm: [x, y],
    pinRadiusMm: 1.5,
    bossRadiusMm: 3.5,
    anchorDepthMm: 3,
    engagementMm: 3,
    radialClearanceMm: 0.2,
    axialClearanceMm: 0.3,
    roofMm: 1,
  });
  const fastener = (id: string, x: number, y: number) => ({
    id,
    centerMm: [x, y],
    baseZMm: 0,
    bossRadiusMm: 3.5,
    pilotRadiusMm: 1.25,
    screwRadiusMm: 1.5,
    clearanceRadiusMm: 1.8,
    headRadiusMm: 3,
    source: { basis: "assumed", reference: "M3x16 assumption" },
    pilotDepthMm: 8,
    screwLengthMm: 16,
    minEngagementMm: 4,
    tipClearanceMm: 0.5,
  });
  const input = {
    ...design(),
    closure: {
      assumption: "Unmeasured PLA fit",
      locators: [locator("a", 20, -15), locator("b", 20, 15)],
      fasteners: [fastener("c", -20, -15), fastener("d", -20, 15)],
    },
  };
  assert(assemblyDesignSchema.safeParse(input).success);
  assert(assemblyDesignSchema.safeParse(design()).success);
  input.closure.locators[1].centerMm = [20, -15];
  assert(!assemblyDesignSchema.safeParse(input).success);
  input.closure.locators[1].centerMm = [20, 15];
  input.closure.fasteners[0].headRadiusMm = 1;
  assert(!assemblyDesignSchema.safeParse(input).success);
});
