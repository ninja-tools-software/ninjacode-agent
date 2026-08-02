/** Serialize Mermaid renders — the library uses shared global state. */
let tail: Promise<void> = Promise.resolve();

export function queueMermaidRender<T>(task: () => Promise<T>): Promise<T> {
  const run = tail.then(task, task);
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Reset queue between tests. */
export function resetMermaidRenderQueue(): void {
  tail = Promise.resolve();
}
