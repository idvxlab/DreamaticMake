import { mkdir, readFile, rename, writeFile, appendFile, open, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export type State = 'preparing' | 'running' | 'validated' | 'needs_input' | 'failed' | 'cancelled' | 'interrupted';
export interface Task {
  task_id: string; max_attempts: number; depends_on: string[];
  budget: { max_text_tokens: number };
  [key: string]: unknown;
}
type Bridge = (method: 'task-prepare' | 'task-validate', args: unknown, signal?: AbortSignal) => Promise<any>;
type Execute = (context: any, attempt: string, signal?: AbortSignal) => Promise<unknown>;

const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
export class TaskRunner {
  constructor(private workspace: string, private bridge: Bridge) {}
  async run(task: Task, execute: Execute, options: { signal?: AbortSignal; resume?: boolean; completed?: string[] } = {}) {
    if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(task.task_id)) throw new Error('Invalid task ID');
    if (task.depends_on.some(d => !options.completed?.includes(d))) throw new Error('Dependencies not ready');
    if (!Number.isInteger(task.max_attempts) || task.max_attempts < 1 || task.max_attempts > 3) throw new Error('Invalid retry budget');
    const dir = resolve(this.workspace, task.task_id);
    await mkdir(dir, { recursive: true });
    const root = await realpath(this.workspace), actual = await realpath(dir);
    const rel = relative(root, actual);
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Attempt path escapes workspace');
    const lock = await open(join(dir, 'writer.lock'), 'wx');
    const file = join(dir, 'state.json');
    const save = async (v: unknown) => {
      const tmp = join(dir, randomUUID()+'.tmp');
      await writeFile(tmp, JSON.stringify(v, null, 2)); await rename(tmp, file);
      await appendFile(join(dir, 'events.jsonl'), JSON.stringify(v)+'\n');
    };
    try {
      let previous: any;
      try { previous = JSON.parse(await readFile(file, 'utf8')); } catch (e: any) { if (e.code !== 'ENOENT') throw e; }
      if (previous?.task_hash !== undefined && previous.task_hash !== hash(task)) throw new Error('Task baseline differs');
      if (previous && !options.resume) throw new Error('Explicit resume required');
      // Revalidate baseline even for an already validated result.
      const context = await this.bridge('task-prepare', { task }, options.signal);
      if (previous?.state === 'validated') {
        if (previous.context_manifest_id !== context.context_manifest_id) throw new Error('Context baseline differs');
        if (!/^attempt-[1-3]$/.test(previous.attempt_id)) throw new Error('Invalid saved attempt');
        const saved = JSON.parse(await readFile(join(dir, previous.attempt_id, 'deliverable.json'), 'utf8'));
        if (hash(saved) !== previous.deliverable_hash) throw new Error('Saved deliverable hash differs');
        await this.bridge('task-validate', { task, result: saved, attempt_id: previous.attempt_id }, options.signal);
        return previous;
      }
      let last: any;
      for (let n = (previous?.attempt ?? 0)+1; n <= task.max_attempts; n++) {
        const attemptId = `attempt-${n}`;
        const attemptDir = join(dir, attemptId); await mkdir(attemptDir, { recursive: false });
        last = { task_hash: hash(task), attempt: n, attempt_id: attemptId, state: 'preparing' as State,
          context_manifest_id: context.context_manifest_id, actual_context_hash: hash(context),
          read_set: (context.queries ?? []).flatMap((q: any) => q.sources ?? []),
          asset_deliveries: [], write_set: [] };
        await save(last);
        // Budget includes the complete initial payload, schema and instructions supplied by caller.
        if (!context.ready || Buffer.byteLength(JSON.stringify(context)) > task.budget.max_text_tokens) {
          last.state = 'needs_input'; await save(last); return last;
        }
        await writeFile(join(attemptDir, 'context.json'), JSON.stringify(context));
        try {
          options.signal?.throwIfAborted();
          last.state = 'running'; await save(last);
          const result = await execute(context, attemptId, options.signal);
          options.signal?.throwIfAborted();
          const validated = await this.bridge('task-validate', { task, result, attempt_id: attemptId }, options.signal);
          await writeFile(join(attemptDir, 'deliverable.json'), JSON.stringify(validated));
          last = { ...last, state: validated.status === 'proposed' ? 'validated' : 'needs_input',
            write_set: (validated.operations ?? []).map((o: any) => o.target),
            deliverable_hash: hash(validated), engineering_outcome: 'unverified' };
          await save(last); return last;
        } catch {
          last.state = options.signal?.aborted ? 'cancelled' : 'failed';
          last.failure = 'execution_or_contract_failure'; await save(last);
          if (options.signal?.aborted) return last;
        }
      }
      return last ?? previous;
    } finally { await lock.close(); await import('node:fs/promises').then(fs => fs.unlink(join(dir, 'writer.lock'))); }
  }
}
