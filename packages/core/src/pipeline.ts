import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import type { AgentExecutor, AgentRunEvent, StageId } from "../../orchestrator/src/contracts";
import { ownerFor } from "../../orchestrator/src/roles";
import { roles } from "../../orchestrator/src/roles";
import { designQuestionPrompt, rolePrompt } from "../../orchestrator/src/prompts";
import type { DesignQuestion, Project, StageRecord } from "./project";
import { purchaseSourceText, withPurchaseLinks } from "./procurement-guide";
import { productStages, ProjectStore } from "./store";
import { HardwareEvidenceError, type DesignEngineBridge, type ProcessContractRef, type ValidatedDeliverable } from "../../design-engine/src/bridge";
import { TaskRunner, taskHash } from "../../design-engine/src/task-runner";

export type EventSink = (project: Project, event: AgentRunEvent) => void;

function agentTurnFailure(event: AgentRunEvent, fallback: string) {
  const payload = event.payload as { error?: string; turn?: { error?: { message?: string } } } | undefined;
  const message = payload?.turn?.error?.message ?? payload?.error;
  return new Error(message || fallback);
}

const usbCableQuestion: DesignQuestion = {
  prompt: "你是否已有兼容设备供电要求的标准 USB-C 线？",
  options: ["已有标准 USB-C 供电线", "我会自行准备标准 USB-C 供电线", "希望项目随附供电线"],
};

const samplingQuestion: DesignQuestion = {
  prompt: "采样周期何时确定？",
  options: ["采样周期留到固件阶段"],
};

function pendingUsbCableQuestion(stage: StageRecord, blocker: string | undefined) {
  if (blocker && /USB[ -]?C.{0,14}(供电线|电源线|线缆)/i.test(blocker) &&
      !stage.confirmedDetails?.some(({ question, answer }) =>
        /USB[ -]?C/i.test(question) && /供电线|电源线|线缆/.test(question) && answer.trim())) {
    return usbCableQuestion;
  }
}

function splitDesignQuestions(response: string): { markdown: string; questions: DesignQuestion[] } {
  const block = /^```design-questions[ \t]*\r?\n([\s\S]*?)^```[ \t]*\r?$/m.exec(response);
  if (!block) {
    if (/^```design-questions\b/m.test(response)) throw new Error("设计细节问题格式不完整");
    const summary = response.split("结构化摘要").at(-1);
    if (summary && /"status"\s*:\s*"needs_input"/.test(summary)) throw new Error("本阶段需要用户输入，但没有生成可回答的设计问题。请继续当前工作重试。");
    return { markdown: response.trim(), questions: [] };
  }
  const value: unknown = JSON.parse(block[1]);
  if (!Array.isArray(value) || value.length > 6) throw new Error("设计细节问题须为最多六项的列表");
  const questions = value.map((entry): DesignQuestion => {
    const prompt: unknown = entry?.prompt;
    const options: unknown = entry?.options;
    if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 500) throw new Error("设计细节问题需要有效的题目");
    if (options === undefined) return { prompt: prompt.trim() };
    if (!Array.isArray(options) || options.length < 1 || options.length > 6 || options.some((option) => typeof option !== "string" || !option.trim() || option.length > 250)) {
      throw new Error("设计细节问题需要一至六个有效选项");
    }
    const choices = options.map((option: string) => option.trim());
    if (new Set(choices).size !== choices.length) throw new Error("设计细节问题包含重复选项");
    return { prompt: prompt.trim(), options: choices };
  });
  const markdown = (response.slice(0, block.index) + response.slice(block.index + block[0].length)).trim();
  if (/^```design-questions\b/m.test(markdown)) throw new Error("每次只可提交一组设计细节问题");
  return { markdown, questions };
}

const stageOutputPrompt = `
读取流程契约的 schemaPath，沿 input_schema 中 input → deliverable 的引用读取该阶段原生输出类型。正式交付时，在 Markdown 末尾用 design-output 代码块包裹一个 JSON 对象，JSON 的 kind 必须与当前阶段一致。说明文字放在代码块外面。
如果流程契约含 elementLibrary，先读取该清单。正式选型使用清单中的完整 element_ref 和对应尺寸证据。
如果还需要用户确认，提交 design-questions 即可。重试时复用本次已有的文件和实际工具结果，只修正交付格式或字段。`;

function stageDeliverable(markdown: string, stage: StageId): { summary: string; deliverable: unknown } {
  const explicit = /^```design-output[ \t]*\r?\n([\s\S]*?)^```[ \t]*\r?$/m.exec(markdown);
  if (explicit) {
    let deliverable;
    try { deliverable = JSON.parse(explicit[1]); }
    catch { throw new Error("design-output 代码块须包含有效 JSON"); }
    if (deliverable?.kind !== stage) throw new Error(`design-output.kind 必须为 ${stage}`);
    return { summary: markdown.replace(explicit[0], "").trim(), deliverable };
  }
  for (const block of [...markdown.matchAll(/^```json[ \t]*\r?\n([\s\S]*?)^```[ \t]*\r?$/gm)].reverse()) {
    try {
      const value = JSON.parse(block[1]);
      const candidates = [value, value?.deliverable, value?.authored_data, value?.payload];
      const deliverable = candidates.find((candidate) => candidate?.kind === stage);
      if (deliverable) return { summary: markdown.replace(block[0], "").trim(), deliverable };
    } catch { /* A Markdown example can contain an unrelated JSON fragment. */ }
  }
  throw new Error(`缺少 ${stage} 的结构化产物，请提交 design-output JSON`);
}

function readHardwareBlockers(text: string) {
  const block = /^```hardware-blockers[ \t]*\r?\n([\s\S]*?)^```[ \t]*\r?$/m.exec(text);
  if (!block) {
    if (/^```hardware-blockers\b/m.test(text)) throw new Error("硬件缺件报告格式不完整。");
    return;
  }
  const missing: unknown = JSON.parse(block[1]);
  if (!Array.isArray(missing) || !missing.length || missing.length > 30 ||
      missing.some((item) => typeof item !== "string" || !item.trim() || item.length > 400)) {
    throw new Error("硬件缺件报告需要一至三十条有效说明。");
  }
  return missing.map((item: string) => item.trim()).join("\n");
}

function isFinished(stage: StageRecord) {
  return stage.state === "completed" || stage.state === "approved";
}

async function stageSources(project: Project, contract: ProcessContractRef, engine: Pick<DesignEngineBridge, "validateOutput">, signal: AbortSignal) {
  const missing = contract.requiredUpstream.filter((id) => !project.stages.some((stage) => stage.id === id && isFinished(stage) && stage.artifact));
  if (missing.length) throw new Error(`上游阶段缺少已完成的产物。${missing.join("、")}`);
  const dependencies = new Set([...contract.requiredUpstream, ...contract.optionalUpstream]);
  const sources = project.stages.flatMap((stage) => dependencies.has(stage.id) && isFinished(stage) && stage.artifact ? [{ stage: stage.id, artifact: stage.artifact }] : []);
  return Promise.all(sources.map(async ({ stage, artifact: { pin, markdown, structured } }) => {
    const summary = contract.processKind === "procurement_assembly_guide" ? { summary: markdown } : {};
    if (structured) return { stage, pin, deliverable: structured.deliverable,
      ...(structured.mechanicalEvidence ? { mechanical_evidence: structured.mechanicalEvidence } : {}), ...summary };
    try {
      const historical = stageDeliverable(markdown, stage);
      const normalized = await engine.validateOutput(stage, historical.deliverable, signal);
      return { stage, pin, deliverable: normalized.deliverable, normalized_content_hash: normalized.content_hash, ...summary };
    } catch {
      signal.throwIfAborted();
      return { stage, pin, legacy_markdown: markdown };
    }
  }));
}

type StageTaskResult = {
  schema_version: "task-result/1";
  task_id: string;
  attempt_id: string;
  context_manifest_id: string;
  status: "proposed" | "needs_input" | "blocked";
  markdown: string;
  questions: DesignQuestion[];
  normalized?: ValidatedDeliverable;
};

export class ProjectPipeline {
  private running = new Set<string>();
  private controllers = new Map<string, AbortController>();
  constructor(private store: ProjectStore, private executor: AgentExecutor, private sink: EventSink,
    private contracts?: Pick<DesignEngineBridge, "materialize" | "validateOutput"> & Partial<Pick<DesignEngineBridge, "purchaseCandidates">>) {}

  isRunning(id: string) { return this.running.has(id); }

  async recoverInterruptedRuns(): Promise<void> {
    const error = "本地服务中断，未完成的工作已暂停。";
    for (const { id } of await this.store.list()) {
      const project = await this.store.get(id);
      const requirements = project.stages.find(({ id }) => id === "requirements");
      if (project.activeStage === "requirements" && requirements?.state === "awaiting_details" &&
          requirements.questions?.some((question) => "library" in question)) {
        // Regenerate pending questions from the brief and saved user answers under the new scope.
        requirements.questions = undefined;
        requirements.revision++;
        requirements.state = "ready";
        await this.store.save(project);
      }
      const hardware = project.stages.find(({ id }) => id === "hardware_selection");
      // Recover older runs that treated a user-supplied USB-C cable as a missing library part.
      if (project.activeStage === "hardware_selection" && hardware?.state === "blocked" &&
          pendingUsbCableQuestion(hardware, hardware.hardwareBlocker?.reason)) {
        hardware.questions = [usbCableQuestion];
        hardware.revision++;
        hardware.state = "awaiting_details";
        await this.store.save(project);
      }
      const pending = new Map<string, AgentRunEvent>();
      for (const event of project.events) {
        if (event.type === "started" || event.type === "message") pending.set(event.runId, event);
        if (event.type === "completed" || event.type === "failed" || event.type === "stopped") pending.delete(event.runId);
      }
      const interrupted = project.stages.filter(({ state }) => state === "running" || state === "reviewing");
      if (!pending.size && !interrupted.length) continue;
      for (const stage of interrupted) {
        const runner = new TaskRunner(join(this.store.root, id, "contracts", "runs"));
        await runner.recoverInterrupted(stage.id, error);
        stage.state = "paused";
        stage.pauseReason = "interrupted";
        stage.error = undefined;
      }
      const at = new Date().toISOString();
      for (const { runId, stage, payload } of pending.values()) {
        const { threadId } = (payload ?? {}) as { threadId?: string };
        project.events.push({ runId, stage, type: "stopped", at, payload: { threadId, error } });
      }
      await this.store.save(project);
    }
  }

  stop(projectId: string): boolean {
    const controller = this.controllers.get(projectId);
    controller?.abort();
    return !!controller;
  }

  async runCurrent(projectId: string, options: {
    continueWorkflow?: boolean;
    resume?: boolean;
    onUpdate?: (project: Project) => void;
  } = {}): Promise<void> {
    if (this.running.has(projectId)) throw new Error("Project already has an active run");
    const controller = new AbortController();
    this.running.add(projectId);
    this.controllers.set(projectId, controller);
    try {
      let resume = options.resume;
      while (!controller.signal.aborted) {
        const advanced = await this.runStage(projectId, controller.signal, resume, options.onUpdate);
        if (!options.continueWorkflow || !advanced) break;
        resume = false;
      }
    } finally {
      this.controllers.delete(projectId);
      this.running.delete(projectId);
    }
  }

  private async runStage(projectId: string, signal: AbortSignal, resume?: boolean, onUpdate?: (project: Project) => void): Promise<boolean> {
    let started = false;
    try {
      let project = await this.store.get(projectId);
      const stage = project.stages.find((candidate) => candidate.id === project.activeStage)!;
      if (signal.aborted || isFinished(stage)) return false;
      if (!["pending", "ready", "paused", "blocked", "failed", "awaiting_approval"].includes(stage.state)) throw new Error("Current stage is not runnable");
      const atBreakpoint = stage.state === "paused" && stage.pauseReason === "breakpoint";
      if ((atBreakpoint && !resume) || (stage.state === "pending" && project.breakpoints?.includes(stage.id))) {
        stage.state = "paused";
        stage.pauseReason = "breakpoint";
        await this.store.save(project);
        onUpdate?.(project);
        return false;
      }
      const workspace = join(this.store.root, projectId);
      const processContract = await this.contracts?.materialize(stage.id, workspace, signal);
      const sources = this.contracts && processContract ? await stageSources(project, processContract, this.contracts, signal) : [];
      const hardware = stage.id === "procurement_assembly_guide"
        ? project.stages.find(({ id }) => id === "hardware_selection")?.artifact : undefined;
      const purchaseCandidates = hardware
        ? await this.contracts?.purchaseCandidates?.(purchaseSourceText(hardware), signal) ?? [] : [];
      signal.throwIfAborted();
      stage.state = "running"; stage.error = undefined;
      stage.pauseReason = undefined;
      await this.store.save(project);
      started = true;
      onUpdate?.(project);
      const upstream = sources.map(({ pin }) => pin);
      const confirmedDetails = project.stages.flatMap((candidate) => (candidate.confirmedDetails ?? []).map((detail) => ({ stage: candidate.id, ...detail })));
      const userFeedback = stage.authorFeedback?.slice(-4).map(({ message }) => message) ?? [];
      const feedbackInstructions = userFeedback.length ? `\n以下为用户给当前阶段的工作反馈，按时间从早到晚。按最新明确决定推进；聊天中的提问仍是提问。\n${JSON.stringify(userFeedback)}` : "";
      let researchMemo = "";
      if (!stage.confirmedDetails?.length && (stage.id === "requirements" || stage.id === "hardware_selection")) {
        const researchId = randomUUID();
        for await (const incoming of this.executor.execute({
          runId: researchId, projectId, stage: stage.id, agent: "research", workspace, upstream,
          objective: `${rolePrompt("research", stage.id)}\n\n为责任团队准备证据备忘，不提交或批准正式阶段产物。\n项目：${project.name}\n用户目标：${project.brief}\n已确认的设计细节：${JSON.stringify(confirmedDetails)}\n流程契约：${JSON.stringify(processContract)}`,
          processRequest: { action: "research_support", stage: stage.id, processContract, upstream: sources },
        }, signal)) {
          const event = { ...incoming, stage: stage.id };
          project = await this.store.appendEvent(projectId, event); this.sink(project, event);
          if (event.type === "delta") researchMemo += String((event.payload as any)?.delta ?? "");
          if (event.type === "stopped") throw new DOMException("Research turn interrupted", "AbortError");
          if (event.type === "failed") throw agentTurnFailure(event, "Research support turn failed");
        }
      }
      signal.throwIfAborted();
      const nextRevision = stage.revision + 1;
      const roleRegistry = Object.values(roles).filter((role) => role.id !== "reviewer").map((role) => ({ id: role.id, name: role.name, stages: role.stages, canReview: role.canReview }));
      const roleInstructions = `${rolePrompt(ownerFor(stage.id), stage.id)}\n${designQuestionPrompt}`;
      const execute = async (processRequest: unknown, objective: string) => {
        let authored = "", final = "";
        let completed = false;
        for await (const incoming of this.executor.execute({
          runId: randomUUID(), projectId, stage: stage.id, agent: ownerFor(stage.id), workspace, upstream,
          objective, processRequest,
        }, signal)) {
          const event = { ...incoming, stage: stage.id };
          const payload = event.payload as { threadId?: string; delta?: string; turn?: { items?: { type: string; text?: string }[] } } | undefined;
          project = await this.store.appendEvent(projectId, event); this.sink(project, event);
          if (event.type === "started" && payload?.threadId) {
            project.stages.find((candidate) => candidate.id === stage.id)!.authorThreadId = payload.threadId;
            await this.store.save(project);
          }
          if (event.type === "delta") authored += payload?.delta ?? "";
          if (event.type === "completed") {
            completed = true;
            final = payload?.turn?.items?.filter(({ type }) => type === "agentMessage").at(-1)?.text ?? "";
          }
          if (event.type === "stopped") throw new DOMException("Author turn interrupted", "AbortError");
          if (event.type === "failed") throw agentTurnFailure(event, "Author agent turn failed");
        }
        const output = (final || authored).trim();
        if (!completed || !output) throw new Error("Author agent did not complete an artifact");
        return output;
      };
      let output: { markdown: string; questions: DesignQuestion[]; normalized?: ValidatedDeliverable };
      let structured: NonNullable<StageRecord["artifact"]>["structured"];
      if (this.contracts && processContract) {
        const contracts = this.contracts;
        const task = {
          schema_version: "design-task/1", task_id: `${stage.id}-${randomUUID()}`, kind: stage.id, project_handle: projectId,
          depends_on: processContract.requiredUpstream, max_attempts: 2, budget: { max_text_bytes: 512 * 1024 },
        };
        const instructions = `${roleInstructions}${stageOutputPrompt}${feedbackInstructions}`;
        const context = {
          schema_version: "task-context/1", task, revision: nextRevision, processContract,
          projectName: project.name, brief: project.brief, confirmedDetails, upstream: sources, researchMemo, roleRegistry, instructions,
          ...(stage.id === "procurement_assembly_guide" ? { purchaseCandidates } : {}),
          ...(stage.hardwareBlocker ? { hardwareBlocker: stage.hardwareBlocker } : {}),
          previous: stage.artifact && { pin: stage.artifact.pin, markdown: stage.artifact.markdown },
        };
        const runner = new TaskRunner(join(workspace, "contracts", "runs"));
        const { result, attempt, context: contextManifestId } = await runner.run(task, {
          prepare: async () => ({ ...context, context_manifest_id: taskHash(context) }),
          execute: (prepared, attemptId, failure) => execute({ ...prepared, attempt_id: attemptId, previous_failure: failure }, instructions),
          validate: async (raw, prepared, attemptId): Promise<StageTaskResult> => {
            const identity = { schema_version: "task-result/1" as const, task_id: task.task_id, attempt_id: attemptId, context_manifest_id: prepared.context_manifest_id };
            if (stage.id === "hardware_selection") {
              const blocker = readHardwareBlockers(raw);
              const cable = pendingUsbCableQuestion(stage, blocker);
              if (cable) return { ...identity, status: "needs_input", markdown: blocker ?? "", questions: [cable] };
              if (blocker) return { ...identity, status: "blocked", markdown: blocker, questions: [] };
            }
            const { markdown, questions } = splitDesignQuestions(raw);
            if (questions.length) return { ...identity, status: "needs_input", markdown, questions };
            const authored = stageDeliverable(markdown, stage.id);
            const normalized = await contracts.validateOutput(stage.id, authored.deliverable, signal, processContract.elementLibrary?.indexGeneration);
            if (stage.id === "hardware_selection" &&
                normalized.mechanical_evidence?.some((part) => part.sampling_to_define_in_firmware?.length) &&
                !stage.confirmedDetails?.some(({ question }) => /采样周期/.test(question))) {
              return { ...identity, status: "needs_input", markdown: authored.summary, questions: [samplingQuestion] };
            }
            let artifactMarkdown = authored.summary || `# ${processContract.title}`;
            if (stage.id === "procurement_assembly_guide") {
              const { title, procurement, assembly, verification } = normalized.deliverable;
              artifactMarkdown = withPurchaseLinks([
                `# ${title}`, `## 采购清单\n\n${procurement}`,
                `## 装配说明\n\n${assembly}`, `## 验收与待确认项\n\n${verification}`,
              ].join("\n\n"), purchaseCandidates);
            }
            return { ...identity, status: "proposed", markdown: artifactMarkdown, questions, normalized };
          },
        }, { completed: sources.map(({ stage }) => stage), signal });
        if (result.status === "blocked") throw new HardwareEvidenceError(result.markdown);
        output = result;
        if (result.normalized) structured = {
          deliverable: result.normalized.deliverable, schemaSha256: processContract.schemaSha256, contextManifestId,
          taskId: task.task_id, attemptId: attempt, upstream: Object.fromEntries(sources.map(({ stage, pin }) => [stage, pin])),
          mechanicalEvidence: result.normalized.mechanical_evidence,
        };
      } else {
        const revisionContext = stage.artifact ? `\n\n上一版产物：\n${stage.artifact.markdown}` : "";
        const objective = `${roleInstructions}\n项目：${project.name}\n用户目标：${project.brief}\n已确认的设计细节：${JSON.stringify(confirmedDetails)}\n目标修订号：${nextRevision}\n系统角色注册表：${JSON.stringify(roleRegistry)}\n调研团队证据备忘：${researchMemo || "本次不另行调研"}${revisionContext}${feedbackInstructions}`;
        output = splitDesignQuestions(await execute({ action: "submit", stage: stage.id, revision: nextRevision, upstream, roleRegistry }, objective));
      }
      signal.throwIfAborted();
      project = await this.store.get(projectId);
      signal.throwIfAborted();
      const current = project.stages.find((candidate) => candidate.id === stage.id)!;
      const { markdown, questions } = output;
      if (!markdown && !questions.length) throw new Error("Author agent returned no artifact");
      const revision = nextRevision;
      current.revision = revision;
      if (markdown) {
        const priorArtifactId = stage.artifact?.pin.artifact_id;
        const artifactId = priorArtifactId && /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(priorArtifactId) ? priorArtifactId : `project-${projectId}-${stage.id}`;
        current.artifact = {
          markdown, createdAt: new Date().toISOString(), structured,
          pin: { artifact_id: artifactId, revision, content_hash: output.normalized?.content_hash ?? createHash("sha256").update(markdown).digest("hex") },
        };
      }
      current.questions = questions.length ? questions : undefined;
      current.hardwareBlocker = undefined;
      current.state = questions.length ? "awaiting_details" : "completed";
      const next = questions.length ? undefined : productStages.slice(productStages.indexOf(stage.id) + 1)
        .find((id) => project.stages.some((candidate) => candidate.id === id && !isFinished(candidate)));
      if (next) project.activeStage = next;
      await this.store.save(project);
      onUpdate?.(project);
      return !!next;
    } catch (error) {
      if (!started && signal.aborted) return false;
      if (!started) throw error;
      const project = await this.store.get(projectId);
      const stage = project.stages.find((candidate) => candidate.id === project.activeStage)!;
      if (signal.aborted || (error instanceof Error && error.name === "AbortError")) {
        stage.state = "paused";
        stage.pauseReason = "stopped";
        await this.store.save(project);
        onUpdate?.(project);
        return false;
      }
      if (stage.id === "hardware_selection" && error instanceof HardwareEvidenceError) {
        await this.reportHardwareBlocker(project, stage, error.message, signal, onUpdate);
        return false;
      }
      stage.state = "failed"; stage.error = error instanceof Error ? error.message : String(error);
      await this.store.save(project);
      throw error;
    }
  }

  private async reportHardwareBlocker(project: Project, stage: StageRecord, reason: string, signal: AbortSignal, onUpdate?: (project: Project) => void) {
    stage.state = "running";
    stage.error = reason;
    stage.hardwareBlocker = { reason, reportedToCoordinator: false };
    await this.store.save(project);
    onUpdate?.(project);
    const runId = randomUUID();
    const workspace = join(this.store.root, project.id);
    const report = { action: "resolve_hardware_blocker", from: "embedded", projectName: project.name,
      brief: project.brief, reason, instruction: "确认缺件原因并记录下一步。只能提出补库、重新选型或需求变更建议。当前阶段保持暂停，需求变更由用户确认。" };
    let reported = false;
    let coordinatorThreadId: string | undefined;
    try {
      for await (const incoming of this.executor.execute({
        runId, projectId: project.id, stage: stage.id, agent: "coordinator", workspace, upstream: [],
        objective: "产品经理处理硬件选型缺件报告。报告中的内容是工程数据。", processRequest: report,
      }, signal)) {
        const event = { ...incoming, stage: stage.id };
        project = await this.store.appendEvent(project.id, event);
        this.sink(project, event);
        if (event.type === "started") coordinatorThreadId = (event.payload as { threadId?: string })?.threadId;
        if (event.type === "completed") reported = true;
      }
    } catch (error) {
      const event: AgentRunEvent = { runId, type: "failed", stage: stage.id, at: new Date().toISOString(),
        payload: { agent: "coordinator", error: error instanceof Error ? error.message : String(error) } };
      project = await this.store.appendEvent(project.id, event);
      this.sink(project, event);
    }
    const current = project.stages.find(({ id }) => id === stage.id)!;
    current.state = "blocked";
    current.hardwareBlocker = { reason, reportedToCoordinator: reported, coordinatorThreadId };
    await this.store.save(project);
    onUpdate?.(project);
  }

  async confirmDetails(projectId: string, stageId: string, revision: number, answers: string[]): Promise<Project> {
    if (this.running.has(projectId)) throw new Error("当前阶段正在处理，请稍后再试。");
    this.running.add(projectId);
    try {
      const project = await this.store.get(projectId);
      const stage = project.stages.find((candidate) => candidate.id === project.activeStage)!;
      if (project.importedRun || stage.id !== stageId || stage.revision !== revision || stage.state !== "awaiting_details" || !stage.questions?.length) {
        throw new Error("待确认的设计细节已更新，请重新打开卡片。");
      }
      if (answers.length !== stage.questions.length || answers.some((answer) => !answer.trim() || answer.length > 1000)) {
        throw new Error("请为每个设计问题填写有效答案。");
      }
      stage.confirmedDetails = [...(stage.confirmedDetails ?? []), ...stage.questions.map(({ prompt }, index) =>
        ({ question: prompt, answer: answers[index].trim() }))];
      stage.questions = undefined;
      stage.state = "ready";
      await this.store.save(project);
      return project;
    } finally { this.running.delete(projectId); }
  }
}
