import type { StageId } from "../../orchestrator/src/contracts";

const cadStages: readonly StageId[] = [
  "spatial_layout", "enclosure_detail", "motion_detail", "assembly_detail", "print_optimization",
];

export function hasCadResults(stage: string): stage is StageId {
  return (cadStages as readonly string[]).includes(stage);
}

export interface CadResultFile {
  id: string;
  filename: string;
  format: "3dm" | "step" | "stl";
  previewable: boolean;
}
