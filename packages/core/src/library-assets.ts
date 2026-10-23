import { readFile, realpath, stat, mkdir, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join, resolve, relative, isAbsolute } from "node:path";
import { z } from "zod";
import { localLibrary } from "./local-library";
import { Settings } from "./settings";
import { Store, HttpError } from "./store";
import { sandboxCommand } from "./sandbox";
import { runProcess } from "./worker";
import type { StageId } from "./contracts";
import { currentStage } from "./workflow";

export async function libraryAsset(
  root: string,
  settings: Settings,
  candidateId: string,
  assetId: string,
) {
  const data = await localLibrary(root, settings, "", candidateId, { assetId });
  if (!data.asset) throw new HttpError(404, "硬件资源不可用");
  const config = await settings.snapshot();
  const library = await realpath(resolve(root, config.MAKE_LOCAL_LIBRARY));
  const path = await realpath(data.asset.path);
  const rel = relative(library, path);
  if (rel === ".." || rel.startsWith("../") || isAbsolute(rel))
    throw new HttpError(403, "资源不在元件库内");
  const size = (await stat(path)).size;
  if (size > 256_000_000)
    throw new HttpError(413, "资源超过本次读取上限 256 MB");
  const bytes = await readFile(path);
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (sha !== data.asset.sha256)
    throw new HttpError(409, "资源内容已变化，请重新同步官方硬件索引");
  return {
    bytes,
    asset: data.asset,
    record: data.record,
    fingerprint: data.fingerprint,
  };
}

export const libraryCheckSchema = z.object({
  candidateId: z.string().regex(/^[a-f0-9]{64}$/),
  modelId: z.string().regex(/^[a-f0-9]{64}$/),
  availableEnvelopeMm: z
    .tuple([
      z.number().positive().max(2000),
      z.number().positive().max(2000),
      z.number().positive().max(2000),
    ])
    .optional(),
  clearanceMm: z.number().min(0).max(50).default(0),
});

export async function checkLibraryModel(
  root: string,
  settings: Settings,
  store: Store,
  id: string,
  input: unknown,
  stage?: StageId,
  signal?: AbortSignal,
) {
  const request = libraryCheckSchema.parse(input);
  const project = await store.get(id);
  if (project.archived) throw new HttpError(409, "归档项目不能生成检查记录");
  const active = currentStage(project);
  const targetStage: StageId =
    stage ?? (active === "structure" || active === "cad" ? active : "hardware");
  if (!["hardware", "structure", "cad"].includes(targetStage))
    throw new HttpError(409, "模型检查用于硬件、结构或 CAD 阶段");
  const revision = project.stages[targetStage].revision;
  const { bytes, asset, record, fingerprint } = await libraryAsset(
    root,
    settings,
    request.candidateId,
    request.modelId,
  );
  if (asset.role !== "step_model" || asset.mime !== "application/step")
    throw new HttpError(400, "请选择该硬件关联的 STEP 模型");
  const folder = join(store.dir(id), "jobs", "library-" + randomUUID());
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, "hardware.step"), bytes);
  const config = await settings.snapshot();
  const sandbox = await sandboxCommand(
    root,
    folder,
    resolve(root, config.MAKE_PYTHON),
    [join(root, "workers/library/inspect_step.py"), folder],
    false,
    store.root,
  );
  const run = await runProcess(sandbox.command, sandbox.args, {
    cwd: folder,
    input: JSON.stringify(request),
    timeout: Math.min(600, +config.MAKE_WORKER_TIMEOUT) * 1000,
    signal,
    env: { PYTHONDONTWRITEBYTECODE: "1", PYTHONIOENCODING: "utf-8" },
  });
  if (run.code !== 0)
    throw new HttpError(
      422,
      "STEP 读取失败：" + (run.stdout + run.stderr).slice(-1500),
    );
  const report = JSON.parse(
    await readFile(join(folder, "report.json"), "utf8"),
  );
  if (report.sha256 !== asset.sha256)
    throw new HttpError(409, "STEP 检查哈希不一致");
  const reference = await store.artifact(
    id,
    targetStage,
    revision,
    "reference-hardware-" + randomUUID() + ".step",
    bytes,
    "application/step",
  );
  const evidence = {
    ...report,
    candidateId: request.candidateId,
    modelId: request.modelId,
    hardwareUrl: record.url,
    hardwareTitle: record.title,
    modelProvenance: asset.provenance,
    libraryFingerprint: fingerprint,
    referenceArtifactId: reference.id,
  };
  const artifact = await store.artifact(
    id,
    targetStage,
    revision,
    "source-geometry-" + randomUUID() + ".json",
    JSON.stringify(evidence, null, 2),
    "application/json",
  );
  await store.update(id, (p) => {
    if (p.stages[targetStage].revision !== revision)
      throw new HttpError(409, "检查期间项目版本已变化");
    p.stages[targetStage].artifacts.push(reference, artifact);
  });
  return { ...evidence, artifactId: artifact.id, artifactHash: artifact.hash };
}
