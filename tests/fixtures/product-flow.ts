import type { Part, StageDraft } from "../../packages/core/src/contracts";
export const requirementDraft: StageDraft = {
  title: "办公鼠标需求",
  summary: "移动指针并进行点击操作。",
  facts: [],
  assumptions: [],
  blockers: [],
  choices: [],
  partIds: [],
  requirementCards: [
    {
      id: "r-pointer",
      title: "指针移动",
      description: "移动鼠标时电脑指针跟随",
      acceptance: ["可以定位指针"],
    },
    {
      id: "r-click",
      title: "点击操作",
      description: "支持左右键点击",
      acceptance: ["可以点击按钮"],
    },
  ],
};
export const functionDraft: StageDraft = {
  title: "鼠标功能模块",
  summary: "位移检测、按键采集。",
  facts: [],
  assumptions: [],
  blockers: [],
  choices: [],
  partIds: [],
  functionModules: [
    {
      id: "f-pointer",
      name: "指针移动",
      description: "采集位移并输出指针增量",
      requirementIds: ["r-pointer"],
      inputs: ["桌面位移"],
      outputs: ["X/Y 位移增量"],
      acceptance: ["移动时产生对应方向的增量"],
      implementation: "mixed",
    },
    {
      id: "f-click",
      name: "按键操作",
      description: "将按键转换为电脑事件",
      requirementIds: ["r-click"],
      inputs: ["按键动作"],
      outputs: ["点击事件"],
      acceptance: ["每次按下产生一次点击"],
      implementation: "mixed",
    },
  ],
};
export const productParts: Part[] = ["controller", "sensor", "buttons"].map(
  (id, index) => ({
    id,
    name: ["共享控制器", "位移传感器", "按键板"][index],
    manufacturer: "UI Fixture",
    revision: "test",
    source: `https://example.com/${id}`,
    licenseSource: `https://example.com/${id}/license`,
    openHardware: "unverified",
    geometryVerified: true,
    dimensions: { width: 20, depth: 10, height: 2 },
    holes: [],
    voltage: "3.3V",
    logic: "3.3V",
    interfaces: ["GPIO"],
    notes: "Isolated fixture, not a real component.",
    checkedAt: "2026-10-23",
    libraryRef: {
      candidateId: "a".repeat(64),
      rawHash: "b".repeat(64),
      sourceUrl: `https://example.com/${id}`,
    },
  }),
);
export const hardwareDraft: StageDraft = {
  title: "硬件组合",
  summary: "控制器共享处理位移与按键输入。",
  facts: [],
  assumptions: [],
  blockers: [],
  choices: [],
  partIds: productParts.map((p) => p.id),
  hardwareFeatures: productParts.map((p) => ({
    partId: p.id,
    selectionReason: "fixture",
    envelopeMm: p.dimensions,
    mounting: [],
    keepouts: [],
    motion: [],
    evidence: [],
    unknowns: [],
  })),
};
export const routing = {
  description: "控制器服务两个功能，各功能还分别需要自己的输入器件。",
  links: [
    {
      functionId: "f-pointer",
      partId: "controller",
      role: "处理位移",
      reason: "共享控制器处理指针数据",
    },
    {
      functionId: "f-click",
      partId: "controller",
      role: "处理点击",
      reason: "同一控制器处理按键事件",
    },
    {
      functionId: "f-pointer",
      partId: "sensor",
      role: "采集位移",
      reason: "传感器提供 X/Y 数据",
    },
    {
      functionId: "f-click",
      partId: "buttons",
      role: "采集点击",
      reason: "按键板提供按下信号",
    },
  ],
  exceptions: [],
};
