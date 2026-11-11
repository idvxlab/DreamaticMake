import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

const browser = await chromium.launch({ executablePath: process.env.MAKE_TEST_BROWSER, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await mkdir("test-results", { recursive: true });
  for (const [project, folder] of [["project_2", "Feather_RP2040_1"], ["project_4", "Pico_1"]]) {
    const query = new URLSearchParams({ project: `examples/${project}`, view: "software" });
    await page.goto(`http://127.0.0.1:4322/?${query}`);
    await page.getByRole("button", { name: "软件工程", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "软件工程", exact: true }).getAttribute("aria-pressed"), "true");
    await page.getByLabel("软件工程目录").locator("summary").filter({ hasText: new RegExp(`^▱\\s*${folder}$`) }).click();
    const main = `software/${folder}/main.py`;
    await page.getByRole("button", { name: `预览 ${main}`, exact: true }).click();
    await page.locator(".software-code").filter({ hasText: "def main():" }).waitFor();
    await page.screenshot({ path: `test-results/${project}-software.png`, fullPage: true });
    const file = project === "project_2" ? "alarm.py" : "safe.py";
    await page.getByRole("button", { name: `预览 software/${folder}/${file}`, exact: true }).click();
    await page.locator(".software-code").filter({ hasText: project === "project_2" ? "class AlarmClock:" : "class SafeController:" }).waitFor();
    await page.getByLabel("查看范围").selectOption("controller");
    await page.getByLabel("软件工程目录").locator("summary").filter({ hasText: /controller ·/ }).waitFor();
    await page.getByLabel("查看范围").selectOption(project === "project_2" ? "display" : "door");
    await page.getByText("当前范围没有关联的软件工程。", { exact: false }).waitFor();
    assert.equal(await page.locator(".software-code").count(), 0);
    console.log(`PASS ${project}: project deep link, main/core source, controller scope and non-controller empty state`);
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
