import type { LayoutProjection } from "./contracts";

export type ProjectInfo = {
  path: string;
  id: string;
  title: string;
  targets: { key: string; name: string; kind: "custom" | "library" }[];
};
export type View = LayoutProjection & {
  project: ProjectInfo;
  selection: { key: string | null; level: "project" | "element" };
};
export type SourceFile = {
  path: string;
  kind: "json" | "markdown" | "text" | "image" | "pdf";
  media_type: string;
  size: number;
};
export type Preview = SourceFile & { text?: string; data_url?: string };

export async function api<T>(body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch("/engine-api", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "引擎请求失败");
  return result;
}
