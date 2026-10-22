import { setTimeout as delay } from 'node:timers/promises'
import { PostgresOutboxAdapter } from './adapters/PostgresOutboxAdapter'
import { PostgresReceiptAnalysisWork } from './adapters/PostgresReceiptAnalysisWork'
import { S3ReceiptAdapter } from './adapters/S3ReceiptAdapter'
import { ProcessReceiptAnalysis } from './application/ProcessReceiptAnalysis'
import { ocrCapacity, suggestReceiptFields, ocrExecution } from './composition/ocr'
import { closeWorkerDb } from './lib/workerDb'
import type { OutboxEvent } from './ports/OutboxPort'

const stop = new AbortController()
process.once('SIGTERM', () => stop.abort())
process.once('SIGINT', () => stop.abort())
const outbox = new PostgresOutboxAdapter()
const work = new PostgresReceiptAnalysisWork()
const storage = new S3ReceiptAdapter()
const analysis = new ProcessReceiptAnalysis(work, storage, suggestReceiptFields, ocrCapacity, ocrExecution)

// Registre du worker commun : les handlers de notifications de 2-484 s'ajoutent ici.
// Les types inconnus ne sont jamais réclamés ni marqués comme traités.
const handlers: Record<string, (event: OutboxEvent) => Promise<void>> = {
  'receipt.analysis.requested': (event) => analysis.execute(event, stop.signal),
}

async function consume() {
  while (!stop.signal.aborted) {
    try {
      const event = await outbox.claim(Object.keys(handlers))
      if (event) await handlers[event.type](event)
      else await delay(250, undefined, { signal: stop.signal })
    } catch {
      if (!stop.signal.aborted) {
        console.error('[worker] Outbox temporarily unavailable')
        await delay(1000, undefined, { signal: stop.signal }).catch(() => {})
      }
    }
  }
}

async function cleanup() {
  while (!stop.signal.aborted) {
    try {
      for (const row of await work.cleanupCandidates()) {
        await storage.delete(row.receipt_key)
        await work.markDeleted(row.id, row.user_id)
      }
      await work.purgeExpired()
    } catch { if (!stop.signal.aborted) console.error('[worker] Receipt cleanup will be retried') }
    await delay(10_000, undefined, { signal: stop.signal }).catch(() => {})
  }
}

async function main() {
  await Promise.all([consume(), consume(), cleanup()])
  await closeWorkerDb()
  // Le pool utilisé par withUserScope peut rester ouvert après l'arrêt des jobs.
  process.exit(0)
}
void main().catch(() => { console.error('[worker] Shutdown failed'); process.exit(1) })
