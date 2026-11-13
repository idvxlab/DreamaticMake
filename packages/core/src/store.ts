import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import type { Project, ProjectSummary } from "./project";
import { stageIds, type AgentRunEvent, type StageId } from "../../orchestrator/src/contracts";
import { ownerFor } from "../../orchestrator/src/roles";

export const productStages: readonly StageId[] = stageIds;

export class ProjectStore {
  constructor(readonly root: string) {}
  private path(id: string) { return join(this.root, id, "project-state.json"); }

  async create(name: string, brief: string, breakpoints: StageId[] = []): Promise<Project> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const project: Project = {
      id, name, brief, createdAt: now, updatedAt: now, activeStage: "requirements", events: [],
      breakpoints: breakpoints.length ? breakpoints : undefined,
      stages: productStages.map((stage) => ({ id: stage, owner: ownerFor(stage), state: "pending", revision: 0 })),
    };
    await this.save(project);
    return project;
  }

  async moveToTrash(id: string): Promise<void> {
    await this.get(id);
    const trash = join(this.root, ".trash");
    await mkdir(trash, { recursive: true });
    await rename(join(this.root, id), join(trash, id));
  }

  async restore(id: string): Promise<void> {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("Invalid project ID");
    await rename(join(this.root, ".trash", id), join(this.root, id));
  }

  async list(): Promise<ProjectSummary[]> {
    await mkdir(this.root, { recursive: true });
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(this.root, { withFileTypes: true });
    const projects: ProjectSummary[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const project = await this.get(entry.name);
        const { events, ...rest } = project;
        projects.push({ ...rest, eventCount: events.length });
      } catch {}
    }
    return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id: string): Promise<Project> {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("Invalid project ID");
    const project = JSON.parse(await readFile(this.path(id), "utf8")) as Project;
    project.events = compactEvents(project.events);
    if (project.importedRun) return project;
    const existing = new Map(project.stages.map((stage) => [stage.id, stage]));
    project.stages = productStages.map((stage) => existing.get(stage) ?? {
      id: stage, owner: ownerFor(stage), state: "pending", revision: 0,
    });
    if (!productStages.includes(project.activeStage)) project.activeStage = "requirements";
    // A project that completed the previous workflow can run just the new final stage.
    if (project.activeStage === "print_optimization" && !existing.has("procurement_assembly_guide") &&
        project.stages.slice(0, -1).every((stage) => stage.state === "completed" || stage.state === "approved")) {
      project.activeStage = "procurement_assembly_guide";
    }
    // Older project files predate explicit thread bindings. Recover a binding
    // only when a completed agent response matches that exact stage's output.
    for (const event of project.events) {
      if (event.type !== "completed") continue;
      const payload = event.payload as { threadId?: string; turn?: { items?: { type: string; text?: string }[] } };
      if (!payload?.threadId) continue;
      const texts = payload.turn?.items?.filter((item) => item.type === "agentMessage" && item.text).map((item) => item.text!.trim()) ?? [];
      for (const stage of project.stages) {
        if (!stage.reviewerThreadId && texts.some((text) => text.length > 32 && stage.review?.markdown.trim().endsWith(text))) stage.reviewerThreadId = payload.threadId;
        if (!stage.authorThreadId && texts.some((text) => text.length > 32 && stage.artifact?.markdown.trim().endsWith(text))) stage.authorThreadId = payload.threadId;
      }
    }
    // Recover feedback sent before projects stored author messages separately.
    for (const event of project.events) rememberAuthorFeedback(project, event);
    return project;
  }

  async save(project: Project): Promise<void> {
    project.updatedAt = new Date().toISOString();
    const target = this.path(project.id);
    await mkdir(dirname(target), { recursive: true });
    const temporary = target + ".tmp";
    await writeFile(temporary, JSON.stringify(project, null, 2), "utf8");
    await rename(temporary, target);
  }

  async appendEvent(id: string, event: AgentRunEvent): Promise<Project> {
    const project = await this.get(id);
    rememberAuthorFeedback(project, event);
    project.events.push(event);
    project.events = compactEvents(project.events);
    await this.save(project);
    return project;
  }
}

function rememberAuthorFeedback(project: Project, event: AgentRunEvent) {
  if (event.type !== "message" || !event.stage || project.importedRun) return;
  const { threadId, message } = (event.payload ?? {}) as { threadId?: string; message?: string };
  const stage = project.stages.find(({ id }) => id === event.stage);
  if (!stage || !threadId || stage.authorThreadId !== threadId || !message?.trim()) return;
  const feedback = stage.authorFeedback ?? [];
  if (feedback.some(({ runId }) => runId === event.runId)) return;
  stage.authorFeedback = [...feedback, { runId: event.runId, at: event.at, message }]
    .sort((a, b) => a.at.localeCompare(b.at)).slice(-12);
}

function compactEvents(events: AgentRunEvent[]) {
  let deltas = 0;
  let records = 0;
  return [...events].reverse().filter((event) => {
    if (event.type === "item") return false;
    if (event.type === "delta") return ++deltas <= 500;
    return ++records <= 150;
  }).reverse();
}
