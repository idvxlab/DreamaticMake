"""Execute example software tests, check GPIO/net contracts and record scoped evidence."""
import ast
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()


def verify(number, folder):
    project = ROOT / 'examples' / ('project_%d' % number)
    code = project / 'software' / folder
    tests = code / 'tests'
    config = {}
    for node in ast.parse((code / 'config.py').read_text(encoding='utf-8')).body:
        if isinstance(node, ast.Assign):
            try: config[node.targets[0].id] = ast.literal_eval(node.value)
            except (ValueError, TypeError): pass
    plan_path = project / 'doc/logical_layout/pin-plan-v0.1.json'
    plan = json.loads(plan_path.read_text(encoding='utf-8'))
    nets_path = project / 'design/circuit-logic.json'
    nets = json.loads(nets_path.read_text(encoding='utf-8'))['nets']
    # The firmware contract uses the same instance/pin identities across v2/v3.
    nets = {name: {**net, 'members': net.get('members', [f"{r['instance']}/{r['id']}" for r in net.get('nodes', [])])}
            for name, net in nets.items()}
    if number == 2:
        actual = {str(pin): name for name, pin in config['BUTTONS'].items()}
        assert actual == plan['button_inputs']
        expected = {'oled_clk': 18, 'oled_din': 19, 'oled_cs': 9, 'oled_dc': 10, 'oled_rst': 11,
                    'rtc_sda': 2, 'rtc_scl': 3, 'piezo_pwm': 8}
        expected.update({'key_' + k: p for k, p in config['BUTTONS'].items()})
        assert config['OLED'] == {'spi': 0, 'sck': 18, 'mosi': 19, 'cs': 9, 'dc': 10, 'rst': 11}
        assert config['RTC'] == {'i2c': 1, 'sda': 2, 'scl': 3, 'address': 0x68}
        assert config['BUZZER_PIN'] == 8
        for net, pin in expected.items(): assert 'controller/gp%02d' % pin in nets[net]['members'], net
    else:
        gpio = plan['gpio']
        assert list(config['ROWS']) == gpio['matrix_rows']
        assert list(config['COLS']) == gpio['matrix_columns']
        assert config['INPUTS'] == {'door': gpio['door'], 'locked': gpio['locked'], 'unlocked': gpio['unlocked'],
                                    'setup': gpio['internal_setup'], 'power': gpio['power_good']}
        assert list(config['MOTOR']) == [gpio['motor_in1'], gpio['motor_in2']]
        assert config['LED'] == gpio['status_led'] and config['BUZZER'] == gpio['buzzer_signal']
        assert config['HARDWARE_ACTUATION_ENABLED'] is False
        for pin in range(7, 16): assert 'controller/gp%d' % pin in nets['io_%d' % pin]['members']
        for row in range(4): assert 'controller/gp%d' % row in nets['key_r%d' % (row + 1)]['members']
        for col in range(3): assert 'controller/gp%d' % (4 + col) in nets['key_c%d' % (col + 1)]['members']
    files = sorted(code.rglob('*.py'))
    for file in files: compile(file.read_text(encoding='utf-8'), str(file), 'exec')
    temp = ROOT / '.runtime/tmp/example-software'
    temp.mkdir(parents=True, exist_ok=True)
    command = [sys.executable, '-B', '-m', 'unittest', 'discover', '-s', str(tests), '-v']
    result = subprocess.run(command, cwd=ROOT, text=True, encoding='utf-8', capture_output=True, timeout=120,
        env={**os.environ, 'TEMP': str(temp), 'TMP': str(temp), 'PYTHONIOENCODING': 'utf-8'})
    if result.returncode: raise RuntimeError(result.stdout + result.stderr)
    record = {'schema_version': '1', 'software_revision': '0.1', 'project': project.name,
        'executed_at': datetime.now(timezone.utc).isoformat(),
        'checks': {'python_syntax': 'pass', 'gpio_and_net_alignment': 'pass', 'host_unit_tests': 'pass'},
        'command': command, 'test_output': result.stdout + result.stderr,
        'source_sha256': {p.relative_to(project).as_posix(): digest(p) for p in files},
        'upstream_sha256': {p.relative_to(project).as_posix(): digest(p) for p in (plan_path, nets_path)},
        'target_micropython_execution': 'not_run', 'flashing': 'not_run', 'hardware_validation': 'not_run'}
    version = json.loads((project/'project.json').read_text(encoding='utf-8'))['project_version']
    evidence = project / 'doc/software_design' / ('verification-v0.2.json' if version == 3 else 'verification-v0.1.json')
    evidence.write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    from engine.interface.bridge import handle
    listing = handle({'method': 'software', 'project_path': str(project)})['projects']
    assert len(listing) == 1 and listing[0]['element_key'] == 'controller' and listing[0]['error'] is None
    assert listing[0]['relative_path'] == 'software/' + folder
    preview = handle({'method': 'software_preview', 'project_path': str(project), 'element_key': 'controller',
                      'path': 'software/' + folder + '/main.py'})
    assert 'def main():' in preview['text']
    record['checks']['engine_binding_and_code_preview'] = 'pass'
    evidence.write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(project.name + ': syntax, GPIO/net contract, host tests, software binding and preview PASS')
    print(result.stderr.strip())


if __name__ == '__main__':
    verify(2, 'Feather_RP2040_1')
    verify(4, 'Pico_1')
