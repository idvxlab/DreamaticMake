import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'engine/interface/vite.config.ts', '--port', '4324'],
  { windowsHide: true, stdio: 'pipe' });
let logs = '';
server.stdout.on('data', chunk => logs += chunk);
server.stderr.on('data', chunk => logs += chunk);
let browser;
try {
  for (let i=0;i<100;i++) {
    try { if ((await fetch('http://127.0.0.1:4324')).ok) break; } catch { /* starting */ }
    await new Promise(r => setTimeout(r,100));
    if (i===99) throw new Error(logs);
  }
  browser = await chromium.launch({executablePath: process.env.MAKE_TEST_BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless:true,args:['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page = await browser.newPage({viewport:{width:1500,height:1000}});
  const errors: string[] = []; page.on('pageerror',e => errors.push(e.message));
  await page.goto('http://127.0.0.1:4324/?project='+encodeURIComponent(resolve('examples/project_2')));
  const panel = page.getByRole('region',{name:'工具分析结果'});
  await panel.getByRole('button',{name:'运行分析'}).waitFor();
  await page.waitForFunction(() => !(document.querySelector('[aria-label="工具分析结果"] button') as HTMLButtonElement)?.disabled);
  await panel.getByRole('button',{name:'运行分析'}).click();
  await panel.getByText('completed / pass',{exact:true}).waitFor();
  assert.match(await panel.innerText(),/覆盖 37 个对象/);
  await panel.getByLabel('分析工具').selectOption('sismic_statechart');
  await panel.getByLabel('操作',{exact:true}).selectOption('simulate');
  await panel.getByLabel('已登记场景').fill('simulation/interlock.json');
  await panel.getByRole('button',{name:'运行分析'}).click();
  await panel.getByRole('status').filter({hasText:'restricted-v1 requires one unit'}).waitFor();
  await panel.getByLabel('分析工具').selectOption('occt_geometry');
  await panel.getByRole('button',{name:'运行分析'}).click();
  await panel.getByText('completed / unknown',{exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  console.log('Tool UI smoke passed: FK, explicit missing Sismic model, real STEP geometry, no browser errors');
} finally {
  await browser?.close();
  server.kill();
}
