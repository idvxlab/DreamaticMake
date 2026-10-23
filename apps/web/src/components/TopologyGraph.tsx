/** Application localization adapter; renderer and styles belong to engine. */
import { TopologyGraph as Graph } from "../../../../engine/interface/components/TopologyGraph";
import { t, useLanguage } from "../i18n";
export function TopologyGraph(
  props: Omit<Parameters<typeof Graph>[0], "translate">,
) {
  useLanguage();
  return <Graph {...props} translate={t} />;
}
