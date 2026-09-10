/**
 * A tiny async mutex. Guarantees at most one browser job runs at a time — the
 * operator's Chrome has a single logged-in session and concurrent automation
 * would trip account-safety heuristics and race on the shared context.
 */
export class Mutex {
  private tail: Promise<void> = Promise.resolve();

  /** Run `fn` exclusively; callers queue in order. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

/** Process-wide browser mutex. */
export const browserMutex = new Mutex();
