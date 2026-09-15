/**
 * In-process concurrency limiter for executions. Swap for BullMQ/Redis when
 * running several server instances.
 */
export class ExecutionQueue {
  private running = 0;
  private waiting: (() => void)[] = [];

  constructor(private readonly concurrency: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.running >= this.concurrency) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.running++;
    try {
      return await task();
    } finally {
      this.running--;
      this.waiting.shift()?.();
    }
  }

  get stats() {
    return { running: this.running, waiting: this.waiting.length };
  }
}
