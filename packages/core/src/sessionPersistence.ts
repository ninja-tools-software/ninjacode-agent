type PersistenceWrite = () => Promise<void>;

/**
 * Coalesces hot-path session writes while preserving a serialized, awaitable
 * durability boundary for checkpoints and terminal lifecycle transitions.
 */
export class DebouncedSessionPersistence {
  private pending?: PersistenceWrite;
  private timer?: NodeJS.Timeout;
  private draining?: Promise<void>;
  private backgroundError?: unknown;

  constructor(private readonly debounceMs: number) {}

  schedule(write: PersistenceWrite): void {
    this.pending = write;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.drain().catch((error: unknown) => {
        this.backgroundError = error;
      });
    }, this.debounceMs);
    this.timer.unref?.();
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    await this.drain();
    if (this.backgroundError !== undefined) {
      const error = this.backgroundError;
      this.backgroundError = undefined;
      throw error;
    }
  }

  private async drain(): Promise<void> {
    if (this.draining) await this.draining;
    while (this.pending) {
      const write = this.pending;
      this.pending = undefined;
      const draining = write();
      this.draining = draining;
      try {
        await draining;
      } finally {
        if (this.draining === draining) this.draining = undefined;
      }
    }
  }
}
