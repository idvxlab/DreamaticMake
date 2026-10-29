import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename, chmod } from "node:fs/promises";
import { resolve, join } from "node:path";
import { z } from "zod";
import type { Role } from "./contracts";

export const DEFAULT_BASE_URL = "https://apicz.boyuerichdata.com/v1";
const baseUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash
    );
  }, "API 地址必须为不含凭据、查询或片段的 HTTPS 地址")
  .transform((s) => s.replace(/\/+$/, ""));
const modelId = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .refine((s) => !/[\r\n]/.test(s));
export const connectionInputSchema = z
  .object({
    baseUrl: baseUrlSchema,
    apiKey: z.string().trim().max(4096).optional(),
    generalModel: modelId,
    cadModel: modelId,
    imageModel: z.union([modelId, z.literal("")]).optional(),
  })
  .strict();
export const catalogInputSchema = z
  .object({
    baseUrl: baseUrlSchema,
    apiKey: z.string().trim().max(4096).optional(),
  })
  .strict();
const storedSchema = connectionInputSchema.extend({
  apiKey: z.string().min(1),
  verifiedAt: z.string(),
});
export type Connection = z.infer<typeof storedSchema>;
export type PublicConnection = {
  baseUrl: string;
  generalModel: string;
  cadModel: string;
  imageModel?: string;
  hasKey: boolean;
  verifiedAt?: string;
};
export function selectModelId(
  config: Pick<Connection, "generalModel" | "cadModel">,
  role: Role,
) {
  return role === "mechanical" ? config.cadModel : config.generalModel;
}
export function suggestModels(ids: string[]) {
  const general = ids.find((id) => id === "deepseek-flash") || "";
  // Only preselect the specifically requested current K3.1 Pro, and only if advertised by the gateway.
  const pro = ids.filter((id) => /(?:^|\/)(?:kimi-)?k3\.1-pro$/i.test(id));
  return { generalModel: general, cadModel: pro.length === 1 ? pro[0] : "" };
}
export function imageModelIds(ids: string[]) {
  return ids.filter((id) =>
    /seedream|qwen-image|gpt-image|dall-e|imagen|flux/i.test(id),
  );
}
export function suggestImageModel(ids: string[]) {
  return (
    [
      "doubao-seedream-4-5-251128",
      "doubao-seedream-5-0-260128",
      "qwen-image-3.0-pro",
      "qwen-image-2.0-pro",
    ].find((id) => ids.includes(id)) || ""
  );
}
export class ConnectionStore {
  constructor(
    private directory = resolve("workspace/workbench"),
    private fetcher: typeof fetch = fetch,
  ) {}
  private file() {
    return join(this.directory, "connection.json");
  }
  async read(): Promise<Connection | undefined> {
    try {
      return storedSchema.parse(
        JSON.parse(await readFile(this.file(), "utf8")),
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
      throw new Error("本机 API 配置无法读取，请在模型设置中重新保存");
    }
  }
  async public(): Promise<PublicConnection> {
    const c = await this.read();
    return c
      ? {
          baseUrl: c.baseUrl,
          generalModel: c.generalModel,
          cadModel: c.cadModel,
          imageModel: c.imageModel || "",
          hasKey: true,
          verifiedAt: c.verifiedAt,
        }
      : {
          baseUrl: DEFAULT_BASE_URL,
          generalModel: "deepseek-flash",
          cadModel: "",
          imageModel: "",
          hasKey: false,
        };
  }
  private async credentials(input: z.infer<typeof catalogInputSchema>) {
    const old = await this.read();
    const key =
      input.apiKey || (old?.baseUrl === input.baseUrl ? old.apiKey : undefined);
    if (!key) throw new Error("请在本机设置页填写此网关的 API Key");
    if (/[\r\n]/.test(key)) throw new Error("API Key 格式不正确");
    return key;
  }
  private async query(baseUrl: string, key: string) {
    let response: Response;
    try {
      response = await this.fetcher(`${baseUrl}/models`, {
        headers: { Authorization: `Bearer ${key}` },
        redirect: "error",
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw new Error("无法连接模型列表，请检查 API 地址、网络和证书");
    }
    if (!response.ok)
      throw new Error(
        response.status === 401 || response.status === 403
          ? "网关拒绝认证，请检查 API Key 或模型权限"
          : `查询模型失败（HTTP ${response.status}）`,
      );
    let text = "";
    const reader = response.body?.getReader();
    if (!reader) throw new Error("网关模型列表为空");
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += new TextDecoder().decode(value);
        if (text.length > 2_000_000) throw new Error("模型列表过大");
      }
    } finally {
      await reader.cancel();
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error("网关没有返回有效的 JSON 模型列表");
    }
    const parsed = z
      .object({
        data: z.array(z.object({ id: z.string().min(1).max(160) })).max(10000),
      })
      .safeParse(json);
    if (!parsed.success) throw new Error("网关未返回兼容的 data[].id 模型列表");
    const ids = [...new Set(parsed.data.data.map((m) => m.id))].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    );
    if (!ids.length) throw new Error("该 Key 未返回任何可用模型");
    return ids;
  }
  async catalog(raw: unknown) {
    const input = catalogInputSchema.parse(raw);
    const key = await this.credentials(input);
    const models = await this.query(input.baseUrl, key);
    return {
      models,
      suggested: suggestModels(models),
      imageModels: imageModelIds(models),
      suggestedImageModel: suggestImageModel(models),
    };
  }
  async save(raw: unknown) {
    const input = connectionInputSchema.parse(raw);
    const apiKey = await this.credentials(input);
    const models = await this.query(input.baseUrl, apiKey);
    if (
      !models.includes(input.generalModel) ||
      !models.includes(input.cadModel)
    )
      throw new Error("选定模型不在当前 Key 的模型列表内，请重新获取列表");
    if (!/deepseek.*flash/i.test(input.generalModel))
      throw new Error("其余 agent 请选择 DeepSeek Flash 型号");
    if (!/kimi|(?:^|\/)k\d/i.test(input.cadModel))
      throw new Error("结构/CAD agent 请选择 Kimi 型号");
    const old = await this.read();
    const imageModel =
      input.imageModel ??
      (old?.baseUrl === input.baseUrl ? old.imageModel : "") ??
      "";
    if (imageModel && !imageModelIds(models).includes(imageModel))
      throw new Error(
        "生图模型必须是当前网关提供的图片模型，Kimi/DeepSeek文字模型不能在此代替生图执行器",
      );
    const config: Connection = {
      ...input,
      apiKey,
      imageModel,
      verifiedAt: new Date().toISOString(),
    };
    await mkdir(this.directory, { recursive: true });
    const temp = this.file() + `.tmp-${randomUUID()}`;
    await writeFile(temp, JSON.stringify(config, null, 2), { mode: 0o600 });
    await chmod(temp, 0o600);
    await rename(temp, this.file());
    return this.public();
  }
}
export const connectionStore = new ConnectionStore();
export async function createRoleModel(
  role: Role,
  store = connectionStore,
  runtimeDirectory = resolve("workspace/workbench/model-runtime"),
) {
  const config = await store.read();
  if (!config)
    throw new Error(
      "请先打开工作台的「模型设置」，填写 API Key 并确认两个模型",
    );
  const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
  const cwd = runtimeDirectory;
  await mkdir(cwd, { recursive: true });
  const runtime = await ModelRuntime.create({
    modelsPath: null,
    authPath: join(cwd, "auth.json"),
    modelsStorePath: join(cwd, "catalog.json"),
    refreshOnCreate: false,
    allowModelNetwork: false,
  });
  const id = selectModelId(config, role);
  runtime.registerProvider("workbench-gateway", {
    baseUrl: config.baseUrl,
    api: "openai-completions",
    authHeader: true,
    models: [
      {
        id,
        name: id,
        input: ["text"],
        reasoning: role === "mechanical",
        ...(role === "mechanical"
          ? { compat: { supportsDeveloperRole: false } }
          : {}),
        ...(role !== "mechanical"
          ? {
              samplingParams: {
                response_format: { type: "json_object" },
                thinking: { type: "disabled" },
                reasoning_effort: "none",
              },
            }
          : {}),
        contextWindow: 65536,
        maxTokens: 16384,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
    ],
  });
  await runtime.setRuntimeApiKey("workbench-gateway", config.apiKey);
  const model = runtime.getModel("workbench-gateway", id);
  if (!model) throw new Error("已配置模型无法注册，未回退到其他模型");
  return {
    modelRuntime: runtime,
    model,
    thinkingLevel: role === "mechanical" ? ("low" as const) : ("off" as const),
    redactError: (message: string) =>
      message.split(config.apiKey).join("[redacted]"),
  };
}
