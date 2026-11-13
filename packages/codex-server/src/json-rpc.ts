import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

type RpcMessage = { id?: number | string; method?: string; params?: unknown; result?: unknown; error?: unknown };

export class JsonRpcConnection {
  private nextId = 1;
  private pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  private listeners = new Set<(message: RpcMessage) => void>();
  private closeListeners = new Set<() => void>();
  private closed = false;

  constructor(input: Readable, private readonly output: Writable) {
    const lines = createInterface({ input });
    lines.on("line", (line) => {
      let message: RpcMessage;
      try { message = JSON.parse(line) as RpcMessage; } catch { return; }
      if (typeof message.id === "number" && ("result" in message || "error" in message)) {
        const waiter = this.pending.get(message.id);
        if (!waiter) return;
        this.pending.delete(message.id);
        if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
        else waiter.resolve(message.result);
        return;
      }
      for (const listener of this.listeners) listener(message);
    });
    const close = () => {
      if (this.closed) return;
      this.closed = true;
      for (const waiter of this.pending.values()) waiter.reject(new Error("Codex app-server connection closed"));
      this.pending.clear();
      for (const listener of this.closeListeners) listener();
      this.closeListeners.clear();
    };
    lines.once("close", close);
    output.once("error", close);
  }

  request<T>(method: string, params: unknown, signal?: AbortSignal): Promise<T> {
    if (this.closed) return Promise.reject(new Error("Codex app-server connection closed"));
    if (signal?.aborted) return Promise.reject(signal.reason);
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const abort = () => {
        this.pending.delete(id);
        reject(signal?.reason);
      };
      this.pending.set(id, {
        resolve: (value) => { signal?.removeEventListener("abort", abort); resolve(value as T); },
        reject: (error) => { signal?.removeEventListener("abort", abort); reject(error); },
      });
      signal?.addEventListener("abort", abort, { once: true });
      this.output.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  notify(method: string, params?: unknown): void {
    this.output.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }

  respond(id: number | string, result: unknown): void {
    if (!this.closed) this.output.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
  }

  onNotification(listener: (message: RpcMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onClose(listener: () => void): () => void {
    if (this.closed) listener();
    else this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }
}
