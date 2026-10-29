import test from "node:test";
import assert from "node:assert/strict";
import {
  imagePreviewItems,
  inheritedImagePackets,
} from "../packages/workbench/image-preview";
import { renderLayoutViews } from "../packages/workbench/layout-tools";
import type { HardwareLibrary } from "../packages/workbench/hardware";
import type {
  Packet,
  Project,
  Invocation,
} from "../packages/workbench/contracts";
import { emptyData } from "./workbench-fixtures";

const packet = (id: string, items: Packet["data"]["structure"]): Packet => ({
  version: "dreamatic.workbench/1",
  id,
  invocationId: id,
  inputs: [],
  summary: id,
  evidence: "proposal",
  data: { ...emptyData(), structure: items },
});
const image = (id: string, imageSet: string, view: string) => ({
  id,
  kind: "generated-image",
  label: id,
  properties: { imageSet, view, imageUrl: `/workbench-api/images/${id}` },
  references: [],
});
const node = (
  id: string,
  inputs: string[],
  p: Packet,
  role: "designer" | "coordinator" = "designer",
): Invocation => ({ id, role, inputs, title: id, status: "done", packet: p });

test("two visual groups share upstream outlines without mixing histories or hiding same-view requests", () => {
  const old = node(
    "history",
    [],
    packet("history", [image("old", "legacy", "front")]),
  );
  const manager = node(
    "manager",
    [old.id],
    packet("manager", []),
    "coordinator",
  );
  const layout = node(
    "layout",
    [],
    packet("layout", [image("layout-front", "component_layout", "front")]),
  );
  const current = node(
    "appearance",
    [manager.id, layout.id],
    packet("appearance", [
      image("appearance-front", "appearance", "front"),
      image("appearance-top", "appearance", "top"),
      {
        id: "pending-layout-top",
        kind: "image-request",
        label: "待生成零件俯视",
        properties: {
          imageSet: "component_layout",
          view: "top",
          prompt: "outline",
        },
        references: [],
      },
    ]),
  );
  const project: Project = {
    version: "dreamatic.workbench/1",
    id: "p",
    brief: "case",
    phase: "complete",
    questions: [],
    answers: {},
    nodes: [old, manager, layout, current],
    plan: [],
    createdAt: "2026-10-27",
  };
  const result = imagePreviewItems(
    current,
    inheritedImagePackets(project, current),
  );
  assert.deepEqual(
    result.items.map((i) => i.id),
    [
      "layout-front",
      "appearance-front",
      "appearance-top",
      "pending-layout-top",
    ],
  );
  assert(!result.ids.has("old"));
});

test("part-outline rendering refuses unknown sources, stale geometry and unresolved positions rather than inventing them", async () => {
  await assert.rejects(
    () => renderLayoutViews([], "missing", async () => {}),
    /必须依赖/,
  );
  const ref = {
    source: "arduino",
    recordId: "board",
    revision: "a".repeat(64),
    assetId: "step",
    sha256: "b".repeat(64),
  };
  const source = packet("structure", [
    {
      id: "board-placement",
      kind: "component",
      label: "board",
      properties: { geometryRef: ref },
      references: [],
    },
  ]);
  const geometry = {
    sha256: ref.sha256,
    reference: ref,
    minMm: [0, 0, 0],
    maxMm: [10, 20, 2],
  };
  const library = {
    inspect: async () => geometry,
    mesh: async () => ({ file: "unused-fixture.stl" }),
  } as unknown as HardwareLibrary;
  await assert.rejects(
    () =>
      renderLayoutViews([source], source.invocationId, async () => {}, library),
    /明确/,
  );
  source.data.structure[0].properties.positionMm = [0, 0, 1];
  await assert.rejects(
    () =>
      renderLayoutViews([source], source.invocationId, async () => {}, library),
    /外壳提案包络/,
  );
  const changed = {
    ...library,
    inspect: async () => ({
      ...geometry,
      reference: { ...ref, revision: "c".repeat(64) },
    }),
  } as unknown as HardwareLibrary;
  await assert.rejects(
    () =>
      renderLayoutViews([source], source.invocationId, async () => {}, changed),
    /版本已变化/,
  );
});

test("completed outline evidence survives an unrelated model-format failure only for the same layout source", () => {
  const structure: Invocation = {
    ...node("structure", [], packet("structure", [])),
    role: "mechanical",
  };
  const outline = image("saved-outline", "component_layout", "front");
  Object.assign(outline.properties, { layoutSourceInvocationId: structure.id });
  const failed: Invocation = {
    ...node("failed", [structure.id], packet("failed", [])),
    status: "error",
    packet: undefined,
    imageEvidence: [packet("outline-proof", [outline])],
  };
  const current = node(
    "current",
    [structure.id],
    packet("current", [image("surface", "appearance", "front")]),
  );
  const project: Project = {
    version: "dreamatic.workbench/1",
    id: "p",
    brief: "case",
    phase: "complete",
    questions: [],
    answers: {},
    nodes: [structure, failed, current],
    plan: [],
    createdAt: "2026-10-27",
  };
  const result = imagePreviewItems(
    current,
    inheritedImagePackets(project, current),
  );
  assert.deepEqual(
    result.items.map((i) => i.id),
    ["saved-outline", "surface"],
  );
});
