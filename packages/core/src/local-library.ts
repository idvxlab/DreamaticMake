import { resolve, join } from "node:path";
import { runProcess } from "./worker";
import { Settings } from "./settings";
import { HttpError } from "./store";

export async function localLibrary(
  root: string,
  settings: Settings,
  query = "",
  candidateId?: string,
  options: { assetId?: string; documentId?: string; offset?: number } = {},
) {
  if (
    query.length > 200 ||
    [candidateId, options.assetId, options.documentId].some(
      (id) => id !== undefined && !/^[a-f0-9]{64}$/.test(id),
    ) ||
    (options.offset !== undefined &&
      (!Number.isInteger(options.offset) ||
        options.offset < 0 ||
        options.offset > 10_000_000)) ||
    ((options.assetId !== undefined || options.documentId !== undefined) &&
      !candidateId)
  )
    throw new HttpError(400, "无效采购库查询");
  const config = await settings.snapshot();
  if (!config.MAKE_LOCAL_LIBRARY?.trim())
    return {
      enabled: false,
      candidates: [],
      requirements: [],
      notice: "请在系统设置填写本地采购库目录",
    };
  const response = await runProcess(
    resolve(root, config.MAKE_PYTHON),
    [join(root, "workers/library/query.py")],
    {
      cwd: root,
      timeout: 20000,
      input: JSON.stringify({
        root: resolve(root, config.MAKE_LOCAL_LIBRARY),
        query,
        candidateId,
        ...options,
      }),
      env: { PYTHONDONTWRITEBYTECODE: "1", PYTHONIOENCODING: "utf-8" },
    },
  );
  if (response.code === 4)
    throw new HttpError(404, "资料不存在或未关联到该硬件");
  if (response.code !== 0)
    throw new HttpError(
      503,
      "本地采购库暂不可读，请检查目录和 Python 设置后重试",
    );
  const result = JSON.parse(response.stdout);
  if (candidateId && !result.record)
    throw new HttpError(404, "采购记录不存在、已排除或暂不可读，请重新检索");
  return result;
}
