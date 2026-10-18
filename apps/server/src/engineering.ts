import { readFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store, HttpError } from "../../../packages/core/src/store";
import { Settings } from "../../../packages/core/src/settings";
import {
  enclosureSchema,
  type Artifact,
  type Part,
} from "../../../packages/core/src/contracts";
import { generateCad, buildFirmware } from "../../../packages/core/src/worker";
import { describeToolObject } from "../../../packages/core/src/tool-activity";
import { invalidate } from "../../../packages/core/src/workflow";
export class Engineering {
  private busy = new Map<string, AbortController>();
  constructor(
    readonly root: string,
    readonly store: Store,
    readonly settings: Settings,
    readonly catalog: Part[],
  ) {}
  async cad(id: string, input: unknown, signal?: AbortSignal) {
    if (this.busy.has(id)) throw new HttpError(409, "工程工具正在运行");
    const controller = new AbortController();
    this.busy.set(id, controller);
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    let activity: Record<string, unknown> | undefined;
    try {
      if ((await this.store.get(id)).stages.cad.status === "approved") {
        await this.store.update(id, (p) => invalidate(p, "cad"));
      }
      const p = await this.store.get(id),
        parameters = enclosureSchema.parse(input),
        revision = p.stages.cad.revision;
      const dir = join(this.store.dir(id), "jobs", randomUUID());
      const config = {
        ...(await this.settings.snapshot()),
        MAKE_WORKSPACE: this.store.root,
      };
      activity = {
        operationId: randomUUID(),
        name: "CAD 几何工作进程",
        stage: "cad",
        revision,
        object:
          describeToolObject(
            "text_to_cad",
            { parameters },
            { projectName: p.name, stage: "cad", revision },
          ) + ` / jobs/${dir.split("/").at(-1)}`,
      };
      await this.store.emit(id, "tool.started", activity);
      const report = await generateCad(
        this.root,
        dir,
        parameters,
        config,
        controller.signal,
      );
      const artifacts: Artifact[] = [];
      for (const name of report.files) {
        const mime = name.endsWith(".stl")
          ? "model/stl"
          : name.endsWith(".step")
            ? "application/step"
            : name.endsWith(".json")
              ? "application/json"
              : "text/x-python";
        artifacts.push(
          await this.store.artifact(
            id,
            "cad",
            revision,
            name,
            await readFile(join(dir, name)),
            mime,
          ),
        );
      }
      await this.store.update(id, (p) => {
        if (
          p.stages.cad.revision !== revision ||
          JSON.stringify(p.parameters) !== JSON.stringify(parameters)
        )
          throw new HttpError(409, "生成期间参数已改变");
        p.stages.cad.artifacts = artifacts;
        p.stages.cad.review = undefined;
      });
      await this.store.emit(id, "artifact.ready", { stage: "cad", artifacts });
      await this.store.emit(id, "tool.completed", activity!);
      return { report, artifacts };
    } catch (error) {
      if (activity)
        await this.store.emit(id, "tool.failed", {
          ...activity,
          error: String(error),
        });
      throw error;
    } finally {
      signal?.removeEventListener("abort", abort);
      this.busy.delete(id);
    }
  }
  async firmware(id: string, source: string, signal?: AbortSignal) {
    if (this.busy.has(id)) throw new HttpError(409, "工程工具正在运行");
    const p = await this.store.get(id);
    if (!p.selectedParts.includes("rpi-pico"))
      throw new HttpError(409, "当前固件适配仅支持目录中的 Raspberry Pi Pico");
    if (p.stages.hardware.status !== "approved")
      throw new HttpError(409, "需要先确认硬件");
    const controller = new AbortController();
    this.busy.set(id, controller);
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const activity = {
      operationId: randomUUID(),
      name: "固件构建工作进程",
      stage: "firmware",
      revision: p.stages.firmware.revision,
      object: describeToolObject(
        "firmware_build",
        {},
        {
          projectName: p.name,
          stage: "firmware",
          revision: p.stages.firmware.revision,
        },
      ),
    };
    await this.store.emit(id, "tool.started", activity);
    try {
      const dir = join(this.store.dir(id), "jobs", randomUUID());
      await mkdir(dir, { recursive: true });
      const config = {
        ...(await this.settings.snapshot()),
        MAKE_WORKSPACE: this.store.root,
      };
      const report = await buildFirmware(
        this.root,
        dir,
        source,
        config,
        controller.signal,
      );
      const rev = p.stages.firmware.revision;
      const files = [
        "platformio.ini",
        "src/main.cpp",
        "build.log",
        "report.json",
        "toolchain-lock.json",
      ];
      for (const f of await readdir(join(dir, ".pio/build/pico")))
        if (/^firmware\.(bin|elf|uf2|hex)$/.test(f))
          files.push(".pio/build/pico/" + f);
      const artifacts: Artifact[] = [];
      for (const file of files)
        artifacts.push(
          await this.store.artifact(
            id,
            "firmware",
            rev,
            file.split("/").at(-1)!,
            await readFile(join(dir, file)),
            "application/octet-stream",
          ),
        );
      await this.store.update(id, (p) => {
        if (p.stages.firmware.revision !== rev)
          throw new HttpError(409, "固件版本已失效");
        p.stages.firmware.artifacts = artifacts;
      });
      await this.store.emit(id, "tool.completed", activity);
      return { report, artifacts };
    } catch (error) {
      await this.store.emit(id, "tool.failed", {
        ...activity,
        error: String(error),
      });
      throw error;
    } finally {
      signal?.removeEventListener("abort", abort);
      this.busy.delete(id);
    }
  }
  async abort(id: string) {
    this.busy.get(id)?.abort();
  }
  isBusy(id: string) {
    return this.busy.has(id);
  }
}
