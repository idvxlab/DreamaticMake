import type { CadBackend, CadBackendId, CadJob, GeometryEvidence } from "./contracts";

export class CadCapabilityError extends Error {}

/**
 * Routes production work only to exact B-rep backends. JSCAD is intentionally
 * excluded from production selection and remains a browser preview renderer.
 */
export class CadRouter {
  private readonly priority: CadBackendId[] = ["rhino"];

  constructor(private readonly backends: CadBackend[]) {}

  async execute(job: CadJob, signal?: AbortSignal): Promise<GeometryEvidence> {
    const diagnostics: string[] = [];
    for (const id of this.priority) {
      const backend = this.backends.find((candidate) => candidate.id === id);
      if (!backend) continue;
      const missing = job.requiredCapabilities.filter((capability) => !backend.capabilities.has(capability));
      if (missing.length) {
        diagnostics.push(`${id}: missing ${missing.join(", ")}`);
        continue;
      }
      const availability = await backend.available();
      if (!availability.available) {
        diagnostics.push(`${id}: ${availability.reason ?? "unavailable"}`);
        continue;
      }
      const evidence = await backend.execute(job, signal);
      if (!evidence.validBrep || evidence.solidCount < 1 || evidence.volumeMm3 <= 0) {
        throw new CadCapabilityError(`${id} returned invalid or empty B-rep geometry`);
      }
      if (job.outputs.includes("step") && !evidence.outputs.some((output) => /\.step$/i.test(output.path))) {
        throw new CadCapabilityError(`${id} did not produce the required STEP artifact`);
      }
      return evidence;
    }
    throw new CadCapabilityError(`No production CAD backend satisfies the job. ${diagnostics.join("; ")}`);
  }
}
