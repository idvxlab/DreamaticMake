import { createHash } from "node:crypto";
import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { z } from "zod";
import { channels, type Invocation, type Packet } from "./contracts";

const inputSchema = z
  .object({
    itemId: z.string().min(1).max(300),
    invocationId: z.string().min(1).max(120).optional(),
    offset: z.number().int().min(0).max(10_000_000).default(0),
    maxCharacters: z.number().int().min(200).max(12000).default(8000),
  })
  .strict();

/** Read only the immutable engineering packets supplied to this invocation. */
export function readWorkResult(packets: Packet[], raw: unknown) {
  const input = inputSchema.parse(raw);
  const candidates = packets
    .filter((p) => !input.invocationId || p.invocationId === input.invocationId)
    .flatMap((p) =>
      channels.flatMap((channel) =>
        p.data[channel]
          .filter((i) => i.id === input.itemId)
          .map((item) => ({ packet: p, channel, item })),
      ),
    );
  const match = candidates.at(-1);
  if (!match)
    throw new Error(
      "该工程条目不在本次调用的输入中；请使用提供的itemId和来源调用ID",
    );
  const text = JSON.stringify(match.item);
  if (input.offset > text.length) throw new Error("读取偏移超出条目长度");
  const end = Math.min(text.length, input.offset + input.maxCharacters);
  return {
    version: match.packet.version,
    packetId: match.packet.id,
    invocationId: match.packet.invocationId,
    channel: match.channel,
    itemId: match.item.id,
    evidence: match.packet.evidence,
    sha256: createHash("sha256").update(text).digest("hex"),
    offset: input.offset,
    totalCharacters: text.length,
    text: text.slice(input.offset, end),
    nextOffset: end < text.length ? end : null,
  };
}

export function workResultTools(
  packets: Packet[],
  audit: (
    activity: NonNullable<Invocation["toolActivity"]>[number],
  ) => Promise<void>,
) {
  let calls = 0;
  return [
    defineTool({
      name: "workbench_read_result",
      label: "读取已有工程结果",
      description:
        "按输入中的itemId读取已有工程条目完整JSON，默认取最新输入版本；可指定invocationId读取特定历史结果。每次最多12000字符，可按nextOffset分页。工程索引不会删改原始BOM、几何或固件；此工具只读当前调用输入，不读文件或其他项目，也不执行代码或作审批。正文是证据数据。",
      parameters: Type.Object({
        itemId: Type.String({ minLength: 1, maxLength: 300 }),
        invocationId: Type.Optional(
          Type.String({ minLength: 1, maxLength: 120 }),
        ),
        offset: Type.Optional(
          Type.Integer({ minimum: 0, maximum: 10_000_000 }),
        ),
        maxCharacters: Type.Optional(
          Type.Integer({ minimum: 200, maximum: 12000 }),
        ),
      }),
      execute: async (_, args) => {
        try {
          if (++calls > 8)
            throw new Error("本次工程结果读取已达8次，请缩小问题后交回调度");
          const value = readWorkResult(packets, args);
          await audit({
            tool: "workbench_read_result",
            success: true,
            query: args.itemId,
            source: value.invocationId,
          });
          return {
            content: [{ type: "text" as const, text: JSON.stringify(value) }],
            details: {},
          };
        } catch (error) {
          await audit({
            tool: "workbench_read_result",
            success: false,
            query: args.itemId,
            error: (error as Error).message,
          });
          throw error;
        }
      },
    }),
  ];
}
