import { ownerFor } from "./roles";
import type { AgentExecutor, AgentRunEvent, StageExecutionRequest } from "./contracts";

export class WorkflowCoordinator {
  constructor(private readonly executor: AgentExecutor) {}

  async *run(
    request: Omit<StageExecutionRequest, "agent">,
    signal?: AbortSignal,
  ): AsyncIterable<AgentRunEvent> {
    const agent = ownerFor(request.stage);
    for await (const event of this.executor.execute({ ...request, agent }, signal)) {
      yield event;
    }
  }
}
