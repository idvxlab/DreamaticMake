import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { DesignEngine, engineContextKey } from "./design-engine";
import {
  Store,
  hash,
  HttpError,
  within,
} from "../../../packages/core/src/store";
import { currentStage, inputHash } from "../../../packages/core/src/workflow";
import {
  designForStage,
  engineDesignSchema,
  evaluateDesign,
  type EngineDesign,
} from "../../../packages/core/src/agent-design";
import { stages, type StageId } from "../../../packages/core/src/contracts";
import { DesignWorkspace } from "./design-workspace";

export const layoutInputSchema = engineDesignSchema
  .omit({ version: true, bundle: true })
  .extend({
    // Scenario snapshot IDs are materialized by Python after compilation.
    scenario: z.record(z.string(), z.unknown()),
  });

/** Runtime-bound tools only. This service cannot make approval decisions. */
export class AgentEngine {
  get workspace() {
    return new DesignWorkspace(this.store, this.engine);
  }
  constructor(
    readonly root: string,
    readonly store: Store,
    readonly engine: DesignEngine,
  ) {}
  async library(id: string, query: string) {
    const project = await this.store.get(id);
    const terms = query
      .toLowerCase()
      .split(/[\s,，]+/)
      .filter(Boolean);
    const templates = [];
    for (const file of await readdir(
      join(this.root, "engine/examples/components"),
    )) {
      if (!file.endsWith(".json") || file.endsWith(".scenario.json")) continue;
      const component = JSON.parse(
        await readFile(
          join(this.root, "engine/examples/components", file),
          "utf8",
        ),
      );
      if (
        !terms.length ||
        terms.some((term) =>
          JSON.stringify(component).toLowerCase().includes(term),
        )
      )
        templates.push({
          file,
          evidence: "synthetic-template-only",
          component,
        });
    }
    return {
      hardwareFeatures: project.stages.hardware.draft?.hardwareFeatures ?? [],
      templates: templates.slice(0, 8),
      instructions:
        "先复用已选硬件的 engineComponent。示例只是分类契约模板，假设尺寸/性能不得冒充真实器件。",
    };
  }
  async compose(
    id: string,
    stage: StageId,
    revision: number,
    input: unknown,
    signal?: AbortSignal,
  ): Promise<EngineDesign> {
    const data = layoutInputSchema.parse(input),
      p = await this.store.get(id);
    if (
      !["structure", "cad", "firmware"].includes(stage) ||
      currentStage(p) !== stage ||
      p.stages[stage].revision !== revision
    )
      throw new HttpError(409, "当前角色不能编辑布局");
    const before = inputHash(p, stage);
    const components = data.source.components as
      | Record<string, any>
      | undefined;
    if (!components || !Object.keys(components).length)
      throw new HttpError(400, "布局需要元件实例");
    for (const part of p.selectedParts)
      if (!data.bindings.some((binding) => binding.partId === part))
        throw new HttpError(400, "布局遗漏已选硬件：" + part);
    const instances = new Set<string>();
    for (const binding of data.bindings) {
      if (
        !p.selectedParts.includes(binding.partId) ||
        !components[binding.instanceId] ||
        instances.has(binding.instanceId)
      )
        throw new HttpError(400, "布局硬件绑定无效或重复");
      instances.add(binding.instanceId);
    }
    for (const constraint of data.constraints)
      if (constraint.instanceIds.some((instance) => !components[instance]))
        throw new HttpError(400, "建模约束引用不存在的实例");
    if (!data.checks.some((check) => check.kind === "collision_free"))
      throw new HttpError(400, "必须保留布局碰撞检查");
    if (
      new Set(data.checks.map((check) => check.id)).size !== data.checks.length
    )
      throw new HttpError(400, "检查 ID 不得重复");
    const upstream =
      stage === "structure"
        ? undefined
        : designForStage(p, stage === "cad" ? "structure" : "cad");
    if (stage !== "structure" && !upstream)
      throw new HttpError(409, "缺少已确认布局");
    if (upstream) {
      const original = upstream.source.components as Record<string, any>;
      for (const [instance, component] of Object.entries(original)) {
        const proposed = components[instance];
        const physical = (item: any) => {
          const { control_functions, behaviors, firmware, revision, ...rest } =
            item ?? {};
          return rest;
        };
        if (
          !proposed ||
          (stage === "cad"
            ? hash(proposed) !== hash(component)
            : hash(physical(proposed)) !== hash(physical(component)))
        )
          throw new HttpError(
            409,
            "下游不得改变已确认元件或物理接口：" + instance,
          );
      }
      if (
        hash(data.bindings) !== hash(upstream.bindings) ||
        hash(data.constraints) !== hash(upstream.constraints)
      )
        throw new HttpError(409, "下游不得改变已确认硬件绑定或建模约束");
      for (const field of ["connections", "joints", "transmissions"])
        if (
          hash(data.source[field] ?? {}) !== hash(upstream.source[field] ?? {})
        )
          throw new HttpError(409, "下游不得改变装配连接");
      if (
        stage === "firmware" &&
        Object.keys(components).length !== Object.keys(original).length
      )
        throw new HttpError(409, "软件阶段不得添加物理元件");
      const roots = data.scenario.roots as any[] | undefined;
      if (
        !roots ||
        (upstream.scenario.roots as any[]).some(
          (root) => !roots.some((next) => hash(next) === hash(root)),
        ) ||
        (stage === "firmware" && hash(roots) !== hash(upstream.scenario.roots))
      )
        throw new HttpError(409, "下游不得移动已确认布局");
      if (
        upstream.checks.some(
          (check) => !data.checks.some((next) => hash(next) === hash(check)),
        )
      )
        throw new HttpError(409, "下游不得删除或削弱已确认目标检查");
    }
    if (stage === "cad") {
      for (const name of ["base.stl", "lid.stl"]) {
        const artifact = p.stages.cad.artifacts.find((a) => a.name === name);
        const represented = Object.values(components).some((component: any) =>
          Object.values(
            component.geometry?.envelopes ??
              component.physical?.geometry?.envelopes ??
              {},
          ).some(
            (envelope: any) =>
              envelope.shape?.kind === "triangle_mesh" &&
              envelope.shape.asset_ref?.sha256 === artifact?.hash,
          ),
        );
        if (!artifact || !represented)
          throw new HttpError(409, "布局必须回传实际 CAD 构件：" + name);
      }
    }
    const source = {
      ...data.source,
      components: Object.fromEntries(
        Object.entries(components).map(([instance, component]) => {
          const original = (
            upstream?.source.components as Record<string, any> | undefined
          )?.[instance];
          return [
            instance,
            stage === "firmware" &&
            original &&
            hash(component) !== hash(original)
              ? { ...component, revision: Number(original.revision ?? 1) + 1 }
              : component,
          ];
        }),
      ),
      input_revisions: Object.fromEntries(
        stages
          .slice(0, stages.indexOf(stage) + 1)
          .map((name) => [name, p.stages[name].revision]),
      ),
    };
    const documents = await this.engine.authoring(
      id,
      "compose",
      { design: source, scenario: data.scenario },
      signal,
    );
    if (inputHash(await this.store.get(id), stage) !== before)
      throw new HttpError(409, "布局输入已变化，请重新编排");
    if (p.stages[stage].designWorkspace?.pending) {
      const imported = await this.engine.layout(
        id,
        "layout_import",
        { source: documents.bundle, scenario: documents.scenario },
        signal,
      );
      const proposed = await this.engine.layout(
        id,
        "layout_project",
        { draft: imported.draft },
        signal,
      );
      const pending = await this.engine.layout(
        id,
        "layout_project",
        { draft: p.stages[stage].designWorkspace!.draft },
        signal,
      );
      if (proposed.snapshot_id !== pending.snapshot_id)
        throw new HttpError(
          409,
          "正式设计尚未包含工作台布局；请读取 engine_workspace 并保留用户的布局和连接",
        );
    }
    return engineDesignSchema.parse({
      ...data,
      version: 1,
      source,
      ...documents,
    });
  }
  async verify(
    id: string,
    stage: StageId,
    revision: number,
    signal?: AbortSignal,
  ) {
    const p = await this.store.get(id),
      design = designForStage(p, stage);
    if (
      !design ||
      !p.stages[stage].draft ||
      currentStage(p) !== stage ||
      p.stages[stage].revision !== revision
    )
      throw new HttpError(409, "缺少当前版本待审阅设计");
    if (p.stages[stage].designWorkspace?.pending) {
      // Only reconcile the submitted design, never a candidate returned by compose.
      const imported = await this.engine.layout(
        id,
        "layout_import",
        { source: design.bundle, scenario: design.scenario },
        signal,
      );
      const actual = await this.engine.layout(
        id,
        "layout_project",
        { draft: imported.draft },
        signal,
      );
      const expected = await this.engine.layout(
        id,
        "layout_project",
        { draft: p.stages[stage].designWorkspace!.draft },
        signal,
      );
      if (actual.snapshot_id !== expected.snapshot_id)
        throw new HttpError(409, "待审阅设计尚未包含工作台布局");
      await this.store.update(id, (current) => {
        if (inputHash(current, stage) !== inputHash(p, stage))
          throw new HttpError(409, "工作台布局已变化");
        current.stages[stage].designWorkspace!.pending = false;
      });
    }
    const state = await this.engine.requestForAgent(
      id,
      {
        method: "workspace",
        bundle: design.bundle,
        scenario: design.scenario,
        contextKey: engineContextKey(p),
      },
      stage,
      revision,
      signal,
    );
    const record = state.record!;
    const evaluation = evaluateDesign(
      design,
      record.reply.type === "result" ? record.reply.payload : undefined,
    );
    if (record.reply.type === "error")
      evaluation.limitations.push(
        ...record.reply.diagnostics.map((d) => d.message),
      );
    const evidence = { designHash: hash(design), ...evaluation };
    const artifact = await this.store.artifact(
      id,
      stage,
      revision,
      "engine-verification.json",
      JSON.stringify({ ...evidence, record }, null, 2),
      "application/json",
    );
    await this.store.update(id, (current) => {
      if (inputHash(current, stage) !== inputHash(p, stage))
        throw new HttpError(409, "验证输入已失效");
      current.stages[stage].artifacts = [
        ...current.stages[stage].artifacts.filter(
          (a) => a.name !== artifact.name,
        ),
        artifact,
      ];
    });
    return { ...evidence, artifactId: artifact.id };
  }
  async importCad(id: string, signal?: AbortSignal) {
    const p = await this.store.get(id);
    if (currentStage(p) !== "cad")
      throw new HttpError(409, "仅 CAD 阶段可回传构件");
    const artifacts = p.stages.cad.artifacts.filter((a) =>
      ["base.stl", "lid.stl"].includes(a.name),
    );
    if (artifacts.length !== 2)
      throw new HttpError(409, "请先实际生成外壳 CAD");
    await this.store.verify(id, artifacts);
    const components: Record<string, unknown> = {};
    for (const artifact of artifacts) {
      const data = await readFile(within(this.store.dir(id), artifact.path));
      const mesh = await this.engine.uploadMesh(
        id,
        { name: artifact.name, unit: "mm", data: data.toString("base64") },
        signal,
      );
      const instance =
        artifact.name === "base.stl" ? "custom_base" : "custom_lid";
      components[instance] = {
        record_kind: "component_design",
        design_version: "1",
        category: "structure",
        id: instance,
        name: artifact.name,
        geometry: {
          root_body: "body",
          bodies: { body: {} },
          envelopes: {
            solid: {
              body_ref: "body",
              approximation: "outer",
              shape: {
                kind: "triangle_mesh",
                unit: "mm",
                collision_mode: "solid",
                asset_ref: {
                  artifact_id: mesh.id,
                  sha256: mesh.sha256,
                  media_type: "model/stl",
                },
              },
            },
          },
        },
      };
    }
    return {
      components,
      instructions:
        "STL 是打印坐标：base 放在原点；lid 已翻转放床，装配时绕 X 旋转 180°，平移 Z=外壳高度（m）。加入上游 source.components 后 engine_layout；保留既有硬件位姿，补充两个壳体根位姿。",
    };
  }
}
