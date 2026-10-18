import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
export const roleIds = [
  "orchestrator",
  "analyst",
  "hardware-engineer",
  "industrial-designer",
  "mechanical-engineer",
  "cad-engineer",
  "firmware-engineer",
  "reviewer",
] as const;
const schema = z.object({
  id: z.enum(roleIds),
  name: z.string(),
  version: z.literal(1),
  mode: z.enum(["primary", "specialist", "reviewer"]),
  allowed_tools: z.array(z.string()),
});
export async function loadRole(root: string, id: string) {
  if (!roleIds.includes(id as (typeof roleIds)[number]))
    throw new Error("未知智能体");
  const source = await readFile(join(root, ".pi/agents", id + ".md"), "utf8");
  const match = source.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error("智能体描述格式无效");
  const meta = schema.parse(parse(match[1]));
  if (meta.id !== id) throw new Error("智能体 ID 不匹配");
  return { ...meta, prompt: match[2] };
}
