import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { ToolDescriptor, ToolRunResult } from '../contracts';

export function ToolResults({ projectPath, target, positions, onSelect }: {
  projectPath: string; target: string | null; positions: Record<string, number>; onSelect: (ref: string) => void;
}) {
  const [tools, setTools] = useState<ToolDescriptor[]>([]);
  const [tool, setTool] = useState('native_kinematics');
  const [operation, setOperation] = useState('pose');
  const [scenario, setScenario] = useState('');
  const [result, setResult] = useState<ToolRunResult | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    api<{ tools: ToolDescriptor[] }>({ method: 'tools_describe' }, abort.signal)
      .then(r => setTools(r.tools)).catch(e => { if (e.name !== 'AbortError') setMessage(e.message); });
    return () => { abort.abort(); controller.current?.abort(); };
  }, []);
  useEffect(() => { controller.current?.abort(); setResult(null); setMessage(''); setBusy(false); }, [projectPath, target]);
  const descriptor = tools.find(t => t.id === tool);
  const execute = async () => {
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setMessage(''); setResult(null);
    try {
      const context = await api<{snapshot_id: string; source_kind: string}>({ method:'tools_prepare', project_path:projectPath }, abort.signal);
      const request = { request_id:crypto.randomUUID(), tool_id:tool, operation,
        ...context, scope:target ? [target] : [], options: tool === 'native_kinematics' || tool === 'fcl_collision' ? {positions} : {},
        scenario_ref:tool === 'sismic_statechart' ? scenario : null };
      const prepared = await api<{status:string; requirements:string[]}>({method:'tools_prepare',project_path:projectPath,tool_request:request},abort.signal);
      if (prepared.status !== 'ready') { setMessage(`${prepared.status}: ${prepared.requirements.join('; ')}`); return; }
      const value = await api<ToolRunResult>({method:'tools_run',project_path:projectPath,tool_request:request},abort.signal);
      const latest = await api<{snapshot_id:string}>({method:'tools_prepare',project_path:projectPath},abort.signal);
      value.presentation.stale = latest.snapshot_id !== value.evidence.subject_snapshot_id;
      setResult(value);
    } catch(e) { if (!abort.signal.aborted) setMessage(e instanceof Error ? e.message : String(e)); }
    finally { if (!abort.signal.aborted) setBusy(false); }
  };
  return <section aria-label="工具分析结果">
    <h3>工具分析</h3>
    <p>检查范围：{target ?? '全项目内部'}{target && '（仅此元件内部）'}</p>
    <label>分析工具<select aria-label="分析工具" value={tool} disabled={busy} onChange={e => {
      const next = tools.find(t => t.id === e.target.value); setTool(e.target.value); setOperation(next?.operations[0] ?? 'pose'); setResult(null);
    }}>{tools.map(t => <option key={t.id} value={t.id}>{t.id}</option>)}</select></label>
    <label>操作<select aria-label="操作" value={operation} disabled={busy} onChange={e => setOperation(e.target.value)}>
      {descriptor?.operations.filter(o => !['sample_trajectory','trajectory_collision'].includes(o)).map(o => <option key={o}>{o}</option>)}
    </select></label>
    {tool === 'sismic_statechart' && <label>已登记场景<input value={scenario} onChange={e => setScenario(e.target.value)} placeholder="simulation/interlock.json" /></label>}
    <button onClick={() => void execute()} disabled={busy || !descriptor?.availability.worker_ready}>{busy ? '分析中…' : '运行分析'}</button>
    {busy && <button onClick={() => { controller.current?.abort(); setBusy(false); setMessage('已取消请求'); }}>取消</button>}
    {descriptor && !descriptor.availability.worker_ready && <p>{descriptor.availability.reason}</p>}
    {message && <p role="status">{message}</p>}
    {result && <>
      <p>{result.evidence.execution} / {result.evidence.outcome}</p>
      {result.presentation.stale && <p role="status">结果来自旧快照，已停用定位。</p>}
      {result.findings.map(f => <div key={f.finding_id}><p>{f.code}: {f.message}</p>
        {f.refs.map(ref => <button key={ref} disabled={result.presentation.stale} onClick={() => {
          const display = result.source_map[ref]?.display_ref; if (display) onSelect(display);
        }}>{ref}</button>)}</div>)}
      <p>覆盖 {result.coverage_items.length} 个对象</p>
      {[...new Set(result.coverage_items.flatMap(c => c.omissions))].map(text => <p key={text}>{text}</p>)}
      <small>运行记录：{result.evidence.run_id}</small>
    </>}
  </section>;
}
