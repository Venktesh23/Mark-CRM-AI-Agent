export async function safeAsync<T>(
  op: () => Promise<T>,
  onError?: (error: unknown) => void
): Promise<T | null> {
  try {
    return await op();
  } catch (error) {
    onError?.(error);
    return null;
  }
}

export function toErrorMessage(error: unknown, fallback = "Unexpected error"): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}
