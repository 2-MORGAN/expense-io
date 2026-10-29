export interface OcrExecutionPort {
  run<T>(userId: string, signal: AbortSignal, task: () => Promise<T>): Promise<T>
}
