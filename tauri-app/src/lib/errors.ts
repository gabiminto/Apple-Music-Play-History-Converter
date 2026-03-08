export function getErrorMessage(error: unknown, fallback = "Unexpected error"): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  return fallback;
}

export function getShortError(error: unknown, fallback = "Unexpected error"): string {
  const message = getErrorMessage(error, fallback);
  const firstLine = message.split("\n").find((line) => line.trim().length > 0);
  return firstLine?.trim() || fallback;
}
