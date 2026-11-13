import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { JsonRpcConnection } from "./json-rpc";
import type { AgentExecutor, AgentRunEvent, StageExecutionRequest } from "../../orchestrator/src/contracts";

interface ThreadResult { thread: { id: string } }
interface TurnResult { turn: { id: string } }
interface StoredTurn { id?: string; status?: string }
interface TurnUpdate { threadId?: string; turnId?: string; turn?: StoredTurn; requestId?: number | string }

export interface ToolApproval {
  token: string;
  server: string;
  message: string;
}

type ApprovalDecision = "accept" | "decline";

export interface CodexServerOptions {
  command?: string;
  args?: string[];
  model?: string;
  cwd: string;
  turnStatusPollMs?: number;
  onToolApprovalsChanged?(projectId: string): void;
}

export class CodexServerExecutor implements AgentExecutor {
  private connection?: Promise<JsonRpcConnection>;
  private toolApprovals = new Map<string, {
    projectId: string;
    approval: ToolApproval;
    decide(decision: ApprovalDecision): void;
  }>();
  constructor(private readonly options: CodexServerOptions) {}

  pendingToolApprovals(projectId: string): ToolApproval[] {
    return [...this.toolApprovals.values()].filter((entry) => entry.projectId === projectId).map((entry) => entry.approval);
  }

  decideToolApproval(projectId: string, token: string, decision: ApprovalDecision): boolean {
    const entry = this.toolApprovals.get(token);
    if (!entry || entry.projectId !== projectId) return false;
    entry.decide(decision);
    return true;
  }

  private connect(): Promise<JsonRpcConnection> {
    if (!this.connection) this.connection = this.startServer().catch((error) => {
      this.connection = undefined;
      throw error;
    });
    return this.connection;
  }

  private async startServer(): Promise<JsonRpcConnection> {
    const child = spawn(this.options.command ?? "codex", this.options.args ?? ["app-server", "--listen", "stdio://"], {
      cwd: this.options.cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    child.on("error", () => child.stdout.destroy());
    const rpc = new JsonRpcConnection(child.stdout, child.stdin);
    rpc.onClose(() => { this.connection = undefined; });
    await rpc.request("initialize", { clientInfo: { name: "dreamatic_maker", title: "DreamaticMaker", version: "0.1.0" } });
    rpc.notify("initialized");
    return rpc;
  }

  async *execute(request: StageExecutionRequest, signal?: AbortSignal): AsyncIterable<AgentRunEvent> {
    signal?.throwIfAborted();
    const rpc = await this.connect();
    signal?.throwIfAborted();
    const started = await rpc.request<ThreadResult>("thread/start", {
      model: this.options.model,
      cwd: request.workspace,
      approvalPolicy: "on-request",
      sandbox: "workspace-write",
    });
    const input = JSON.stringify({ role: request.agent, objective: request.objective, process_request: request.processRequest, upstream: request.upstream });
    yield* this.streamTurn(rpc, started.thread.id, request.runId, input, { agent: request.agent }, signal, request.projectId);
  }

  async *continueThread(threadId: string, text: string, runId: string, signal?: AbortSignal, projectId?: string): AsyncIterable<AgentRunEvent> {
    signal?.throwIfAborted();
    const rpc = await this.connect();
    signal?.throwIfAborted();
    const resumed = await rpc.request<ThreadResult>("thread/resume", { threadId, excludeTurns: true });
    if (resumed.thread.id !== threadId) throw new Error("Resumed conversation did not match the selected thread");
    yield* this.streamTurn(rpc, threadId, runId, text, { continued: true }, signal, projectId);
  }

  private async *streamTurn(rpc: JsonRpcConnection, threadId: string, runId: string, text: string, context: object, signal?: AbortSignal, projectId?: string): AsyncIterable<AgentRunEvent> {
    const queue: AgentRunEvent[] = [];
    let wake: (() => void) | undefined;
    let terminal = false;
    let turnId: string | undefined;
    let interruptionRequested = false;
    let lastUpdate = Date.now();
    let reconciling = false;
    let poll: ReturnType<typeof setInterval> | undefined;
    const pollMs = this.options.turnStatusPollMs ?? 30_000;
    const reconciliation = new AbortController();
    const approvalTokens = new Map<number | string, string>();
    const removeApproval = (requestId: number | string) => {
      const token = approvalTokens.get(requestId);
      if (!token) return;
      approvalTokens.delete(requestId);
      this.toolApprovals.delete(token);
      if (projectId) this.options.onToolApprovalsChanged?.(projectId);
    };
    const push = (type: AgentRunEvent["type"], payload: object) => {
      queue.push({ runId, type, at: new Date().toISOString(), payload: { ...payload, threadId } });
      wake?.();
      wake = undefined;
    };
    const interrupt = () => {
      if (!turnId || terminal || interruptionRequested) return;
      interruptionRequested = true;
      // Wait for the turn's terminal state before releasing the project.
      void rpc.request("turn/interrupt", { threadId, turnId }).catch((error) => {
        if (!terminal) push("item", { error: String(error), operation: "turn/interrupt" });
      });
    };
    const finishTurn = (update: TurnUpdate) => {
      if (terminal) return;
      terminal = true;
      const status = update.turn?.status;
      push(status === "completed" ? "completed" : status === "interrupted" ? "stopped" : "failed", update);
    };
    const reconcileTurn = async () => {
      if (!turnId || terminal || reconciling || Date.now() - lastUpdate < pollMs) return;
      reconciling = true;
      const signal = AbortSignal.any([reconciliation.signal, AbortSignal.timeout(5_000)]);
      try {
        const { thread } = await rpc.request<{ thread: { id: string; status: { type: string } } }>("thread/read", { threadId }, signal);
        if (thread.id !== threadId || !["idle", "notLoaded", "systemError"].includes(thread.status.type)) return;
        const { data } = await rpc.request<{ data: StoredTurn[] }>("thread/turns/list", { threadId, limit: 1, itemsView: "full" }, signal);
        const turn = data.find((candidate) => candidate.id === turnId);
        if (turn?.status && ["completed", "interrupted", "failed"].includes(turn.status)) finishTurn({ threadId, turn });
      } catch {
        // A transient read failure leaves the live turn authoritative.
      } finally { reconciling = false; }
    };
    const off = rpc.onNotification(({ id, method, params: raw }) => {
      const params = raw as TurnUpdate | undefined;
      if (params?.threadId !== threadId) return;
      const incomingTurn = params.turnId ?? params.turn?.id;
      if (turnId && incomingTurn && incomingTurn !== turnId) return;
      lastUpdate = Date.now();
      if (method === "mcpServer/elicitation/request" && id !== undefined) {
        const request = raw as {
          mode?: string;
          serverName?: string;
          message?: string;
          requestedSchema?: { properties?: object; required?: string[] };
        };
        const reply = (action: ApprovalDecision | "cancel") => rpc.respond(id, {
          action, content: action === "accept" ? {} : null, _meta: null,
        });
        if (!projectId || request.mode !== "form" || !request.serverName || !request.message ||
            !request.requestedSchema || Object.keys(request.requestedSchema.properties ?? {}).length ||
            request.requestedSchema.required?.length) {
          reply("cancel");
          return;
        }
        const token = randomUUID();
        approvalTokens.set(id, token);
        this.toolApprovals.set(token, {
          projectId,
          approval: { token, server: request.serverName, message: request.message },
          decide: (decision) => {
            removeApproval(id);
            reply(decision);
          },
        });
        this.options.onToolApprovalsChanged?.(projectId);
      } else if (method === "serverRequest/resolved" && params.requestId !== undefined) removeApproval(params.requestId);
      else if (method === "item/agentMessage/delta") push("delta", params);
      else if (method?.includes("approval")) push("approval", params);
      else if (method === "turn/completed") finishTurn(params);
    });
    const offClose = rpc.onClose(() => {
      if (terminal) return;
      terminal = true;
      push("failed", { error: "Codex app-server connection closed" });
    });
    signal?.addEventListener("abort", interrupt, { once: true });
    try {
      signal?.throwIfAborted();
      yield { runId, type: "started", at: new Date().toISOString(), payload: { ...context, threadId } };
      signal?.throwIfAborted();
      const started = await rpc.request<TurnResult>("turn/start", { threadId, input: [{ type: "text", text }] });
      turnId = started.turn.id;
      if (signal?.aborted) interrupt();
      poll = setInterval(() => { void reconcileTurn(); }, pollMs);
      while (!terminal || queue.length) {
        if (!queue.length) await new Promise<void>((resolve) => { wake = resolve; });
        while (queue.length) yield queue.shift()!;
      }
    } finally {
      for (const id of approvalTokens.keys()) removeApproval(id);
      clearInterval(poll);
      reconciliation.abort();
      signal?.removeEventListener("abort", interrupt);
      off();
      offClose();
    }
  }
}
