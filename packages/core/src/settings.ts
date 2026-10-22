import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { parse } from "dotenv";
import { researchPolicy, defaultResearchSources } from "./research";
import { workspacePath } from "./workspace";
import { HttpError } from "./store";
export const modules = [
  {
    id: "reasoning",
    title: "推理模型",
    description: "配置需求分析、设计协作与固件开发使用的推理模型。",
  },
  {
    id: "image",
    title: "图像模型",
    description:
      "配置参考图理解与图生 CAD 使用的图像模型，可使用独立的服务地址、密钥和模型。留空的字段沿用推理模型配置。",
  },
  {
    id: "cad",
    title: "CAD 设置",
    description: "配置本地参数化 CAD 工具链与工程任务执行时限。",
  },
  {
    id: "system",
    title: "系统设置",
    description: "配置系统语言、固件工具链与本地运行选项。",
  },
] as const;
export type SettingsModule = (typeof modules)[number]["id"];
export type ConfigField = {
  key: string;
  label: string;
  default: string;
  module: SettingsModule;
  secret?: boolean;
  advanced?: boolean;
  restartRequired?: boolean;
  type?: "number" | "select";
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  example: string;
  description: string;
};
export const fields: ConfigField[] = [
  {
    key: "MAKE_LOCAL_LIBRARY",
    label: "本地采购库目录",
    default: "",
    module: "system",
    example: "../小家电元件库",
    description:
      "只读连接含 parts_library 与 jd_purchase 的目录。每次检索读取最新数据库和参数文件，硬件页每 30 秒刷新。已选项目保留证据快照，不自动改写审批或已确认尺寸。使用 CAD Python，无需另装依赖。",
  },
  {
    key: "MAKE_RESEARCH_SOURCES",
    label: "硬件资料入口（HTTPS）",
    default: defaultResearchSources,
    module: "system",
    example:
      "https://www.raspberrypi.com/products/, https://learn.adafruit.com/",
    description:
      "以逗号或空格分隔，最多 20 个入口；允许访问入口的精确域名（不限路径）。树莓派入口自动包含 www、主域、datasheets 和 pip 官方资料域名。提取静态网页/文本/JSON 及链接，不执行脚本，不解析 PDF/STEP；资料仍需核验。下次任务生效。",
  },
  {
    key: "MAKE_BASE_URL",
    label: "API 地址（Chat Completions）",
    default: "https://api.openai.com/v1",
    module: "reasoning",
    example: "https://api.openai.com/v1",
    description: "推理模型服务的兼容 Chat Completions API 地址。",
  },
  {
    key: "MAKE_API_KEY",
    label: "API Key",
    default: "",
    secret: true,
    module: "reasoning",
    example: "sk-…",
    description: "仅保存于本地 .env，读取配置时不会返回密钥。",
  },
  {
    key: "MAKE_MODEL",
    label: "推理模型",
    default: "gpt-4.1",
    module: "reasoning",
    example: "gpt-4.1",
    description: "用于智能体协作、需求分析与代码生成。",
  },
  {
    key: "MAKE_PROVIDER",
    label: "服务标识",
    default: "openai",
    module: "reasoning",
    advanced: true,
    example: "openai",
    description: "用于标识当前推理模型服务配置。",
  },
  {
    key: "MAKE_IMAGE_BASE_URL",
    label: "图像 API 地址",
    default: "",
    module: "image",
    example: "https://api.openai.com/v1",
    description: "支持图片输入的 Chat Completions 服务地址；可与推理服务不同。",
  },
  {
    key: "MAKE_IMAGE_API_KEY",
    label: "图像 API Key",
    default: "",
    secret: true,
    module: "image",
    example: "sk-…",
    description: "独立配置图像服务密钥；未单独配置时沿用推理服务密钥。",
  },
  {
    key: "MAKE_IMAGE_MODEL",
    label: "图像模型",
    default: "",
    module: "image",
    example: "gpt-4.1",
    description: "用于图片理解和图生 CAD 参数提取，需要支持图片输入。",
  },
  {
    key: "MAKE_ENGINE_PYTHON",
    label: "设计引擎 Python 路径",
    default:
      process.platform === "win32"
        ? ".venv/Scripts/python.exe"
        : ".venv/bin/python",
    module: "cad",
    example: ".venv/Scripts/python.exe",
    description:
      "已安装 Pydantic 2 的 Python 3.11+ 解释器；用于模型校验与仿真。",
  },
  {
    key: "MAKE_PYTHON",
    label: "CAD Python 路径",
    default: ".venv/bin/python",
    module: "cad",
    example: ".venv/bin/python",
    description: "已安装 build123d 和 trimesh 的 Python 解释器路径。",
  },
  {
    key: "MAKE_WORKER_TIMEOUT",
    label: "工作进程超时（秒）",
    default: "120",
    module: "cad",
    type: "number",
    min: 5,
    max: 600,
    example: "120",
    description: "CAD 与固件任务的执行时限；首次固件构建建议使用 600 秒。",
  },
  {
    key: "MAKE_WORKSPACE",
    label: "项目工作目录",
    default: "workspace",
    module: "system",
    restartRequired: true,
    example: "workspace 或 /Users/你的用户名/DreamaticProjects",
    description:
      "相对路径以系统源码根目录为基准。每个项目存放在独立子目录。修改后重启生效，不自动搬迁原工作目录。",
  },
  {
    key: "MAKE_LANGUAGE",
    label: "界面语言",
    default: "zh",
    module: "system",
    type: "select",
    options: [
      { value: "zh", label: "简体中文" },
      { value: "en", label: "English" },
    ],
    example: "zh",
    description:
      "支持简体中文与英文；界面保存后立即切换，智能体在下一轮任务使用所选语言。已有项目内容保持原文。",
  },
  {
    key: "MAKE_PIO",
    label: "PlatformIO 路径",
    default: ".venv/bin/pio",
    module: "system",
    advanced: true,
    example: ".venv/bin/pio",
    description: "本地固件编译工具的可执行文件路径。",
  },
];
/** Independent vision service with per-field fallback for existing configurations. */
export function imageConfig(config: Config): Config {
  return {
    ...config,
    MAKE_BASE_URL: config.MAKE_IMAGE_BASE_URL || config.MAKE_BASE_URL,
    MAKE_API_KEY: config.MAKE_IMAGE_API_KEY || config.MAKE_API_KEY,
    MAKE_MODEL:
      config.MAKE_IMAGE_MODEL || config.MAKE_VISION_MODEL || config.MAKE_MODEL,
  };
}
export type Config = Record<string, string>;
export class Settings {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(readonly root: string) {}
  async snapshot(): Promise<Config> {
    let disk: Config = {};
    try {
      disk = parse(await readFile(join(this.root, ".env")));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    return Object.fromEntries(
      fields.map((f) => [
        f.key,
        disk[f.key] ??
          process.env[f.key] ??
          (f.key === "MAKE_IMAGE_MODEL"
            ? (disk.MAKE_VISION_MODEL ??
              process.env.MAKE_VISION_MODEL ??
              f.default)
            : f.default),
      ]),
    );
  }
  async public() {
    const config = await this.snapshot();
    return {
      path: join(this.root, ".env"),
      modules,
      fields: fields.map((f) => ({
        ...f,
        value: f.secret ? "" : config[f.key],
        configured: !!config[f.key],
      })),
    };
  }
  async save(values: Record<string, string>) {
    const operation = this.queue
      .catch(() => {})
      .then(async () => {
        const current = await this.snapshot();
        for (const [key, value] of Object.entries(values)) {
          const f = fields.find((f) => f.key === key);
          if (
            !f ||
            typeof value !== "string" ||
            /[\r\n\0]/.test(value) ||
            value.length > 4096
          )
            throw new HttpError(400, "无效设置字段");
          if (
            key === "MAKE_BASE_URL" ||
            (key === "MAKE_IMAGE_BASE_URL" && value)
          ) {
            const u = new URL(value);
            if (
              !["http:", "https:"].includes(u.protocol) ||
              u.username ||
              u.password
            )
              throw new HttpError(400, "无效 API 地址");
          }
          if (
            key === "MAKE_WORKER_TIMEOUT" &&
            (!/^\d+$/.test(value) || +value < 5 || +value > 600)
          )
            throw new HttpError(400, "超时范围为 5–600 秒");
          if (key === "MAKE_RESEARCH_SOURCES") researchPolicy(value);
          if (key === "MAKE_WORKSPACE") {
            if (!value.trim()) throw new HttpError(400, "项目工作目录不能为空");
            workspacePath(this.root, value);
          }
          if (key === "MAKE_PROVIDER" && !/^[a-zA-Z0-9_-]+$/.test(value))
            throw new HttpError(400, "无效服务标识");
          if (key === "MAKE_LANGUAGE" && !["zh", "en"].includes(value))
            throw new HttpError(400, "仅支持简体中文或英文");
          current[key] = value;
        }
        let original = "";
        try {
          original = await readFile(join(this.root, ".env"), "utf8");
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        }
        const seen = new Set<string>();
        const quote = (v: string) => {
          if (v.includes('"') || v.includes("\\")) {
            if (v.includes("'"))
              throw new HttpError(400, "配置值不能同时包含两种引号");
            return "'" + v + "'";
          }
          return JSON.stringify(v);
        };
        const lines = original.split("\n").map((line) => {
          const key = line.match(
            /^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=/,
          )?.[1];
          if (!key || !(key in values)) return line;
          if (seen.has(key)) return "";
          seen.add(key);
          return `${key}=${quote(current[key])}`;
        });
        for (const key of Object.keys(values))
          if (!seen.has(key)) lines.push(`${key}=${quote(current[key])}`);
        const tmp = join(this.root, `.env.${randomUUID()}.tmp`);
        await writeFile(tmp, lines.join("\n").replace(/\n*$/, "\n"), {
          mode: 0o600,
        });
        await rename(tmp, join(this.root, ".env"));
        return this.public();
      });
    this.queue = operation;
    return operation;
  }
}
