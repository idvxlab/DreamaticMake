import { t } from "./i18n";
import type {
  Project,
  StageId,
  Part,
} from "../../../packages/core/src/contracts";
export type ProjectView = Project & {
  flowRoutingCurrent?: boolean;
  currentStage?: StageId;
  hashes: Record<StageId, string>;
};
export async function api<T = any>(
  path: string,
  method = "GET",
  data?: unknown,
): Promise<T> {
  const r = await fetch("/api" + path, {
    method,
    headers: data === undefined ? {} : { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const json = await r.json();
  if (!r.ok) throw new Error(t(json.error ?? "请求失败"));
  return json;
}
export const artifactURL = (id: string, artifactId: string) =>
  `/api/projects/${id}/artifacts/${artifactId}`;
export type SettingsView = {
  path: string;
  activeWorkspace?: string;
  modules: { id: string; title: string; description: string }[];
  fields: (import("../../../packages/core/src/settings").ConfigField & {
    value: string;
    configured: boolean;
  })[];
};
export type Upload = { id: string; name: string; mime: string };
