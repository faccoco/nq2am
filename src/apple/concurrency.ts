export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  onSettled?: (result: R, index: number, completed: number) => void
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }

  const limit = Math.max(1, Math.min(Math.floor(concurrency), items.length));
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  let completed = 0;

  async function runWorker(): Promise<void> {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) {
        return;
      }

      const result = await worker(items[index], index);
      results[index] = result;
      completed += 1;
      onSettled?.(result, index, completed);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => runWorker()));
  return results;
}
