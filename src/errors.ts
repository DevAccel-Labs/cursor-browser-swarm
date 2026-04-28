export class SwarmError extends Error {
  constructor(
    message: string,
    public readonly code = "SWARM_ERROR",
  ) {
    super(message);
    this.name = "SwarmError";
  }
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
