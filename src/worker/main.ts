import { config } from 'dotenv'
import { closePool } from '@/lib/db'
import { buildHandlers } from '@/worker/handlers'
import { describeError, log } from '@/worker/log'
import { processNextEvent, type OutboxHandlers } from '@/worker/processNextEvent'
import { runWorker } from '@/worker/runWorker'

const DEFAULT_POLL_INTERVAL_MS = 2000

async function main(): Promise<void> {
  config({ quiet: true })

  const pollIntervalMs = Number(process.env.WORKER_POLL_INTERVAL_MS ?? DEFAULT_POLL_INTERVAL_MS)
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
    throw new Error('WORKER_POLL_INTERVAL_MS must be a positive number of milliseconds')
  }

  if (!process.env.DATABASE_URL) {
    log('error', 'worker.config', { error: 'DATABASE_URL is not set' })
    process.exitCode = 1
    return
  }

  let handlers: OutboxHandlers
  try {
    handlers = buildHandlers(process.env)
  } catch (error) {
    log('error', 'worker.config', { error: describeError(error) })
    process.exitCode = 1
    return
  }
  log('info', 'worker.started', { types: Object.keys(handlers) })

  // `once` : un second signal retrouve le comportement par défaut et tue le
  // processus si l'événement en cours ne se termine pas.
  const controller = new AbortController()
  process.once('SIGINT', () => controller.abort())
  process.once('SIGTERM', () => controller.abort())

  await runWorker({
    processNext: () => processNextEvent(handlers),
    pollIntervalMs,
    signal: controller.signal,
    onError: (error) => log('error', 'worker.error', { error: describeError(error) }),
  })

  await closePool()
  log('info', 'worker.stopped')
}

main().catch((error) => {
  log('error', 'worker.crashed', { error: describeError(error) })
  process.exitCode = 1
})
