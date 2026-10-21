import { validateAnswers, answerText } from "./answers";
import type { Answers } from "./contracts";
import { choiceQuestions } from "./choice-questions";
import { randomUUID } from "node:crypto";
import {
  stages,
  roleForStage,
  stageSubmissionSchema,
  type Project,
  type StageId,
  type StageDraft,
  type Interaction,
  type Part,
} from "./contracts";
import { hash, HttpError, Store } from "./store";
import { within } from "./store";
import { readFile } from "node:fs/promises";
import {
  designForStage,
  engineStages,
  evaluateDesign,
  type EngineVerification,
} from "./agent-design";
export function currentStage(p: Project) {
  return stages.find((s) => p.stages[s].status !== "approved");
}
export function inputHash(p: Project, id: StageId) {
  return hash({
    id,
    brief: p.brief,
    userInputs: p.messages
      .filter((m) => m.role === "user")
      .map((m) => ({ id: m.id, text: m.text, attachments: m.attachments })),
    answers: p.messages
      .filter((m) => m.interaction?.answers)
      .map((m) => m.interaction),
    revision: p.stages[id].revision,
    upstream: stages.slice(0, stages.indexOf(id)).map((s) => ({
      stage: s,
      draft: p.stages[s].draft,
      revision: p.stages[s].revision,
    })),
    parameters: p.parameters,
    selectedParts: p.selectedParts,
    draft: p.stages[id].draft,
    // Verification is an output of this input snapshot, never an input to itself.
    artifacts: p.stages[id].artifacts
      .filter((a) => a.name !== "engine-verification.json")
      .map((a) => [a.id, a.hash]),
  });
}
export function invalidate(p: Project, id: StageId) {
  for (const name of stages.slice(stages.indexOf(id))) {
    const s = p.stages[name];
    s.revision++;
    s.status = s.draft ? "stale" : "not_started";
    s.review = undefined;
    s.needsReviewOnly = false;
    s.error = undefined;
    s.failureSummary = undefined;
    s.artifacts = [];
  }
}
export class Workflow {
  constructor(
    readonly store: Store,
    readonly catalog: Part[],
  ) {}
  async catalogFor(id: string) {
    return this.store.projectCatalog(id, this.catalog);
  }
  async submit(
    id: string,
    stage: StageId,
    revision: number,
    role: string,
    input: unknown,
  ) {
    const draft = stageSubmissionSchema(stage).parse(input) as StageDraft;
    if (draft.engineDesign && !engineStages.includes(stage))
      throw new HttpError(400, "此阶段不能提交引擎布局");
    if (draft.hardwareFeatures && stage !== "hardware")
      throw new HttpError(400, "此阶段不能提交硬件特征");
    if (choiceQuestions(draft.choices))
      throw new HttpError(
        400,
        "choices 必须是互斥完整方案；独立问题及其选项必须使用 ask_user，后续工程事项使用 futureChecks",
      );
    const catalog = await this.catalogFor(id);
    if (
      draft.futureChecks?.some(
        (check) => stages.indexOf(check.stage) <= stages.indexOf(stage),
      )
    )
      throw new HttpError(
        400,
        "后续待核验事项必须指定后续阶段；当前阶段问题应写入 blockers",
      );
    await this.store.update(id, (p) => {
      if (
        role !== roleForStage[stage] ||
        currentStage(p) !== stage ||
        p.stages[stage].revision !== revision
      )
        throw new HttpError(409, "角色、阶段或版本不匹配");
      if (
        draft.choices.length &&
        draft.selectedChoice &&
        !draft.choices.some((c) => c.id === draft.selectedChoice)
      )
        throw new HttpError(400, "无效方案");
      if (stage === "hardware") {
        if (!draft.partIds.length) draft.blockers.push("尚未选择硬件");
        const selected = [...new Set(draft.partIds)].map((partId) => {
          const part = catalog.find((c) => c.id === partId);
          if (!part) throw new HttpError(400, "只能选择目录中存在的精确部件");
          return part;
        });
        const normalize = (value: string) =>
          value
            .replace(/\\+(?=["'])/g, "")
            .normalize("NFKC")
            .trim();
        // Geometry findings belong to server validation. Replace echoed versions rather than appending them again.
        draft.blockers = [
          ...new Set(
            draft.blockers.filter(
              (blocker) =>
                !selected.some((part) =>
                  normalize(blocker).startsWith(
                    normalize(`${part.name} 的完整安装几何尚未核验`),
                  ),
                ),
            ),
          ),
        ];
        for (const part of selected) {
          if (!part.geometryVerified)
            draft.blockers.push(`${part.name} 的完整安装几何尚未核验`);
        }
        p.selectedParts = draft.partIds;
        for (const feature of draft.hardwareFeatures ?? []) {
          const part = selected.find((part) => part.id === feature.partId);
          if (
            !part ||
            feature.envelopeMm.width !== part.dimensions.width ||
            feature.envelopeMm.depth !== part.dimensions.depth ||
            feature.envelopeMm.height !== part.dimensions.height
          )
            throw new HttpError(
              400,
              "硬件特征必须引用选定器件的目录尺寸，不得虚构安装包络",
            );
        }
      }
      if (draft.parameters) {
        if (
          !["appearance", "structure"].includes(stage) &&
          JSON.stringify(draft.parameters) !== JSON.stringify(p.parameters)
        )
          throw new HttpError(409, "此角色不能改变已确认的机械参数");
        p.parameters = draft.parameters;
      }
      const s = p.stages[stage];
      if (
        !draft.selectedChoice &&
        s.draft?.selectedChoice &&
        draft.choices.some((c) => c.id === s.draft!.selectedChoice)
      )
        draft.selectedChoice = s.draft.selectedChoice;
      s.draft = draft;
      s.needsReviewOnly = false;
      s.review = undefined;
      s.status = "running";
    });
  }
  async review(
    id: string,
    stage: StageId,
    revision: number,
    verdict: "pass" | "changes_requested",
    summary: string,
    verification?: EngineVerification,
  ) {
    await this.store.update(id, async (p) => {
      const s = p.stages[stage];
      if (currentStage(p) !== stage || s.revision !== revision || !s.draft)
        throw new HttpError(409, "审阅输入已失效");
      s.needsReviewOnly = false;
      // A model's prose cannot override current-stage blockers.
      let engineIssue = "";
      if (engineStages.includes(stage)) {
        if (!verification)
          engineIssue = "缺少当前设计的 engine_verify 执行证据";
        else {
          try {
            await this.verifyEngineEvidence(p, stage, verification);
          } catch (error) {
            engineIssue = String(error);
          }
        }
      }
      const inconsistent =
        verdict === "pass" && (s.draft.blockers.length > 0 || !!engineIssue);
      s.review = {
        verdict: inconsistent ? "changes_requested" : verdict,
        summary: inconsistent
          ? `审阅结论未通过服务端校验：${engineIssue || "当前仍有未解决阻塞，不能确认。硬件完整安装几何缺口必须通过真实资料或实测核验解决，不能通过去重、改写描述或移入 futureChecks 消除；请在硬件页查看待核验器件并补充实测尺寸。"}\n\n${summary}`
          : summary,
        inputHash: inputHash(p, stage),
        engineVerification: verification,
      };
      s.status = "awaiting_confirmation";
    });
  }
  private async verifyEngineEvidence(
    p: Project,
    stage: StageId,
    verification: EngineVerification,
  ) {
    const design = designForStage(p, stage);
    const artifact = p.stages[stage].artifacts.find(
      (a) =>
        a.id === verification.artifactId &&
        a.name === "engine-verification.json" &&
        a.revision === p.stages[stage].revision,
    );
    if (!design || !artifact || verification.designHash !== hash(design))
      throw new HttpError(409, "引擎验证缺失或设计已变化");
    await this.store.verify(p.id, [artifact]);
    const saved = JSON.parse(
      await readFile(within(this.store.dir(p.id), artifact.path), "utf8"),
    );
    if (
      saved.designHash !== hash(design) ||
      saved.record?.contextKey !==
        hash(stages.map((name) => inputHash(p, name))) ||
      saved.record?.method !== "workspace" ||
      saved.record.reply?.type !== "result" ||
      hash(saved.record.bundle) !== hash(design.bundle) ||
      hash(saved.record.scenario) !== hash(design.scenario) ||
      saved.record.reply.payload?.snapshot_id !== design.scenario.snapshot_id ||
      saved.record.reply.payload?.result?.snapshot_id !==
        design.scenario.snapshot_id ||
      !evaluateDesign(design, saved.record.reply.payload).passed
    )
      throw new HttpError(
        409,
        "当前设计引擎验证未通过，需修复布局/行为/场景或补齐不支持的验证",
      );
  }
  async approve(
    id: string,
    args: {
      stage: StageId;
      revision: number;
      inputHash: string;
      decision: "approved" | "changes_requested";
      comment?: string;
      key: string;
    },
  ) {
    const catalog = await this.catalogFor(id);
    return this.store.update(id, async (p) => {
      const previous = p.approvals.find((a) => a.id === args.key);
      if (previous) {
        if (
          previous.stage !== args.stage ||
          previous.revision !== args.revision ||
          previous.inputHash !== args.inputHash ||
          previous.decision !== args.decision
        )
          throw new HttpError(409, "幂等键已用于不同请求");
        return previous;
      }
      const s = p.stages[args.stage];
      if (
        p.running ||
        currentStage(p) !== args.stage ||
        s.revision !== args.revision ||
        inputHash(p, args.stage) !== args.inputHash
      )
        throw new HttpError(409, "预览版本已失效或任务仍在运行");
      if (!s.draft) throw new HttpError(409, "尚无可确认成果");
      if (args.decision === "approved") {
        if (choiceQuestions(s.draft.choices))
          throw new HttpError(409, "这些是独立问题，请分别回答后重新生成草稿");
        if (
          s.status !== "awaiting_confirmation" ||
          s.review?.verdict !== "pass" ||
          s.review.inputHash !== args.inputHash
        )
          throw new HttpError(409, "需要当前版本的独立审阅通过");
        if (s.draft.blockers.length)
          throw new HttpError(409, s.draft.blockers.join("；"));
        if (engineStages.includes(args.stage)) {
          if (!s.review.engineVerification)
            throw new HttpError(409, "缺少引擎验证证据");
          await this.verifyEngineEvidence(
            p,
            args.stage,
            s.review.engineVerification,
          );
        }
        if (s.draft.choices.length && !s.draft.selectedChoice)
          throw new HttpError(409, "请先选择方案");
        if (p.messages.some((m) => m.interaction && !m.interaction.answers))
          throw new HttpError(409, "请先回答待确认问题");
        if (args.stage === "cad") {
          for (const partId of p.selectedParts) {
            const part = catalog.find((c) => c.id === partId),
              placement = p.parameters.components.find(
                (c) => c.partId === partId,
              );
            if (
              !part?.geometryVerified ||
              !placement ||
              placement.width !== part.dimensions.width ||
              placement.depth !== part.dimensions.depth ||
              placement.height !== part.dimensions.height
            )
              throw new HttpError(
                409,
                "需要已核验部件的准确装配包络：" + partId,
              );
          }
        }
        if (
          args.stage === "cad" &&
          !s.artifacts.some((a) => a.name === "assembly.step")
        )
          throw new HttpError(409, "缺少实际 CAD 产物");
        if (
          args.stage === "firmware" &&
          !s.artifacts.some(
            (a) => a.name === "firmware.bin" || a.name === "firmware.elf",
          )
        )
          throw new HttpError(409, "缺少编译产物");
        await this.store.verify(id, s.artifacts);
      }
      const receipt = {
        id: args.key,
        stage: args.stage,
        revision: s.revision,
        inputHash: args.inputHash,
        artifactHashes: Object.fromEntries(
          s.artifacts.map((a) => [a.path, a.hash]),
        ),
        decision: args.decision,
        actor: "local-user" as const,
        createdAt: new Date().toISOString(),
        comment: args.comment,
      };
      p.approvals.push(receipt);
      if (args.decision === "approved") s.status = "approved";
      else {
        const repairContext = [
          "请系统负责完善当前阶段：先根据以下审阅意见和阻塞项提出具体修复步骤，再逐项执行并重新提交独立审阅。复用已确认的需求、方案和历史答案；不要要求用户通过自由文本自行设计完善方案。只在确实缺少用户才能提供的信息或存在必要决策时，用结构化问题卡索取少量补充。不得自动代替用户批准成果，也不得无依据宣称已消除工程阻塞。",
          s.review
            ? `独立审阅意见：${s.review.summary}`
            : "尚缺独立审阅，请完成审阅。",
          ...s.draft.blockers.map((blocker) => `待处理阻塞：${blocker}`),
          args.comment?.trim()
            ? `用户补充：${args.comment.trim()}`
            : "用户无额外补充，请系统按审阅意见完善。",
        ].join("\n\n");
        invalidate(p, args.stage);
        p.messages.push({
          id: randomUUID(),
          role: "user",
          text: `完善 ${args.stage}：\n${repairContext}`,
          createdAt: new Date().toISOString(),
        });
      }
      return receipt;
    });
  }
  async revise(id: string, stage: StageId, revision: number, comment: string) {
    await this.store.update(id, (p) => {
      if (
        p.running ||
        p.stages[stage].revision !== revision ||
        !p.stages[stage].draft
      )
        throw new HttpError(409, "阶段已改变或正在执行");
      invalidate(p, stage);
      p.messages.push({
        id: randomUUID(),
        role: "user",
        text: `重新打开${stage}阶段：${comment}`,
        createdAt: new Date().toISOString(),
      });
    });
  }
  async answerChoiceQuestions(
    id: string,
    stage: StageId,
    revision: number,
    answers: Answers,
  ) {
    await this.store.update(id, (project) => {
      const state = project.stages[stage];
      if (
        project.running ||
        project.archived ||
        currentStage(project) !== stage ||
        state.revision !== revision ||
        !state.draft
      )
        throw new HttpError(409, "阶段已改变或正在执行");
      const card = choiceQuestions(state.draft.choices);
      if (!card) throw new HttpError(409, "无效方案");
      if (
        project.messages.some(
          (message) => message.interaction && !message.interaction.answers,
        )
      )
        throw new HttpError(409, "请先回答待确认问题");
      validateAnswers(card, answers);
      project.messages.push({
        id: randomUUID(),
        role: "assistant",
        agent: roleForStage[stage],
        text: card.title,
        createdAt: new Date().toISOString(),
        interaction: { ...card, id: randomUUID(), answers },
      });
      project.messages.push({
        id: randomUUID(),
        role: "user",
        text: card.questions
          .map(
            (question) =>
              `${question.label}: ${answerText(answers[question.id])}`,
          )
          .join("\n"),
        createdAt: new Date().toISOString(),
      });
      invalidate(project, stage);
      state.draft = undefined;
      state.status = "not_started";
    });
  }
  async choose(id: string, stage: StageId, revision: number, choice: string) {
    await this.store.update(id, (p) => {
      const s = p.stages[stage];
      if (
        p.running ||
        currentStage(p) !== stage ||
        s.revision !== revision ||
        !s.draft?.choices.some((c) => c.id === choice)
      )
        throw new HttpError(409, "方案已失效");
      if (choiceQuestions(s.draft.choices))
        throw new HttpError(409, "这些是独立问题，请分别回答后重新生成草稿");
      s.draft.selectedChoice = choice;
      const candidate = s.draft.choices.find((c) => c.id === choice);
      if (candidate?.parameters) {
        if (!["appearance", "structure"].includes(stage))
          throw new HttpError(400, "此阶段不能改变机械参数");
        p.parameters = candidate.parameters;
        s.draft.parameters = candidate.parameters;
      }
      s.needsReviewOnly = true;
      s.review = undefined;
      s.status = "stale";
    });
  }
  async ask(id: string, interaction: Omit<Interaction, "id" | "answers">) {
    await this.store.update(id, (p) => {
      if (p.messages.some((m) => m.interaction && !m.interaction.answers))
        throw new HttpError(409, "已有问题等待回答");
      const normalize = (value: string) =>
        value.replace(/\s+/g, "").toLowerCase();
      const answered = p.messages.flatMap((message) =>
        message.interaction?.answers ? message.interaction.questions : [],
      );
      if (
        interaction.questions.some((question) =>
          answered.some(
            (previous) =>
              normalize(previous.label) === normalize(question.label),
          ),
        )
      )
        throw new HttpError(
          409,
          "这个问题已经回答，请读取已有答案继续处理；如有新的冲突，请明确说明差异，不要重复提问",
        );
      p.messages.push({
        id: randomUUID(),
        role: "assistant",
        text: interaction.title,
        agent: roleForStage[currentStage(p) ?? "requirements"],
        createdAt: new Date().toISOString(),
        interaction: { ...interaction, id: randomUUID() },
      });
    });
  }
  async answer(id: string, interactionId: string, answers: Answers) {
    await this.store.update(id, (p) => {
      if (p.running) throw new HttpError(409, "请等待当前任务结束");
      const card = p.messages.find(
        (m) => m.interaction?.id === interactionId,
      )?.interaction;
      if (!card || card.answers) throw new HttpError(409, "问题已回答或不存在");
      validateAnswers(card, answers);
      card.answers = answers;
      p.messages.push({
        id: randomUUID(),
        role: "user",
        text: Object.entries(answers)
          .map(([k, v]) => `${k}: ${answerText(v)}`)
          .join("\n"),
        createdAt: new Date().toISOString(),
      });
    });
  }
}
