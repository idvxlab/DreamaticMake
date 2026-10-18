import { test } from "node:test";
import assert from "node:assert/strict";
import {
  describeToolObject,
  toolActivityLabel,
} from "../packages/core/src/tool-activity";
const context = {
  projectName: "桌面终端",
  stage: "requirements" as const,
  revision: 2,
};
test("工具记录描述具体对象，而不是仅记录工具名", () => {
  assert.match(
    describeToolObject("context_read", {}, context),
    /桌面终端.*project.json.*硬件目录.*需求分析 · V2/,
  );
  assert.match(
    describeToolObject("catalog_search", { query: "Pico" }, context),
    /本项目硬件目录.*Pico/,
  );
  assert.match(
    describeToolObject("stage_submit", { title: "需求规格" }, context),
    /需求规格/,
  );
  assert.match(
    describeToolObject(
      "text_to_cad",
      { parameters: { width: 90, depth: 65, height: 35 } },
      context,
    ),
    /90 × 65 × 35 mm/,
  );
  assert.match(
    describeToolObject("firmware_build", { source: "private code" }, context),
    /src\/main.cpp/,
  );
  assert(
    !describeToolObject(
      "firmware_build",
      { source: "private code" },
      context,
    ).includes("private code"),
  );
  assert.equal(
    toolActivityLabel("context_read", "project.json"),
    "context_read：project.json",
  );
  assert.match(toolActivityLabel("context_read"), /旧记录未保存操作对象/);
});
test("资料记录去掉查询参数和认证信息，不记录原始工具参数", () => {
  const value = describeToolObject(
    "research_fetch",
    { url: "https://user:secret@example.com/doc?api_key=secret#token" },
    context,
  );
  assert.equal(value, "桌面终端 / 资料：https://example.com/doc");
  assert(!value.includes("secret"));
});
