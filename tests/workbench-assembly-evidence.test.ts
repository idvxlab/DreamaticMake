import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AssemblyEvidence,
  assemblyResults,
} from "../apps/web/workbench/AssemblyEvidence";
import { ExecutionNotice } from "../apps/web/workbench/Evidence";
import type { Invocation, Packet } from "../packages/workbench/contracts";
const id = "11111111-1111-4111-8111-111111111111",
  revision = "a".repeat(64),
  sha = "b".repeat(64);
const url = `/workbench-api/assembly/${id}/base.stl?revision=${revision}&sha256=${sha}`;
function node(passed = false): Invocation {
  const packet: Packet = {
    version: "dreamatic.workbench/1",
    id: "proof",
    invocationId: "assembly",
    inputs: [],
    summary: "",
    evidence: "executed",
    execution: {
      tool: "build_printable_assembly",
      artifact: `assembly:${id}`,
      digest: revision,
    },
    data: {
      structure: [
        {
          id: `assembly:${id}`,
          kind: "assembly-model",
          label: "fixture assembly",
          properties: {
            version: "dreamatic.assembly-result/1",
            id,
            revision,
            geometryChecksPassed: passed,
            sourceLayoutInvocationId: "layout",
            report: {
              gaps: passed ? [] : ["closure gap"],
              closure: { passed },
              parts: ["base"],
              checks: { fits: passed },
            },
            assets: [{ id: "base.stl", sha256: sha, bytes: 123, url }],
          },
          references: [],
        },
      ],
      motion: [],
      circuit_energy: [],
      flow: [],
      logic: [],
    },
  };
  return {
    id: "failed",
    role: "mechanical",
    status: passed ? "done" : "error",
    title: "assembly",
    inputs: [],
    assemblyEvidence: [packet],
  };
}
test("failed assembly evidence retains report and version-bound download without physical success claims", () => {
  const n = node();
  const html = renderToStaticMarkup(
    React.createElement(AssemblyEvidence, { node: n }),
  );
  assert.match(html, /closure gap/);
  assert.match(html, /存在缺口/);
  assert.match(html, /base.stl/);
  assert.match(html, /实物打印、装配、公差与制造均未验证/);
  assert.equal(assemblyResults(n)[0].assets[0].url, url);
  const notice = renderToStaticMarkup(
    React.createElement(ExecutionNotice, { node: n }),
  );
  assert.match(notice, /存在检查缺口/);
});
test("successful geometry is distinct from physical assembly and proposal URLs are ignored", () => {
  const n = node(true);
  const html = renderToStaticMarkup(
    React.createElement(AssemblyEvidence, { node: n }),
  );
  assert.match(html, /本次分件几何检查通过/);
  assert.match(html, /未验证/);
  n.packet = n.assemblyEvidence![0];
  n.assemblyEvidence = [];
  assert.equal(
    renderToStaticMarkup(React.createElement(AssemblyEvidence, { node: n })),
    "",
  );
  assert.equal(
    renderToStaticMarkup(
      React.createElement(AssemblyEvidence, {
        node: { ...n, packet: undefined },
      }),
    ),
    "",
  );
});
test("download allowlist rejects remote, traversal, stale digest, unexpected file and spoofed tool", () => {
  for (const bad of [
    "https://evil.example/file",
    "//evil.example/file",
    url + "&extra=1",
    url.replace(sha, "c".repeat(64)),
    url.replace(id, "22222222-2222-4222-8222-222222222222"),
    url.replace("base.stl", "../secret"),
    url.replace("base.stl", "other.stl"),
  ]) {
    const n = node();
    (
      n.assemblyEvidence![0].data.structure[0].properties.assets as any[]
    )[0].url = bad;
    assert.equal(assemblyResults(n)[0].assets.length, 0, bad);
  }
  const n = node();
  n.assemblyEvidence![0].execution!.tool = "model-proposal";
  assert.equal(assemblyResults(n).length, 0);
  const stale = node();
  stale.assemblyEvidence![0].execution!.digest = "c".repeat(64);
  assert.equal(assemblyResults(stale).length, 0);
});

test("all seven worker asset filenames are accepted only on the exact bound URL", () => {
  const n = node();
  const names = [
    "base.step",
    "base.stl",
    "base-assembly.step",
    "lid.step",
    "lid.stl",
    "lid-assembly.step",
    "report.json",
  ];
  n.assemblyEvidence![0].data.structure[0].properties.assets = names.map(
    (name) => ({
      id: name,
      sha256: sha,
      bytes: 7,
      url: `/workbench-api/assembly/${id}/${name}?revision=${revision}&sha256=${sha}`,
    }),
  );
  assert.deepEqual(
    assemblyResults(n)[0].assets.map((a) => a.id),
    names,
  );
});
