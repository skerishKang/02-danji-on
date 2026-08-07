export function createApplicationIdempotencyKey(): string {
  return `application:${crypto.randomUUID()}`;
}

export async function retryNetworkOnce<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    // Browser fetch rejects with TypeError for network-level failures.
    // HTTP 4xx/5xx errors are converted to ordinary Error by the API adapter
    // and must not be retried automatically here.
    if (error instanceof TypeError) return action();
    throw error;
  }
}
