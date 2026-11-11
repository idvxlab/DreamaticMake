import { spawn } from 'node:child_process';

/** Host supplies executable and roots. Model arguments cannot change either. */
export function pythonBridge(python: string, cwd: string, projectRoot: string, handle: string) {
  return (method: 'context-query' | 'task-prepare' | 'task-validate', args: unknown, signal?: AbortSignal): Promise<any> => new Promise((resolve, reject) => {
    const module = method === 'context-query' ? 'engine' : 'harness.bridge';
    const child = spawn(python, ['-B', '-m', module, 'request', '--project-root', projectRoot, '--project-handle', handle],
      { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', errors = '';
    const kill = () => {
      if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
      else child.kill('SIGKILL');
    };
    const timer = setTimeout(kill, 30_000);
    signal?.addEventListener('abort', kill, { once: true });
    if (signal?.aborted) kill();
    child.stdout.on('data', b => { output += b; if (output.length > 4_000_000) kill(); });
    child.stderr.on('data', b => { if (errors.length < 4000) errors += b; });
    child.on('error', reject);
    child.on('close', code => {
      clearTimeout(timer); signal?.removeEventListener('abort', kill);
      try {
        const result = JSON.parse(output);
        if (code || result.type !== 'result') reject(new Error('Engine request failed: '+JSON.stringify(result.diagnostics ?? [])));
        else resolve(result.payload);
      } catch { reject(new Error('Engine protocol failed')); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify({ request_id: 'harness', method, arguments: args }));
  });
}
