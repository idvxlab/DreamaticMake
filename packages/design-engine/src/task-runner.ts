import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, open, readFile, readdir, realpath, rename, rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Adapted from DreamaticMake design-engine-v2 (3fc506b), harness/src/runner.ts.
// The host supplies preparation, execution, and validation for each task.
export const taskHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export interface WorkflowTask {
  task_id: string;
  depends_on: string[];
  max_attempts: number;
  budget: { max_text_bytes: number };
}

interface TaskContext {
  context_manifest_id: string;
}

interface TaskResult {
  status: "proposed" | "needs_input" | "blocked";
}

async function saveState(dir: string, value: unknown) {
  const tmp = join(dir, `${randomUUID()}.tmp`);
  const data = JSON.stringify(value, null, 2);
  await writeFile(tmp, data);
  await rename(tmp, join(dir, "state.json"));
  await appendFile(join(dir, "events.jsonl"), JSON.stringify(value) + "\n");
}

export class TaskRunner {
  constructor(private readonly workspace: string) {}

  async recoverInterrupted(stage: string, failure: string): Promise<void> {
    const entries = await readdir(this.workspace, { withFileTypes: true }).catch((error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith(stage + "-")) continue;
      const dir = join(this.workspace, entry.name);
      const data = await readFile(join(dir, "state.json"), "utf8").catch((error) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      });
      if (!data) continue;
      const state = JSON.parse(data);
      if (state.state !== "running") continue;
      await rm(join(dir, "writer.lock"), { force: true });
      await saveState(dir, { ...state, state: "cancelled", failure });
    }
  }

  async run<C extends TaskContext, Raw, Result extends TaskResult>(task: WorkflowTask, handlers: {
    prepare: () => Promise<C>;
    execute: (context: C, attempt: string, failure?: string) => Promise<Raw>;
    validate: (result: Raw, context: C, attempt: string) => Promise<Result>;
  }, options: { completed: readonly string[]; signal: AbortSignal }) {
    if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(task.task_id)) throw new Error("任务 ID 无效");
    if (task.depends_on.some((dependency) => !options.completed.includes(dependency))) throw new Error("上游阶段尚未完成");
    if (!Number.isInteger(task.max_attempts) || task.max_attempts < 1 || task.max_attempts > 3) throw new Error("任务重试次数无效");
    options.signal.throwIfAborted();
    await mkdir(this.workspace, { recursive: true });
    const dir = join(await realpath(this.workspace), task.task_id);
    await mkdir(dir);
    if (await realpath(dir) !== dir) throw new Error("任务路径超出工作区");
    const lockPath = join(dir, "writer.lock");
    const lock = await open(lockPath, "wx");
    const hash = taskHash(task);

    try {
      const context = await handlers.prepare();
      if (Buffer.byteLength(JSON.stringify(context)) > task.budget.max_text_bytes) throw new Error("阶段上下文超出预算，请缩小任务范围");

      let failure: string | undefined;
      for (let n = 1; n <= task.max_attempts; n++) {
        const attempt = `attempt-${n}`;
        const attemptDir = join(dir, attempt);
        await mkdir(attemptDir);
        const attemptContext = { ...context, previous_failure: failure };
        const receipt = {
          task_hash: hash, attempt: n, attempt_id: attempt, context_manifest_id: context.context_manifest_id,
          actual_context_hash: taskHash(attemptContext),
        };
        await writeFile(join(attemptDir, "context.json"), JSON.stringify(attemptContext));
        await saveState(dir, { ...receipt, state: "running" });
        let result: Result;
        try {
          options.signal.throwIfAborted();
          const raw = await handlers.execute(context, attempt, failure);
          options.signal.throwIfAborted();
          result = await handlers.validate(raw, context, attempt);
          options.signal.throwIfAborted();
        } catch (error) {
          failure = error instanceof Error ? error.message : String(error);
          await saveState(dir, { ...receipt, state: options.signal.aborted || (error instanceof Error && error.name === "AbortError") ? "cancelled" : "failed", failure });
          if (options.signal.aborted || n === task.max_attempts || (error instanceof Error && error.name === "AbortError")) throw error;
          continue;
        }
        await writeFile(join(attemptDir, "deliverable.json"), JSON.stringify(result));
        await saveState(dir, { ...receipt, state: result.status === "proposed" ? "validated" : result.status, deliverable_hash: taskHash(result) });
        return { result, attempt, context: context.context_manifest_id };
      }
      throw new Error("任务重试次数已用完");
    } finally {
      await lock.close();
      await unlink(lockPath);
    }
  }
}
