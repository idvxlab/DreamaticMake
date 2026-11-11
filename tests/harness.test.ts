import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { TaskRunner, type Task } from '../harness/src/runner';
import { createTaskSession } from '../harness/src/runtime';
import { getModel } from '@mariozechner/pi-ai';
import { execFileSync } from 'node:child_process';
import { pythonBridge } from '../harness/src/bridge';

const task: Task = { task_id:'F0', max_attempts:3, depends_on:[], budget:{max_text_tokens:32000} };
async function temporary(fn: (dir: string) => Promise<void>) {
  await mkdir(resolve('workspace/harness-tests'), { recursive:true });
  const dir = await mkdtemp(resolve('workspace/harness-tests/attempt-'));
  try { await fn(dir); } finally { await rm(dir, { recursive:true, force:true }); }
}
test('runner retries, persists receipts, resumes idempotently and rechecks baseline', async () => temporary(async dir => {
  let calls=0, prepares=0;
  const bridge = async (method: string, args: any) => {
    if (method==='task-prepare') { prepares++; return {ready:true,context_manifest_id:'ctx'}; }
    if (++calls===1) throw new Error('invalid');
    return {status:'proposed'};
  };
  const runner=new TaskRunner(dir,bridge);
  const result=await runner.run(task,async()=>({}));
  assert.equal(result.state,'validated'); assert.equal(result.attempt,2);
  assert.equal(result.engineering_outcome,'unverified');
  await assert.rejects(runner.run(task,async()=>({})),/resume/);
  const resumed=await runner.run(task,async()=>{throw new Error('duplicate');},{resume:true});
  assert.deepEqual(resumed,result); assert.equal(prepares,2);
  await assert.rejects(runner.run({...task,max_attempts:2},async()=>({}),{resume:true}),/baseline/);
}));
test('runner bounds retries, dependencies, scope, budget and cancellation', async () => temporary(async dir => {
  const runner=new TaskRunner(dir,async()=>({ready:true,context_manifest_id:'ctx'}));
  await assert.rejects(runner.run({...task,task_id:'../escape'},async()=>({})),/ID/);
  await assert.rejects(runner.run({...task,depends_on:['missing']},async()=>({})),/Dependencies/);
  const blocked=await runner.run({...task,task_id:'budget',budget:{max_text_tokens:1}},async()=>{throw new Error('must not run');});
  assert.equal(blocked.state,'needs_input');
  let calls=0;
  const failed=await runner.run(task,async()=>{calls++;throw new Error('bad schema');});
  assert.equal(failed.state,'failed'); assert.equal(calls,3);
  const abort=new AbortController(); abort.abort();
  const cancelled=await runner.run({...task,task_id:'cancel'},async()=>({}),{signal:abort.signal});
  assert.equal(cancelled.state,'cancelled');
}));
test('pinned Pi SDK creates independent sessions without filesystem tools or discovered context', async () => temporary(async dir => {
  const model=getModel('openai','gpt-4o-mini');
  const a=await createTaskSession(dir,'task-only-system',model,'test-placeholder');
  const b=await createTaskSession(dir,'another-task',model,'test-placeholder');
  try {
    assert.ok(a.session.systemPrompt.startsWith('task-only-system\n'));
    assert.ok(b.session.systemPrompt.startsWith('another-task\n'));
    assert.ok(!b.session.systemPrompt.includes('task-only-system'));
    assert.deepEqual(a.session.messages,[]); assert.deepEqual(b.session.messages,[]);
    assert.deepEqual(a.session.getActiveToolNames(),[]);
  } finally { a.session.dispose(); b.session.dispose(); }
}));
test('real Python bridge prepares and validates a v3 needs-input deliverable', async () => temporary(async dir => {
  const candidates=['.runtime/python','.venv-engine'].map(p=>resolve(p,process.platform==='win32'?'Scripts/python.exe':'bin/python'));
  const python=process.env.MAKE_ENGINE_PYTHON || candidates.find(existsSync) || 'python';
  const source='import json; from engine.query import QueryService; from process.tasks import plan_tasks; s=QueryService("examples/project_2","clock"); print(plan_tasks(s,["button_stop"])[0].model_dump_json())';
  const nativeTask=JSON.parse(execFileSync(python,['-B','-c',source],{encoding:'utf8',windowsHide:true}));
  const bridge=pythonBridge(python,resolve('.'),resolve('examples/project_2'),'clock');
  const runner=new TaskRunner(dir,bridge);
  const result=await runner.run(nativeTask,async(context,attempt)=>({
    task_id:nativeTask.task_id, attempt_id:attempt, context_manifest_id:context.context_manifest_id,
    status:'needs_input', open_issues:['No selected current collision evidence'],
  }));
  assert.equal(result.state,'needs_input'); assert.equal(result.engineering_outcome,'unverified');
}));
