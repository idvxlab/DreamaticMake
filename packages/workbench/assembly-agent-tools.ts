import { z } from "zod";
import { assemblyDesignSchema } from "./assembly-contracts";
import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { Invocation, Packet } from "./contracts";
import {
  assemblyStore,
  type AssemblyStore,
  type AssemblyResult,
} from "./assembly";
export function assemblyAgentTools(
  packets: Packet[],
  observe: (result: AssemblyResult) => Promise<void>,
  audit: (
    activity: NonNullable<Invocation["toolActivity"]>[number],
  ) => Promise<void>,
  store: AssemblyStore = assemblyStore,
) {
  let selected: string | undefined;
  let job: Promise<AssemblyResult> | undefined;
  return [
    defineTool({
      name: "assembly_design_contract",
      label: "读取装配设计合同",
      description:
        "在提出assembly-design之前读取准确字段和单位。只返回公开数据合同，不执行CAD或审批。",
      parameters: Type.Object({}),
      execute: async () => ({
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(z.toJSONSchema(assemblyDesignSchema)),
          },
        ],
        details: {},
      }),
    }),
    defineTool({
      name: "build_printable_assembly",
      label: "生成可打印分件并检查装配几何",
      description:
        "执行已依赖的assembly-design条目。须引用完整结构快照每一个component-instance，固定真实外形及STEP来源、原生变换；生成底壳和盖板STEP/STL，检查限位支撑、走线/连接器预留、定位紧固、声明打印床及回装几何。检查失败仍保存报告；不能据此宣称实物打印、制造公差或电气验证。",
      parameters: Type.Object({
        designItemId: Type.String({ minLength: 1, maxLength: 240 }),
      }),
      execute: async (_, args) => {
        try {
          if (selected && selected !== args.designItemId)
            throw new Error("一次调用仅执行一份装配设计");
          selected = args.designItemId;
          job ||= store.build(packets, selected);
          const result = await job;
          await observe(result);
          await audit({
            tool: "build_printable_assembly",
            success: result.geometryChecksPassed,
            source: result.itemId,
            ...(!result.geometryChecksPassed
              ? {
                  error: JSON.stringify(
                    result.report.gaps || ["几何检查未通过"],
                  ),
                }
              : {}),
          });
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result) }],
            details: {},
          };
        } catch (error) {
          await audit({
            tool: "build_printable_assembly",
            success: false,
            error: (error as Error).message,
          });
          throw error;
        }
      },
    }),
  ];
}
