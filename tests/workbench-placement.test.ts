import test from "node:test";
import assert from "node:assert/strict";
import { placementCenter } from "../packages/workbench/placement";

test("native CAD translation rotates the original bounds center before placing a centered preview mesh", () => {
  const props = {
    sourceFrame: "source-cad-native/1",
    translationMm: [8.889962, -48.888045, 6.2],
    rotationDeg: [0, 0, 90],
    geometryBounds: {
      minMm: [-1.1119550983339168, -0.00007588608398800822, -3.200000008742275],
      maxMm: [43.18, 17.78, 8.500000055513455],
    },
  };
  const center = placementCenter(props)!;
  assert(Math.abs(center[0]) < 0.000001);
  assert(Math.abs(center[1] + 27.854022549166958) < 0.000001);
  assert(Math.abs(center[2] - 8.85000002338559) < 0.000001);
  assert.deepEqual(
    placementCenter({ ...props, positionMm: [1, 2, 3] }),
    [1, 2, 3],
  );
  assert.equal(
    placementCenter({ ...props, sourceFrame: "unknown" }),
    undefined,
  );
  assert.equal(
    placementCenter({ ...props, rotationDeg: [0, NaN, 90] }),
    undefined,
  );
});
