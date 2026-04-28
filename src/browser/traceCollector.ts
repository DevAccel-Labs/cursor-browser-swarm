export function traceViewerCommand(tracePath: string): string {
  return `bunx playwright show-trace ${tracePath}`;
}
