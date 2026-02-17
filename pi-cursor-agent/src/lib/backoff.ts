type BackoffConfig = {
  retries: number;
  delay: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
};

const sleep = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

export const backoff = async <T>(
  fn: () => Promise<T>,
  { retries, delay, shouldRetry }: BackoffConfig,
): Promise<T> => {
  let lastError: unknown;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (shouldRetry && !shouldRetry(error, attempt)) {
        throw error;
      }

      await sleep(delay);
    }
  }

  throw lastError;
};
