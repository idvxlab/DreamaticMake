import type {
  LayoutDraft,
  GraphProjection,
  LayoutReport,
  LayoutProjection,
} from "../../../engine/interface/contracts";
export type {
  LayoutDraft,
  GraphProjection,
  LayoutReport,
  LayoutProjection,
} from "../../../engine/interface/contracts";
import { z } from "zod";
import type {
  EngineDiagnostic,
  EnginePose,
  EngineScene,
  EngineShape,
} from "./design-engine";

export const identityPose = (): EnginePose => ({
  translation_m: [0, 0, 0],
  rotation_xyzw: [0, 0, 0, 1],
});
export const emptyLayout = (): LayoutDraft => ({
  record_kind: "layout_draft",
  layout_version: 1,
  entities: {},
  bodies: {},
  envelopes: {},
  ports: {},
  edges: {},
  joints: {},
  transmissions: {},
  paths: [],
});
/** Add imported objects without replacing the design or rewriting asset identities. */
export function mergeLayout(
  base: LayoutDraft,
  imported: LayoutDraft,
  namespace: string,
): LayoutDraft {
  const next = structuredClone(base);
  const ref = (value: string) => `${namespace}/${value}`;
  for (const [id, value] of Object.entries(imported.entities))
    next.entities[ref(id)] = value;
  for (const [id, value] of Object.entries(imported.bodies))
    next.bodies[ref(id)] = { ...value, entity: ref(value.entity) };
  for (const [id, value] of Object.entries(imported.envelopes))
    next.envelopes[ref(id)] = { ...value, body: ref(value.body) };
  for (const [id, value] of Object.entries(imported.ports))
    next.ports[ref(id)] = {
      ...value,
      entity: ref(value.entity),
      body: value.body ? ref(value.body) : null,
    };
  for (const [id, value] of Object.entries(imported.edges))
    next.edges[ref(id)] = { ...value, members: value.members.map(ref) };
  for (const [id, value] of Object.entries(imported.joints))
    next.joints[ref(id)] = {
      ...value,
      parent: ref(value.parent),
      child: ref(value.child),
    };
  for (const [id, value] of Object.entries(imported.transmissions))
    next.transmissions[ref(id)] = {
      ...value,
      driver: ref(value.driver),
      follower: ref(value.follower),
    };
  next.paths.push(
    ...imported.paths.map((value) => ({
      ...value,
      source: ref(value.source),
      target: ref(value.target),
    })),
  );
  return next;
}
export const notebookSchema = z
  .object({
    version: z.literal(1),
    cells: z
      .array(
        z
          .object({ id: z.string().max(100), code: z.string().max(20000) })
          .strict(),
      )
      .max(16),
    inputs: z
      .array(
        z
          .object({
            name: z.string().regex(/^[A-Za-z_]\w{0,63}$/),
            value: z.number().finite(),
            min: z.number().finite(),
            max: z.number().finite(),
            step: z.number().positive().finite(),
          })
          .strict(),
      )
      .max(32),
    bindings: z
      .array(
        z
          .object({
            output: z.string().max(100),
            target: z.string().max(512),
            unit: z.enum(["rad", "deg", "m", "mm", "sample"]),
          })
          .strict(),
      )
      .max(32),
  })
  .strict()
  .superRefine((n, ctx) => {
    if (
      new Set(n.inputs.map((i) => i.name)).size !== n.inputs.length ||
      new Set(n.cells.map((c) => c.id)).size !== n.cells.length
    )
      ctx.addIssue({ code: "custom", message: "Duplicate notebook identity" });
    for (const i of n.inputs)
      if (i.min > i.max || i.value < i.min || i.value > i.max)
        ctx.addIssue({
          code: "custom",
          message: "Notebook input outside range",
        });
  });
export type NotebookDocument = z.infer<typeof notebookSchema>;
export const defaultNotebook = (): NotebookDocument => ({
  version: 1,
  cells: [
    {
      id: "control",
      code: '# 输入来自滑杆；输出用于临时预览\nangle = inputs["angle_deg"]\noutputs["angle"] = angle\noutputs["curve"] = [i * angle / 20 for i in range(21)]\nprint("目标角度:", angle)',
    },
  ],
  inputs: [{ name: "angle_deg", value: 0, min: -90, max: 90, step: 1 }],
  bindings: [],
});
export type WorkspaceRecord = {
  revision: number;
  draft: LayoutDraft;
  notebook: NotebookDocument;
  contextKey: string;
  baseDesignHash: string;
  pending: boolean;
};
export type WorkspaceState = {
  stage: string;
  contextKey: string;
  stale: boolean;
  record: WorkspaceRecord;
  origin: string;
  editable: boolean;
};
