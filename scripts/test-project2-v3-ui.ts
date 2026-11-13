import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--config','engine/interface/vite.config.ts','--host','127.0.0.1','--port','4325'],{windowsHide:true,stdio:'pipe'});
let logs='';server.stdout.on('data',c=>logs+=c);server.stderr.on('data',c=>logs+=c);
let browser;
try {
  let startupError='';
  for(let i=0;i<150;i++) {
    try {const response=await fetch('http://127.0.0.1:4325');if(response.ok)break;startupError=`HTTP ${response.status}: ${await response.text()}`;}
    catch(error){startupError=String(error);}
    await new Promise(r=>setTimeout(r,100));if(i===149)throw new Error(logs+'\n'+startupError);
  }
  browser=await chromium.launch({executablePath:process.env.MAKE_TEST_BROWSER??'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless:true,args:['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:1500,height:1000}});
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:4325/?project='+encodeURIComponent(resolve('examples/project_2')));
  // The compatibility preview includes one USB-input placeholder; native v3 has 37 physical links.
  await page.locator('.engine-scene[data-body-count="38"]').waitFor();
  assert.equal(await page.getByLabel('查看范围').locator('option').count(),44);
  await page.getByRole('button',{name:'运动视图',exact:true}).click();
  await page.getByLabel('button_stop/joints/press',{exact:true}).waitFor();
  assert.equal(await page.locator('.joint input').count(),5);
  const [moved]=await Promise.all([
    page.waitForResponse(r=>r.url().endsWith('/engine-api')&&r.request().postDataJSON()?.joint_inputs?.['button_stop/joints/press']===.0002),
    page.getByLabel('button_stop/joints/press',{exact:true}).evaluate(element=>{
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(element,'0.0002');
      element.dispatchEvent(new Event('input',{bubbles:true}));
      element.dispatchEvent(new Event('change',{bubbles:true}));
    }),
  ]);
  assert.equal((await moved.json()).motion.status,'completed');
  await page.getByLabel('查看范围').selectOption('button_stop/cap');
  const panel=page.getByRole('region',{name:'工具分析结果'});
  await page.waitForFunction(()=>!(document.querySelector('[aria-label="工具分析结果"] button') as HTMLButtonElement)?.disabled);
  await panel.getByRole('button',{name:'运行分析'}).click();
  await panel.getByText('completed / pass',{exact:true}).waitFor();
  assert.match(await panel.innerText(),/覆盖 1 个对象/);
  await page.getByRole('button',{name:'软件工程',exact:true}).click();
  await page.getByLabel('查看范围').selectOption('controller');
  await page.getByLabel('软件工程目录').locator('summary').filter({hasText:/^▱\s*Feather_RP2040_1$/}).click();
  await page.getByRole('button',{name:'预览 software/Feather_RP2040_1/main.py',exact:true}).click();
  await page.locator('.software-code').filter({hasText:'def main():'}).waitFor();
  assert.deepEqual(errors,[]);
  await mkdir('workspace/tools/ui',{recursive:true});
  await page.screenshot({path:'workspace/tools/ui/project2-v3-software.png',fullPage:true});
  console.log('PASS project_2 v3 UI: 43 targets, 38 preview bodies including USB placeholder, 5 joints, motion input, scoped FK, controller software preview');
} finally {await browser?.close();server.kill();}
