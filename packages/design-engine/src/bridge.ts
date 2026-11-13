import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { StageId } from "../../orchestrator/src/contracts";

export interface ProcessContractRef {
  processKind: StageId;
  title: string;
  requiredUpstream: StageId[];
  optionalUpstream: StageId[];
  contextKeys: string[];
  limitations: string[];
  schemaPath: string;
  schemaSha256: string;
  elementLibrary?: { path: string; sha256: string; indexGeneration: string };
}

interface ProcessDescriptor {
  title: string;
  required_upstream: StageId[];
  optional_upstream: StageId[];
  context_keys: string[];
  limitations: string[];
}

export interface ValidatedDeliverable {
  deliverable: Record<string, unknown>;
  content_hash: string;
  mechanical_evidence?: MechanicalEvidence[];
}

export interface MechanicalEvidence {
  name: string;
  model: string;
  instances: string[];
  sampling_to_define_in_firmware?: string[];
  mechanical_evidence: { kind: "step" | "drawing"; path: string; sha256: string; locator?: string };
}

export class HardwareEvidenceError extends Error {}

export interface PurchaseCandidate {
  name: string;
  model: string;
  status: "候选" | "备选";
  note: string;
  purchase_links: { supplier: string; url: string; source: string }[];
}

export class DesignEngineBridge {
  constructor(private readonly root: string, private readonly python: string) {}

  private request<T>(command: "schema" | "validate-output" | "library-pins" | "purchase-candidates", stage: StageId, signal?: AbortSignal, input?: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.python, ["-B", "-m", "process", command, stage], {
        cwd: this.root, signal, stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      });
      let output = "", error = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        output += chunk;
        if (output.length > 16 * 1024 * 1024) child.kill();
      });
      child.stderr.on("data", (chunk: string) => { if (error.length < 4000) error += chunk; });
      child.on("error", reject);
      child.stdin.on("error", () => { /* Report errors from the process response. */ });
      child.stdin.end(input === undefined ? undefined : JSON.stringify(input));
      child.on("close", (code) => {
        try {
          const value = JSON.parse(output);
          if (code !== 0) {
            const fields = (value.fields as string[] | undefined)?.slice(0, 12).join("、");
            if (value.code === "HardwareEvidenceMissing" || value.code === "StaleElementLibrary") {
              const instances = (value.instances as string[] | undefined)?.join("、");
              reject(new HardwareEvidenceError(value.code === "StaleElementLibrary"
                ? "小零件库或尺寸附件已变化，请重新检索。"
                : `所选器件在小零件库中缺少可核验的 STEP 或带尺寸二维图纸。请检查 ${fields}（${instances}）。`));
            } else {
              reject(new Error(fields ? `${stage} 产物不符合契约。请检查 ${fields}` : `${stage} 产物不符合契约`));
            }
          } else resolve(value as T);
        } catch {
          reject(new Error(error.trim() || `设计契约进程 ${command} 未返回有效结果 (${code})`));
        }
      });
    });
  }

  async materialize(stage: StageId, workspace: string, signal?: AbortSignal): Promise<ProcessContractRef> {
    const descriptor = await this.request<ProcessDescriptor>("schema", stage, signal);
    const canonical = JSON.stringify(descriptor, null, 2) + "\n";
    const folder = join(workspace, "contracts");
    const path = join(folder, `${stage}.schema.json`);
    await mkdir(folder, { recursive: true });
    await writeFile(path, canonical, "utf8");
    const contract: ProcessContractRef = {
      processKind: stage, title: descriptor.title,
      requiredUpstream: descriptor.required_upstream ?? [], optionalUpstream: descriptor.optional_upstream ?? [],
      contextKeys: descriptor.context_keys ?? [], limitations: descriptor.limitations ?? [],
      schemaPath: relative(workspace, path), schemaSha256: createHash("sha256").update(canonical).digest("hex"),
    };
    if (stage === "hardware_selection") {
      const library = await this.request<{ index_generation: string }>("library-pins", stage, signal);
      const manifest = JSON.stringify(library, null, 2) + "\n";
      const libraryPath = join(folder, "element-library.json");
      await writeFile(libraryPath, manifest, "utf8");
      contract.elementLibrary = {
        path: relative(workspace, libraryPath), sha256: createHash("sha256").update(manifest).digest("hex"), indexGeneration: library.index_generation,
      };
    }
    return contract;
  }

  validateOutput(stage: StageId, deliverable: unknown, signal?: AbortSignal, libraryGeneration?: string) {
    return this.request<ValidatedDeliverable>("validate-output", stage, signal, { deliverable, element_library_generation: libraryGeneration });
  }

  purchaseCandidates(text: string, signal?: AbortSignal) {
    return this.request<PurchaseCandidate[]>("purchase-candidates", "procurement_assembly_guide", signal, { text });
  }
}
