import { ApiResponseError } from './apiError'
import type { components } from '@/types/api'

export type ReceiptSuggestion = components['schemas']['ReceiptSuggestion']

function pause(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted()
    const abort = () => { clearTimeout(timer); reject(signal.reason) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, 300)
    signal.addEventListener('abort', abort, { once: true })
  })
}

export async function analyzeReceipt(receipt: File, signal: AbortSignal): Promise<ReceiptSuggestion> {
  const formData = new FormData()
  formData.set('receipt', receipt)
  const started = await fetch('/api/receipt-analyses', {
    method: 'POST', body: formData, headers: { 'Idempotency-Key': crypto.randomUUID() }, signal,
  })
  if (started.status !== 202) throw new ApiResponseError(await started.json().catch(() => null), 'Impossible d’analyser ce reçu.')
  const accepted = await started.json() as components['schemas']['AnalysisAccepted']
  if (typeof accepted.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(accepted.id)) throw new Error('Invalid analysis response')
  while (true) {
    signal.throwIfAborted()
    const response = await fetch(`/api/receipt-analyses/${accepted.id}`, { signal, cache: 'no-store' })
    if (!response.ok) throw new ApiResponseError(await response.json().catch(() => null), 'Impossible d’analyser ce reçu.')
    const analysis = await response.json() as components['schemas']['ReceiptAnalysis']
    if (analysis.status === 'succeeded' && analysis.result) return analysis.result
    if (analysis.status !== 'queued' && analysis.status !== 'running') throw new ApiResponseError(analysis.error, 'Impossible d’analyser ce reçu.')
    await pause(signal)
  }
}
