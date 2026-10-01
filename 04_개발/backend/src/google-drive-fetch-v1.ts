export const GOOGLE_DRIVE_FETCH_TIMEOUT_MS = 15_000;

export function googleDriveRequestSignal(
  callerSignal?: AbortSignal,
  timeoutMs = GOOGLE_DRIVE_FETCH_TIMEOUT_MS
): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return callerSignal
    ? AbortSignal.any([callerSignal, timeoutSignal])
    : timeoutSignal;
}

export function boundedGoogleDriveFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = GOOGLE_DRIVE_FETCH_TIMEOUT_MS
): Promise<Response> {
  return fetch(input, {
    ...init,
    signal: googleDriveRequestSignal(init.signal ?? undefined, timeoutMs)
  });
}
