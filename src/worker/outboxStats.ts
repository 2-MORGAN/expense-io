import type { OutboxTypeStats } from '@/lib/outbox'
import { outboxStats } from '@/lib/outbox'
import { describeError, log } from '@/worker/log'

/**
 * Métriques de l'outbox (ADR-003 §6, Q5) : toutes les minutes, une ligne de
 * journal `outbox.stats` que le collecteur de logs transforme en jauges
 * (`outbox_events_pending`, `outbox_events_dead`,
 * `outbox_oldest_pending_age_seconds`). Une file qui vieillit ou une DLQ qui
 * grossit se voit sans ouvrir la base (MTTD, cours 4).
 */
export const DEFAULT_STATS_INTERVAL_MS = 60_000

export interface OutboxSummary {
  pending: number
  dead: number
  oldestPendingAgeSeconds: number | null
  byType: OutboxTypeStats[]
}

export function summarizeOutbox(byType: OutboxTypeStats[]): OutboxSummary {
  const ages = byType.map((t) => t.oldestPendingAgeSeconds).filter((age): age is number => age !== null)
  return {
    pending: byType.reduce((sum, t) => sum + t.pending, 0),
    dead: byType.reduce((sum, t) => sum + t.dead, 0),
    oldestPendingAgeSeconds: ages.length > 0 ? Math.max(...ages) : null,
    byType,
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

export async function runOutboxStats(
  signal: AbortSignal,
  intervalMs = DEFAULT_STATS_INTERVAL_MS,
  read: () => Promise<OutboxTypeStats[]> = outboxStats,
): Promise<void> {
  while (!signal.aborted) {
    try {
      log('info', 'outbox.stats', { ...summarizeOutbox(await read()) })
    } catch (error) {
      if (!signal.aborted) log('warn', 'outbox.stats.failed', { error: describeError(error) })
    }
    await pause(intervalMs, signal)
  }
}
