"""Bounded subprocess runner. Isolation is not an OS security sandbox."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time


def stop_tree(process):
    if process.poll() is not None: return
    if os.name == 'nt':
        subprocess.run(['taskkill.exe', '/PID', str(process.pid), '/T', '/F'], capture_output=True,
            creationflags=subprocess.CREATE_NO_WINDOW, timeout=5)
    else:
        try: os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError: pass
    process.wait(timeout=5)


def execute(tool, operation, tool_input, *, timeout_s=20, cancelled=lambda: False, directory=None):
    if not 0 < timeout_s <= 24: raise ValueError('Worker deadline must be within bridge budget')
    if cancelled(): raise InterruptedError('Tool request cancelled')
    root = Path(__file__).resolve().parents[2]
    if directory is None:
        directory = root/'workspace/tools/tmp'
    Path(directory).mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=directory) as temporary:
        folder = Path(temporary)
        input_file, output_file = folder/'input.json', folder/'output.json'
        input_file.write_text(json.dumps({'tool_id': tool, 'operation': operation, 'input': tool_input}, allow_nan=False), encoding='utf-8')
        with (folder/'stdout.log').open('wb') as stdout, (folder/'stderr.log').open('wb') as stderr:
            process = subprocess.Popen([sys.executable, '-B', '-m', 'engine.tools.worker', str(input_file), str(output_file)],
                cwd=root, stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr,
                env={**os.environ, 'TEMP':str(folder.resolve()), 'TMP':str(folder.resolve()), 'TMPDIR':str(folder.resolve())},
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0, start_new_session=os.name != 'nt')
            start = time.monotonic()
            try:
                while process.poll() is None:
                    if cancelled(): raise InterruptedError('Tool request cancelled')
                    if time.monotonic()-start >= timeout_s: raise TimeoutError('Tool worker timed out')
                    if sum(p.stat().st_size for p in folder.iterdir() if p.is_file()) > 64_000_000: raise ValueError('Worker output budget exceeded')
                    time.sleep(.02)
            finally: stop_tree(process)
        if not output_file.exists(): raise ValueError('Worker failed before publishing output')
        if output_file.stat().st_size > 16_000_000: raise ValueError('Worker output budget exceeded')
        result = json.loads(output_file.read_text(encoding='utf-8'))
        if process.returncode or 'error' in result: raise ValueError(result.get('error', 'Worker failed'))
        return result
