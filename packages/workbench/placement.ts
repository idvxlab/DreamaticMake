import { Euler, MathUtils, Vector3 } from "three";

const vector = (v: unknown): v is [number, number, number] =>
  Array.isArray(v) &&
  v.length === 3 &&
  v.every((n) => typeof n === "number" && Number.isFinite(n));

// The viewer centers source meshes. Convert an explicit native-origin transform
// using the same XYZ Euler convention as the renderer.
export function placementCenter(
  properties: Record<string, unknown>,
): [number, number, number] | undefined {
  if (vector(properties.positionMm)) return [...properties.positionMm];
  if (
    properties.sourceFrame !== "source-cad-native/1" ||
    !vector(properties.translationMm)
  )
    return;
  const bounds = properties.geometryBounds as
    | { minMm?: unknown; maxMm?: unknown }
    | undefined;
  if (!bounds || !vector(bounds.minMm) || !vector(bounds.maxMm)) return;
  const rotation = properties.rotationDeg ?? [0, 0, 0];
  if (!vector(rotation)) return;
  const center = new Vector3(...bounds.minMm)
    .add(new Vector3(...bounds.maxMm))
    .multiplyScalar(0.5);
  const angles = rotation.map(MathUtils.degToRad) as [number, number, number];
  center.applyEuler(new Euler(angles[0], angles[1], angles[2], "XYZ"));
  center.add(new Vector3(...properties.translationMm));
  return center.toArray() as [number, number, number];
}
