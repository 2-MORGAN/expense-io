import { PostgresReceiptAnalysisWork } from '@/modules/receipt-analysis/adapters/PostgresReceiptAnalysisWork'
import { S3ReceiptAdapter } from '@/adapters/S3ReceiptAdapter'
import {
  ANALYSIS_BACKOFF_SECONDS,
  MAX_ANALYSIS_ATTEMPTS,
  ProcessReceiptAnalysis,
} from '@/modules/receipt-analysis/application/ProcessReceiptAnalysis'
import { ocrCapacity, ocrExecution, suggestReceiptFields } from '@/composition/ocr'
import { RECEIPT_ANALYSIS_REQUESTED } from '@/modules/receipt-analysis/domain/analysisPayload'
import { log } from '@/worker/log'
import type { OutboxHandlers } from '@/worker/processNextEvent'

const CLEANUP_INTERVAL_MS = 10_000

const work = new PostgresReceiptAnalysisWork()
const storage = new S3ReceiptAdapter()

/** Analyse asynchrone des reçus (2-475) : traitement détaché, hors transaction. */
export function receiptAnalysisHandlers(): OutboxHandlers {
  const analysis = new ProcessReceiptAnalysis(work, storage, suggestReceiptFields, ocrCapacity, ocrExecution)
  return {
    [RECEIPT_ANALYSIS_REQUESTED]: {
      maxRetries: MAX_ANALYSIS_ATTEMPTS - 1,
      backoffSeconds: ANALYSIS_BACKOFF_SECONDS,
      run: (event, signal) => analysis.execute(event, signal),
    },
  }
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
    function done() {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
  })
}

/**
 * Supprime de S3 les reçus des analyses terminées, puis les analyses expirées
 * (24 h) et leurs événements. Le listage et la purge, qui portent sur toutes
 * les entreprises, passent par des fonctions `SECURITY DEFINER` étroites ;
 * `markDeleted` écrit sous l'utilisateur de l'analyse (2-481, ADR-001).
 */
export async function runReceiptCleanup(signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    try {
      for (const row of await work.cleanupCandidates()) {
        await storage.delete(row.receipt_key)
        await work.markDeleted(row.id, row.user_id)
      }
      await work.purgeExpired()
    } catch {
      if (!signal.aborted) log('warn', 'receipt_cleanup.retry')
    }
    await pause(CLEANUP_INTERVAL_MS, signal)
  }
}
