import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Settings, imageConfig } from "../packages/core/src/settings";
test("四个设置模块：独立图像配置持久化、密钥脱敏及旧视觉模型兼容", async () => {
  const root = await mkdtemp(join(tmpdir(), "make-modules-"));
  const settings = new Settings(root);
  try {
    await writeFile(
      join(root, ".env"),
      "# legacy\nMAKE_VISION_MODEL=legacy-vision\n",
    );
    assert.equal((await settings.snapshot()).MAKE_IMAGE_MODEL, "legacy-vision");
    await settings.save({
      MAKE_BASE_URL: "https://reason.example/v1",
      MAKE_API_KEY: "reason-secret",
      MAKE_MODEL: "reason-model",
      MAKE_IMAGE_BASE_URL: "https://image.example/v1",
      MAKE_IMAGE_API_KEY: "image-secret",
      MAKE_IMAGE_MODEL: "image-model",
    });
    const snapshot = await settings.snapshot(),
      image = imageConfig(snapshot),
      view = await settings.public();
    assert.deepEqual(
      view.modules.map((m) => m.id),
      ["reasoning", "image", "cad", "system"],
    );
    assert.equal(snapshot.MAKE_BASE_URL, "https://reason.example/v1");
    assert.equal(image.MAKE_BASE_URL, "https://image.example/v1");
    assert.equal(image.MAKE_MODEL, "image-model");
    assert.equal(image.MAKE_API_KEY, "image-secret");
    assert.equal(
      view.fields.find((f) => f.key === "MAKE_IMAGE_API_KEY")?.value,
      "",
    );
    assert(!JSON.stringify(view).includes("image-secret"));
    await settings.save({ MAKE_PYTHON: ".venv/bin/python" });
    assert.equal((await settings.snapshot()).MAKE_IMAGE_MODEL, "image-model");
    await settings.save({
      MAKE_IMAGE_BASE_URL: "",
      MAKE_IMAGE_API_KEY: "",
      MAKE_IMAGE_MODEL: "",
    });
    const fallback = imageConfig(await settings.snapshot());
    assert.equal(fallback.MAKE_BASE_URL, "https://reason.example/v1");
    assert.equal(fallback.MAKE_API_KEY, "reason-secret");
    assert.equal(fallback.MAKE_MODEL, "reason-model");
    await assert.rejects(() =>
      settings.save({ MAKE_IMAGE_BASE_URL: "file:///private/etc/passwd" }),
    );
    assert.match(await readFile(join(root, ".env"), "utf8"), /# legacy/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("硬件资料入口可在 Settings 持久化且拒绝无效来源", async () => {
  const root = await mkdtemp(join(tmpdir(), "make-research-settings-"));
  const settings = new Settings(root);
  try {
    const view = await settings.public();
    assert.equal(
      view.fields.find((f) => f.key === "MAKE_RESEARCH_SOURCES")?.value,
      "https://www.raspberrypi.com/products/",
    );
    await settings.save({
      MAKE_RESEARCH_SOURCES:
        "https://learn.adafruit.com/, https://www.raspberrypi.com/products/",
    });
    assert.match(
      (await settings.public()).fields.find(
        (f) => f.key === "MAKE_RESEARCH_SOURCES",
      )!.value,
      /adafruit/,
    );
    await assert.rejects(
      settings.save({ MAKE_RESEARCH_SOURCES: "https://localhost/" }),
      /公共/,
    );
    await assert.rejects(settings.save({ MAKE_RESEARCH_SOURCES: "" }), /1–20/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("中英文设置保存后可恢复，非法语言不会覆盖已保存值", async () => {
  const root = await mkdtemp(join(tmpdir(), "make-language-"));
  try {
    const settings = new Settings(root);
    assert.equal((await settings.snapshot()).MAKE_LANGUAGE, "zh");
    await settings.save({ MAKE_LANGUAGE: "en" });
    const restored = new Settings(root);
    assert.equal((await restored.snapshot()).MAKE_LANGUAGE, "en");
    const field = (await restored.public()).fields.find(
      (f) => f.key === "MAKE_LANGUAGE",
    )!;
    assert.deepEqual(
      field.options?.map((o) => o.value),
      ["zh", "en"],
    );
    await assert.rejects(
      restored.save({ MAKE_LANGUAGE: "fr" }),
      /简体中文或英文/,
    );
    assert.equal((await restored.snapshot()).MAKE_LANGUAGE, "en");
    await restored.save({ MAKE_LANGUAGE: "zh" });
    assert.equal((await restored.snapshot()).MAKE_LANGUAGE, "zh");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
