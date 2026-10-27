import { describe, expect, it, vi } from 'vitest'
import { runOutboxStats, summarizeOutbox } from './outboxStats'

describe('métriques de l’outbox (ADR-003 §6)', () => {
  it('totalise en attente et morts, garde l’âge du plus ancien en attente', () => {
    expect(summarizeOutbox([
      { type: 'a', pending: 2, dead: 0, oldestPendingAgeSeconds: 30 },
      { type: 'b', pending: 1, dead: 3, oldestPendingAgeSeconds: 600 },
      { type: 'c', pending: 0, dead: 1, oldestPendingAgeSeconds: null },
    ])).toMatchObject({ pending: 3, dead: 4, oldestPendingAgeSeconds: 600 })
  })

  it('outbox vide : zéro, sans âge', () => {
    expect(summarizeOutbox([])).toEqual({ pending: 0, dead: 0, oldestPendingAgeSeconds: null, byType: [] })
  })

  it('écrit une ligne outbox.stats par passage, et continue après une erreur de lecture', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const controller = new AbortController()
    let calls = 0
    const read = vi.fn(async () => {
      calls += 1
      if (calls === 1) throw new Error('base indisponible')
      controller.abort()
      return [{ type: 'a', pending: 1, dead: 0, oldestPendingAgeSeconds: 5 }]
    })
    await runOutboxStats(controller.signal, 1, read)
    expect(read).toHaveBeenCalledTimes(2)
    expect(JSON.parse(String(warn.mock.calls[0][0]))).toMatchObject({ msg: 'outbox.stats.failed' })
    expect(JSON.parse(String(info.mock.calls[0][0]))).toMatchObject({ msg: 'outbox.stats', pending: 1, oldestPendingAgeSeconds: 5 })
    vi.restoreAllMocks()
  })
})
