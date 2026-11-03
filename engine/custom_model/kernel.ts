import modeling from "@jscad/modeling";
import type { Geom3 } from "@jscad/modeling/src/geometries/types";

export const KERNEL = "@jscad/modeling@2.13.0";
import type { ModelResult } from "./model";

/** Small declarative command language; never evaluates JavaScript or Python. */
export function buildModel(source: string): ModelResult {
  if (source.length > 64000) throw new Error("命令文本最多 64 KB");
  const {
    primitives: p,
    booleans: b,
    transforms: t,
    extrusions: e,
    geometries: g,
    modifiers: m,
    measurements,
  } = modeling;
  const objects = new Map<string, Geom3>();
  const shown = new Set<string>();
  let count = 0;
  let last = "";
  const get = (id: string) => {
    const shape = objects.get(id);
    if (!shape) throw new Error(`未定义实体：${id}`);
    return shape;
  };
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    const tokens = line.split("#")[0].trim().split(/\s+/);
    if (!tokens[0]) continue;
    try {
      if (++count > 200) throw new Error("每次最多执行 200 条命令");
      const [op, id, ...args] = tokens;
      if (!id || !/^[A-Za-z][\w-]{0,63}$/.test(id))
        throw new Error("实体名称需以英文字母开头");
      if (op === "show") {
        if (args.length) throw new Error("用法：show 实体名");
        get(id);
        shown.add(id);
        continue;
      }
      if (objects.has(id)) throw new Error(`实体名称重复：${id}，请使用新名称`);
      const nums = (offset: number, length: number, positive = false) => {
        if (args.length !== offset + length) throw new Error("参数数量不正确");
        return args.slice(offset).map((v) => {
          const n = Number(v);
          if (
            !Number.isFinite(n) ||
            Math.abs(n) > 100000 ||
            (positive && n <= 0)
          )
            throw new Error(
              "需要有限数值（尺寸必须大于零，绝对值上限 100000）",
            );
          return n;
        });
      };
      let shape: Geom3;
      switch (op) {
        case "box":
          shape = p.cuboid({
            size: nums(0, 3, true) as [number, number, number],
          });
          break;
        case "cylinder": {
          const [radius, height] = nums(0, 2, true);
          shape = p.cylinder({ radius, height, segments: 48 });
          break;
        }
        case "sphere":
          shape = p.sphere({ radius: nums(0, 1, true)[0], segments: 32 });
          break;
        case "move":
          shape = t.translate(
            nums(1, 3) as [number, number, number],
            get(args[0]),
          );
          break;
        case "rotate":
          shape = t.rotate(
            nums(1, 3).map((n) => (n * Math.PI) / 180) as [
              number,
              number,
              number,
            ],
            get(args[0]),
          );
          break;
        case "union":
        case "subtract":
        case "intersect":
          if (args.length < 2 || args.length > 20)
            throw new Error("布尔操作需要 2～20 个已定义实体");
          shape = b[op](...args.map(get));
          break;
        case "extrude": {
          if (args.length < 4 || args.length > 65)
            throw new Error("用法：extrude 名称 高度 x,y x,y x,y …");
          const height = Number(args[0]);
          const points = args
            .slice(1)
            .map((pair) => pair.split(",").map(Number));
          if (
            !Number.isFinite(height) ||
            height <= 0 ||
            height > 100000 ||
            points.some(
              (v) =>
                v.length !== 2 ||
                v.some((n) => !Number.isFinite(n) || Math.abs(n) > 100000),
            )
          )
            throw new Error("拉伸高度或轮廓坐标无效");
          shape = e.extrudeLinear(
            { height },
            p.polygon({ points: points as [number, number][] }),
          );
          break;
        }
        default:
          throw new Error(`未知命令：${op}`);
      }
      objects.set(id, shape);
      last = id;
    } catch (error) {
      throw new Error(`第 ${index + 1} 行：${(error as Error).message}`);
    }
  }
  if (!last) throw new Error("请输入建模命令");
  if (!shown.size) shown.add(last);
  let triangleCount = 0;
  const parts = [...shown].map((id) => {
    const shape = get(id);
    // Upstream 2.13.0 declares a default export here but only names the overloads.
    const generalize = m.generalize as unknown as (
      options: { snap: boolean; triangulate: boolean },
      shape: Geom3,
    ) => Geom3;
    const triangles = g.geom3.toPolygons(
      generalize({ snap: true, triangulate: true }, shape),
    );
    const positions: number[] = [];
    for (const polygon of triangles) {
      for (let i = 1; i + 1 < polygon.vertices.length; i++) {
        if (++triangleCount > 200000)
          throw new Error("输出超过 200000 个三角形");
        positions.push(
          ...polygon.vertices[0],
          ...polygon.vertices[i],
          ...polygon.vertices[i + 1],
        );
      }
    }
    if (!positions.length || positions.some((v) => !Number.isFinite(v)))
      throw new Error(`实体 ${id} 为空或无法输出网格`);
    return {
      id,
      positions,
      volume_mm3: measurements.measureVolume(shape),
      bounds_mm: measurements.measureBoundingBox(shape),
    };
  });
  return { kernel: KERNEL, unit: "mm", parts, command_count: count };
}
