// En premier : la télémétrie (ADR-007) démarre avant le chargement de pg.
import { telemetry } from '@/worker/telemetry'
import { config } from 'dotenv'
import { closePool, configureDatabase } from '@/lib/db'
import { checkDatabaseRole } from '@/lib/dbRole'
import { outboxStats } from '@/lib/outbox'
import { backlogOf, observeOutboxBacklog } from '@/lib/telemetry/outbox'
import { buildHandlers } from '@/worker/handlers'
import { describeError, log } from '@/worker/log'
import { DEFAULT_STATS_INTERVAL_MS, runOutboxStats } from '@/worker/outboxStats'
import { processNextEvent, type OutboxHandlers } from '@/worker/processNextEvent'
import { runReceiptCleanup } from '@/worker/receiptAnalysis'
import { runWorker } from '@/worker/runWorker'

const DEFAULT_POLL_INTERVAL_MS = 2000
// Deux boucles : une analyse de reçu longue ne bloque pas les autres événements.
// La concurrence de l'OCR reste bornée à 2 par ses propres verrous (ADR-003 §1).
const CONSUMERS = 2

async function main(): Promise<void> {
  config({ quiet: true })

  const pollIntervalMs = Number(process.env.WORKER_POLL_INTERVAL_MS ?? DEFAULT_POLL_INTERVAL_MS)
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
    throw new Error('WORKER_POLL_INTERVAL_MS must be a positive number of milliseconds')
  }

  // Rôle `expense_worker` (2-481) : il lit et met à jour l'outbox de toutes
  // les entreprises, ce que le rôle de l'application ne peut pas. En
  // développement, un `.env` antérieur retombe sur `DATABASE_URL` (le
  // contrôle du rôle l'avertit).
  const databaseUrl = process.env.WORKER_DATABASE_URL
    ?? (process.env.NODE_ENV === 'production' ? undefined : process.env.DATABASE_URL)
  if (!databaseUrl) {
    log('error', 'worker.config', { error: 'WORKER_DATABASE_URL is not set' })
    process.exitCode = 1
    return
  }
  configureDatabase(databaseUrl, 'expense-worker')
  await checkDatabaseRole('worker')

  // Configuration incomplète en production (APP_URL, SMTP_HOST) : le worker
  // refuse de démarrer plutôt que d'échouer à chaque email (2-484).
  let handlers: OutboxHandlers
  try {
    handlers = buildHandlers(process.env)
  } catch (error) {
    log('error', 'worker.config', { error: describeError(error) })
    process.exitCode = 1
    return
  }
  log('info', 'worker.started', { types: Object.keys(handlers) })
  // Mêmes chiffres que la ligne `outbox.stats`, en jauges OpenTelemetry (ADR-007).
  if (telemetry) {
    const types = Object.keys(handlers)
    observeOutboxBacklog(telemetry.meterProvider.getMeter('expense-io'), async () => backlogOf(await outboxStats(), types))
  }

  // `once` : un second signal retrouve le comportement par défaut et tue le
  // processus si l'événement en cours ne se termine pas.
  const controller = new AbortController()
  process.once('SIGINT', () => controller.abort())
  process.once('SIGTERM', () => controller.abort())

  const consumers = Array.from({ length: CONSUMERS }, () => runWorker({
    processNext: () => processNextEvent(handlers, { signal: controller.signal }),
    pollIntervalMs,
    signal: controller.signal,
    onError: (error) => log('error', 'worker.error', { error: describeError(error) }),
  }))
  const statsIntervalMs = Number(process.env.OUTBOX_STATS_INTERVAL_MS ?? DEFAULT_STATS_INTERVAL_MS)
  await Promise.all([
    ...consumers,
    runReceiptCleanup(controller.signal),
    runOutboxStats(controller.signal, Number.isFinite(statsIntervalMs) && statsIntervalMs > 0 ? statsIntervalMs : DEFAULT_STATS_INTERVAL_MS),
  ])

  log('info', 'worker.stopped')
  // Dernier envoi de la télémétrie avant de fermer la base : la mesure de
  // l'outbox la relit une dernière fois.
  await telemetry?.shutdown()
  await closePool()
}

main()
  .catch((error) => {
    log('error', 'worker.crashed', { error: describeError(error) })
    process.exitCode = 1
  })
  .finally(() => telemetry?.shutdown())
