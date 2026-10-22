import { z } from "zod";
import { Store, hash, HttpError } from "../../../packages/core/src/store";
import { currentStage } from "../../../packages/core/src/workflow";
import {
  stages,
  type Project,
  type StageId,
} from "../../../packages/core/src/contracts";
import { designForStage } from "../../../packages/core/src/agent-design";
import {
  defaultNotebook,
  emptyLayout,
  identityPose,
  notebookSchema,
  type LayoutDraft,
  type LayoutProjection,
  type WorkspaceState,
} from "../../../packages/core/src/design-workspace";
import { DesignEngine, engineContextKey } from "./design-engine";
import { readFile } from "node:fs/promises";
import { within } from "../../../packages/core/src/store";

const context = z.string().regex(/^[a-f0-9]{64}$/);
export class DesignWorkspace {
  constructor(
    readonly store: Store,
    readonly engine: DesignEngine,
  ) {}
  stage(p: Project): StageId {
    const s = currentStage(p);
    return !s
      ? "delivery"
      : stages.indexOf(s) < stages.indexOf("structure")
        ? "structure"
        : s;
  }
  async state(id: string): Promise<WorkspaceState> {
    const p = await this.store.get(id),
      stage = this.stage(p),
      contextKey = engineContextKey(p);
    const design = designForStage(p, stage);
    const saved = p.stages[stage].designWorkspace;
    if (saved)
      return {
        stage,
        contextKey,
        record: saved,
        stale: saved.contextKey !== contextKey,
        origin: "project-draft",
        editable: !p.archived && !!currentStage(p),
      };
    const inherited = stages
      .slice(0, stages.indexOf(stage))
      .reverse()
      .map((s) => p.stages[s].designWorkspace)
      .find(Boolean);
    let draft = emptyLayout();
    if (design)
      draft = (
        await this.engine.layout(id, "layout_import", {
          source: design.source,
          scenario: design.scenario,
        })
      ).draft;
    else {
      const catalog = await this.store.projectCatalog(id);
      p.selectedParts.forEach((partId, i) => {
        const part = catalog.find((c) => c.id === partId);
        const entity = `part_${i + 1}`,
          body = `${entity}/bodies/body`;
        draft.entities[entity] = {
          name: part?.name ?? partId,
          part_id: partId,
        };
        draft.bodies[body] = {
          entity,
          pose: { ...identityPose(), translation_m: [i * 0.06, 0, 0] },
        };
        if (part?.dimensions.height)
          draft.envelopes[`${entity}/envelopes/solid`] = {
            body,
            pose: identityPose(),
            shape: {
              kind: "box",
              size_m: [
                part.dimensions.width / 1000,
                part.dimensions.depth / 1000,
                part.dimensions.height / 1000,
              ],
            },
            purpose: "solid",
            approximation: "unknown",
            margin_m: 0,
          };
      });
    }
    return {
      stage,
      contextKey,
      stale: false,
      origin: design ? "stage-design" : "selected-parts",
      editable: !p.archived && !!currentStage(p),
      record: {
        revision: 0,
        draft,
        notebook: inherited?.notebook ?? defaultNotebook(),
        contextKey,
        baseDesignHash: hash(design ?? null),
        pending: false,
      },
    };
  }
  async operate(id: string, input: unknown, signal?: AbortSignal) {
    const data = z
      .object({
        method: z.enum([
          "layout_project",
          "layout_motion",
          "layout_collision",
          "layout_connectivity",
          "layout_import",
        ]),
        contextKey: context,
        draft: z.record(z.string(), z.unknown()).optional(),
        source: z.record(z.string(), z.unknown()).optional(),
        scenario: z.record(z.string(), z.unknown()).optional(),
        joint_inputs: z.record(z.string(), z.number().finite()).optional(),
      })
      .strict()
      .parse(input);
    const p = await this.store.get(id);
    if (p.running) throw new HttpError(409, "请等待项目任务结束");
    if (engineContextKey(p) !== data.contextKey)
      throw new HttpError(409, "项目输入已变化，请刷新设计工作台");
    const { contextKey, method, ...request } = data;
    const result = await this.engine.layout(id, method, request, signal);
    if (engineContextKey(await this.store.get(id)) !== contextKey)
      throw new HttpError(409, "项目输入已变化，结果未发布");
    return result;
  }
  async cadAssets(id: string, signal?: AbortSignal) {
    const p = await this.store.get(id),
      fingerprint = engineContextKey(p);
    const artifacts = p.stages.cad.artifacts.filter((a) =>
      ["base.stl", "lid.stl"].includes(a.name),
    );
    if (!artifacts.length) throw new HttpError(409, "请先生成实际 CAD 构件");
    await this.store.verify(id, artifacts);
    const existing = await this.engine.meshes.list(id),
      result = [];
    for (const a of artifacts) {
      const mesh =
        existing.find((m) => m.sha256 === a.hash) ??
        (await this.engine.uploadMesh(
          id,
          {
            name: a.name,
            unit: "mm",
            data: (await readFile(within(this.store.dir(id), a.path))).toString(
              "base64",
            ),
          },
          signal,
        ));
      result.push({
        ...mesh,
        assemblyPose:
          a.name === "lid.stl"
            ? {
                translation_m: [0, 0, p.parameters.height / 1000],
                rotation_xyzw: [1, 0, 0, 0],
              }
            : identityPose(),
      });
    }
    if (engineContextKey(await this.store.get(id)) !== fingerprint)
      throw new HttpError(409, "CAD 输入已变化，请重试");
    return result;
  }
  async save(id: string, input: unknown, signal?: AbortSignal, agent = false) {
    const data = z
      .object({
        contextKey: context,
        baseRevision: z.number().int().nonnegative(),
        draft: z.record(z.string(), z.unknown()),
        notebook: notebookSchema,
      })
      .strict()
      .parse(input);
    const before = await this.state(id);
    if (
      before.contextKey !== data.contextKey ||
      before.record.revision !== data.baseRevision
    )
      throw new HttpError(409, "设计版本冲突，请重新加载");
    const projection: LayoutProjection = await this.engine.layout(
      id,
      "layout_project",
      { draft: data.draft },
      signal,
    );
    const draft = projection.draft;
    const physicalChanged = hash(draft) !== hash(before.record.draft);
    if (before.stage === "cad" && physicalChanged) {
      const source = designForStage(await this.store.get(id), "structure");
      if (!source) throw new HttpError(409, "缺少已确认的结构设计");
      const baseline: LayoutDraft = (
        await this.engine.layout(
          id,
          "layout_import",
          { source: source.source, scenario: source.scenario },
          signal,
        )
      ).draft;
      for (const collection of [
        "entities",
        "bodies",
        "envelopes",
        "ports",
        "edges",
        "joints",
        "transmissions",
      ] as const) {
        for (const [key, value] of Object.entries(baseline[collection])) {
          if (hash(draft[collection][key] ?? null) !== hash(value))
            throw new HttpError(
              409,
              "CAD 可追加构件；修改已确认布局需先重新打开结构阶段：" + key,
            );
        }
      }
      if (
        baseline.paths.some(
          (path) => !draft.paths.some((next) => hash(next) === hash(path)),
        )
      )
        throw new HttpError(409, "CAD 不得删除已确认的连接路径");
    }
    await this.store.update(id, (p) => {
      const stage = this.stage(p);
      if (
        (!agent && p.running) ||
        p.archived ||
        !currentStage(p) ||
        stage !== before.stage ||
        engineContextKey(p) !== data.contextKey ||
        (p.stages[stage].designWorkspace?.revision ?? 0) !== data.baseRevision
      )
        throw new HttpError(409, "设计版本或编辑权限已变化");
      if (!["structure", "cad"].includes(stage) && physicalChanged)
        throw new HttpError(
          409,
          "修改物理布局需先重新打开结构阶段；下游可编辑逻辑实验",
        );
      p.stages[stage].review = undefined;
      p.stages[stage].designWorkspace = {
        revision: data.baseRevision + 1,
        draft,
        notebook: data.notebook,
        contextKey: "",
        baseDesignHash: before.record.baseDesignHash,
        pending:
          before.record.pending || hash(draft) !== hash(before.record.draft),
      };
      p.stages[stage].designWorkspace!.contextKey = engineContextKey(p);
    });
    return { state: await this.state(id), projection };
  }
}
