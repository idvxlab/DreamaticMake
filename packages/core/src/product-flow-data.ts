import type { Project } from "./contracts";

/** Legacy facts remain literal cards; they are never inferred to be functions. */
export function requirementOutputs(project: Project) {
  const draft = project.stages.requirements.draft;
  return (
    draft?.requirementCards ??
    (draft
      ? [
          {
            id: "legacy-requirements",
            title: draft.title,
            description: draft.summary,
            acceptance: [],
          },
        ]
      : [])
  );
}
export function functionOutputs(project: Project) {
  return project.stages.intent.draft?.functionModules ?? [];
}
