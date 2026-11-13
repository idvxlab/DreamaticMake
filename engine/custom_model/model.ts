export const EXAMPLE = `# 单位：mm；基本体以原点为中心。每次运行从头重建。
box outer 80 60 30
move outer_up outer 0 0 15
box cavity 76 56 30
move cavity_up cavity 0 0 17
subtract base outer_up cavity_up
cylinder hole 3 90
rotate hole_side hole 90 0 0
move port hole_side 0 0 14
subtract housing base port
show housing`;

export type ModelPart = {
  id: string;
  positions: number[];
  volume_mm3: number;
  bounds_mm: number[][];
};
export type ModelResult = {
  kernel: string;
  unit: "mm";
  parts: ModelPart[];
  command_count: number;
};

/** Binary STL in millimeters; material remains in the project, as STL has none. */
export function toSTL(part: ModelPart): ArrayBuffer {
  const count = part.positions.length / 9;
  const buffer = new ArrayBuffer(84 + count * 50);
  const view = new DataView(buffer);
  new Uint8Array(buffer, 0, 80).set(
    new TextEncoder().encode("Dreamatic custom model; units=mm"),
  );
  view.setUint32(80, count, true);
  for (let i = 0; i < count; i++) {
    const at = 84 + i * 50;
    const v = part.positions.slice(i * 9, i * 9 + 9);
    const a = [v[3] - v[0], v[4] - v[1], v[5] - v[2]],
      c = [v[6] - v[0], v[7] - v[1], v[8] - v[2]];
    const normal = [
      a[1] * c[2] - a[2] * c[1],
      a[2] * c[0] - a[0] * c[2],
      a[0] * c[1] - a[1] * c[0],
    ];
    const length = Math.hypot(...normal) || 1;
    [...normal.map((n) => n / length), ...v].forEach((n, j) =>
      view.setFloat32(at + j * 4, n, true),
    );
  }
  return buffer;
}
