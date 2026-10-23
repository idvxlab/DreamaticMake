/** Application adapter: localization and authenticated project asset transport. */
import { useCallback } from "react";
import {
  EngineScene as Scene,
  type MeshLoader,
} from "../../../../engine/interface/components/EngineScene";
import { t, useLanguage } from "../i18n";

type Props = Omit<Parameters<typeof Scene>[0], "loadMesh" | "translate"> & {
  projectId: string;
};
export function EngineScene({ projectId, ...props }: Props) {
  useLanguage();
  const loadMesh = useCallback<MeshLoader>(
    async (asset, signal) => {
      const id = asset.artifact_id;
      if (!id || !/^[a-f0-9-]{36}$/.test(id))
        throw new Error(t("网格需要当前项目内的 STL 资产"));
      const response = await fetch(
        `/api/projects/${projectId}/engine/meshes/${id}`,
        { signal },
      );
      if (!response.ok) throw new Error(t("STL 资产读取失败"));
      return response.arrayBuffer();
    },
    [projectId],
  );
  return <Scene {...props} loadMesh={loadMesh} translate={t} />;
}
