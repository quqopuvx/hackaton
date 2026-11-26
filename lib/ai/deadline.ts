export class SearchDeadlineError extends Error {}

/** Settle even when a provider leaves its response body or cancellation pending. */
export async function withSearchDeadline<T>(
  milliseconds: number, message: string, work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const reason = new SearchDeadlineError(message);
      reject(reason);
      controller.abort(reason);
    }, milliseconds);
  });
  try {
    return await Promise.race([work(controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
