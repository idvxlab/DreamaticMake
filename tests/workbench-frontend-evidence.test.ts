import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ItemEvidence, ExecutionNotice } from "../apps/web/workbench/Evidence";
import type { Packet, Invocation } from "../packages/workbench/contracts";
const packet = (properties: Record<string, unknown>): Packet => ({
  version: "dreamatic.workbench/1",
  id: "test",
  invocationId: "test",
  inputs: [],
  summary: "",
  evidence: "proposal",
  data: {
    structure: [
      {
        id: "oled",
        label: "OLED",
        kind: "reserved-volume",
        properties: { dimensionsMm: [30, 16, 30], ...properties },
        references: [],
      },
    ],
    motion: [],
    circuit_energy: [],
    flow: [],
    logic: [],
  },
});
test("OLED reserved-volume design assumption remains explicit despite a versioned hardware source", () => {
  const html = renderToStaticMarkup(
    React.createElement(ItemEvidence, {
      packet: packet({
        reservedVolumeStatus: "designAssumption",
        hardwareRefs: [
          { source: "curated", recordId: "oled", revision: "abc" },
        ],
        unknownFields: ["connector clearance"],
      }),
    }),
  );
  assert.match(html, /设计假设/);
  assert.match(html, /connector clearance/);
  assert.match(html, /abc/);
});
test("OLED label alone does not manufacture an estimated evidence category", () => {
  const html = renderToStaticMarkup(
    React.createElement(ItemEvidence, { packet: packet({}) }),
  );
  assert.match(html, /尺寸来源未提供/);
  assert.doesNotMatch(html, /设计假设 \/ 估计预留/);
});
test("executed CAD evidence does not imply assembly, firmware or manufacturing success", () => {
  const p = packet({});
  p.evidence = "executed";
  p.execution = {
    tool: "build_appearance_geometry",
    artifact: "/test.step",
    digest: "sha",
  };
  const node: Invocation = {
    id: "test",
    role: "designer",
    title: "test",
    status: "done",
    inputs: [],
    appearanceEvidence: [p],
  };
  const html = renderToStaticMarkup(
    React.createElement(ExecutionNotice, { node }),
  );
  assert.match(html, /本次有 1 项工具产物证据/);
  assert.match(html, /固件编译：无执行证据/);
  assert.match(html, /制造与实物：未验证/);
  const borrowed = renderToStaticMarkup(
    React.createElement(ExecutionNotice, {
      node: {
        ...node,
        appearanceEvidence: [],
        toolActivity: [{ tool: "build_appearance_geometry", success: true }],
      },
    }),
  );
  assert.match(borrowed, /本次无工具产物证据/);
});
