import { describe, expect, it, vi } from 'vitest'
import { runWorker } from '@/worker/runWorker'

describe('runWorker', () => {
  it('enchaîne tant qu’il y a du travail, puis attend', async () => {
    const controller = new AbortController()
    const results = [true, true, false]
    const processNext = vi.fn(async () => {
      const next = results.shift()
      if (next === undefined) controller.abort()
      return next ?? false
    })
    await runWorker({ processNext, pollIntervalMs: 5, signal: controller.signal, onError: vi.fn() })
    expect(processNext).toHaveBeenCalledTimes(4)
  })

  it('signale une erreur et continue', async () => {
    const controller = new AbortController()
    const onError = vi.fn()
    const processNext = vi.fn()
      .mockRejectedValueOnce(new Error('database down'))
      .mockImplementationOnce(async () => { controller.abort(); return false })
    await runWorker({ processNext, pollIntervalMs: 5, signal: controller.signal, onError })
    expect(onError).toHaveBeenCalledWith(new Error('database down'))
    expect(processNext).toHaveBeenCalledTimes(2)
  })

  it('s’arrête pendant l’attente quand on le lui demande', async () => {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 20)
    const started = Date.now()
    await runWorker({ processNext: async () => false, pollIntervalMs: 60_000, signal: controller.signal, onError: vi.fn() })
    expect(Date.now() - started).toBeLessThan(1_000)
  })
})
